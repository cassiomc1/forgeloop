import { currentRepositoryFingerprint } from "./repository.js";
import { validateEventLedger } from "./events.js";
import { createWorkState, initializeWorkState, readWorkState, mutateWorkState } from "./work-state.js";

const DEFAULT_PENDING_STEPS = ["planning", "implementation", "verification"];

/**
 * Resume phase derived from the highest lifecycle milestone already recorded in
 * a validated ledger. Recreating a checkpoint at ROUTED for a task whose ledger
 * already passed EXECUTION_STARTED would make every subsequent advance append a
 * duplicate non-repeatable milestone and invalidate the ledger, so restoration
 * must resume at the phase the recorded chronology supports.
 */
const RESUME_PHASE_BY_MILESTONE = Object.freeze({
  PLAN_RECORDED: "PLANNED",
  EXECUTION_STARTED: "EXECUTING",
  VERIFICATION_STARTED: "VERIFYING",
  VERIFICATION_RECORDED: "VERIFYING",
  REVIEW_STARTED: "REVIEWING",
});

const RESUME_STEPS_BY_PHASE = Object.freeze({
  CONTRACT_READY: {
    completedSteps: ["contract"],
    pendingSteps: ["route", ...DEFAULT_PENDING_STEPS],
  },
  ROUTED: {
    completedSteps: ["contract", "route"],
    pendingSteps: [...DEFAULT_PENDING_STEPS],
  },
  PLANNED: {
    completedSteps: ["contract", "route", "planning"],
    pendingSteps: [...DEFAULT_PENDING_STEPS.filter((step) => step !== "planning")],
  },
  EXECUTING: {
    completedSteps: ["contract", "route", "planning", "implementation"],
    pendingSteps: ["verification"],
  },
  VERIFYING: {
    completedSteps: ["contract", "route", "planning", "implementation"],
    pendingSteps: ["verification"],
  },
  REVIEWING: {
    completedSteps: ["contract", "route", "planning", "implementation", "verification"],
    pendingSteps: [],
  },
});

function cycleEvents(events) {
  const CYCLE_EVENT_NAMES = new Set([
    "VERIFICATION_STARTED",
    "VERIFICATION_RECORDED",
    "DIAGNOSIS_RECORDED",
    "DIAGNOSTIC_CASE_RECORDED",
  ]);
  const cycles = events
    .filter((event) => CYCLE_EVENT_NAMES.has(event.event))
    .map((event) => event.details?.verificationCycle)
    .filter((cycle) => Number.isInteger(cycle) && cycle >= 1);
  return cycles.at(-1);
}

/**
 * Canonical reconstruction projection: for a resumed phase derived from a
 * validated ledger, returns the single source of truth for completedSteps and
 * pendingSteps. Unknown phases fall back to the ROUTED projection, matching the
 * historical default resume checkpoint.
 */
export function resumeStepsForPhase(phase) {
  return RESUME_STEPS_BY_PHASE[phase] ?? RESUME_STEPS_BY_PHASE.ROUTED;
}

/**
 * Canonical verification cycle derived from the ledger when history proves
 * verification has started; undefined when the ledger has no cycle metadata.
 */
export function resumeVerificationCycleForPhase(events) {
  return cycleEvents(events);
}

/**
 * Canonical work-state identity fields for reconstruction from a validated
 * ledger: resumed phase, completedSteps, pendingSteps, and verificationCycle.
 * This is the one projection shared by ensureResumableState and
 * contract-create reconstruction so later phases cannot be reconstructed with
 * contradictory steps.
 */
export function buildResumableWorkStateFields({ events, resumedPhase }) {
  const steps = resumeStepsForPhase(resumedPhase);
  return {
    phase: resumedPhase,
    completedSteps: [...steps.completedSteps],
    pendingSteps: [...steps.pendingSteps],
    ...(events && events.length > 0 && cycleEvents(events) !== undefined
      ? { verificationCycle: cycleEvents(events) }
      : {}),
  };
}

export async function deriveResumePhaseFromLedger(target, packageRoot, taskId) {
  let ledger;
  try {
    ledger = await validateEventLedger(target, packageRoot, { taskId });
  } catch {
    return null;
  }
  if (!ledger?.valid) return null;
  const scoped = (ledger.events ?? []).filter((event) => !taskId || event.taskId === taskId);
  if (scoped.some((event) => event.event === "COMPLETION_VALIDATED")) return null;
  const positions = RESUME_PHASE_BY_MILESTONE;
  let derived = null;
  for (const event of scoped) {
    const phase = positions[event.event];
    if (phase) derived = phase;
  }
  return derived;
}

