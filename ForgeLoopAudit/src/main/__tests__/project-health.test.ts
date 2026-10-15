import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { PathBoundary } from '@main/security/path-boundary';
import { ProjectSnapshotBuilder } from '@main/core/project/project-snapshot';

const KEY = 'a'.repeat(64);
const TIMESTAMP = '2026-08-20T10:00:00.000Z';

describe('project health vs canonical ownership', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'forgeloop-health-'));
    const taskDir = join(root, '.forgeloop', 'task-state', KEY);
    mkdirSync(join(root, '.forgeloop'), { recursive: true });
    mkdirSync(taskDir, { recursive: true });
    writeFileSync(join(root, '.forgeloop', 'config.json'), JSON.stringify({ schemaVersion: 1, protocolVersion: 1, complianceMode: 'standard' }));
    writeFileSync(join(taskDir, 'task.json'), JSON.stringify({
      schemaVersion: 1, protocolVersion: 1, taskId: 'TASK-001', taskKey: KEY,
      createdAt: TIMESTAMP, updatedAt: TIMESTAMP, writeClaims: [],
    }));
    writeFileSync(join(taskDir, 'work-state.json'), JSON.stringify({
      schemaVersion: 1, protocolVersion: 1, taskId: 'TASK-001',
      contractFingerprint: 'c'.repeat(64),
      repositoryFingerprint: { branch: 'main', head: null },
      phase: 'COMPLETE',
      selectedGuides: [], completedSteps: [], pendingSteps: [],
      checks: [], failures: [], blockers: [],
      lastUpdated: TIMESTAMP,
    }));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function makeBuilder(ownership: Record<string, unknown>, status = 'VALID') {
    return new ProjectSnapshotBuilder(
      new PathBoundary(root),
      {
        readConfig: () => ({ schemaVersion: 1, protocolVersion: 1, complianceMode: 'standard' }),
        tryReadConfig: () => ({ schemaVersion: 1, protocolVersion: 1, complianceMode: 'standard' }),
        listTaskKeys: () => [KEY],
        readTaskSummaryArtifacts: () => ({
          'task.json': { taskId: 'TASK-001', taskKey: KEY },
          'work-state.json': { phase: 'COMPLETE' },
        }),
        readTaskDescriptor: () => ({ taskId: 'TASK-001' }),
        listSessions: () => [],
        readGlobalPolicy: () => ({}),
      } as any,
      {} as never,
      { source: 'PROTOCOL_INFO', protocolVersion: 1, schemaVersion: 1, compatibilityMode: 'INTEGRATION_V1' } as any,
      false,
      {
        getPackageVersion: () => '1.5.0',
        getCapabilities: () => ({}) as never,
        readProtocolInfo: async () => ({ compatibility: { protocolVersion: 1, schemaVersion: 1 } }),
        listTasks: async () => ({ count: 1, tasks: [{ taskId: 'TASK-001', healthy: true, phase: 'COMPLETE', mutationAllowed: false }] }),
        readTaskStatus: async () => ({ phase: 'COMPLETE', status }),
        readTaskOwnership: async () => ownership,
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
      } as never,
    );
  }

  it('ownership inconsistency overrides otherwise valid lifecycle health', async () => {
    const snapshot = await makeBuilder({
      taskId: 'TASK-001',
      phase: 'COMPLETE',
      claimState: 'INCONSISTENT',
      mutationAllowed: false,
      ownershipValid: false,
      recoveryStatus: 'INCONSISTENT',
      historicalWriteClaims: [],
      effectiveWriteClaims: [],
      reasonCodes: ['E_TASK_CLAIM_OWNERSHIP_INCONSISTENT'],
    }).build();

    // The lifecycle aggregate would report VALID — canonical ownership wins.
    expect(snapshot.health.status).toBe('INCONSISTENT');
    expect(snapshot.health.source).toBe('FORGELOOP_OWNERSHIP');
  });

  it('keeps the canonical status aggregate when every ownership projection is healthy', async () => {
    const snapshot = await makeBuilder({
      taskId: 'TASK-001',
      phase: 'COMPLETE',
      claimState: 'RELEASED_BY_COMPLETION',
      mutationAllowed: false,
      ownershipValid: true,
      recoveryStatus: 'NOT_APPLICABLE',
      historicalWriteClaims: [],
      effectiveWriteClaims: [],
      reasonCodes: [],
    }).build();

    expect(snapshot.health.status).toBe('VALID');
    expect(snapshot.health.source).toBe('FORGELOOP_STATUS_AGGREGATE');
  });

  it('maps canonical revalidation status to the project STALE state', async () => {
    const snapshot = await makeBuilder({
      taskId: 'TASK-001',
      phase: 'COMPLETE',
      claimState: 'RELEASED_BY_COMPLETION',
      mutationAllowed: false,
      ownershipValid: true,
      recoveryStatus: 'NOT_APPLICABLE',
      historicalWriteClaims: [],
      effectiveWriteClaims: [],
      reasonCodes: [],
    }, 'REVALIDATION_REQUIRED').build();

    expect(snapshot.health.status).toBe('STALE');
    expect(snapshot.health.source).toBe('FORGELOOP_STATUS_AGGREGATE');
  });
});
