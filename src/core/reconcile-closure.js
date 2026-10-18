import { withTaskTransaction } from "./transaction.js";
import { readContract } from "./contract.js";
import { canonicalFingerprint, readJsonArtifact, writeJsonArtifact } from "./artifacts.js";
import { appendProtocolEvent, validateCompletionRecoveryAuthorization, validateEventLedger } from "./events.js";
import { authorizeCompletionRecoveryOrRebind } from "./completion-recovery-rebind.js";
import { runCommandExecution } from "./execution.js";
import { createReceipt } from "./receipt.js";
import { currentRepositoryFingerprint } from "./repository.js";
import { taskArtifactPath } from "./task-paths.js";
import { resolveTaskClaimState } from "./task-claim-state.js";
import { DIAGNOSTIC_SCHEMA_VERSION, diagnosticSemanticFingerprint } from "./diagnostic-model.js";
import { classifyLoadedWorkState, readWorkState, mutateWorkState } from "./work-state.js";
import { classifyRequirement } from "./evidence-readiness.js";
import { assertDiagnosingToCorrectingTransition } from "./phase.js";
import { resolveCurrentCycleDiagnostic } from "./diagnostic-projection.js";
import { hasCurrentReview } from "./review-correction.js";

export const RECONCILE_EVENT = "CHECKPOINT_RECONCILED";

/**
 * Build the schema-valid rebound diagnostic case for a drifted DIAGNOSING task
 * that entered the phase before its cycle recorded any diagnosis. The case
 * binds every observation to the just-passed contract-bound evidence execution
 * so the diagnosis carries explicit provenance instead of being manufactured
 * by recovery: the hypothesis is the recovery statement, settled by the
 * successful evidence, with the next safe action being the canonical advance.
 */
function reconcileReboundDiagnosticCase({
  taskId,
  verificationCycle,
  checkId,
  requirement,
  command,
  executionId,
  repositoryHead,
}) {
  const statementLimit = 2000;
  const observations = [{
    id: "obs-reconcile-evidence",
    kind: "CHECK_RESULT",
    evidenceRef: checkId,
    provenance: "FORGELOOP_EXECUTED",
    statement: `Contract-bound evidence ${checkId} passed in the current repository (${repositoryHead}); execution ${executionId}: ${command}`.slice(0, statementLimit),
  }];
  const hypotheses = [{
    id: "h-reconcile-rebind",
    statement: `Repository moved after the task entered DIAGNOSING but before the cycle recorded any diagnosis; cycle ${verificationCycle} diagnosis is rebound from the passed contract-bound evidence requirement "${requirement}".`.slice(0, statementLimit),
    contributorRefs: [],
    evidenceRefs: [checkId],
    settledBy: { type: "CHECK_STATUS", checkId, expectedStatus: "passed" },
    status: "OPEN",
  }];
  const details = {
    schemaVersion: DIAGNOSTIC_SCHEMA_VERSION,
    verificationCycle,
    diagnosticRevision: 1,
    failureClass: "VERIFICATION_FAILURE",
    observations,
    contributors: [],
    hypotheses,
    nextSafeAction: {
      statement: "Advance DIAGNOSING -> CORRECTING -> VERIFYING and continue the canonical verification pipeline in the reconciled repository.".slice(0, statementLimit),
    },
  };
  details.diagnosticFingerprint = diagnosticSemanticFingerprint({
    verificationCycle: details.verificationCycle,
    failureClass: details.failureClass,
    case_: details,
  });
  details.previousDiagnosticFingerprint = null;
  return details;
}

// DIAGNOSING is reconcilable under the same diagnosis-boundary condition as
// CORRECTING: the active cycle must already carry an append-only diagnosis.
// Without it, drift entering DIAGNOSING before the cycle's first diagnosis is
// unrecoverable (reconcile-closure, task-recover, handoff, and every mutation
// all refuse), which stranded real drifted tasks on this exact edge.
const RECONCILABLE_PHASES = new Set(["EXECUTING", "VERIFYING", "DIAGNOSING", "CORRECTING", "REVIEWING"]);

function reconcileError(code, message, artifacts = []) {
  const error = new Error(message);
  error.code = code;
  error.artifacts = artifacts;
  return error;
}

