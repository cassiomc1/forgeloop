import { describe, it, expect } from 'vitest';
import { buildRecoverySummary } from '@main/core/tasks/task-reader';
import type { TaskOwnershipSummary } from '@shared/domain';

function ownership(overrides: Partial<TaskOwnershipSummary> = {}): TaskOwnershipSummary {
  return {
    claimState: 'ACTIVE',
    mutationAllowed: true,
    ownershipValid: true,
    historicalWriteClaims: ['src/a/**'],
    effectiveWriteClaims: ['src/a/**'],
    reasonCodes: [],
    source: 'FORGELOOP_INTEGRATION',
    ...overrides,
  };
}

const rawRecovery = {
  schemaVersion: 1,
  protocolVersion: 1,
  taskId: 'TASK-001',
  status: 'RECOVERED',
  recoveredAt: '2026-08-20T10:00:00.000Z',
  recoveryId: 'recovery-abc123',
  recoveryEventSeq: 7,
  classificationAtRecovery: 'STALE',
  reasonCodes: ['E_TASK_CLAIM_STALE'],
  releasedClaims: ['src/a/**'],
  previousPhase: 'EXECUTING',
  previousRevision: 3,
  repositoryFingerprint: { branch: 'main', head: 'deadbeef' },
  authority: { kind: 'HOST_ATTESTED' },
};

describe('task recovery semantics', () => {
  it('reports RECOVERED with resume required from canonical ownership', () => {
    const summary = buildRecoverySummary(rawRecovery, ownership({
      claimState: 'RELEASED_BY_RECOVERY',
      mutationAllowed: false,
      ownershipValid: true,
    }));
    expect(summary.status).toBe('RECOVERED');
    expect(summary.resumeRequired).toBe(true);
    expect(summary.source).toBe('FORGELOOP_INTEGRATION');
    expect(summary.recoveryId).toBe('recovery-abc123');
    expect(summary.classificationAtRecovery).toBe('STALE');
    expect(summary.releasedClaims).toEqual(['src/a/**']);
    expect(summary.previousPhase).toBe('EXECUTING');
    expect(summary.previousRevision).toBe(3);
    expect(summary.authorityKind).toBe('HOST_ATTESTED');
  });

  it('does not require resume when canonical mutation is allowed again', () => {
    const summary = buildRecoverySummary(rawRecovery, ownership({
      claimState: 'ACTIVE',
      mutationAllowed: true,
    }));
    expect(summary.resumeRequired).toBe(false);
    expect(summary.status).toBe('NONE');
  });

  it('fails closed to UNKNOWN when only the raw artifact exists', () => {
    const summary = buildRecoverySummary(rawRecovery, ownership({ source: 'UNAVAILABLE', claimState: 'UNKNOWN', mutationAllowed: null }));
    expect(summary.status).toBe('UNKNOWN');
    expect(summary.source).toBe('RAW_ARTIFACT');
    expect(summary.resumeRequired).toBe(false);
  });

  it('reports NONE without recovery evidence anywhere', () => {
    const summary = buildRecoverySummary(undefined, ownership());
    expect(summary.status).toBe('NONE');
    expect(summary.source).toBe('UNAVAILABLE');
    expect(summary.releasedClaims).toEqual([]);
    expect(summary.reasonCodes).toEqual([]);
  });
});
