import { appendProtocolEvent, validateEventLedger } from "./events.js";
import { readWorkState, mutateWorkState } from "./work-state.js";
import { getTaskTransaction, withTaskTransaction } from "./transaction.js";
import {
  DIAGNOSTIC_SCHEMA_VERSION,
  DISPOSITION_TRANSITIONS,
  assertDiagnosticCaseDetails,
  assertHypothesisDispositionDetails,
  assertInterventionDetails,
  diagnosticSemanticFingerprint,
  interventionSemanticFingerprint,
} from "./diagnostic-model.js";
import { projectHypothesisStates, getHypothesisState } from "./hypothesis-projection.js";

const TERMINAL_STATUSES = Object.freeze(["FALSIFIED", "SUPERSEDED", "UNRESOLVED"]);

function canTransitionStatus(from, to) {
  if (from === to) return false;
  if (TERMINAL_STATUSES.includes(from)) return false;
  return (DISPOSITION_TRANSITIONS[from] ?? []).includes(to);
}

export {
  DIAGNOSTIC_SCHEMA_VERSION,
  assertDiagnosticCaseDetails,
  assertInterventionDetails,
  assertHypothesisDispositionDetails,
};

function stateError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function requireActiveState(target, { packageRoot, taskId }) {
  const state = await readWorkState(target, { packageRoot, taskId });
  if (!state) throw stateError("E_STATE_MISSING", "Work state not found");
  if (typeof state.verificationCycle !== "number" || state.verificationCycle < 1) {
    throw stateError("E_DIAGNOSTIC_CASE_CYCLE_MISMATCH", "Active verification cycle must be an integer >= 1");
  }
  return state;
}

async function requireValidLedger(target, packageRoot, taskId) {
  const ledger = await validateEventLedger(target, packageRoot, { taskId: taskId ?? null });
  if (!ledger.valid) {
    throw stateError(ledger.errors[0].code ?? "E_EVENT_INVALID", ledger.errors[0].message);
  }
  return ledger;
}

export function legacyDiagnosisToDiagnosticCase(diagnosisDetails) {
  if (!diagnosisDetails || typeof diagnosisDetails !== "object") return null;
  return {
    schemaVersion: DIAGNOSTIC_SCHEMA_VERSION,
    verificationCycle: diagnosisDetails.verificationCycle,
    diagnosticRevision: 1,
    failureClass: diagnosisDetails.failureClass,
    observations: (diagnosisDetails.evidenceRefs ?? []).map((ref, index) => ({
      id: `obs-legacy-${index + 1}`,
      kind: "CHECK_RESULT",
      evidenceRef: ref,
      statement: `Legacy diagnosis bound evidence ${ref}.`,
    })),
    contributors: [],
    hypotheses: [
      {
        id: "h-legacy",
        statement: diagnosisDetails.hypothesis,
        contributorRefs: [],
        evidenceRefs: [...(diagnosisDetails.evidenceRefs ?? [])],
        settledBy: { type: "PREDICATE", statement: diagnosisDetails.settledBy },
        status: "OPEN",
      },
    ],
    nextSafeAction: { statement: diagnosisDetails.nextSafeAction },
    diagnosticFingerprint: diagnosisDetails.diagnosisFingerprint,
    previousDiagnosticFingerprint: diagnosisDetails.previousDiagnosisFingerprint ?? null,
    sourceModel: "LEGACY_DIAGNOSIS_V1",
  };
}

export async function recordStructuredDiagnosticCase(options) {
  if (await getTaskTransaction(options.target)) return recordDiagnosticCase(options);
  const state = await readWorkState(options.target, { packageRoot: options.packageRoot, taskId: options.taskId });
  if (!state) return recordDiagnosticCase(options);
  return withTaskTransaction({ target: options.target, taskId: options.taskId ?? state.taskId,
    packageRoot: options.packageRoot, operation: "record-diagnostic-case" }, () => recordDiagnosticCase(options));
}

