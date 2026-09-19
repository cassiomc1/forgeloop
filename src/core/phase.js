import { ARTIFACT_PATHS, canonicalFingerprint, readJsonArtifact, writeJsonArtifact } from "./artifacts.js";
import { readContract } from "./contract.js";
import {
  appendProtocolEvent,
  LIFECYCLE_MILESTONES,
  validateEventLedger,
  validateStateLedgerCoherence,
} from "./events.js";
import { readPersistedRoute } from "./route-artifact.js";
import { assertWorkPhase, isValidTransition } from "./protocol.js";
import { readWorkState, mutateWorkState } from "./work-state.js";
import { authorizeCompletionRecoveryOrRebind } from "./completion-recovery-rebind.js";
import { evaluateCompletion, runComplete as persistCompletion } from "./completion.js";
import { evaluatePreflight } from "./preflight.js";
import { requiredEvidenceForTarget } from "./completion-artifacts.js";
import { assertCompletionRelationships, assertStateIdentity, stateIdentityErrors } from "./completion-relationships.js";
import { createReceipt, validateReceipt } from "./receipt.js";
import { assertExecutionPrerequisites, hasExecutionStarted } from "./execution-prerequisites.js";
import { taskArtifactPath } from "./task-paths.js";
import { discoverTasks } from "./task-discovery.js";
import { assertNoScopeConflicts, assertScopeClean } from "./task-scope.js";
import { readTaskDescriptor } from "./task-descriptor.js";
import { E_TASK_SCOPE_REQUIRED } from "./error-codes.js";
import { resolveCurrentCycleDiagnostic } from "./diagnostic-projection.js";
import {
  buildInformationGainProjection,
  evaluateStructuredDiagnosticStall,
} from "./information-gain-projection.js";
import { assertStructuralQualityExecutionReady } from "./structural-quality/service.js";
import { getTaskTransaction, withTaskTransaction } from "./transaction.js";
import {
  CONTRACT_BOOTSTRAP_REPAIR_EVENT,
  ROUTE_CHECKPOINT_BOUND_EVENT,
  resolveCanonicalPostRepairCheckpointBinding,
  sameCanonicalGuideList,
} from "./contract-bootstrap-recovery.js";

function phaseError(code, message, artifacts = []) {
  const error = new Error(message);
  error.code = code;
  error.artifacts = artifacts;
  return error;
}

const PHASE_EVENTS = Object.freeze({
  CONTRACT_READY: "CONTRACT_VALIDATED",
  ROUTED: "ROUTE_VALIDATED",
  DESIGNING: "DESIGN_GATE_STARTED",
  PLANNED: "PLAN_RECORDED",
  EXECUTING: "EXECUTION_STARTED",
  VERIFYING: "VERIFICATION_STARTED",
  REVIEWING: "REVIEW_STARTED",
  COMPLETE: "COMPLETION_VALIDATED",
});

const LATE_PHASES = new Set([
  "EXECUTING",
  "VERIFYING",
  "DIAGNOSING",
  "CORRECTING",
  "REVIEWING",
  "COMPLETE",
]);

async function readPhaseIdentityArtifacts(target, state, toPhase, packageRoot, options, paths) {
  const scopedTaskId = options.taskId ?? null;
  const requireContract = LATE_PHASES.has(state.phase)
    || ["CONTRACT_READY", "ROUTED", "EXECUTING"].includes(toPhase);
  const requireRoute = state.phase === "ROUTED"
    || LATE_PHASES.has(state.phase)
    || ["ROUTED", "EXECUTING"].includes(toPhase);
  let contract = null;
  let route = null;
  try {
    contract = await readContract(target, packageRoot, { taskId: scopedTaskId, contractPath: options.contractPath });
  } catch (error) {
    if (error.code === "ARTIFACT_MISSING" && !requireContract) {
      contract = null;
    } else {
      throw phaseError(
        requireContract ? "E_PHASE_PREREQUISITE_MISSING" : error.code ?? "E_CONTRACT_INVALID",
        `${requireContract ? `Phase ${toPhase} requires current contract` : "Unable to validate current contract"}: ${error.message}`,
        [paths.contractRel],
      );
    }
  }
  try {
    route = await readPersistedRoute(target, packageRoot, { taskId: scopedTaskId, routePath: options.routePath });
  } catch (error) {
    if (error.code === "ARTIFACT_MISSING" && !requireRoute) {
      route = null;
    } else {
      throw phaseError(
        requireRoute ? "E_PHASE_PREREQUISITE_MISSING" : error.code ?? "E_ROUTE_INVALID",
        `${requireRoute ? `Phase ${toPhase} requires persisted route` : "Unable to validate persisted route"}: ${error.message}`,
        [paths.routeRel],
      );
    }
  }
  return { contract, route };
}