export async function ensureResumableState({ target, packageRoot, contract, route, taskId, statePath }) {
  if (!contract || !route) return null;
  const existing = await readWorkState(target, { packageRoot, taskId, statePath });
  if (existing) return existing;

  const resumedPhase = await deriveResumePhaseFromLedger(target, packageRoot, taskId) ?? "ROUTED";
  let events = [];
  try {
    const ledger = await validateEventLedger(target, packageRoot, { taskId });
    if (ledger.valid) {
      events = (ledger.events ?? []).filter((event) => !taskId || event.taskId === taskId);
    }
  } catch {
    events = [];
  }
  const projection = buildResumableWorkStateFields({ events, resumedPhase });
  const state = createWorkState({
    taskId: contract.value.taskId,
    contractFingerprint: contract.fingerprint,
    routeFingerprint: route.fingerprint,
    repositoryFingerprint: await currentRepositoryFingerprint(target),
    phase: projection.phase,
    selectedGuides: route.value.guides,
    completedSteps: projection.completedSteps,
    pendingSteps: projection.pendingSteps,
    ...(projection.verificationCycle !== undefined ? { verificationCycle: projection.verificationCycle } : {}),
    checks: [],
    failures: [],
    blockers: [],
    verificationEvidence: [],
  });
  return initializeWorkState(target, state, { packageRoot, taskId, statePath });
}

function routeSyncError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function sameStringList(left, right) {
  const a = [...(left ?? [])].sort();
  const b = [...(right ?? [])].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/**
 * Rebinds an existing ROUTED checkpoint to an already-persisted route.
 *
 * Only the route-bound identity fields are updated; contract, repository,
 * steps, checks, evidence, and phase are preserved. Same-identity reruns are
 * a no-op. Every other situation fails closed.
 */
export async function synchronizePersistedRouteState({ target, packageRoot, taskId, route, contract = null, statePath } = {}) {
  if (!route || !route.value || typeof route.fingerprint !== "string") {
    throw routeSyncError("E_ROUTE_STALE", "A persisted route artifact is required to synchronize checkpoint identity");
  }
  const state = await readWorkState(target, { packageRoot, taskId, statePath });
  if (!state) return null;
  if (state.phase !== "ROUTED") {
    throw routeSyncError(
      "E_ROUTE_PHASE_UNSUPPORTED",
      `Route checkpoint synchronization supports phase ROUTED, found ${state.phase}`,
    );
  }
  if (taskId && state.taskId !== taskId) {
    throw routeSyncError("E_ROUTE_STALE", "Work state does not belong to the current route task");
  }
  if (contract && state.contractFingerprint !== contract.fingerprint) {
    // Contract evolution with regenerated routing is a pre-existing flow whose
    // stale checkpoint is recovered through the sanctioned clear-state and
    // preflight recreation path. Never rebind route identity across a contract
    // boundary here; leave the checkpoint untouched.
    return state;
  }
  if (route.value.contractFingerprint !== undefined && state.contractFingerprint !== route.value.contractFingerprint) {
    return state;
  }
  if (state.routeFingerprint === route.fingerprint && sameStringList(state.selectedGuides, route.value.guides)) {
    return state;
  }
  return mutateWorkState(target, {
    expectedRevision: state.revision ?? 0,
    packageRoot,
    taskId,
    statePath,
  }, () => ({
    ...state,
    routeFingerprint: route.fingerprint,
    selectedGuides: [...route.value.guides],
  }));
}

export async function synchronizePreflightState({
  target,
  packageRoot,
  state,
  contract,
  route,
  requiredGates,
  satisfiedGates,
  complianceMode,
  statePath,
  taskId,
}) {
  const candidate = createWorkState({
    ...state,
    taskId: contract.value.taskId,
    contractFingerprint: contract.fingerprint,
    routeFingerprint: route.fingerprint,
    selectedGuides: route.value.guides,
    requiredGates: [...requiredGates],
    satisfiedGates: [...satisfiedGates],
    ...(complianceMode ? { complianceMode } : {}),
    lastUpdated: state.lastUpdated,
  });
  const withoutTimestamp = (value) => {
    const copy = structuredClone(value);
    delete copy.lastUpdated;
    return copy;
  };
  if (JSON.stringify(withoutTimestamp(candidate)) === JSON.stringify(withoutTimestamp(state))) {
    return state;
  }
  return mutateWorkState(target, {
    expectedRevision: state.revision ?? 0,
    packageRoot,
    taskId,
    statePath,
  }, () => ({ ...candidate, lastUpdated: new Date().toISOString() }));
}