function assertRepositoryOnlyFreshness(freshness, stateRel, contractRel) {
  if (freshness.status !== "REVALIDATION_REQUIRED") {
    throw reconcileError(
      "E_RECONCILE_NOT_STALE",
      `work-state checkpoint is ${freshness.status === "FRESH" ? "fresh" : "not revalidation-required"}; no reconciliation required`,
      [stateRel, contractRel],
    );
  }
  if (freshness.reasons.length === 1 && freshness.reasons[0] === "REPOSITORY_CHANGED") return;
  throw reconcileError(
    "E_RECONCILE_UNSUPPORTED_DRIFT",
    `reconcile-closure only reconciles repository fingerprint drift; unresolved drift: ${freshness.reasons.join(", ")}`,
    [stateRel, contractRel],
  );
}

async function assertFreshReviewingRecoveryIsAuthorized({
  target,
  packageRoot,
  taskId,
  state,
  eventsRel,
  receiptRel,
}) {
  if (state.phase !== "REVIEWING" || !Object.prototype.hasOwnProperty.call(state, "lastCompletionAttempt")) return;
  const ledger = await validateEventLedger(target, packageRoot, { taskId });
  if (!ledger.valid) return;
  let receipt = null;
  try {
    receipt = (await readJsonArtifact(target, receiptRel, "execution-receipt", packageRoot)).value;
  } catch (error) {
    if (error.code !== "ARTIFACT_MISSING") throw error;
  }
  const recoveryAuth = validateCompletionRecoveryAuthorization({ state, receipt, events: ledger.events });
  if (!recoveryAuth.authorized) {
    const first = recoveryAuth.errors?.[0] ?? {};
    throw reconcileError(
      first.code ?? "E_COMPLETION_RECOVERY_UNAUTHORIZED",
      `REVIEWING reconciliation requires authorized completion recovery: ${first.message ?? "unauthorized"}`,
      [eventsRel, receiptRel],
    );
  }
}

async function validateReconciliationCheckpoint({
  target,
  packageRoot,
  taskId,
  state,
  stateRel,
  contractRel,
  eventsRel,
  receiptRel,
  authorityContext,
  runtimeContext,
}) {
  const freshness = await classifyLoadedWorkState({ target, state, contractFile: contractRel });
  if (freshness.status !== "REVALIDATION_REQUIRED") {
    await assertFreshReviewingRecoveryIsAuthorized({
      target,
      packageRoot,
      taskId,
      state,
      eventsRel,
      receiptRel,
    });
  }
  assertRepositoryOnlyFreshness(freshness, stateRel, contractRel);

  const ledger = await validateEventLedger(target, packageRoot, { taskId });
  if (!ledger.valid) {
    const first = ledger.errors[0];
    throw reconcileError(
      "E_RECONCILE_LEDGER_INVALID",
      `append-only event ledger must be valid before reconciliation: ${first?.message ?? "invalid ledger"}`,
      [eventsRel],
    );
  }

  await assertReconciliationClaimOwnership(target, { taskId, packageRoot, state, stateRel, eventsRel });

  const reboundOrState = await rebindReconciliationState(target, {
    packageRoot,
    taskId,
    state,
    ledger,
    authorityContext,
    runtimeContext,
    stateRel,
    receiptRel,
  });
  return reboundOrState;
}

/** Fail closed unless the task claim is valid, mutable, and ACTIVE in this checkout. */
async function assertReconciliationClaimOwnership(target, { taskId, packageRoot, state, stateRel, eventsRel }) {
  const ownership = await resolveTaskClaimState(target, { taskId, packageRoot });
  if (!ownership.ownershipValid || !ownership.mutationAllowed || ownership.claimState !== "ACTIVE") {
    const first = ownership.ownershipErrors?.[0] ?? ownership.errors?.[0] ?? {};
    throw reconcileError(
      first.code ?? "E_TASK_CLAIM_OWNERSHIP_INCONSISTENT",
      `reconcile-closure requires active, valid task claim ownership: ${first.message ?? ownership.claimState}`,
      [stateRel, eventsRel],
    );
  }
}

/** Handle the phase-bound diagnosis rebind gates for CORRECTING/DIAGNOSING and the REVIEWING recovery authorization.
 * Returns the possibly-rebound state (or the original state when no rebind applies). */