function assertRepairedCheckpointIdentity({ contract, route, state, events, contractRel, routeRel, stateRel }) {
  const repairMarker = events.find((event) => event.event === CONTRACT_BOOTSTRAP_REPAIR_EVENT);
  if (!repairMarker || state.phase === "ROUTED") return false;
  const checkpoint = resolveCanonicalPostRepairCheckpointBinding(events, repairMarker);
  if (!checkpoint) {
    throw phaseError(
      "E_PHASE_CHRONOLOGY_INVALID",
      "Repaired late-phase state requires a canonical route checkpoint binding",
      [contractRel, routeRel],
    );
  }
  const identityErrors = [
    ...stateIdentityErrors({ contract, state }),
    ...stateIdentityErrors({ contract, route }),
  ];
  if (state.routeFingerprint !== checkpoint.routeFingerprint
    || !sameCanonicalGuideList(state.selectedGuides, checkpoint.selectedGuides)) {
    identityErrors.push({
      code: "E_ROUTE_GUIDE_MISMATCH",
      message: "Work state does not match the immutable route checkpoint identity",
      artifacts: [routeRel, stateRel],
    });
  }
  if (identityErrors.length > 0) {
    const first = identityErrors[0];
    throw phaseError(first.code, first.message, first.artifacts);
  }
  return true;
}

async function assertPersistedStateIdentity(target, state, toPhase, packageRoot, options = {}) {
  const scopedTaskId = options.taskId ?? null;
  const events = options.events ?? [];
  const contractRel = options.contractPath ?? (scopedTaskId ? taskArtifactPath(scopedTaskId, "contract") : ARTIFACT_PATHS.contract);
  const routeRel = options.routePath ?? (scopedTaskId ? taskArtifactPath(scopedTaskId, "route") : ARTIFACT_PATHS.route);
  const stateRel = options.statePath ?? (scopedTaskId ? taskArtifactPath(scopedTaskId, "state") : ARTIFACT_PATHS.state);
  const { contract, route } = await readPhaseIdentityArtifacts(
    target,
    state,
    toPhase,
    packageRoot,
    options,
    { contractRel, routeRel },
  );
  if (!contract && !route) return;
  if (toPhase !== "ROUTED" && assertRepairedCheckpointIdentity({
    contract,
    route,
    state,
    events,
    contractRel,
    routeRel,
    stateRel,
  })) {
    return;
  }
  try {
    assertStateIdentity({ contract, route, state });
  } catch (error) {
    throw phaseError(
      error.code,
      error.message,
      error.artifacts,
    );
  }
}

function reconcileImplementationStep(state, toPhase) {
  if (state.phase !== "EXECUTING" || toPhase !== "VERIFYING") return state;
  if (!state.pendingSteps.includes("implementation")) return state;
  return {
    ...state,
    completedSteps: state.completedSteps.includes("implementation")
      ? [...state.completedSteps]
      : [...state.completedSteps, "implementation"],
    pendingSteps: state.pendingSteps.filter((step) => step !== "implementation"),
  };
}

