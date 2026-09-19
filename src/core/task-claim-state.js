import {
  E_COMPLETION_OWNERSHIP_UNPROVEN,
  E_TASK_CLAIM_OWNERSHIP_INCONSISTENT,
  E_TASK_COMPLETE,
  E_TASK_RECOVERED,
  E_TASK_RECOVERY_INCONSISTENT,
} from "./error-codes.js";
import { validateCompletionOwnershipProof } from "./completion-ownership.js";
import { validateEventLedger, validateStateLedgerCoherence } from "./events.js";
import { classifyRecoveryHistory } from "./recovery-history.js";
import { readTaskDescriptor } from "./task-descriptor.js";
import { normalizeWriteClaims } from "./task-scope.js";
import {
  readTaskRecovery,
  validateTaskRecoveryConsistency,
} from "./task-recovery.js";
import { readWorkState } from "./work-state.js";
import { readContract } from "./contract.js";
import { readPersistedRoute } from "./route-artifact.js";
import {
  CONTRACT_BOOTSTRAP_REPAIR_EVENT,
  isContractBootstrapRepairMarkerValid,
  resolveCanonicalPostRepairCheckpointBinding,
  resolveCanonicalPostRepairRouteBinding,
  sameCanonicalGuideList,
} from "./contract-bootstrap-recovery.js";
import { canonicalFingerprint } from "./artifacts.js";
import { stateIdentityErrors } from "./completion-relationships.js";
import { routeCheckpointMustMatchCurrentRoute } from "./resumability.js";

const REPAIR_PHASE_EVENTS = Object.freeze({
  CONTRACT_READY: "CONTRACT_VALIDATED",
  ROUTED: "ROUTE_VALIDATED",
  DESIGNING: "DESIGN_GATE_STARTED",
  PLANNED: "PLAN_RECORDED",
  EXECUTING: "EXECUTION_STARTED",
  VERIFYING: "VERIFICATION_STARTED",
  DIAGNOSING: "VERIFICATION_STARTED",
  CORRECTING: "VERIFICATION_STARTED",
  REVIEWING: "REVIEW_STARTED",
  COMPLETE: "COMPLETION_VALIDATED",
});

const REPAIR_ROUTE_PHASES = new Set([
  "ROUTED", "DESIGNING", "PLANNED", "EXECUTING", "VERIFYING", "DIAGNOSING", "CORRECTING", "REVIEWING", "COMPLETE",
]);

function ownershipError(message, cause = null) {
  return {
    code: E_TASK_RECOVERY_INCONSISTENT,
    message,
    ...(cause?.code ? { causeCode: cause.code } : {}),
  };
}

function repairInvalid(message) {
  return ownershipError(message, { code: "E_CONTRACT_BOOTSTRAP_REPAIR_INVALID" });
}

function lateRouteCheckpointErrors(events, state, marker) {
  if (routeCheckpointMustMatchCurrentRoute(state.phase) || !REPAIR_PHASE_EVENTS[state.phase]) return [];
  const checkpoint = resolveCanonicalPostRepairCheckpointBinding(events, marker);
  if (!checkpoint) {
    return [repairInvalid("Repaired late-phase state lacks an immutable route checkpoint binding")];
  }
  if (state.routeFingerprint !== checkpoint.routeFingerprint
    || !sameCanonicalGuideList(state.selectedGuides, checkpoint.selectedGuides)) {
    return [repairInvalid("Late-phase checkpoint route identity was rewritten after the canonical checkpoint binding")];
  }
  return [];
}

function repairArtifactErrors(artifacts) {
  return [
    ...(artifacts?.contractError
      ? [repairInvalid(`Current contract artifact is invalid after a recorded repair: ${artifacts.contractError}`)]
      : []),
    ...(artifacts?.routeError
      ? [repairInvalid(`Current route artifact is invalid after a recorded repair: ${artifacts.routeError}`)]
      : []),
  ];
}

function repairAnchorErrors(marker, state, artifacts) {
  const errors = [];
  if (state.phase !== marker.details.reconstructedPhase) {
    errors.push(repairInvalid(
      `Work-state phase ${state.phase} does not match repair anchor phase ${marker.details.reconstructedPhase}`,
    ));
  }
  if (canonicalFingerprint(state) !== marker.details.reconstructedStateFingerprint) {
    errors.push(repairInvalid("Work-state fingerprint does not match the repair anchor"));
  }
  const stateRouteFingerprint = state.routeFingerprint ?? null;
  const currentRouteFingerprint = artifacts?.route?.fingerprint ?? null;
  if (stateRouteFingerprint !== marker.details.routeFingerprint
    || currentRouteFingerprint !== marker.details.routeFingerprint) {
    errors.push(repairInvalid("Current route identity does not match the repair anchor"));
  }
  return errors;
}

