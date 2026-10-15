import { parseClaimState, safeStringArray } from '@shared/domain';
import type { TaskOwnershipSummary } from '@shared/domain';
import type { CanonicalOwnershipResource } from '@main/core/integration/types';

function optionalBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

/**
 * Project the canonical `task/ownership` integration resource into the
 * ForgeLoopAudit's ownership summary DTO.
 *
 * This is a pure presentation projection: it never derives ownership from
 * raw artifacts and never casts unknown claim states into canonical values.
 * A missing resource yields source=UNAVAILABLE with UNKNOWN/null fields so
 * callers fail closed instead of assuming healthy ownership.
 */
export function normalizeOwnership(data: CanonicalOwnershipResource | null | undefined): TaskOwnershipSummary {
  if (!data || typeof data !== 'object') {
    return {
      claimState: 'UNKNOWN',
      mutationAllowed: null,
      ownershipValid: null,
      historicalWriteClaims: [],
      effectiveWriteClaims: [],
      reasonCodes: [],
      source: 'UNAVAILABLE',
    };
  }

  return {
    claimState: parseClaimState(data.claimState),
    mutationAllowed: optionalBoolean(data.mutationAllowed),
    ownershipValid: optionalBoolean(data.ownershipValid),
    historicalWriteClaims: safeStringArray(data.historicalWriteClaims),
    effectiveWriteClaims: safeStringArray(data.effectiveWriteClaims),
    reasonCodes: safeStringArray(data.reasonCodes),
    source: 'FORGELOOP_INTEGRATION',
  };
}
