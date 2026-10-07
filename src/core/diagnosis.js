import { appendProtocolEvent, validateEventLedger } from "./events.js";
import { readWorkState, mutateWorkState } from "./work-state.js";
import { getTaskTransaction, withTaskTransaction } from "./transaction.js";
import {
  DIAGNOSIS_INFORMATION_GAIN,
  assertDiagnosisDetails,
  classifyDiagnosisInformationGain,
  createDiagnosisDetails,
  currentCycleDiagnosis,
  diagnosisEventsForTask,
  diagnosisFingerprint,
  normalizeDiagnosisText,
} from "./diagnosis-model.js";

export {
  DIAGNOSIS_INFORMATION_GAIN,
  assertDiagnosisDetails,
  classifyDiagnosisInformationGain,
  createDiagnosisDetails,
  currentCycleDiagnosis,
  diagnosisEventsForTask,
  diagnosisFingerprint,
  normalizeDiagnosisText,
};

export async function recordDiagnosis(options) {
  if (await getTaskTransaction(options.target)) return recordDiagnosisInTransaction(options);
  const state = await readWorkState(options.target, { packageRoot: options.packageRoot, taskId: options.taskId, statePath: options.statePath });
  if (!state) return recordDiagnosisInTransaction(options);
  return withTaskTransaction({ target: options.target, taskId: options.taskId ?? state.taskId,
    packageRoot: options.packageRoot, operation: "record-diagnosis" }, () => recordDiagnosisInTransaction(options));
}

async function recordDiagnosisInTransaction({
  target,
  packageRoot,
  hypothesis,
  failureClass,
  evidenceRefs,
  settledBy,
  nextSafeAction,
  taskId = null,
  statePath = null,
  eventsPath = null,
}) {
  const state = await readWorkState(target, { packageRoot, taskId, statePath });
  if (!state) {
    const error = new Error("Work state not found");
    error.code = "E_STATE_MISSING";
    throw error;
  }
  if (state.phase !== "DIAGNOSING") {
    const error = new Error(`Recording a diagnosis requires phase DIAGNOSING, currently ${state.phase}`);
    error.code = "E_PHASE_PREREQUISITE_MISSING";
    throw error;
  }
  if (typeof state.verificationCycle !== "number" || state.verificationCycle < 1) {
    const error = new Error("Active verification cycle must be an integer >= 1");
    error.code = "E_DIAGNOSIS_INVALID";
    throw error;
  }

  const ledger = await validateEventLedger(target, packageRoot, { taskId: taskId ?? null, eventsPath });
  if (!ledger.valid) {
    const first = ledger.errors[0];
    const error = new Error(first.message);
    error.code = first.code;
    throw error;
  }

  const verificationStarted = ledger.events.some(
    (e) => e.taskId === state.taskId && e.event === "VERIFICATION_STARTED",
  );
  if (!verificationStarted) {
    const error = new Error("No VERIFICATION_STARTED event found for active cycle");
    error.code = "E_PHASE_CHRONOLOGY_INVALID";
    throw error;
  }

  const currentCycleChecks = (state.checks ?? []).filter(
    (c) => c.details?.verificationCycle === state.verificationCycle,
  );

  const cleanRefs = (evidenceRefs ?? []).map((r) => String(r).trim()).filter(Boolean);
  if (cleanRefs.length === 0) {
    const error = new Error("record-diagnosis requires at least one evidenceRef");
    error.code = "E_DIAGNOSIS_EVIDENCE_INVALID";
    throw error;
  }

  const matchedChecks = [];
  for (const ref of cleanRefs) {
    const check = currentCycleChecks.find((c) => (c.id === ref || c.checkId === ref));
    if (!check) {
      const error = new Error(`Evidence reference "${ref}" does not match any check from verification cycle ${state.verificationCycle}`);
      error.code = "E_DIAGNOSIS_EVIDENCE_INVALID";
      throw error;
    }
    matchedChecks.push(check);
  }

  const hasFailedOrBlocked = matchedChecks.some((c) => c.status === "failed" || c.status === "blocked");
  if (!hasFailedOrBlocked) {
    const error = new Error("Diagnosis evidenceRefs must include at least one failed or blocked check from the current cycle");
    error.code = "E_DIAGNOSIS_EVIDENCE_INVALID";
    throw error;
  }

  const existingEvent = currentCycleDiagnosis(
    ledger.events,
    state.taskId,
    state.verificationCycle,
  );

  const requestedFingerprint = diagnosisFingerprint({
    failureClass,
    hypothesis,
    evidenceRefs: cleanRefs,
  });

  if (existingEvent?.details?.diagnosisFingerprint === requestedFingerprint) {
    const updatedState = await mutateWorkState(target, {
      expectedRevision: state.revision ?? 0,
      packageRoot,
      taskId: taskId ?? null,
      statePath,
    }, () => ({
      ...state,
      diagnosedHypothesis: existingEvent.details.hypothesis,
      lastUpdated: new Date().toISOString(),
    }));
    return {
      event: existingEvent,
      state: updatedState,
      diagnosis: existingEvent.details,
      idempotent: true,
    };
  }

  const taskDiagnosisEvents = diagnosisEventsForTask(ledger.events, state.taskId);
  const previousEvent = taskDiagnosisEvents.at(-1) ?? null;
  const previousDetails = previousEvent?.details ?? null;

  const details = createDiagnosisDetails(
    {
      verificationCycle: state.verificationCycle,
      failureClass,
      hypothesis,
      evidenceRefs: cleanRefs,
      settledBy,
      nextSafeAction,
    },
    previousDetails,
  );

  const event = await appendProtocolEvent(
    target,
    {
      taskId: state.taskId,
      event: "DIAGNOSIS_RECORDED",
      details,
    },
    packageRoot,
    { taskId: taskId ?? null, eventsPath },
  );

  const updatedState = await mutateWorkState(target, {
    expectedRevision: state.revision ?? 0,
    packageRoot,
    taskId: taskId ?? null,
    statePath,
  }, () => ({
    ...state,
    diagnosedHypothesis: hypothesis.trim(),
    lastUpdated: new Date().toISOString(),
  }));

  return {
    event,
    state: updatedState,
    diagnosis: details,
    idempotent: false,
  };
}