async function recordDiagnosticCase({
  target,
  packageRoot,
  caseFile = null,
  caseInput = null,
  taskId = null,
}) {
  let parsed;
  if (caseFile) {
    const { readFile } = await import("node:fs/promises");
    const { assertSafePath, ensureWithin } = await import("./filesystem.js");
    await assertSafePath(target, caseFile);
    const absolute = ensureWithin(target, caseFile);
    try {
      parsed = JSON.parse(await readFile(absolute, "utf8"));
    } catch (error) {
      throw stateError("E_DIAGNOSTIC_CASE_INVALID", `diagnostic case file is not valid JSON: ${error.message}`);
    }
  } else {
    parsed = caseInput;
  }

  const state = await requireActiveState(target, { packageRoot, taskId });
  if (state.phase !== "DIAGNOSING") {
    throw stateError("E_PHASE_PREREQUISITE_MISSING", `Recording a structured diagnostic case requires phase DIAGNOSING, currently ${state.phase}`);
  }
  const ledger = await requireValidLedger(target, packageRoot, taskId);

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw stateError("E_DIAGNOSTIC_CASE_INVALID", "diagnostic case must be a JSON object");
  }
  if (!Array.isArray(parsed.hypotheses) || parsed.hypotheses.length < 1) {
    throw stateError("E_DIAGNOSTIC_CASE_INVALID", "diagnostic case requires at least one hypothesis (hypotheses.minItems = 1)");
  }
  if (Number.isInteger(parsed.verificationCycle) && parsed.verificationCycle !== state.verificationCycle) {
    throw stateError("E_DIAGNOSTIC_CASE_CYCLE_MISMATCH", `case verificationCycle ${parsed.verificationCycle} does not match active cycle ${state.verificationCycle}`);
  }

  const activeCycleChecks = (state.checks ?? []).filter(
    (candidate) => candidate.details?.verificationCycle === state.verificationCycle,
  );
  const findActiveCheck = (ref) => activeCycleChecks.find(
    (candidate) => candidate.id === ref || candidate.checkId === ref,
  );

  for (const hypothesis of parsed.hypotheses ?? []) {
    for (const ref of hypothesis.evidenceRefs ?? []) {
      if (!findActiveCheck(ref)) {
        throw stateError("E_DIAGNOSTIC_CASE_EVIDENCE_INVALID", `evidenceRef "${ref}" does not match any check from verification cycle ${state.verificationCycle}`);
      }
    }
  }

  // Observation evidence must resolve: CHECK_RESULT observations to a real
  // active-cycle check, MANUAL_OBSERVATION provenance to be stated explicitly.
  for (const observation of parsed.observations ?? []) {
    if (observation.kind === "CHECK_RESULT") {
      if (!observation.evidenceRef || !findActiveCheck(observation.evidenceRef)) {
        throw stateError("E_DIAGNOSTIC_CASE_EVIDENCE_INVALID", `observation "${observation.id}" evidenceRef "${observation.evidenceRef ?? ""}" does not resolve to a real check from verification cycle ${state.verificationCycle}`);
      }
    } else if (observation.provenance && observation.provenance !== "MANUAL_OBSERVATION" && observation.kind !== "CHECK_RESULT") {
      throw stateError("E_DIAGNOSTIC_CASE_INVALID", `observation "${observation.id}" has unsupported provenance "${observation.provenance}"`);
    }
  }

  // A VERIFICATION_FAILURE case must bind to failed/blocked evidence from the
  // active correction cycle so it cannot be formally valid yet semantically empty.
  if (parsed.failureClass === "VERIFICATION_FAILURE") {
    const bindsToFailure = [
      ...parsed.hypotheses.flatMap((hypothesis) => hypothesis.evidenceRefs ?? []),
      ...(parsed.observations ?? [])
        .filter((observation) => observation.kind === "CHECK_RESULT")
        .map((observation) => observation.evidenceRef),
    ].some((ref) => {
      const check = ref ? findActiveCheck(ref) : null;
      return check?.status === "failed" || check?.status === "blocked";
    });
    if (!bindsToFailure) {
      throw stateError("E_DIAGNOSTIC_CASE_EVIDENCE_INVALID", "VERIFICATION_FAILURE cases require at least one hypothesis or observation bound to failed/blocked evidence from the active verification cycle");
    }
  }

  const previousCases = ledger.events.filter(
    (event) => event.event === "DIAGNOSTIC_CASE_RECORDED"
      && event.taskId === state.taskId
      && event.details?.verificationCycle === state.verificationCycle,
  );
  const previousCase = previousCases.at(-1)?.details ?? null;
  const revision = (previousCase?.diagnosticRevision ?? 0) + 1;

  const details = {
    schemaVersion: DIAGNOSTIC_SCHEMA_VERSION,
    verificationCycle: state.verificationCycle,
    diagnosticRevision: revision,
    failureClass: parsed.failureClass,
    observations: parsed.observations ?? [],
    contributors: parsed.contributors ?? [],
    hypotheses: (parsed.hypotheses ?? []).map((hypothesis) => ({ ...hypothesis, status: "OPEN" })),
    nextSafeAction: parsed.nextSafeAction,
  };
  details.diagnosticFingerprint = diagnosticSemanticFingerprint({
    verificationCycle: details.verificationCycle,
    failureClass: details.failureClass,
    case_: details,
  });
  details.previousDiagnosticFingerprint = previousCase?.diagnosticFingerprint ?? null;

  if (previousCase && previousCase.diagnosticFingerprint === details.diagnosticFingerprint) {
    return {
      event: previousCases.at(-1),
      state,
      diagnosticCase: previousCase,
      idempotent: true,
    };
  }

  assertDiagnosticCaseDetails(details);

  const event = await appendProtocolEvent(
    target,
    { taskId: state.taskId, event: "DIAGNOSTIC_CASE_RECORDED", details },
    packageRoot,
    { taskId: taskId ?? null },
  );

  const updatedState = await mutateWorkState(target, {
    expectedRevision: state.revision ?? 0,
    packageRoot,
    taskId,
  }, () => ({
    ...state,
    diagnosedHypothesis: details.hypotheses[0]?.statement ?? state.diagnosedHypothesis,
    lastUpdated: new Date().toISOString(),
  }));

  return { event, state: updatedState, diagnosticCase: details, idempotent: false };
}

