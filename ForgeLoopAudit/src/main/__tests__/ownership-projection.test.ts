import { describe, it, expect } from 'vitest';
import { normalizeOwnership } from '@main/core/tasks/ownership-projection';
import type { CanonicalOwnershipResource } from '@main/core/integration/types';

function canonical(overrides: Partial<CanonicalOwnershipResource> = {}): CanonicalOwnershipResource {
  return {
    taskId: 'TASK-001',
    phase: 'EXECUTING',
    claimState: 'ACTIVE',
    mutationAllowed: true,
    ownershipValid: true,
    recoveryStatus: null,
    historicalWriteClaims: ['src/a/**'],
    effectiveWriteClaims: ['src/a/**'],
    reasonCodes: [],
    ...overrides,
  };
}

describe('core/tasks/ownership-projection', () => {
  it('projects an ACTIVE canonical claim verbatim', () => {
    const summary = normalizeOwnership(canonical());
    expect(summary.claimState).toBe('ACTIVE');
    expect(summary.mutationAllowed).toBe(true);
    expect(summary.ownershipValid).toBe(true);
    expect(summary.effectiveWriteClaims).toEqual(['src/a/**']);
    expect(summary.source).toBe('FORGELOOP_INTEGRATION');
  });

  it('projects RELEASED_BY_COMPLETION with empty effective claims', () => {
    const summary = normalizeOwnership(canonical({
      phase: 'COMPLETE',
      claimState: 'RELEASED_BY_COMPLETION',
      mutationAllowed: false,
      historicalWriteClaims: ['src/a/**'],
      effectiveWriteClaims: [],
    }));
    expect(summary.claimState).toBe('RELEASED_BY_COMPLETION');
    expect(summary.mutationAllowed).toBe(false);
    expect(summary.effectiveWriteClaims).toEqual([]);
    expect(summary.historicalWriteClaims).toEqual(['src/a/**']);
  });

  it('projects RELEASED_BY_RECOVERY keeping history separate from effective claims', () => {
    const summary = normalizeOwnership(canonical({
      phase: 'EXECUTING',
      claimState: 'RELEASED_BY_RECOVERY',
      mutationAllowed: false,
      ownershipValid: true,
      recoveryStatus: 'RECOVERED',
      historicalWriteClaims: ['src/a/**', 'src/b/**'],
      effectiveWriteClaims: [],
      reasonCodes: ['E_TASK_RECOVERY_RESUME_REQUIRED'],
    }));
    expect(summary.claimState).toBe('RELEASED_BY_RECOVERY');
    expect(summary.mutationAllowed).toBe(false);
    expect(summary.effectiveWriteClaims).toEqual([]);
    expect(summary.historicalWriteClaims).toEqual(['src/a/**', 'src/b/**']);
    expect(summary.reasonCodes).toContain('E_TASK_RECOVERY_RESUME_REQUIRED');
  });

  it('preserves INCONSISTENT state instead of masking it', () => {
    const summary = normalizeOwnership(canonical({
      claimState: 'INCONSISTENT',
      mutationAllowed: false,
      ownershipValid: false,
      reasonCodes: ['E_TASK_CLAIM_OWNERSHIP_INCONSISTENT'],
    }));
    expect(summary.claimState).toBe('INCONSISTENT');
    expect(summary.ownershipValid).toBe(false);
  });

  it('normalizes unknown claim states to UNKNOWN instead of casting', () => {
    const summary = normalizeOwnership(canonical({ claimState: 'SOME_FUTURE_STATE' }));
    expect(summary.claimState).toBe('UNKNOWN');
  });

  it('returns UNAVAILABLE without guessing booleans when canonical data is missing', () => {
    const summary = normalizeOwnership(null);
    expect(summary.source).toBe('UNAVAILABLE');
    expect(summary.claimState).toBe('UNKNOWN');
    expect(summary.mutationAllowed).toBeNull();
    expect(summary.ownershipValid).toBeNull();
    expect(summary.effectiveWriteClaims).toEqual([]);
  });

  it('coerces malformed field types instead of trusting them', () => {
    const raw = canonical({
      mutationAllowed: 'yes' as unknown as boolean,
      ownershipValid: 1 as unknown as boolean,
      historicalWriteClaims: [1, 'ok', null] as unknown as string[],
      effectiveWriteClaims: undefined as unknown as string[],
    });
    const summary = normalizeOwnership(raw);
    expect(summary.mutationAllowed).toBeNull();
    expect(summary.ownershipValid).toBeNull();
    expect(summary.historicalWriteClaims).toEqual(['ok']);
    expect(summary.effectiveWriteClaims).toEqual([]);
  });

  it('keeps historical claims distinct when they differ from effective claims', () => {
    const summary = normalizeOwnership(canonical({
      historicalWriteClaims: ['src/legacy/**'],
      effectiveWriteClaims: ['src/current/**'],
    }));
    expect(summary.historicalWriteClaims).toEqual(['src/legacy/**']);
    expect(summary.effectiveWriteClaims).toEqual(['src/current/**']);
  });
});