async function assertPhasePrerequisites(target, state, toPhase, packageRoot, authorityContext, runtimeContext, options = {}) {
  const scopedTaskId = options.taskId ?? null;
  const contractRel = options.contractPath ?? (scopedTaskId ? taskArtifactPath(scopedTaskId, "contract") : ARTIFACT_PATHS.contract);
  const routeRel = options.routePath ?? (scopedTaskId ? taskArtifactPath(scopedTaskId, "route") : ARTIFACT_PATHS.route);

  if (toPhase === "CONTRACT_READY" || toPhase === "ROUTED" || toPhase === "EXECUTING") {
    try {
      await readContract(target, packageRoot, { taskId: scopedTaskId, contractPath: options.contractPath });
    } catch (error) {
      throw phaseError("E_PHASE_PREREQUISITE_MISSING", `Phase ${toPhase} requires ${contractRel}: ${error.message}`, [contractRel]);
    }
  }
  if (toPhase === "ROUTED" || toPhase === "EXECUTING") {
    try {
      await readPersistedRoute(target, packageRoot, { taskId: scopedTaskId, routePath: options.routePath });
    } catch (error) {
      throw phaseError("E_PHASE_PREREQUISITE_MISSING", `Phase ${toPhase} requires ${routeRel}: ${error.message}`, [routeRel]);
    }
  }
  if (toPhase === "EXECUTING" && scopedTaskId) {
    try {
      await assertStructuralQualityExecutionReady({ target, packageRoot, taskId: scopedTaskId, runtimeContext });
    } catch (error) {
      throw phaseError(error.code, error.message, error.artifacts);
    }
  }
  if (hasExecutionStarted(toPhase)) {
    try {
      await assertExecutionPrerequisites({ target, state, packageRoot, ...options, taskId: scopedTaskId, runtimeContext });
    } catch (error) {
      throw phaseError(error.code, error.message, error.artifacts);
    }
  }
  if (toPhase === "COMPLETE" && state.verificationEvidence.length === 0) {
    throw phaseError("E_PHASE_EVIDENCE_MISSING", "COMPLETE requires verification evidence");
  }
  if (toPhase === "COMPLETE") {
    const completion = await evaluateCompletion({ target, packageRoot, persist: false, authorityContext, runtimeContext, taskId: scopedTaskId, ...options });
    if (completion.status !== "VALID") {
      throw phaseError("E_COMPLETION_REJECTED", "COMPLETE requires a valid completion audit", completion.errors.flatMap((error) => error.artifacts ?? []));
    }
  }
}

async function appendRepairRouteCheckpoint({ target, packageRoot, taskId, state, events, stateRel, eventsRel }) {
  const repairMarker = events.find((event) => event.event === CONTRACT_BOOTSTRAP_REPAIR_EVENT);
  const checkpointAlreadyBound = events.some((event) => event.event === ROUTE_CHECKPOINT_BOUND_EVENT);
  if (!repairMarker || state.phase !== "ROUTED" || checkpointAlreadyBound) return;
  if (typeof state.routeFingerprint !== "string") {
    throw phaseError("E_ROUTE_GUIDE_MISMATCH", "ROUTED state requires a route fingerprint before checkpoint binding", [stateRel, eventsRel]);
  }
  await appendProtocolEvent(target, {
    taskId: state.taskId,
    event: ROUTE_CHECKPOINT_BOUND_EVENT,
    details: {
      routeFingerprint: state.routeFingerprint,
      contractFingerprint: state.contractFingerprint,
      selectedGuides: [...state.selectedGuides].sort(),
    },
  }, packageRoot, { taskId, eventsPath: eventsRel });
}

export async function advanceWorkState(target, toPhase, options = {}) {
  const normalizedOptions = typeof options === "string" ? { packageRoot: options } : options;
  if (!normalizedOptions.taskId || await getTaskTransaction(target)) {
    return advanceWorkStateInternal(target, toPhase, normalizedOptions);
  }
  return withTaskTransaction({
    target,
    taskId: normalizedOptions.taskId,
    operation: "advance",
    packageRoot: normalizedOptions.packageRoot,
    recordCommitEvent: true,
  }, async () => advanceWorkStateInternal(target, toPhase, normalizedOptions));
}

