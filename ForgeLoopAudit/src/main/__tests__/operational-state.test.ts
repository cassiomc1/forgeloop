import { describe, it, expect } from 'vitest';
import { resolveOperationalState, selectActiveTaskId } from '@main/core/tasks/operational-state';
import type { TaskSummary, TaskOwnershipSummary } from '@shared/domain';

function ownership(overrides: Partial<TaskOwnershipSummary> = {}): TaskOwnershipSummary {
  return {
    claimState: 'ACTIVE',
    mutationAllowed: true,
    ownershipValid: true,
    historicalWriteClaims: [],
    effectiveWriteClaims: [],
    reasonCodes: [],
    source: 'FORGELOOP_INTEGRATION',
    ...overrides,
  };
}

function task(overrides: Partial<TaskSummary> = {}): TaskSummary {
  return {
    taskId: 'TASK-001',
    taskKey: 'key',
    phase: 'EXECUTING',
    selectedGuides: [],
    completedSteps: [],
    pendingSteps: [],
    blockers: [],
    failures: [],
    checks: [],
    gates: [],
    evidenceCoverage: { total: 0, covered: 0, partial: 0, notVerified: 0, blocked: 0, coveragePercent: 0 },
    ownership: ownership(),
    operationalState: 'READ_ONLY_UNKNOWN',
    ...overrides,
  };
}

describe('core/tasks/operational-state', () => {
  it('classifies an executing task with valid active claims as ACTIVE', () => {
    expect(resolveOperationalState({ phase: 'EXECUTING', ownership: ownership() })).toBe('ACTIVE');
  });

  it('classifies recovery-released blocked-mutation tasks as RECOVERY_RESUME_REQUIRED', () => {
    const state = resolveOperationalState({
      phase: 'EXECUTING',
      ownership: ownership({ claimState: 'RELEASED_BY_RECOVERY', mutationAllowed: false, effectiveWriteClaims: [] }),
    });
    expect(state).toBe('RECOVERY_RESUME_REQUIRED');
  });

  it('classifies complete released-by-completion tasks as COMPLETED_RELEASED', () => {
    const state = resolveOperationalState({
      phase: 'COMPLETE',
      ownership: ownership({ claimState: 'RELEASED_BY_COMPLETION', mutationAllowed: false, effectiveWriteClaims: [] }),
    });
    expect(state).toBe('COMPLETED_RELEASED');
  });

  it('never treats phase COMPLETE as proof of release', () => {
    const state = resolveOperationalState({
      phase: 'COMPLETE',
      ownership: ownership({ claimState: 'ACTIVE', mutationAllowed: true }),
    });
    expect(state).toBe('ACTIVE');
  });

  it('fails closed to OWNERSHIP_INCONSISTENT even when the phase looks finished', () => {
    const state = resolveOperationalState({
      phase: 'COMPLETE',
      ownership: ownership({ claimState: 'INCONSISTENT', mutationAllowed: false, ownershipValid: false }),
    });
    expect(state).toBe('OWNERSHIP_INCONSISTENT');
  });

  it('surfaces ownershipValid=false as OWNERSHIP_INCONSISTENT regardless of claim state', () => {
    const state = resolveOperationalState({
      phase: 'EXECUTING',
      ownership: ownership({ claimState: 'ACTIVE', ownershipValid: false }),
    });
    expect(state).toBe('OWNERSHIP_INCONSISTENT');
  });

  it('keeps BLOCKED as a lifecycle state', () => {
    expect(resolveOperationalState({ phase: 'BLOCKED', ownership: ownership() })).toBe('BLOCKED');
  });

  it('degrades to READ_ONLY_UNKNOWN without canonical ownership', () => {
    const state = resolveOperationalState({
      phase: 'EXECUTING',
      ownership: ownership({ source: 'UNAVAILABLE', claimState: 'UNKNOWN', mutationAllowed: null, ownershipValid: null }),
    });
    expect(state).toBe('READ_ONLY_UNKNOWN');
  });

  describe('selectActiveTaskId', () => {
    it('prefers operationally ACTIVE tasks over recovered attention items', () => {
      const recovered = task({
        taskId: 'TASK-REC',
        operationalState: 'RECOVERY_RESUME_REQUIRED',
        recovery: { status: 'RECOVERED', releasedClaims: [], reasonCodes: [], resumeRequired: true, source: 'FORGELOOP_INTEGRATION' },
      });
      const active = task({ taskId: 'TASK-ACT', operationalState: 'ACTIVE' });
      expect(selectActiveTaskId([recovered, active])).toBe('TASK-ACT');
      expect(selectActiveTaskId([recovered])).toBeUndefined();
    });

    it('returns undefined when no task is operationally active', () => {
      const completed = task({ taskId: 'T1', phase: 'COMPLETE', operationalState: 'COMPLETED_RELEASED' });
      const unknown = task({ taskId: 'T2', operationalState: 'READ_ONLY_UNKNOWN' });
      expect(selectActiveTaskId([completed, unknown])).toBeUndefined();
    });
  });
});
