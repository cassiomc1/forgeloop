import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { PathBoundary } from '@main/security/path-boundary';
import { SchemaValidator } from '@main/core/protocol/validator';
import { createProjectReader } from '@main/core/project/project-reader';
import {
  createCanonicalTaskReadService,
  summarizeCanonicalTaskStatus,
  type CanonicalTaskReadService,
} from '@main/core/tasks/canonical-task-read-service';
import type { ForgeLoopIntegrationAdapter } from '@main/core/integration/forgeloop-integration';
import type { CanonicalOwnershipResource } from '@main/core/integration/types';

const KEY = 'a'.repeat(64);
const TIMESTAMP = '2026-08-20T10:00:00.000Z';

function descriptor(taskId: string): Record<string, unknown> {
  return {
    schemaVersion: 1,
    protocolVersion: 1,
    taskId,
    taskKey: KEY,
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
    writeClaims: [],
  };
}

function workState(phase: string): Record<string, unknown> {
  return {
    schemaVersion: 1,
    protocolVersion: 1,
    taskId: 'TASK-1',
    contractFingerprint: 'c'.repeat(64),
    repositoryFingerprint: { branch: 'main', head: null },
    phase,
    selectedGuides: [],
    completedSteps: [],
    pendingSteps: [],
    checks: [],
    failures: [],
    blockers: [],
    lastUpdated: TIMESTAMP,
  };
}

function ownership(overrides: Partial<CanonicalOwnershipResource>): CanonicalOwnershipResource {
  return {
    taskId: 'TASK-1',
    phase: null,
    claimState: 'ACTIVE',
    mutationAllowed: true,
    ownershipValid: true,
    recoveryStatus: null,
    historicalWriteClaims: [],
    effectiveWriteClaims: ['src/a.ts'],
    reasonCodes: [],
    ...overrides,
  };
}

function adapterWith(result: CanonicalOwnershipResource): ForgeLoopIntegrationAdapter {
  return {
    getPackageVersion: () => '1.5.0',
    getCapabilities: () => ({}) as never,
    readProtocolInfo: async () => ({}),
    listTasks: async () => ({ count: 1, tasks: [] }),
    readTaskStatus: async () => ({ phase: result.phase ?? 'EXECUTING' }),
    readTaskOwnership: async () => result,
    readTaskContract: async () => ({}),
    readTaskContinuity: async () => ({}),
    executeReadOnly: async <T>(_root: string, command: string) => ({
      ok: true,
      command,
      exitCode: 0,
      result: { currentPhase: result.phase ?? 'EXECUTING', action: 'NONE' } as T | null,
      error: null,
      metadata: { protocolVersion: 1 },
    }),
  };
}