export async function recordIntervention({
  target,
  packageRoot,
  interventionFile = null,
  interventionInput = null,
  taskId = null,
}) {
  let parsed;
  if (interventionFile) {
    const { readFile } = await import("node:fs/promises");
    const { assertSafePath, ensureWithin } = await import("./filesystem.js");
    await assertSafePath(target, interventionFile);
    try {
      parsed = JSON.parse(await readFile(ensureWithin(target, interventionFile), "utf8"));
    } catch (error) {
      throw stateError("E_INTERVENTION_INVALID", `intervention file is not valid JSON: ${error.message}`);
    }
  } else {
    parsed = interventionInput;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw stateError("E_INTERVENTION_INVALID", "intervention must be a JSON object");
  }

  const state = await requireActiveState(target, { packageRoot, taskId });
  if (state.phase !== "CORRECTING") {
    throw stateError("E_PHASE_PREREQUISITE_MISSING", `Recording an intervention requires phase CORRECTING, currently ${state.phase}`);
  }
  const ledger = await requireValidLedger(target, packageRoot, taskId);

  const knownHypothesisIds = new Set();
  for (const event of ledger.events) {
    if (event.event !== "DIAGNOSTIC_CASE_RECORDED" && event.event !== "DIAGNOSIS_RECORDED") continue;
    if (event.taskId !== state.taskId) continue;
    if (event.event === "DIAGNOSTIC_CASE_RECORDED") {
      for (const hypothesis of event.details?.hypotheses ?? []) knownHypothesisIds.add(hypothesis.id);
    } else {
      knownHypothesisIds.add("h-legacy");
    }
  }
  for (const ref of parsed.hypothesisRefs ?? []) {
    if (!knownHypothesisIds.has(ref)) {
      throw stateError("E_INTERVENTION_REFERENCE_INVALID", `intervention references unknown hypothesis "${ref}"`);
    }
  }

  const details = {
    schemaVersion: DIAGNOSTIC_SCHEMA_VERSION,
    verificationCycle: state.verificationCycle,
    intervention: {
      id: parsed.id,
      kind: parsed.kind,
      statement: parsed.statement,
      ...(Array.isArray(parsed.targets) ? { targets: parsed.targets } : {}),
      hypothesisRefs: parsed.hypothesisRefs ?? [],
      ...(typeof parsed.expectedObservation === "string" ? { expectedObservation: parsed.expectedObservation } : {}),
      ...(typeof parsed.reversible === "boolean" ? { reversible: parsed.reversible } : {}),
    },
  };
  details.interventionSemanticFingerprint = interventionSemanticFingerprint(details);
  assertInterventionDetails(details);

  const priorInterventions = ledger.events.filter(
    (event) => event.event === "INTERVENTION_RECORDED"
      && event.taskId === state.taskId
      && event.details?.interventionSemanticFingerprint === details.interventionSemanticFingerprint,
  );
  const repeatedSemanticIntervention = priorInterventions.length > 0;

  const event = await appendProtocolEvent(
    target,
    { taskId: state.taskId, event: "INTERVENTION_RECORDED", details },
    packageRoot,
    { taskId: taskId ?? null },
  );

  return {
    event,
    state,
    intervention: details,
    repeatedSemanticIntervention,
    effectiveness: "PENDING",
  };
}