async function rebindReconciliationState(target, {
  packageRoot,
  taskId,
  state,
  ledger,
  authorityContext,
  runtimeContext,
  stateRel,
  receiptRel,
}) {
  if (state.phase === "CORRECTING" || state.phase === "DIAGNOSING") {
    // The diagnosis boundary for CORRECTING stays absolute: recovery can never
    // manufacture a diagnosis or authorize a retry the ordinary correction
    // transition would refuse. A drifted DIAGNOSING task without a cycle
    // diagnosis is the one legal exception: the drift struck between entering
    // DIAGNOSING and recording the cycle's first diagnosis, and no other
    // command can create either the diagnosis or the fresh checkpoint. Such a
    // task reconciles only after contract-bound evidence passes, and the
    // reconcile itself records the cycle diagnosis below (provenance bound to
    // the passed evidence execution).
    const cycleDiagnosis = resolveCurrentCycleDiagnostic(ledger.events, state.taskId, state.verificationCycle ?? 1);
    // Refresh only the repository binding for a task that entered correction
    // from review before recording its new finding. No diagnosis is invented;
    // advance to VERIFYING still requires one from this cycle.
    if (state.phase === "CORRECTING" && !cycleDiagnosis && hasCurrentReview(state, ledger.events)) return state;
    if (state.phase === "DIAGNOSING" && !cycleDiagnosis) {
      return { ...state, undiagnosedDiagnosingRebind: true };
    }
    assertDiagnosingToCorrectingTransition({
      state,
      events: ledger.events,
      resolveDiagnosis: resolveCurrentCycleDiagnostic,
    });
  }

  if (state.phase !== "REVIEWING" || !Object.prototype.hasOwnProperty.call(state, "lastCompletionAttempt")) {
    return state;
  }

  const recovery = await authorizeCompletionRecoveryOrRebind({ target, packageRoot, taskId, authorityContext, runtimeContext });
  if (!recovery.recoveryAuth.authorized) {
    const first = recovery.recoveryAuth.errors?.[0] ?? {};
    throw reconcileError(
      first.code ?? "E_COMPLETION_RECOVERY_UNAUTHORIZED",
      `REVIEWING reconciliation requires authorized completion recovery: ${first.message ?? "unauthorized"}`,
      [stateRel, receiptRel],
    );
  }
  return recovery.rebound ? recovery.state : state;
}

/**
 * Canonical recovery for an EXECUTING, VERIFYING, CORRECTING, or REVIEWING task whose
 * objective is already satisfied in the current repository but whose
 * work-state checkpoint is stale because the repository fingerprint moved.
 *
 * The command refreshes the checkpoint repository fingerprint only after:
 *   - the task is EXECUTING, VERIFYING, CORRECTING, or REVIEWING (with either a
 *     persisted completion rejection or the narrow repository-only bootstrap
 *     path),
 *   - classification requires revalidation and the only drift is
 *     REPOSITORY_CHANGED,
 *   - the append-only event ledger is valid,
 *   - a contract-bound verification check (exact verification item id and
 *     requirement text, type VERIFICATION) executes successfully in the
 *     current repository as evidence that the objective is present.
 *
 * Closure itself proceeds through the canonical pipeline (advance to
 * VERIFYING, prepare-completion, record-check, complete); claims are
 * released only by canonical COMPLETE.
 */
export async function runReconcileClosure(options = {}) {
  if (typeof options.taskId !== "string" || !options.taskId.trim()) return reconcileSelectedClosure(options);
  return withTaskTransaction({ target: options.target, packageRoot: options.packageRoot,
    taskId: options.taskId, operation: "reconcile-closure", recordCommitEvent: true },
  () => reconcileSelectedClosure(options));
}

