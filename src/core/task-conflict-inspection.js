import { classifyLoadedWorkState, readWorkState } from "./work-state.js";
import { taskArtifactPath } from "./task-paths.js";
import { readLockInfo, classifyLockStaleness } from "./task-lock.js";
import { validateStateLedgerCoherence } from "./events.js";
import { currentRepositoryFingerprint } from "./repository.js";
import { collectTaskClaimEvidence, classifyTaskClaimState } from "./task-claim-state.js";

export const TASK_CONFLICT_CLASSIFICATIONS = Object.freeze([
  "ACTIVE",
  "RECOVERABLE",
  "STALE",
  "ABANDONED",
  "INCONSISTENT",
  "RECOVERED",
  "COMPLETE",
]);

const POST_EXECUTION_PHASES = new Set([
  "EXECUTING",
  "VERIFYING",
  "DIAGNOSING",
  "CORRECTING",
  "REVIEWING",
  "COMPLETE",
]);

export const TASK_CONFLICT_IDLE_THRESHOLD_MS = 14 * 24 * 60 * 60 * 1000;

const RECONCILABLE_DRIFT = new Set(["REPOSITORY_CHANGED"]);
export const MEANINGFUL_ACTIVITY_EVENTS = new Set([
  "EXECUTION_STARTED",
  "VERIFICATION_STARTED",
  "CHECK_RECORDED",
  "VERIFICATION_RECORDED",
  "DIAGNOSIS_RECORDED",
  "CORRECTION_STARTED",
  "REVIEW_STARTED",
  "CONTINUITY_RECORDED",
  "CHECKPOINT_RECONCILED",
  "TASK_RECOVERY_RESUMED",
]);

function idleMs(lastUpdated, now) {
  const parsed = Date.parse(lastUpdated);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, now - parsed);
}

function passedCheckCount(state) {
  return (state?.checks ?? []).filter((check) => check.status === "passed").length;
}

function checkCount(state, status) {
  return (state?.checks ?? []).filter((check) => check.status === status).length;
}

function lastMeaningfulActivity(state, events) {
  const candidates = [
    ...(state?.lastUpdated ? [{ at: state.lastUpdated, type: "WORK_STATE_UPDATED" }] : []),
    ...events
      .filter((event) => MEANINGFUL_ACTIVITY_EVENTS.has(event.event))
      .map((event) => ({ at: event.at, type: event.event })),
  ].filter((candidate) => Number.isFinite(Date.parse(candidate.at)));
  return candidates.sort((left, right) => Date.parse(right.at) - Date.parse(left.at))[0] ?? null;
}

function isInitialTaskLedger(events, taskId) {
  return events.length >= 2
    && events[0]?.taskId === taskId
    && events[0]?.event === "TASK_RECEIVED"
    && events[1]?.taskId === taskId
    && events[1]?.event === "TRANSACTION_COMMITTED"
    && events[1]?.details?.operation === "task-create"
    && !events.slice(2).some((event) => [
      "CONTRACT_VALIDATED", "ROUTE_VALIDATED", "PREFLIGHT_READY", "EXECUTION_STARTED",
      "VERIFICATION_STARTED", "VERIFICATION_RECORDED", "REVIEW_STARTED", "COMPLETION_VALIDATED",
      "TASK_RECOVERY_RECORDED", "OPERATOR_RECOVERY_RECORDED", "TASK_RECOVERY_RESUMED",
    ].includes(event.event));
}

function deriveEarlyPhase(events, taskId) {
  if (!isInitialTaskLedger(events, taskId)) return null;
  return events.some((event) => event.event === "DISCOVERY_STARTED")
    ? "DISCOVERING"
    : "RECEIVED";
}

/**
 * Deterministic classification of a potentially conflicting task from
 * machine-readable state only. REVIEWING plus an old timestamp alone is never
 * sufficient for STALE or ABANDONED: post-execution tasks whose only drift is
 * REPOSITORY_CHANGED remain RECOVERABLE because an official recovery path
 * exists.
 */