function evolvedRepairErrors(marker, events, state, artifacts) {
  const errors = [];
  const contract = artifacts?.contract ?? null;
  const route = artifacts?.route ?? null;
  if (!contract) errors.push(repairInvalid("Current contract is unavailable after a recorded repair"));
  const routeRequired = REPAIR_ROUTE_PHASES.has(state.phase) || state.routeFingerprint !== undefined;
  if (routeRequired && !route) {
    errors.push(repairInvalid("Current route is required by the evolved task state but is unavailable"));
  }
  if (contract) {
    const routeErrors = stateIdentityErrors({ contract, route, state });
    const checkpointMustMatch = routeCheckpointMustMatchCurrentRoute(state.phase);
    errors.push(...routeErrors
      .filter((error) => checkpointMustMatch || error.code !== "E_ROUTE_GUIDE_MISMATCH")
      .map((error) => repairInvalid(error.message)));
  }
  const currentRouteFingerprint = route?.fingerprint ?? null;
  const binding = currentRouteFingerprint !== marker.details.routeFingerprint
    ? resolveCanonicalPostRepairRouteBinding(events, marker, currentRouteFingerprint)
    : null;
  if (currentRouteFingerprint !== marker.details.routeFingerprint && !binding) {
    errors.push(repairInvalid("Changed route identity lacks a canonical post-repair route binding"));
  }
  errors.push(...lateRouteCheckpointErrors(events, state, marker));
  errors.push(...validateStateLedgerCoherence(state, events).map((error) => repairInvalid(error.message)));
  const requiredEvent = REPAIR_PHASE_EVENTS[state.phase];
  if (requiredEvent && !events.some((event) => event.event === requiredEvent)) {
    errors.push(repairInvalid(`Current work-state phase ${state.phase} is not supported by the repair ledger history`));
  }
  return errors;
}

function validateContractBootstrapRepairConsistency(taskId, events, state, artifacts) {
  const marker = events.find((event) => event.event === CONTRACT_BOOTSTRAP_REPAIR_EVENT);
  if (!marker) return [];
  if (!isContractBootstrapRepairMarkerValid(events, marker)) {
    return [repairInvalid("Contract bootstrap repair marker is invalid")];
  }
  if (!state) return [repairInvalid("Work-state is missing after a recorded contract bootstrap repair")];
  const errors = [];
  if (state.taskId !== taskId) errors.push(repairInvalid("Work-state taskId does not match the repaired task"));
  if (!Number.isInteger(state.revision) || state.revision < 0) {
    return [...errors, repairInvalid("Work-state revision is missing or invalid after a recorded repair")];
  }
  const anchorRevision = marker.details.reconstructedStateRevision;
  if (state.revision < anchorRevision) {
    return [...errors, repairInvalid("Work-state revision rolled back behind the repair anchor")];
  }
  if (state.contractFingerprint !== marker.details.contractFingerprint) {
    errors.push(repairInvalid("Work-state contract fingerprint does not match repair-time contract identity"));
  }
  errors.push(...repairArtifactErrors(artifacts));
  return state.revision === anchorRevision
    ? [...errors, ...repairAnchorErrors(marker, state, artifacts)]
    : [...errors, ...evolvedRepairErrors(marker, events, state, artifacts)];
}

/**
 * Async cross-artifact consistency collector for a recorded contract bootstrap
 * repair. The pure classifier stays filesystem-free; this reads the current
 * task-scoped contract and route artifacts through their canonical readers so
 * schema validation, artifact bounds, task-scoped paths, and fingerprint
 * semantics stay consistent with the rest of the protocol.
 *
 * With no repair marker this performs no extra work.
 */
async function collectContractBootstrapRepairConsistency(target, packageRoot, taskId, events, state) {
  const marker = events.find((event) => event.event === CONTRACT_BOOTSTRAP_REPAIR_EVENT);
  if (!marker) return null;
  const artifacts = { contract: null, route: null, contractError: null, routeError: null };

  // Contract binding: the current contract must exist, validate, and bind to
  // the marker and work state.
  try {
    const contract = await readContract(target, packageRoot, { taskId });
    artifacts.contract = contract;
    if (contract.fingerprint !== marker.details.contractFingerprint) {
      artifacts.contractError = `contract fingerprint ${contract.fingerprint} does not match marker contract fingerprint ${marker.details.contractFingerprint}`;
    } else if (state && state.contractFingerprint !== marker.details.contractFingerprint) {
      artifacts.contractError = "work-state contract fingerprint does not match marker contract fingerprint";
    }
  } catch (error) {
    artifacts.contractError = error.code === "ARTIFACT_MISSING"
      ? "contract artifact is missing after a recorded repair"
      : `contract artifact is invalid after a recorded repair: ${error.message}`;
  }

  // Route binding is anchored exactly at repair time, then follows the
  // current state/route identity after the checkpoint advances.
  const routeRequired = state && (REPAIR_ROUTE_PHASES.has(state.phase)
    || state.routeFingerprint !== undefined);
  if (routeRequired || marker.details.routeFingerprint !== null) {
    try {
      const route = await readPersistedRoute(target, packageRoot, { taskId });
      artifacts.route = route;
      if (route.value?.contractFingerprint !== undefined
        && route.value.contractFingerprint !== marker.details.contractFingerprint) {
        artifacts.routeError = "route artifact contract binding does not match marker contract fingerprint";
      }
    } catch (error) {
      artifacts.routeError = error.code === "ARTIFACT_MISSING"
        ? "route artifact is missing after a routed repair"
        : `route artifact is invalid after a routed repair: ${error.message}`;
    }
  }

  return artifacts;
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

  const repairArtifacts = await collectContractBootstrapRepairConsistency(target, packageRoot, taskId, ledger.events, state);
  const repairConsistencyErrors = validateContractBootstrapRepairConsistency(taskId, ledger.events, state, repairArtifacts);
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
