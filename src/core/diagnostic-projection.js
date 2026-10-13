import { ledgerEventsOfTypes } from "./ledger-event-collection.js";

export function diagnosticEventsForTask(events, taskId) {
  return (events ?? []).filter((event) =>
    (event.event === "DIAGNOSTIC_CASE_RECORDED" || event.event === "DIAGNOSIS_RECORDED")
    && (!taskId || event.taskId === taskId));
}

export function* iterateDiagnosticEvents(events, taskId) {
  for (const event of ledgerEventsOfTypes(events ?? [], ["DIAGNOSTIC_CASE_RECORDED", "DIAGNOSIS_RECORDED"])) {
    if (!taskId || event.taskId === taskId) yield event;
  }
}

function structuredProjection(event) {
  const details = event.details ?? {};
  return {
    sourceModel: "STRUCTURED_DIAGNOSTIC_CASE_V1",
    event,
    details,
    diagnosticCase: details,
    informationGain: details.informationGain ?? null,
  };
}

function legacyProjection(event) {
  const details = event.details ?? {};
  return {
    sourceModel: "LEGACY_DIAGNOSIS_V1",
    event,
    details,
    diagnosticCase: null,
    informationGain: details.informationGain ?? null,
  };
}

function resolveArrayCurrentCycleDiagnostic(events, taskId, verificationCycle) {
  const candidates = diagnosticEventsForTask(events, taskId).filter(event => {
    const cycle = event.details?.verificationCycle;
    return verificationCycle === null || verificationCycle === undefined || cycle === null || cycle === undefined || cycle === verificationCycle;
  }).sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  const structured = [...candidates].reverse().find(event => event.event === "DIAGNOSTIC_CASE_RECORDED");
  const legacy = [...candidates].reverse().find(event => event.event === "DIAGNOSIS_RECORDED");
  return structured ? structuredProjection(structured) : (legacy ? legacyProjection(legacy) : null);
}

export function resolveCurrentCycleDiagnostic(events, taskId, verificationCycle) {
  if (Array.isArray(events)) return resolveArrayCurrentCycleDiagnostic(events, taskId, verificationCycle);
  let structured = null;
  let legacy = null;
  for (const event of iterateDiagnosticEvents(events, taskId)) {
    const cycle = event.details?.verificationCycle;
    if (verificationCycle !== null && verificationCycle !== undefined
      && cycle !== null && cycle !== undefined && cycle !== verificationCycle) continue;
    if (event.event === "DIAGNOSTIC_CASE_RECORDED") {
      if (!structured || (event.seq ?? 0) >= (structured.seq ?? 0)) structured = event;
    } else if (!legacy || (event.seq ?? 0) >= (legacy.seq ?? 0)) legacy = event;
  }
  if (structured) return structuredProjection(structured);
  if (legacy) return legacyProjection(legacy);

  return null;
}

export function projectDiagnosticCases(events, taskId) {
  return diagnosticEventsForTask(events, taskId)
    .filter((event) => event.event === "DIAGNOSTIC_CASE_RECORDED")
    .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
    .map((event) => ({ sequence: event.seq, at: event.at, ...event.details }));
}
