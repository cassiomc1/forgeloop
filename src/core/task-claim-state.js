import {
  E_COMPLETION_OWNERSHIP_UNPROVEN,
  E_TASK_CLAIM_OWNERSHIP_INCONSISTENT,
  E_TASK_COMPLETE,
  E_TASK_RECOVERED,
  E_TASK_RECOVERY_INCONSISTENT,
} from "./error-codes.js";
import { validateCompletionOwnershipProof } from "./completion-ownership.js";
import { validateEventLedger } from "./events.js";
import { classifyRecoveryHistory } from "./recovery-history.js";
import { readTaskDescriptor } from "./task-descriptor.js";
import { normalizeWriteClaims } from "./task-scope.js";
import {
  readTaskRecovery,
  validateTaskRecoveryConsistency,
} from "./task-recovery.js";
import { readWorkState } from "./work-state.js";
import {
  CONTRACT_BOOTSTRAP_REPAIR_EVENT,
  isContractBootstrapRepairMarkerValid,
} from "./contract-bootstrap-recovery.js";
import { canonicalFingerprint } from "./artifacts.js";

function ownershipError(message, cause = null) {
  return {
    code: E_TASK_RECOVERY_INCONSISTENT,
    message,
    ...(cause?.code ? { causeCode: cause.code } : {}),
  };
}

function validateContractBootstrapRepairConsistency(events, state, target, taskId) {
  const marker = events.find((event) => event.event === CONTRACT_BOOTSTRAP_REPAIR_EVENT);
  if (!marker) return [];
  if (!isContractBootstrapRepairMarkerValid(events, marker)) {
    return [ownershipError("Contract bootstrap repair marker is invalid")];
  }
  const errors = [];
  if (state) {
    if (state.phase !== marker.details.reconstructedPhase) {
      errors.push(ownershipError(
        `Work-state phase ${state.phase} does not match repair marker phase ${marker.details.reconstructedPhase}`,
      ));
    }
    if (state.contractFingerprint !== marker.details.contractFingerprint) {
      errors.push(ownershipError(
        "Work-state contract fingerprint does not match repair marker contract fingerprint",
      ));
    }
    if (canonicalFingerprint(state) !== marker.details.reconstructedStateFingerprint) {
      errors.push(ownershipError(
        "Work-state fingerprint does not match repair marker reconstructed state fingerprint",
      ));
    }
    if (marker.details.routeFingerprint !== null) {
      if (state.routeFingerprint !== marker.details.routeFingerprint) {
        errors.push(ownershipError(
          "Work-state route fingerprint does not match repair marker route fingerprint",
        ));
      }
    } else if (state.routeFingerprint !== undefined) {
      errors.push(ownershipError(
        "Repair marker has no route but work-state claims a route",
      ));
    }
  }
  return errors;
}

function appendClaims(target, claims, errors, source) {
  if (claims === undefined || claims === null) return;
  try {
    target.push(...normalizeWriteClaims(claims));
  } catch (error) {
    errors.push(ownershipError(`Invalid ${source} write claims: ${error.message}`, error));
  }
}

/**
 * Collects every input needed to resolve claim ownership from one immutable
 * snapshot: descriptor, work state, recovery tombstone, validated ledger, and
 * classified recovery history. Classification is a pure function of this
 * evidence, so conflict inspection can reuse it without rereading artifacts.
 */
export async function collectTaskClaimEvidence(target, {
  taskId,
  packageRoot,
  descriptor: suppliedDescriptor = null,
  state: suppliedState = null,
} = {}) {
  const errors = [];
  let descriptor = suppliedDescriptor;
  let state = suppliedState;
  let recovery = null;
  let ledger = { valid: false, events: [], errors: [] };

  if (!descriptor) {
    try {
      descriptor = (await readTaskDescriptor(target, taskId, packageRoot)).value;
    } catch (error) {
      errors.push(ownershipError(`Task descriptor cannot establish claim ownership: ${error.message}`, error));
    }
  }
  if (!state) {
    try {
      state = await readWorkState(target, { taskId, packageRoot });
    } catch (error) {
      errors.push(ownershipError(`Task work state cannot establish claim ownership: ${error.message}`, error));
    }
  }

  try {
    recovery = (await readTaskRecovery(target, { taskId, packageRoot }))?.value ?? null;
  } catch (error) {
    errors.push(ownershipError(`Task recovery artifact cannot establish claim ownership: ${error.message}`, error));
  }

  try {
    ledger = await validateEventLedger(target, packageRoot, { taskId });
  } catch (error) {
    errors.push(ownershipError(`Task event ledger cannot establish claim ownership: ${error.message}`, error));
  }
  if (!ledger.valid) {
    for (const error of ledger.errors) {
      errors.push(ownershipError(`Task event ledger is invalid: ${error.message}`, error));
    }
  }
  if (ledger.events.some((event) => event.taskId !== taskId)) {
    errors.push(ownershipError(`Task event ledger contains an event for a different task`));
  }

  const repairConsistencyErrors = validateContractBootstrapRepairConsistency(ledger.events, state, target, taskId);
  errors.push(...repairConsistencyErrors);

  const history = classifyRecoveryHistory(ledger.events);
  const descriptorClaims = [];
  appendClaims(descriptorClaims, descriptor?.writeClaims, errors, "descriptor");
  const normalizedDescriptorClaims = normalizeWriteClaims(descriptorClaims);

  const historicalClaims = [...normalizedDescriptorClaims];
  for (const cycle of history.recoveries) {
    appendClaims(historicalClaims, cycle.event?.details?.releasedClaims, errors, "recovery ledger");
  }
  appendClaims(historicalClaims, recovery?.releasedClaims, errors, "recovery artifact");

  return {
    taskId,
    phase: state?.phase ?? null,
    descriptor,
    state,
    recovery,
    ledger,
    history,
    normalizedDescriptorClaims,
    historicalWriteClaims: normalizeWriteClaims(historicalClaims),
    errors,
  };
}

