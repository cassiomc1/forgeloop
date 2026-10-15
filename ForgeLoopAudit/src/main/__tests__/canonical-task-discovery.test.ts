import { describe, it, expect } from 'vitest';
import { discoverCanonicalTasks, type CanonicalTaskDiscoveryAdapter } from '@main/core/integration/task-projection';

function adapterWith(entries: Array<{ taskId: string; phase: string | null; mutationAllowed?: boolean }>, options: { throwOnList?: Error } = {}): CanonicalTaskDiscoveryAdapter {
  return {
    async listTasks() {
      if (options.throwOnList) throw options.throwOnList;
      return {
        count: entries.length,
        tasks: entries.map((entry) => ({
          taskId: entry.taskId,
          healthy: true,
          phase: entry.phase,
          mutationAllowed: entry.mutationAllowed !== false,
        })),
      };
    },
  };
}

describe('core/integration/task-projection', () => {
  it('prefers the canonical task list as the semantic source', async () => {
    const result = await discoverCanonicalTasks(
      adapterWith([{ taskId: 'TASK-001', phase: 'COMPLETE' }, { taskId: 'TASK-002', phase: 'EXECUTING' }]),
      '/tmp/project',
      ['abc123', 'def456'],
    );
    expect(result.source).toBe('FORGELOOP_INTEGRATION');
    expect(result.tasks).toHaveLength(2);
    expect(result.tasks[0].taskId).toBe('TASK-001');
  });

  it('records a diagnostic when canonical and filesystem views diverge', async () => {
    const result = await discoverCanonicalTasks(
      adapterWith([{ taskId: 'TASK-001', phase: 'EXECUTING' }]),
      '/tmp/project',
      ['key-a', 'key-b', 'key-c'],
    );
    expect(result.diagnostics.some((entry) => entry.includes('parity'))).toBe(true);
  });

  it('does not emit a parity diagnostic when counts agree', async () => {
    const result = await discoverCanonicalTasks(
      adapterWith([{ taskId: 'TASK-001', phase: 'PLANNED' }]),
      '/tmp/project',
      ['key-a'],
    );
    expect(result.diagnostics).toEqual([]);
  });

  it('fails closed to UNAVAILABLE without inventing tasks when discovery errors', async () => {
    const result = await discoverCanonicalTasks(
      adapterWith([], { throwOnList: new Error('E_TASK_DESCRIPTOR_INVALID') }),
      '/tmp/project',
      ['key-a'],
    );
    expect(result.source).toBe('UNAVAILABLE');
    expect(result.tasks).toEqual([]);
    expect(result.diagnostics.some((entry) => entry.includes('E_TASK_DESCRIPTOR_INVALID'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Snapshot-level authority: project/tasks drives semantic task existence in
// INTEGRATION_V1 mode.
import { beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { PathBoundary } from '@main/security/path-boundary';
import { ProjectSnapshotBuilder } from '@main/core/project/project-snapshot';
import type { ForgeLoopIntegrationAdapter } from '@main/core/integration/forgeloop-integration';

const KEY = 'b'.repeat(64);

function integrationFor(tasks: Array<{ taskId: string }>): ForgeLoopIntegrationAdapter {
  return {
    getPackageVersion: () => '1.5.0',
    getCapabilities: () => ({}) as never,
    readProtocolInfo: async () => ({ compatibility: { protocolVersion: 1, schemaVersion: 1 } }),
    listTasks: async () => ({
      count: tasks.length,
      tasks: tasks.map((task) => ({ taskId: task.taskId, healthy: true, phase: 'EXECUTING', mutationAllowed: true })),
    }),
    readTaskStatus: async (_root: string, taskId: string) => ({ taskId, phase: 'EXECUTING' }),
    readTaskOwnership: async (_root: string, taskId: string) => ({
      taskId,
      phase: 'EXECUTING',
      claimState: 'ACTIVE',
      mutationAllowed: true,
      ownershipValid: true,
      recoveryStatus: null,
      historicalWriteClaims: [],
      effectiveWriteClaims: [],
      reasonCodes: [],
    }),
    readTaskContract: async () => ({}),
    readTaskContinuity: async () => ({}),
    executeReadOnly: async <T>(_root: string, command: string) => ({
      ok: true,
      command,
      exitCode: 0,
      result: {} as T | null,
      error: null,
      metadata: null,
    }),
  };
}

describe('canonical discovery authority over snapshot tasks', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'forgeloop-authority-'));
    mkdirSync(join(root, '.forgeloop'), { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('does not promote extra filesystem namespaces into semantic tasks', async () => {
    // Canonical view sees only TASK-001; the filesystem has an extra namespace.
    const builder = new ProjectSnapshotBuilder(
      new PathBoundary(root),
      {
        readConfig: () => ({ schemaVersion: 1, protocolVersion: 1 }),
        tryReadConfig: () => ({ schemaVersion: 1, protocolVersion: 1 }),
        listTaskKeys: () => [KEY, 'c'.repeat(64)],
        readTaskSummaryArtifacts: () => ({
          'task.json': { taskId: 'TASK-001' },
          'work-state.json': { phase: 'EXECUTING' },
        }),
        readTaskDescriptor: (key: string) =>
          key === KEY ? { taskId: 'TASK-001' } : { taskId: 'TASK-GHOST' },
        listSessions: () => [],
        readGlobalPolicy: () => ({}),
      } as any,
      {} as never,
      { source: 'PROTOCOL_INFO', protocolVersion: 1, schemaVersion: 1, compatibilityMode: 'INTEGRATION_V1' } as any,
      false,
      integrationFor([{ taskId: 'TASK-001' }]),
    );

    const snapshot = await builder.build();
    expect(snapshot.tasks).toHaveLength(1);
    expect(snapshot.tasks[0].taskId).toBe('TASK-001');
    expect(snapshot.diagnostics?.some((entry) => entry.includes('not a canonical task'))).toBe(true);
  });

  it('surfaces canonical task without namespace as diagnostic without a synthetic summary', async () => {
    const builder = new ProjectSnapshotBuilder(
      new PathBoundary(root),
      {
        readConfig: () => ({ schemaVersion: 1, protocolVersion: 1 }),
        tryReadConfig: () => ({ schemaVersion: 1, protocolVersion: 1 }),
        listTaskKeys: () => [],
        readTaskSummaryArtifacts: () => ({}),
        readTaskDescriptor: () => { throw new Error('missing'); },
        listSessions: () => [],
        readGlobalPolicy: () => ({}),
      } as any,
      {} as never,
      { source: 'PROTOCOL_INFO', protocolVersion: 1, schemaVersion: 1, compatibilityMode: 'INTEGRATION_V1' } as any,
      false,
      integrationFor([{ taskId: 'TASK-REMOTE' }]),
    );

    const snapshot = await builder.build();
    expect(snapshot.tasks).toHaveLength(0);
    expect(snapshot.diagnostics?.some((entry) => entry.includes('TASK-REMOTE') && entry.includes('no readable filesystem namespace'))).toBe(true);
  });

  it('never defaults corrupt namespaces to RECEIVED', async () => {
    const builder = new ProjectSnapshotBuilder(
      new PathBoundary(root),
      {
        readConfig: () => ({ schemaVersion: 1, protocolVersion: 1 }),
        tryReadConfig: () => ({ schemaVersion: 1, protocolVersion: 1 }),
        listTaskKeys: () => ['d'.repeat(64)],
        readTaskSummaryArtifacts: () => {
          throw new Error('task.json is not valid JSON');
        },
        readTaskDescriptor: () => {
          throw new Error('task.json is not valid JSON');
        },
        listSessions: () => [],
        readGlobalPolicy: () => ({}),
      } as any,
      {} as never,
      { source: 'PROTOCOL_INFO', protocolVersion: 1, schemaVersion: 1, compatibilityMode: 'INTEGRATION_V1' } as any,
      false,
      integrationFor([]),
    );

    const snapshot = await builder.build();
    expect(snapshot.tasks).toHaveLength(0);
    expect(snapshot.diagnostics?.some((entry) => entry.includes('corrupt task namespace'))).toBe(true);
  });

  it('fails closed when canonical discovery is unavailable in INTEGRATION_V1', async () => {
    const builder = new ProjectSnapshotBuilder(
      new PathBoundary(root),
      {
        readConfig: () => ({ schemaVersion: 1, protocolVersion: 1 }),
        tryReadConfig: () => ({ schemaVersion: 1, protocolVersion: 1 }),
        listTaskKeys: () => [KEY],
        readTaskSummaryArtifacts: () => ({}),
        readTaskDescriptor: () => ({ taskId: 'TASK-001' }),
        listSessions: () => [],
        readGlobalPolicy: () => ({}),
      } as any,
      {} as never,
      { source: 'PROTOCOL_INFO', protocolVersion: 1, schemaVersion: 1, compatibilityMode: 'INTEGRATION_V1' } as any,
      false,
      integrationFor([]),
    );
    (builder['integration'] as any).listTasks = async () => {
      throw new Error('E_TASK_DESCRIPTOR_INVALID');
    };

    await expect(builder.build()).rejects.toThrow(/Canonical task discovery unavailable/);
  });
});