async function reconcileSelectedClosure({
  target,
  packageRoot,
  taskId,
  checkId,
  requirement,
  argv,
  details,
  authorityContext,
  runtimeContext,
} = {}) {
  requireReconcileInputs({ taskId, checkId, requirement, argv });

  const stateRel = taskArtifactPath(taskId, "state");
  const contractRel = taskArtifactPath(taskId, "contract");
  const eventsRel = taskArtifactPath(taskId, "events");
  const receiptRel = taskArtifactPath(taskId, "receipt");

  let state = await readWorkState(target, { packageRoot, taskId });
  if (!state) {
    throw reconcileError("E_RECONCILE_PHASE_INVALID", "Cannot reconcile without work state", [stateRel]);
  }
  if (!RECONCILABLE_PHASES.has(state.phase)) {
    throw reconcileError(
      "E_RECONCILE_PHASE_INVALID",
      `reconcile-closure supports EXECUTING, VERIFYING, DIAGNOSING, CORRECTING, or REVIEWING tasks whose objective is already satisfied; found ${state.phase}`,
      [stateRel],
    );
  }
  state = await validateReconciliationCheckpoint({
    target,
    packageRoot,
    taskId,
    state,
    stateRel,
    contractRel,
    eventsRel,
    receiptRel,
    authorityContext,
    runtimeContext,
  });

  const contract = await readContract(target, packageRoot, { taskId });
  const verificationItem = (contract.value.verification ?? []).find((item) => {
    if (typeof item === "string") {
      return item === requirement;
    }
    return classifyRequirement(item).type === "VERIFICATION"
      && item.id === checkId
      && item.text === requirement;
  });
  if (!verificationItem) {
    throw reconcileError(
      "E_RECONCILE_REQUIREMENT_UNKNOWN",
      `no contract verification item matches id "${checkId}" with the exact requirement text`,
      [contractRel],
    );
  }

  const execution = await runCommandExecution({
    target,
    packageRoot,
    taskId,
    checkId,
    requirement,
    verificationCycle: state.verificationCycle ?? 1,
    argv,
    details,
    authorityContext,
    runtimeContext,
  });
  if (execution.execution.status !== "passed") {
    throw reconcileError(
      "E_RECONCILE_EVIDENCE_FAILED",
      `objective-satisfaction evidence failed (exit ${execution.execution.exitCode ?? "not-started"}): ${execution.result}`,
      [execution.path],
    );
  }

  const repository = await currentRepositoryFingerprint(target);
  const previous = state.repositoryFingerprint;

  const rebindDiagnosis = Boolean(state.undiagnosedDiagnosingRebind);
  if (rebindDiagnosis) {
    delete state.undiagnosedDiagnosingRebind;
    await appendProtocolEvent(target, {
      taskId,
      event: "DIAGNOSTIC_CASE_RECORDED",
      details: reconcileReboundDiagnosticCase({
        taskId,
        verificationCycle: state.verificationCycle ?? 1,
        checkId,
        requirement,
        command: argv.join(" "),
        executionId: execution.execution.executionId,
        repositoryHead: repository.head,
      }),
    }, packageRoot, { taskId });
  }

  await appendProtocolEvent(target, {
    taskId,
    event: RECONCILE_EVENT,
    details: {
      previousBranch: previous?.branch ?? null,
      previousHead: previous?.head ?? null,
      currentBranch: repository.branch,
      currentHead: repository.head,
      checkId,
      requirement,
      command: argv.join(" "),
      exitCode: execution.execution.exitCode ?? 0,
      executionId: execution.execution.executionId,
    },
  }, packageRoot, { taskId });

  const nextState = await mutateWorkState(target, {
    expectedRevision: state.revision ?? 0,
    packageRoot,
    taskId,
  }, () => ({
    ...state,
    repositoryFingerprint: repository,
    lastUpdated: new Date().toISOString(),
  }));

  try {
    const receipt = await readJsonArtifact(target, receiptRel, "execution-receipt", packageRoot);
    const reboundReceipt = await createReceipt({
      ...receipt.value,
      stateFingerprint: canonicalFingerprint(nextState),
    }, packageRoot, { target, taskId, authorityContext, runtimeContext });
    await writeJsonArtifact(target, receiptRel, reboundReceipt, "execution-receipt", packageRoot);
  } catch (error) {
    if (error.code !== "ARTIFACT_MISSING") throw error;
  }

  return {
    taskId,
    phase: state.phase,
    reconciled: true,
    previousRepositoryFingerprint: previous,
    repositoryFingerprint: repository,
    checkId,
    requirement,
    executionId: execution.execution.executionId,
    executionPath: execution.path,
    event: RECONCILE_EVENT,
  };
}

/** Validate the reconcile arguments exactly as before; shared by the phase-independent input gate. */
function requireReconcileInputs({ taskId, checkId, requirement, argv } = {}) {
  if (typeof taskId !== "string" || !taskId.trim()) {
    throw reconcileError("E_TASK_REQUIRED", "reconcile-closure requires --task", []);
  }
  if (typeof checkId !== "string" || !checkId.trim()) {
    throw reconcileError("E_RECONCILE_REQUIREMENT_UNKNOWN", "reconcile-closure requires --id", []);
  }
  if (typeof requirement !== "string" || !requirement.trim()) {
    throw reconcileError("E_RECONCILE_REQUIREMENT_UNKNOWN", "reconcile-closure requires --requirement", []);
  }
  if (!Array.isArray(argv) || argv.length === 0) {
    throw reconcileError("E_RECONCILE_EVIDENCE_FAILED", "reconcile-closure requires -- followed by the evidence command argv", []);
  }
}
