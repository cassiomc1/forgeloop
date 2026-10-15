import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { PathBoundary } from '@main/security/path-boundary';
import { SchemaValidator } from '@main/core/protocol/validator';
import { createProjectReader } from '@main/core/project/project-reader';
import { ProjectSnapshotBuilder } from '@main/core/project/project-snapshot';
import { createCanonicalTaskReadService } from '@main/core/tasks/canonical-task-read-service';
import type { ForgeLoopIntegrationAdapter } from '@main/core/integration/forgeloop-integration';

const KEY = 'a'.repeat(64);
const TIMESTAMP = '2026-08-20T10:00:00.000Z';

function integrationFor(ownership: Record<string, unknown>): ForgeLoopIntegrationAdapter {
  return {
    getPackageVersion: () => '1.5.0',
    getCapabilities: () => ({}) as never,
    readProtocolInfo: async () => ({ compatibility: { protocolVersion: 1, schemaVersion: 1 } }),
    listTasks: async () => ({
      count: 1,
      tasks: [{ taskId: 'TASK-001', healthy: true, phase: 'BLOCKED', mutationAllowed: false }],
    }),
    readTaskStatus: async () => ({ phase: 'BLOCKED' }),
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
  } as never;
}

describe('GET_TASK / snapshot semantic parity', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'forgeloop-parity-'));
    const taskDir = join(root, '.forgeloop', 'task-state', KEY);
    mkdirSync(join(root, '.forgeloop'), { recursive: true });
    mkdirSync(taskDir, { recursive: true });
    writeFileSync(join(root, '.forgeloop', 'config.json'), JSON.stringify({ schemaVersion: 1, protocolVersion: 1, complianceMode: 'standard' }));
    writeFileSync(join(taskDir, 'task.json'), JSON.stringify({
      schemaVersion: 1, protocolVersion: 1, taskId: 'TASK-001', taskKey: KEY,
      createdAt: TIMESTAMP, updatedAt: TIMESTAMP, writeClaims: ['src/a/**'],
    }));
    writeFileSync(join(taskDir, 'work-state.json'), JSON.stringify({
      schemaVersion: 1, protocolVersion: 1, taskId: 'TASK-001',
      contractFingerprint: 'c'.repeat(64),
      repositoryFingerprint: { branch: 'main', head: null },
      phase: 'BLOCKED',
      selectedGuides: [], completedSteps: [], pendingSteps: [],
      checks: [], failures: [],
      blockers: [{ id: 'b1', reason: 'FIXTURE', detail: 'blocked' }],
      lastUpdated: TIMESTAMP,
    }));
    // A raw recovery artifact exists but canonical ownership decides semantics.
    writeFileSync(join(taskDir, 'recovery.json'), JSON.stringify({
      schemaVersion: 1, protocolVersion: 1, taskId: 'TASK-001', status: 'RECOVERED',
      recoveredAt: TIMESTAMP, recoveryId: 'recovery-parity', recoveryEventSeq: 2,
      classificationAtRecovery: 'STALE', reasonCodes: ['E_TASK_CLAIM_STALE'],
      releasedClaims: ['src/a/**'], previousPhase: 'EXECUTING', previousRevision: 3,
      repositoryFingerprint: { branch: 'main', head: null },
      authority: { kind: 'HOST_ATTESTED', grantRef: 'host-attestation:parity' },
    }));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function makeIntegration(): ForgeLoopIntegrationAdapter {
    return integrationFor({
      taskId: 'TASK-001',
      phase: 'BLOCKED',
      claimState: 'RELEASED_BY_RECOVERY',
      mutationAllowed: false,
      ownershipValid: true,
      recoveryStatus: 'ACTIVE',
      historicalWriteClaims: ['src/a/**'],
      effectiveWriteClaims: [],
      reasonCodes: ['E_TASK_RECOVERY_RESUME_REQUIRED'],
    });
  }

  it('snapshot and task detail share the exact same canonical projection', async () => {
    const boundary = new PathBoundary(root);
    const reader = createProjectReader(boundary, new SchemaValidator('schemas'));
    const integration = makeIntegration();

    const builder = new ProjectSnapshotBuilder(
      boundary,
      reader,
      {} as never,
      { source: 'PROTOCOL_INFO', protocolVersion: 1, schemaVersion: 1, compatibilityMode: 'INTEGRATION_V1' } as any,
      false,
      integration,
    );
    const snapshot = await builder.build();

    const detailService = createCanonicalTaskReadService({ projectRoot: root, projectReader: reader, integration });
    const detail = await detailService.readTask('TASK-001', KEY);

    const fromSnapshot = snapshot.tasks.find((task) => task.taskId === 'TASK-001');
    expect(fromSnapshot).toBeDefined();

    // GET_TASK(detail).summary must equal snapshot.tasks[N] on every semantic field.
    expect(detail.summary.ownership).toEqual(fromSnapshot!.ownership);
    expect(detail.summary.operationalState).toBe(fromSnapshot!.operationalState);
    expect(detail.summary.historicalWriteClaims).toEqual(fromSnapshot!.historicalWriteClaims);
    expect(detail.summary.effectiveWriteClaims).toEqual(fromSnapshot!.effectiveWriteClaims);
    expect(detail.summary.recovery?.resumeRequired).toBe(fromSnapshot!.recovery?.resumeRequired);
    expect(detail.summary.recovery?.status).toBe(fromSnapshot!.recovery?.status);

    expect(detail.summary.operationalState).toBe('RECOVERY_RESUME_REQUIRED');
    expect(detail.summary.ownership.claimState).toBe('RELEASED_BY_RECOVERY');
    expect(detail.summary.recovery?.resumeRequired).toBe(true);
    expect(snapshot.activeTaskId).toBeUndefined();
  });
});