function inconsistentResult({ taskId, phase, historicalWriteClaims, recovery, errors }) {
  const reasonCodes = [
    E_TASK_CLAIM_OWNERSHIP_INCONSISTENT,
    ...errors.flatMap((error) => [error.code, error.causeCode]).filter(Boolean),
  ];
  return {
    taskId,
    phase,
    historicalWriteClaims,
    effectiveWriteClaims: historicalWriteClaims,
    writeClaims: historicalWriteClaims,
    claimState: "INCONSISTENT",
    mutationAllowed: false,
    recovery,
    recoveryStatus: "INCONSISTENT",
    valid: false,
    ownershipValid: false,
    reasonCodes: [...new Set(reasonCodes)],
    errors,
    ownershipErrors: errors,
  };
}

/**
 * Deterministic claim-ownership decision table over collected evidence.
 * Claims are released only for validated canonical completion or validated
 * active recovery; everything else fails closed.
 */
export function classifyTaskClaimState(evidence) {
  const {
    taskId,
    phase,
    recovery,
    ledger,
    history,
    normalizedDescriptorClaims,
    historicalWriteClaims,
  } = evidence;

  // Classification is side-effect free: never mutate the supplied evidence.
  const errors = [...(evidence.errors ?? [])];
  errors.push(...validateTaskRecoveryConsistency({
    taskId,
    recovery,
    events: ledger.events,
    historicalWriteClaims: normalizedDescriptorClaims,
    recoveryHistory: history,
  }));

  if (errors.length > 0) {
    return inconsistentResult({ taskId, phase, historicalWriteClaims, recovery, errors });
  }

  if (phase === "COMPLETE") {
    const proof = validateCompletionOwnershipProof({ taskId, state: evidence.state, ledger });
    if (!proof.valid) {
      return inconsistentResult({
        taskId,
        phase,
        historicalWriteClaims,
        recovery,
        errors: [
          ownershipError(
            "COMPLETE work-state lacks canonical lifecycle/ledger completion proof; claims stay reserved",
            { code: E_COMPLETION_OWNERSHIP_UNPROVEN },
          ),
          ...proof.errors.map((error) => ownershipError(error.message, { code: error.code })),
        ],
      });
    }
    return {
      taskId,
      phase,
      historicalWriteClaims,
      effectiveWriteClaims: [],
      writeClaims: [],
      claimState: "RELEASED_BY_COMPLETION",
      mutationAllowed: false,
      recovery: null,
      recoveryStatus: "NOT_APPLICABLE",
      valid: true,
      ownershipValid: true,
      reasonCodes: [],
      errors: [],
      ownershipErrors: [],
    };
  }

  if (history.activeRecovery) {
    // The consistency validator above guarantees that the active ledger cycle
    // and recovery artifact identify the same recovery before this branch.
    return {
      taskId,
      phase,
      historicalWriteClaims,
      effectiveWriteClaims: [],
      writeClaims: [],
      claimState: "RELEASED_BY_RECOVERY",
      mutationAllowed: false,
      recovery,
      recoveryStatus: "ACTIVE",
      valid: true,
      ownershipValid: true,
      reasonCodes: [],
      errors: [],
      ownershipErrors: [],
    };
  }

  return {
    taskId,
    phase,
    historicalWriteClaims,
    effectiveWriteClaims: normalizedDescriptorClaims,
    writeClaims: normalizedDescriptorClaims,
    claimState: "ACTIVE",
    mutationAllowed: true,
    recovery: null,
    recoveryStatus: history.completedRecoveries.length > 0 ? "COMPLETED" : "ABSENT",
    valid: true,
    ownershipValid: true,
    reasonCodes: [],
    errors: [],
    ownershipErrors: [],
  };
}

/**
 * Resolve claim ownership from the task descriptor, work state, recovery
 * tombstone, and the complete validated task ledger. Any disagreement retains
 * every claim that can be recovered from validated inputs and fails closed.
 */
export async function resolveTaskClaimState(target, options = {}) {
  const evidence = await collectTaskClaimEvidence(target, options);
  return classifyTaskClaimState(evidence);
}

export async function assertTaskMutationAllowed(target, options = {}) {
  const result = await resolveTaskClaimState(target, options);
  if (result.mutationAllowed) return result;

  const inconsistent = result.claimState === "INCONSISTENT";
  const error = new Error(inconsistent
    ? `Task ${result.taskId} claim ownership is inconsistent; ordinary mutation is blocked`
    : result.claimState === "RELEASED_BY_COMPLETION"
      ? `Task ${result.taskId} is COMPLETE and cannot be mutated`
      : `Task ${result.taskId} is RECOVERED and its write claims are released; run task-resume before ordinary mutation`);
  error.code = inconsistent
    ? E_TASK_CLAIM_OWNERSHIP_INCONSISTENT
    : result.claimState === "RELEASED_BY_COMPLETION"
      ? E_TASK_COMPLETE
      : E_TASK_RECOVERED;
  error.taskId = result.taskId;
  error.claimState = result.claimState;
  error.reasonCodes = result.reasonCodes;
  error.errors = result.errors;
  error.recovery = result.recovery;
  throw error;
}
