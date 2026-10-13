import { ledgerEventsOfTypes } from "./ledger-event-collection.js";

import { canonicalFingerprint } from "./artifacts.js";
import { assertFailureClass } from "./protocol.js";

export const DIAGNOSIS_INFORMATION_GAIN = Object.freeze([
  "FIRST_DIAGNOSIS",
  "NEW_HYPOTHESIS",
  "NEW_EVIDENCE",
  "NEW_HYPOTHESIS_AND_EVIDENCE",
  "NONE",
]);

export function normalizeDiagnosisText(value, label = "value") {
  if (typeof value !== "string" || !value.trim()) {
    const error = new Error(`${label} must be a non-empty string`);
    error.code = "E_DIAGNOSIS_INVALID";
    throw error;
  }
  return value.trim().replace(/\s+/gu, " ").toLowerCase();
}

export function diagnosisFingerprint({ failureClass, hypothesis, evidenceRefs }) {
  assertFailureClass(failureClass);
  const normalizedHypothesis = normalizeDiagnosisText(hypothesis, "hypothesis");
  if (!Array.isArray(evidenceRefs) || evidenceRefs.length === 0) {
    const error = new Error("evidenceRefs must be a non-empty array of strings");
    error.code = "E_DIAGNOSIS_INVALID";
    throw error;
  }
  const cleanRefs = evidenceRefs.map((ref) => {
    if (typeof ref !== "string" || !ref.trim()) {
      const error = new Error("evidenceRef must be a non-empty string");
      error.code = "E_DIAGNOSIS_INVALID";
      throw error;
    }
    return ref.trim();
  });
  const normalizedRefs = [...new Set(cleanRefs)].sort();
  return canonicalFingerprint({
    failureClass,
    hypothesis: normalizedHypothesis,
    evidenceRefs: normalizedRefs,
  });
}

export function classifyDiagnosisInformationGain(current, previous) {
  if (!previous) return "FIRST_DIAGNOSIS";

  const currentHypothesis = normalizeDiagnosisText(current.hypothesis, "current hypothesis");
  const prevHypothesis = normalizeDiagnosisText(previous.hypothesis, "previous hypothesis");
  const sameHypothesis = currentHypothesis === prevHypothesis;

  const currentEvidence = [...new Set((current.evidenceRefs ?? []).map((r) => String(r).trim()))].sort();
  const prevEvidence = [...new Set((previous.evidenceRefs ?? []).map((r) => String(r).trim()))].sort();
  const sameEvidence = JSON.stringify(currentEvidence) === JSON.stringify(prevEvidence);

  if (sameHypothesis && sameEvidence) return "NONE";
  if (!sameHypothesis && !sameEvidence) return "NEW_HYPOTHESIS_AND_EVIDENCE";
  if (!sameHypothesis) return "NEW_HYPOTHESIS";
  return "NEW_EVIDENCE";
}

export function createDiagnosisDetails(input, previous = null) {
  if (typeof input?.verificationCycle !== "number" || !Number.isInteger(input.verificationCycle) || input.verificationCycle < 1) {
    const error = new Error("verificationCycle must be an integer >= 1");
    error.code = "E_DIAGNOSIS_INVALID";
    throw error;
  }
  try {
    assertFailureClass(input.failureClass);
  } catch {
    const error = new Error(`Invalid failureClass: ${input.failureClass}`);
    error.code = "E_DIAGNOSIS_INVALID";
    throw error;
  }
  if (typeof input.hypothesis !== "string" || !input.hypothesis.trim()) {
    const error = new Error("hypothesis must be a non-empty string");
    error.code = "E_DIAGNOSIS_INVALID";
    throw error;
  }
  if (!Array.isArray(input.evidenceRefs) || input.evidenceRefs.length === 0) {
    const error = new Error("evidenceRefs must be a non-empty array");
    error.code = "E_DIAGNOSIS_INVALID";
    throw error;
  }
  const cleanRefs = input.evidenceRefs.map((r) => {
    if (typeof r !== "string" || !r.trim()) {
      const error = new Error("each evidenceRef must be a non-empty string");
      error.code = "E_DIAGNOSIS_INVALID";
      throw error;
    }
    return r.trim();
  });
  const uniqueRefs = [...new Set(cleanRefs)].sort();
  if (typeof input.settledBy !== "string" || !input.settledBy.trim()) {
    const error = new Error("settledBy must be a non-empty string");
    error.code = "E_DIAGNOSIS_INVALID";
    throw error;
  }
  if (typeof input.nextSafeAction !== "string" || !input.nextSafeAction.trim()) {
    const error = new Error("nextSafeAction must be a non-empty string");
    error.code = "E_DIAGNOSIS_INVALID";
    throw error;
  }

  const fingerprint = diagnosisFingerprint({
    failureClass: input.failureClass,
    hypothesis: input.hypothesis,
    evidenceRefs: uniqueRefs,
  });
  const infoGain = classifyDiagnosisInformationGain(
    { hypothesis: input.hypothesis, evidenceRefs: uniqueRefs },
    previous ? { hypothesis: previous.hypothesis, evidenceRefs: previous.evidenceRefs } : null,
  );

  return {
    verificationCycle: input.verificationCycle,
    failureClass: input.failureClass,
    hypothesis: input.hypothesis.trim(),
    evidenceRefs: uniqueRefs,
    settledBy: input.settledBy.trim(),
    nextSafeAction: input.nextSafeAction.trim(),
    diagnosisFingerprint: fingerprint,
    informationGain: infoGain,
    previousDiagnosisFingerprint: previous?.diagnosisFingerprint ?? null,
  };
}