describe('core/tasks/canonical-task-read-service', () => {
  let root: string;
  let service: CanonicalTaskReadService;

  function makeService(adapterResult: CanonicalOwnershipResource): CanonicalTaskReadService {
    const boundary = new PathBoundary(root);
    const reader = createProjectReader(boundary, new SchemaValidator('schemas'));
    return createCanonicalTaskReadService({
      projectRoot: root,
      projectReader: reader,
      integration: adapterWith(adapterResult),
    });
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'forgeloop-task-service-'));
    const taskDir = join(root, '.forgeloop', 'task-state', KEY);
    mkdirSync(join(root, '.forgeloop'), { recursive: true });
    mkdirSync(taskDir, { recursive: true });
    writeFileSync(join(root, '.forgeloop', 'config.json'), JSON.stringify({ schemaVersion: 1, protocolVersion: 1 }));
    writeFileSync(join(taskDir, 'task.json'), JSON.stringify(descriptor('TASK-1')));
    writeFileSync(join(taskDir, 'work-state.json'), JSON.stringify(workState('EXECUTING')));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it.each(['constructor', '__proto__', 'UNKNOWN'])('refuses unknown native phase %s without inventing lifecycle state', async (phase) => {
    writeFileSync(join(root, '.forgeloop', 'state.sqlite'), 'selected native storage');
    const reader = createProjectReader(new PathBoundary(root), new SchemaValidator('schemas'));
    const adapter = adapterWith(ownership({}));
    adapter.readTaskStatus = async () => ({ taskKey: KEY, phase });
    service = createCanonicalTaskReadService({ projectRoot: root, projectReader: reader, integration: adapter });
    await expect(service.readTask('TASK-1', KEY)).rejects.toThrow('Canonical SQLite task phase unavailable');
  });

  it('produces canonical ownership for task readers', async () => {
    service = makeService(ownership({}));
    const result = await service.readTask('TASK-1', KEY);
    expect(result.taskId).toBe('TASK-1');
    expect(result.taskKey).toBe(KEY);
    expect(result.summary.ownership.claimState).toBe('ACTIVE');
    expect(result.summary.ownership.source).toBe('FORGELOOP_INTEGRATION');
    expect(result.summary.operationalState).toBe('ACTIVE');
    expect(result.status).toBeDefined();
  });

  it('preserves canonical status freshness and comparison reasons for the UI', async () => {
    const adapter = adapterWith(ownership({}));
    adapter.readTaskStatus = async () => ({
      status: 'REVALIDATION_REQUIRED',
      reasons: ['REPOSITORY_CHANGED', 'CONTRACT_NOT_VERIFIED'],
      warnings: ['CHECKPOINT_OLD'],
      repositoryComparison: 'MISMATCH',
      contractComparison: 'NOT_VERIFIED',
      artifactComparison: 'NOT_APPLICABLE',
    });
    const boundary = new PathBoundary(root);
    const reader = createProjectReader(boundary, new SchemaValidator('schemas'));
    service = createCanonicalTaskReadService({ projectRoot: root, projectReader: reader, integration: adapter });

    const result = await service.readTask('TASK-1', KEY);

    expect(result.summary.canonicalStatus).toEqual({
      status: 'REVALIDATION_REQUIRED',
      reasons: ['REPOSITORY_CHANGED', 'CONTRACT_NOT_VERIFIED'],
      warnings: ['CHECKPOINT_OLD'],
      repositoryComparison: 'MISMATCH',
      contractComparison: 'NOT_VERIFIED',
      artifactComparison: 'NOT_APPLICABLE',
    });
  });

  it('fails closed when canonical status has no status field', () => {
    expect(summarizeCanonicalTaskStatus({ phase: 'EXECUTING' })).toBeUndefined();
  });

  it('never marks recovered tasks as active', async () => {
    writeFileSync(
      join(root, '.forgeloop', 'task-state', KEY, 'work-state.json'),
      JSON.stringify(workState('BLOCKED')),
    );
    service = makeService(ownership({
      claimState: 'RELEASED_BY_RECOVERY',
      mutationAllowed: false,
      effectiveWriteClaims: [],
      historicalWriteClaims: ['src/a.ts'],
      recoveryStatus: 'ACTIVE',
    }));
    const result = await service.readTask('TASK-1', KEY);
    expect(result.summary.ownership.claimState).toBe('RELEASED_BY_RECOVERY');
    expect(result.summary.operationalState).toBe('RECOVERY_RESUME_REQUIRED');
    expect(result.summary.recovery?.resumeRequired).toBe(true);
    expect(result.summary.effectiveWriteClaims).toEqual([]);
  });

  it('keeps historical claims separate from effective claims', async () => {
    service = makeService(ownership({
      historicalWriteClaims: ['src/legacy/**'],
      effectiveWriteClaims: ['src/current/**'],
    }));
    const result = await service.readTask('TASK-1', KEY);
    expect(result.summary.historicalWriteClaims).toEqual(['src/legacy/**']);
    expect(result.summary.effectiveWriteClaims).toEqual(['src/current/**']);
  });

  it('fails closed to READ_ONLY_UNKNOWN without canonical ownership data', async () => {
    const failing = adapterWith(ownership({}));
    failing.readTaskOwnership = async () => {
      throw new Error('resource unavailable');
    };
    const boundary = new PathBoundary(root);
    const reader = createProjectReader(boundary, new SchemaValidator('schemas'));
    service = createCanonicalTaskReadService({ projectRoot: root, projectReader: reader, integration: failing });
    const result = await service.readTask('TASK-1', KEY);
    expect(result.summary.ownership.source).toBe('UNAVAILABLE');
    expect(result.summary.operationalState).toBe('READ_ONLY_UNKNOWN');
  });
});