export function classifyConflictEvidence(evidence, {
  now = Date.now(),
  idleThresholdMs = TASK_CONFLICT_IDLE_THRESHOLD_MS,
} = {}) {
  if (!evidence || evidence.healthy === false) {
    return {
      classification: "INCONSISTENT",
      reasonCodes: evidence?.healthReasonCodes?.length > 0
        ? evidence.healthReasonCodes
        : ["E_TASK_DESCRIPTOR_INVALID"],
      recoverable: false,
    };
  }

  const {
    lockStatus,
    freshnessStatus,
    freshnessReasons,
    phase,
    lastUpdated,
    lastMeaningfulActivityAt,
    ledgerValid,
    recordedChecks,
    totalChecks,
    verificationEvidenceCount,
    recoveryStatus,
    earlyPhase,
  } = evidence;

  if (!ledgerValid) {
    return {
      classification: "INCONSISTENT",
      reasonCodes: ["E_LEDGER_INVALID"],
      recoverable: false,
    };
  }
  const KNOWN_PHASES = new Set([
    "RECEIVED", "DISCOVERING", "CONTRACT_READY", "ROUTED", "DESIGNING", "PLANNED",
    ...POST_EXECUTION_PHASES,
  ]);
  const effectivePhase = phase ?? earlyPhase;
  if (!effectivePhase || !KNOWN_PHASES.has(effectivePhase)) {
    return {
      classification: "INCONSISTENT",
      reasonCodes: ["E_PHASE_UNKNOWN"],
      recoverable: false,
    };
  }


  if (lockStatus === "LIVE") {
    return {
      classification: "ACTIVE",
      reasonCodes: ["E_TASK_LOCKED"],
      recoverable: false,
    };
  }

  if (lockStatus === "UNKNOWN" || lockStatus === "CORRUPT") {
    return {
      classification: "INCONSISTENT",
      reasonCodes: ["E_TASK_LOCK_STATE_UNKNOWN"],
      recoverable: false,
    };
  }

  if (freshnessStatus === "UNKNOWN") {
    return {
      classification: "INCONSISTENT",
      reasonCodes: freshnessReasons?.length > 0 ? freshnessReasons : ["E_STATE_UNREADABLE"],
      recoverable: false,
    };
  }

  if (recoveryStatus === "RECOVERED") {
    return {
      classification: "RECOVERED",
      reasonCodes: ["TASK_RECOVERED"],
      recoverable: false,
    };
  }

  if (effectivePhase === "COMPLETE") {
    return {
      classification: "COMPLETE",
      reasonCodes: ["TASK_COMPLETE"],
      recoverable: false,
      terminal: true,
    };
  }

  const drift = freshnessReasons ?? [];
  const staleOnlyRepositoryDrift = freshnessStatus === "REVALIDATION_REQUIRED"
    && drift.length > 0
    && drift.every((reason) => RECONCILABLE_DRIFT.has(reason));
  const idle = idleMs(lastMeaningfulActivityAt ?? lastUpdated, now);
  const idleBeyondThreshold = idle !== null && idle > idleThresholdMs;

  if (freshnessStatus === "FRESH") {
    return {
      classification: "ACTIVE",
      reasonCodes: ["STATE_FRESH"],
      recoverable: false,
    };
  }

  if (POST_EXECUTION_PHASES.has(effectivePhase)) {
    if (staleOnlyRepositoryDrift) {
      return {
        classification: "RECOVERABLE",
        reasonCodes: ["E_REPOSITORY_CHANGED", "OFFICIAL_RECOVERY_AVAILABLE"],
        recoverable: true,
        recoveredBy: recordedChecks > 0
          ? ["forgeloop reconcile-closure", "canonical VERIFYING -> REVIEWING -> complete pipeline"]
          : ["forgeloop reconcile-closure", "canonical verification recording pipeline"],
      };
    }
    const recordedEvidence = (totalChecks ?? recordedChecks ?? 0) + (verificationEvidenceCount ?? 0);
    if (idleBeyondThreshold && recordedEvidence === 0) {
      return {
        classification: "ABANDONED",
        reasonCodes: ["NO_RECORDED_EVIDENCE", "IDLE_BEYOND_THRESHOLD", ...drift],
        recoverable: false,
        recoveredBy: ["forgeloop task-recover --task <id> --acknowledge-recovery"],
      };
    }
    return {
      classification: "ACTIVE",
      reasonCodes: ["RECENT_PROGRESS", ...(drift.length > 0 ? drift : [])],
      recoverable: false,
    };
  }

  if (idleBeyondThreshold) {
    return {
      classification: "STALE",
      reasonCodes: ["IDLE_BEYOND_THRESHOLD", ...(drift.length > 0 ? drift : ["STATE_FRESH"])],
      recoverable: false,
      recoveredBy: ["forgeloop task-recover --task <id> --acknowledge-recovery"],
    };
  }

  return {
    classification: "ACTIVE",
    reasonCodes: ["RECENT_PROGRESS"],
    recoverable: false,
  };
}