export async function recordHypothesisDisposition({
  target,
  packageRoot,
  hypothesisRef,
  status,
  evidenceRefs = [],
  reason,
  taskId = null,
}) {
  const state = await requireActiveState(target, { packageRoot, taskId });
  const ledger = await requireValidLedger(target, packageRoot, taskId);

  // Authoritative current status comes from the append-only projection, never
  // from the source diagnostic case.
  const projection = projectHypothesisStates(ledger.events, { taskId: state.taskId });
  const projectedState = getHypothesisState(projection, hypothesisRef);
  const knownHypothesisIds = new Set(projection.hypotheses.map((hypothesis) => hypothesis.id));
  if (!knownHypothesisIds.has(hypothesisRef)) {
    throw stateError("E_HYPOTHESIS_DISPOSITION_INVALID", `unknown hypothesis "${hypothesisRef}"`);
  }
  const currentStatus = projectedState.currentStatus;

  if (!canTransitionStatus(currentStatus, status)) {
    throw stateError("E_HYPOTHESIS_DISPOSITION_INVALID", `disposition transition ${currentStatus} -> ${status} is not allowed`);
  }

  for (const ref of evidenceRefs) {
    const check = (state.checks ?? []).find(
      (candidate) => candidate.details?.verificationCycle === state.verificationCycle
        && (candidate.id === ref || candidate.checkId === ref),
    );
    if (!check) {
      throw stateError("E_HYPOTHESIS_DISPOSITION_EVIDENCE_INVALID", `evidenceRef "${ref}" does not match any check from verification cycle ${state.verificationCycle}`);
    }
  }

  const details = {
    schemaVersion: DIAGNOSTIC_SCHEMA_VERSION,
    verificationCycle: state.verificationCycle,
    hypothesisRef,
    status,
    evidenceRefs: [...new Set(evidenceRefs)],
    reason,
  };
  assertHypothesisDispositionDetails(details);

  const event = await appendProtocolEvent(
    target,
    { taskId: state.taskId, event: "HYPOTHESIS_DISPOSITION_RECORDED", details },
    packageRoot,
    { taskId: taskId ?? null },
  );

  return { event, state, disposition: details };
}