async function advanceWorkStateInternal(target, toPhase, normalizedOptions) {
  const {
    packageRoot,
    now = new Date().toISOString(),
    authorityContext,
    runtimeContext,
    taskId = null,
    statePath = null,
    contractPath = null,
    routePath = null,
    receiptPath = null,
    eventsPath = null,
  } = normalizedOptions;
  assertWorkPhase(toPhase);

  let state = await readWorkState(target, { packageRoot, taskId, statePath });
  const stateRel = statePath ?? (taskId ? taskArtifactPath(taskId, "state") : ARTIFACT_PATHS.state);
  if (!state) throw phaseError("E_PHASE_PREREQUISITE_MISSING", "Cannot advance without work state", [stateRel]);
  const eventsRel = eventsPath ?? (taskId ? taskArtifactPath(taskId, "events") : ARTIFACT_PATHS.events);
  const receiptRel = receiptPath ?? (taskId ? taskArtifactPath(taskId, "receipt") : ARTIFACT_PATHS.receipt);

  // COMPLETE must use the same transactional completion path regardless of
  // whether the caller selected the dedicated command or a phase transition.
  // This keeps required code-manifest capture and its ledger event atomic with
  // the final state and receipt.
  if (toPhase === "COMPLETE" && state.phase === "REVIEWING") {
    const completion = await persistCompletion({
      target,
      packageRoot,
      taskId,
      authorityContext,
      runtimeContext,
      contractPath,
      routePath,
      statePath,
      receiptPath,
      eventsPath,
      preflightPath: null,
    });
    if (completion.status !== "VALID") {
      throw phaseError(
        "E_COMPLETION_REJECTED",
        "COMPLETE requires a valid completion audit",
        completion.errors.flatMap((error) => error.artifacts ?? []),
      );
    }
    return readWorkState(target, { packageRoot, taskId, statePath });
  }

  await assertPhasePrerequisites(target, state, toPhase, packageRoot, authorityContext, runtimeContext, { taskId, statePath, contractPath, routePath, receiptPath, eventsPath });

  if (toPhase === "EXECUTING" && taskId) {
    // Multi-task checkout scope checks
    const discovered = await discoverTasks(target, packageRoot);
    let descriptor = null;
    try {
      const descArtifact = await readTaskDescriptor(target, taskId, packageRoot);
      descriptor = descArtifact.value;
    } catch {
      // Descriptor might not exist if legacy
    }

    const nonCompleteTasks = discovered.filter((t) => t.phase !== "COMPLETE");
    if (nonCompleteTasks.length > 1) {
      const currentTask = discovered.find((task) => task.taskId === taskId && task.healthy !== false);
      const claims = currentTask?.writeClaims ?? [];
      if (claims.length === 0) {
        throw phaseError(
          E_TASK_SCOPE_REQUIRED,
          "Multiple tasks exist in the repository. Entering EXECUTING requires declared non-empty write claims. Use 'forgeloop task-scope' first.",
          [descriptor ? taskArtifactPath(taskId, "descriptor") : stateRel],
        );
      }
      assertNoScopeConflicts(claims, discovered, taskId);
      await assertScopeClean(target, claims);
    }
  }

  if (!isValidTransition(state.phase, toPhase)) {
    throw phaseError("E_PHASE_TRANSITION_INVALID", `Invalid work-state transition: ${state.phase} -> ${toPhase}`);
  }
  const ledger = await validateEventLedger(target, packageRoot, { taskId, eventsPath });
  if (!ledger.valid) {
    const first = ledger.errors[0];
    throw phaseError(first.code, first.message, [eventsRel]);
  }
  if (ledger.events.some((event) => event.taskId !== state.taskId)) {
    throw phaseError(
      "E_PHASE_CHRONOLOGY_INVALID",
      "Cannot advance work state with lifecycle events from a different task",
      [eventsRel, stateRel],
    );
  }
  const coherenceErrors = validateStateLedgerCoherence(state, ledger.events);
  if (coherenceErrors.length > 0) {
    throw phaseError(coherenceErrors[0].code, coherenceErrors[0].message, [stateRel, eventsRel]);
  }
  await assertPersistedStateIdentity(target, state, toPhase, packageRoot, {
    taskId,
    contractPath,
    routePath,
    events: ledger.events,
  });
  const eventType = PHASE_EVENTS[toPhase];
  const reenteringVerification = toPhase === "VERIFYING" && ["CORRECTING", "REVIEWING"].includes(state.phase);
  if (toPhase === "VERIFYING" && state.phase === "REVIEWING") {
    const recovery = await authorizeCompletionRecoveryOrRebind({
      target,
      packageRoot,
      taskId,
      statePath,
      contractPath,
      routePath,
      receiptPath,
      eventsPath,
      authorityContext,
      runtimeContext,
    });
    if (!recovery.recoveryAuth.authorized) {
      const firstError = recovery.recoveryAuth.errors[0] ?? {};
      throw phaseError(
        firstError.code ?? "E_COMPLETION_RECOVERY_UNAUTHORIZED",
        firstError.message ?? "REVIEWING -> VERIFYING requires authorized completion recovery",
        [stateRel, eventsRel],
      );
    }
    if (recovery.rebound) {
      state = recovery.state;
    }
  }
  if (toPhase === "CORRECTING" && state.phase === "DIAGNOSING") {
    const cycle = state.verificationCycle ?? 1;
    const diagEvent = resolveCurrentCycleDiagnostic(ledger.events, state.taskId, cycle);
    if (!diagEvent) {
      throw phaseError(
        "E_DIAGNOSIS_REQUIRED",
        "DIAGNOSING -> CORRECTING requires an append-only diagnosis record for the active verification cycle",
        [eventsRel],
      );
    }
    let stalledNoGain = false;
    if (diagEvent.sourceModel === "STRUCTURED_DIAGNOSTIC_CASE_V1") {
      // One canonical structured-stall truth, shared with progress/reflect.
      const stall = evaluateStructuredDiagnosticStall(
        buildInformationGainProjection(ledger.events, state.taskId),
        { verificationCycle: cycle },
      );
      stalledNoGain = stall.stalled;
    }
    const gainClassification = diagEvent.sourceModel === "STRUCTURED_DIAGNOSTIC_CASE_V1"
      ? null
      : diagEvent.details?.informationGain;
    if (!diagEvent.details
      || stalledNoGain
      || (diagEvent.sourceModel !== "STRUCTURED_DIAGNOSTIC_CASE_V1" && gainClassification === "NONE")) {
      throw phaseError(
        "E_DIAGNOSIS_NO_NEW_INFORMATION",
        "The proposed retry repeats the previous hypothesis with the same evidence without new information",
        [eventsRel],
      );
    }
  }
  if (toPhase === "VERIFYING" && state.phase === "CORRECTING") {
    const cycle = state.verificationCycle ?? 1;
    const diagEvent = resolveCurrentCycleDiagnostic(ledger.events, state.taskId, cycle);
    if (!diagEvent) {
      throw phaseError(
        "E_DIAGNOSIS_REQUIRED",
        "CORRECTING -> VERIFYING requires an append-only diagnosis record for the current cycle",
        [eventsRel],
      );
    }
    if (typeof state.diagnosedHypothesis !== "string" || !state.diagnosedHypothesis.trim()) {
      throw phaseError(
        "E_PHASE_PREREQUISITE_MISSING",
        "CORRECTING -> VERIFYING requires a diagnosed hypothesis",
        [stateRel],
      );
    }
  }
  const repeatedReview = state.phase === "VERIFYING" && toPhase === "REVIEWING"
    && ledger.events.some((event) => event.taskId === state.taskId && event.event === "REVIEW_STARTED");
  if (eventType && !reenteringVerification && !repeatedReview
    && ledger.events.some((event) => event.taskId === state.taskId && event.event === eventType)) {
    throw phaseError("E_PHASE_CHRONOLOGY_INVALID", `Lifecycle milestone already exists: ${eventType}`, [eventsRel]);
  }
  const milestoneIndex = reenteringVerification || repeatedReview ? -1 : LIFECYCLE_MILESTONES.indexOf(eventType);
  if (milestoneIndex >= 0) {
    const lastMilestone = ledger.events.reduce((last, event) => Math.max(last, LIFECYCLE_MILESTONES.indexOf(event.event)), -1);
    if (lastMilestone !== milestoneIndex - 1) {
      throw phaseError("E_PHASE_CHRONOLOGY_INVALID", `Phase ${toPhase} cannot append ${eventType} after the current lifecycle ledger`, [eventsRel]);
    }
  }
  const reconciled = reconcileImplementationStep(state, toPhase);
  const next = {
    ...reconciled,
    previousPhase: state.phase,
    phase: toPhase,
    lastUpdated: now,
  };
  if (toPhase === "VERIFYING") {
    next.verificationCycle = reenteringVerification ? (state.verificationCycle ?? 1) + 1 : (state.verificationCycle ?? 1);
  }
  if (reenteringVerification) delete next.lastCompletionAttempt;
  next.revision = (state.revision ?? 0) + 1;
  await appendRepairRouteCheckpoint({
    target,
    packageRoot,
    taskId,
    state,
    events: ledger.events,
    stateRel,
    eventsRel,
  });
  let nextReceipt = null;
  try {
    const receipt = await readJsonArtifact(target, receiptRel, "execution-receipt", packageRoot);
    const contract = await readContract(target, packageRoot, { taskId, contractPath });
    const route = await readPersistedRoute(target, packageRoot, { taskId, routePath });
    const preflight = await evaluatePreflight({ target, packageRoot, taskId, contractPath, routePath, statePath });
    const requiredEvidence = await requiredEvidenceForTarget({
      target,
      contract,
      route,
      packageRoot,
      additionalEvidence: preflight.policy?.requiredEvidence ?? [],
    });
    await validateReceipt(receipt.value, packageRoot, {
      target,
      taskId: contract?.value?.taskId,
      authorityContext,
      runtimeContext,
    });
    assertCompletionRelationships({
      contract,
      route,
      state,
      receipt: receipt.value,
      requiredEvidence,
      requireRequiredChecks: false,
      requireReceiptStateFingerprint: false,
      target,
      taskId: contract?.value?.taskId,
      authorityContext,
      runtimeContext,
    });
    nextReceipt = await createReceipt({
      ...receipt.value,
      stateFingerprint: canonicalFingerprint(next),
      verificationCycle: next.verificationCycle ?? receipt.value.verificationCycle ?? 1,
    }, packageRoot, {
      target,
      taskId: contract?.value?.taskId,
      authorityContext,
      runtimeContext,
    });
    assertCompletionRelationships({
      contract,
      route,
      state: next,
      receipt: nextReceipt,
      requiredEvidence,
      requireRequiredChecks: false,
      target,
      taskId: contract?.value?.taskId,
      authorityContext,
      runtimeContext,
    });
  } catch (error) {
    if (error.code !== "ARTIFACT_MISSING") throw error;
  }
  await mutateWorkState(target, {
    expectedRevision: state.revision ?? 0,
    packageRoot,
    taskId,
    statePath,
  }, () => next);
  if (nextReceipt) {
    await writeJsonArtifact(target, receiptRel, nextReceipt, "execution-receipt", packageRoot);
  }
  if (eventType) await appendProtocolEvent(target, {
    taskId: state.taskId,
    event: eventType,
    at: now,
    details: eventType === "VERIFICATION_STARTED"
      ? { verificationCycle: next.verificationCycle }
      : eventType === "REVIEW_STARTED"
        ? { verificationCycle: next.verificationCycle ?? 1 }
        : undefined,
  }, packageRoot, { taskId, eventsPath });
  return next;
}