export async function inspectTaskConflictState(target, {
  taskId,
  packageRoot,
  now = Date.now(),
  ignoredLockId = null,
} = {}) {
  const [lockInfo, stateResult, ownershipEvidence] = await Promise.all([
    readLockInfo(target, taskId),
    readWorkState(target, { packageRoot, taskId })
      .then((value) => ({ value, error: null }))
      .catch((error) => ({ value: null, error })),
    collectTaskClaimEvidence(target, { packageRoot, taskId }),
  ]);
  const claimProjection = classifyTaskClaimState(ownershipEvidence);
  const state = stateResult.value;
  const recovery = claimProjection.recovery;

  const lockClassification = ignoredLockId && lockInfo?.lockId === ignoredLockId
    ? { status: "NONE", stale: false }
    : classifyLockStaleness(lockInfo, now);

  let freshness = null;
  if (state) {
    try {
      freshness = await classifyLoadedWorkState({
        target,
        state,
        contractFile: taskArtifactPath(taskId, "contract"),
      });
    } catch {
      freshness = { status: "UNKNOWN", reasons: ["E_STATE_UNREADABLE"] };
    }
  }

  // Reuse the ownership snapshot's already-validated ledger; no second full
  // ledger parse inside this immutable inspection.
  const coherenceErrors = ownershipEvidence.state && ownershipEvidence.ledger
    ? validateStateLedgerCoherence(ownershipEvidence.state, ownershipEvidence.ledger.events)
    : [];
  const ledgerValid = ownershipEvidence.ledger.valid && coherenceErrors.length === 0;
  const ledgerEvents = ownershipEvidence.ledger.events;
  const ledgerErrors = [...ownershipEvidence.ledger.errors, ...coherenceErrors];

  const repository = await currentRepositoryFingerprint(target);
  const initialTask = !state && ledgerValid && ownershipEvidence.descriptor
    && isInitialTaskLedger(ledgerEvents, taskId)
    && !ownershipEvidence.recovery;
  const meaningfulActivity = lastMeaningfulActivity(state, ledgerEvents);
  const recoveryConsistencyErrors = claimProjection.ownershipErrors ?? claimProjection.errors ?? [];
  const healthReasonCodes = [
    ...(stateResult.error ? ["E_STATE_UNREADABLE"] : []),
    ...(claimProjection.ownershipValid === false
      ? claimProjection.reasonCodes
      : []),
  ];

  const evidence = {
    healthy: healthReasonCodes.length === 0,
    healthReasonCodes,
    descriptorHealthy: true,
    phase: state?.phase ?? (initialTask ? deriveEarlyPhase(ledgerEvents, taskId) : null),
    lastUpdated: state?.lastUpdated ?? null,
    lastMeaningfulActivityAt: meaningfulActivity?.at ?? null,
    lastMeaningfulEventType: meaningfulActivity?.type ?? null,
    workStateRevision: state?.revision ?? 0,
    lockStatus: lockClassification.status,
    lockId: lockInfo?.lockId ?? null,
    lockExpiresAt: lockClassification.expiresAt ?? null,
    freshnessStatus: freshness?.status ?? (initialTask ? "FRESH" : "UNKNOWN"),
    freshnessReasons: freshness?.reasons ?? [],
    ledgerValid,
    ledgerLastSeq: ledgerEvents.at(-1)?.seq ?? 0,
    ledgerErrors,
    recordedChecks: passedCheckCount(state),
    passedCheckCount: passedCheckCount(state),
    failedCheckCount: checkCount(state, "failed"),
    blockedCheckCount: checkCount(state, "blocked"),
    totalChecks: state?.checks?.length ?? 0,
    verificationEvidenceCount: state?.verificationEvidence?.length ?? 0,
    recoveryStatus: claimProjection.claimState === "RELEASED_BY_RECOVERY"
      ? "RECOVERED"
      : recovery?.status ?? null,
    recoveryConsistencyErrors,
    claimState: claimProjection.claimState,
    historicalWriteClaims: claimProjection.historicalWriteClaims,
    effectiveWriteClaims: claimProjection.effectiveWriteClaims,
    mutationAllowed: claimProjection.mutationAllowed,
    ownershipValid: claimProjection.ownershipValid,
    ownershipErrors: recoveryConsistencyErrors,
    repositoryBranch: repository.branch,
    repositoryHead: repository.head,
  };

  const verdict = classifyConflictEvidence(evidence, { now });

  return {
    taskId,
    classification: verdict.classification,
    reasonCodes: verdict.reasonCodes,
    recoverable: verdict.recoverable ?? false,
    ...(verdict.recoveredBy ? { recoveredBy: verdict.recoveredBy } : {}),
    evidence,
  };
}