export function assertDiagnosisDetails(details) {
  if (!details || typeof details !== "object" || Array.isArray(details)) {
    const error = new Error("Diagnosis details must be an object");
    error.code = "E_DIAGNOSIS_INVALID";
    throw error;
  }
  if (typeof details.verificationCycle !== "number" || !Number.isInteger(details.verificationCycle) || details.verificationCycle < 1) {
    const error = new Error("Diagnosis verificationCycle must be an integer >= 1");
    error.code = "E_DIAGNOSIS_INVALID";
    throw error;
  }
  try {
    assertFailureClass(details.failureClass);
  } catch {
    const error = new Error(`Invalid diagnosis failureClass: ${details.failureClass}`);
    error.code = "E_DIAGNOSIS_INVALID";
    throw error;
  }
  if (typeof details.hypothesis !== "string" || !details.hypothesis.trim()) {
    const error = new Error("Diagnosis hypothesis must be a non-empty string");
    error.code = "E_DIAGNOSIS_INVALID";
    throw error;
  }
  if (!Array.isArray(details.evidenceRefs) || details.evidenceRefs.length === 0) {
    const error = new Error("Diagnosis evidenceRefs must be a non-empty array");
    error.code = "E_DIAGNOSIS_INVALID";
    throw error;
  }
  for (const ref of details.evidenceRefs) {
    if (typeof ref !== "string" || !ref.trim()) {
      const error = new Error("Diagnosis evidenceRef must be a non-empty string");
      error.code = "E_DIAGNOSIS_INVALID";
      throw error;
    }
  }
  if (typeof details.settledBy !== "string" || !details.settledBy.trim()) {
    const error = new Error("Diagnosis settledBy must be a non-empty string");
    error.code = "E_DIAGNOSIS_INVALID";
    throw error;
  }
  if (typeof details.nextSafeAction !== "string" || !details.nextSafeAction.trim()) {
    const error = new Error("Diagnosis nextSafeAction must be a non-empty string");
    error.code = "E_DIAGNOSIS_INVALID";
    throw error;
  }
  if (!DIAGNOSIS_INFORMATION_GAIN.includes(details.informationGain)) {
    const error = new Error(`Invalid diagnosis informationGain: ${details.informationGain}`);
    error.code = "E_DIAGNOSIS_INVALID";
    throw error;
  }
  if (typeof details.diagnosisFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(details.diagnosisFingerprint)) {
    const error = new Error("Invalid diagnosisFingerprint");
    error.code = "E_DIAGNOSIS_INVALID";
    throw error;
  }
  const computed = diagnosisFingerprint({
    failureClass: details.failureClass,
    hypothesis: details.hypothesis,
    evidenceRefs: details.evidenceRefs,
  });
  if (computed !== details.diagnosisFingerprint) {
    const error = new Error("Diagnosis fingerprint does not match computed fingerprint");
    error.code = "E_DIAGNOSIS_INVALID";
    throw error;
  }
  if (details.previousDiagnosisFingerprint !== null && (typeof details.previousDiagnosisFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(details.previousDiagnosisFingerprint))) {
    const error = new Error("Invalid previousDiagnosisFingerprint");
    error.code = "E_DIAGNOSIS_INVALID";
    throw error;
  }
  return details;
}

export function diagnosisEventsForTask(events, taskId) {
  if (!Array.isArray(events)) return [];
  return events.filter((e) => e.event === "DIAGNOSIS_RECORDED" && (!taskId || e.taskId === taskId));
}

export function currentCycleDiagnosis(events, taskId, verificationCycle) {
  const taskEvents = diagnosisEventsForTask(events, taskId);
  for (let i = taskEvents.length - 1; i >= 0; i--) {
    if (taskEvents[i].details?.verificationCycle === verificationCycle) {
      return taskEvents[i];
    }
  }
  return null;
}


export function latestDiagnosisForTask(events, taskId) {
  let latest = null;
  for (const event of ledgerEventsOfTypes(events ?? [], ["DIAGNOSIS_RECORDED"])) {
    if (!taskId || event.taskId === taskId) latest = event;
  }
  return latest;
}
