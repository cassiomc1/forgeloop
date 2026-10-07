import { ledgerEventsOfTypes } from "./ledger-event-collection.js";
import { ledgerRelationMap, ledgerRelationSet, ledgerGroupedSet } from "./ledger-relations.js";
import { buildTaskTrace } from "./trace.js";
import { readEvents } from "./events.js";
import { findTaskById } from "./task-discovery.js";
import { projectHypothesisStates, summarizeOpenHypotheses } from "./hypothesis-projection.js";
import {
  buildInformationGainProjection,
  evaluateStructuredDiagnosticStall,
} from "./information-gain-projection.js";
import { computeFailureSignature } from "./failure-signature.js";
import {
  computeStrategyFingerprints as computeStrategyFingerprintsImpl,
  detectOscillation as detectOscillationImpl,
  evaluateInterventionEffectiveness as evaluateInterventionEffectivenessImpl,
} from "./strategy-analysis.js";

export const REFLECTION_STATUS = Object.freeze({
  ADVANCING: "ADVANCING",
  WATCH: "WATCH",
  STALLED: "STALLED",
});


export function summarizeHypotheses(trace) {
  const summary = { created: 0, supported: 0, weakened: 0, falsified: 0, superseded: 0, unresolved: 0, open: 0 };

  const pseudoEvents = [
    ...trace.diagnostics.cases.map((diagnosticCase) => ({
      seq: diagnosticCase.sequence,
      event: "DIAGNOSTIC_CASE_RECORDED",
      details: diagnosticCase,
    })),
    ...trace.diagnostics.legacyDiagnoses.map((legacy) => ({
      seq: legacy.sequence,
      event: "DIAGNOSIS_RECORDED",
      details: legacy,
    })),
    ...trace.diagnostics.dispositions.map((disposition) => ({
      seq: disposition.sequence,
      event: "HYPOTHESIS_DISPOSITION_RECORDED",
      details: disposition,
    })),
  ];
  const projection = projectHypothesisStates(pseudoEvents);

  for (const hypothesis of projection.hypotheses) {
    if (hypothesis.id === "h-legacy" && hypothesis.sourceEventSeq !== null) {
      summary.created += 1;
    } else if (hypothesis.id !== "h-legacy") {
      summary.created += 1;
    }
    const status = hypothesis.currentStatus.toLowerCase();
    if (summary[status] !== undefined) summary[status] += 1;
  }
  summary.open = projection.openHypotheses.length;
  return summary;
}

export function detectOscillation(strategies) {
  return detectOscillationImpl(strategies);
}

export function evaluateInterventionEffectiveness(trace, surfacesByCycle) {
  return evaluateInterventionEffectivenessImpl(trace, surfacesByCycle);
}

function failedRequirementSurfacesFromEvents(events = [], state = null) {
  const byCycle = ledgerGroupedSet();
  const record = (cycle, requirement) => {
    if (requirement) byCycle.add(cycle, requirement);
  };
  for (const event of events) {
    if (event.event !== "VERIFICATION_RECORDED") continue;
    const d = event.details ?? {};
    if (d.status === "failed" || d.status === "blocked") {
      record(d.verificationCycle ?? 1, d.requirement ?? d.id ?? d.checkId);
    }
  }
  for (const check of state?.checks ?? []) {
    if (check.status !== "failed" && check.status !== "blocked") continue;
    record(check.details?.verificationCycle ?? state?.verificationCycle ?? 1, check.requirement ?? check.id ?? check.checkId);
  }
  return byCycle;
}

function signatureSetsByCycle(trace) {
  const byCycle = new Map();
  for (const entry of trace.failureSignatures) {
    for (const cycle of entry.cycles ?? []) {
      if (!byCycle.has(cycle)) byCycle.set(cycle, new Set());
      byCycle.get(cycle).add(entry.signature);
    }
  }
  return byCycle;
}

function* contextEvents(events, types, taskId) {
  for (const event of ledgerEventsOfTypes(events, types)) if (!taskId || event.taskId === taskId) yield event;
}

function contextFailureSignature(details) {
  return computeFailureSignature({ requirement: details.requirement ?? details.id ?? details.checkId,
    status: details.status, exitCode: Number.isInteger(details.exitCode) ? details.exitCode : null,
    failureToken: typeof details.failureToken === "string" && details.failureToken
      ? details.failureToken : (typeof details.details?.failureToken === "string" ? details.details.failureToken : null) });
}

function activeFailure(details, cycle, observedCycle) {
  return ["failed", "blocked"].includes(details?.status) && (cycle === null || observedCycle === cycle);
}

function activeContextFailures(events, state, cycle) {
  const signatures = new Set();
  const requirements = new Set();
  for (const event of contextEvents(events, ["VERIFICATION_RECORDED"], state?.taskId)) {
    const details = event.details;
    if (!activeFailure(details, cycle, details?.verificationCycle)) continue;
    signatures.add(contextFailureSignature(details));
    const requirement = details.requirement ?? details.id ?? details.checkId;
    if (requirement) requirements.add(requirement);
  }
  for (const check of state?.checks ?? []) {
    if (!activeFailure(check, cycle, check.details?.verificationCycle)) continue;
    const requirement = check.requirement ?? check.id ?? check.checkId;
    if (requirement) requirements.add(requirement);
  }
  return { activeFailureSignatures: [...signatures].sort(), activeFailedRequirements: [...requirements].sort() };
}

function contextInterventions(events, taskId) {
  const groups = ledgerRelationMap();
  const lastCycles = ledgerRelationMap();
  const invalidCycles = ledgerRelationSet();
  let latestIntervention = null;
  for (const event of contextEvents(events, ["INTERVENTION_RECORDED"], taskId)) {
    latestIntervention = event.details?.intervention?.id ?? null;
    const fingerprint = event.details?.interventionSemanticFingerprint;
    if (!fingerprint) continue;
    groups.set(fingerprint, (groups.get(fingerprint) ?? 0) + 1);
    const cycle = Number(event.details?.verificationCycle ?? 1);
    if (!Number.isFinite(cycle)) invalidCycles.add(fingerprint);
    else lastCycles.set(fingerprint, Math.max(lastCycles.get(fingerprint) ?? -Infinity, cycle));
  }
  return { groups, lastCycles, invalidCycles, latestIntervention };
}

export function deriveDiagnosticContext(events = [], state = null) {
  const cycle = state?.verificationCycle ?? null;
  const failures = activeContextFailures(events, state, cycle);
  const openHypotheses = summarizeOpenHypotheses(events, state?.taskId).sort();
  const relevant = { *[Symbol.iterator]() {
    yield* contextEvents(events, ["VERIFICATION_RECORDED"], state?.taskId);
  } };
  const surfacesByCycle = failedRequirementSurfacesFromEvents(relevant, state);
  const cycles = new Set();
  for (const event of contextEvents(events, ["VERIFICATION_STARTED"], state?.taskId)) {
    if (Number.isInteger(event.details?.verificationCycle)) cycles.add(event.details.verificationCycle);
  }
  const completedCycles = [...cycles].sort((a, b) => a - b);
  const { groups, lastCycles, invalidCycles, latestIntervention } = contextInterventions(events, state?.taskId);
  const doNotRepeat = [];
  for (const [fingerprint, countOfInterventions] of groups) {
    if (countOfInterventions < 2 || invalidCycles.has(fingerprint)) continue;
    const lastCycle = lastCycles.get(fingerprint);
    let count = 0;
    let latestCycle = null;
    for (const completed of completedCycles) if (completed > lastCycle) { count++; latestCycle = completed; }
    if (count < 2) continue;
    const firstSurface = [...(surfacesByCycle.values(lastCycle))].sort();
    const latestSurface = [...(surfacesByCycle.values(latestCycle))].sort();
    if (JSON.stringify(firstSurface) === JSON.stringify(latestSurface)) doNotRepeat.push(fingerprint);
  }
  return { ...failures, openHypotheses, latestIntervention, nextExperiment: null, doNotRepeat: doNotRepeat.sort() };
}

export async function buildTaskReflection({ target, packageRoot, taskId = null } = {}) {
  const trace = await buildTaskTrace({ target, packageRoot, taskId });
  // Modern tasks own a scoped ledger; legacy singleton callers still pass a
  // taskId that must be used only as a filter over the canonical ledger.
  const task = taskId ? await findTaskById(target, taskId, packageRoot) : null;
  const rawEvents = await readEvents(target, packageRoot, task ? { taskId } : {});

  // Authoritative surfaces come from the canonical trace projection.
  const surfaceEntries = {};
  for (const entry of trace.failureSurfaces) {
    surfaceEntries[entry.verificationCycle] = { surface: entry.surface, signatures: [] };
  }
  const signatureSets = signatureSetsByCycle(trace);
  for (const [cycle, signatures] of signatureSets.entries()) {
    if (!surfaceEntries[cycle]) surfaceEntries[cycle] = { surface: [], signatures: [] };
    surfaceEntries[cycle].signatures = [...signatures].sort();
  }

  const cycles = [...new Set([
    ...trace.failureSurfaces.map((entry) => entry.verificationCycle),
    ...trace.diagnostics.cases.map((diagnosticCase) => diagnosticCase.verificationCycle),
  ])].sort((a, b) => a - b);

  const strategies = computeStrategyFingerprintsImpl(trace);
  const oscillation = detectOscillation(strategies);

  const signals = [];
  let status = REFLECTION_STATUS.ADVANCING;

  const evaluatedInterventions = evaluateInterventionEffectiveness(trace, surfaceEntries);
  const repeatedNonInformative = evaluatedInterventions
    .filter((intervention) => intervention.effectiveness === "NON_INFORMATIVE");
  if (oscillation.detected) {
    signals.push("OSCILLATING_STRATEGY");
    status = REFLECTION_STATUS.WATCH;
  }
  if (repeatedNonInformative.length >= 2) {
    signals.push("REPEATED_INTERVENTION");
    status = REFLECTION_STATUS.WATCH;
  }

  const lastTwoSameStrategy = strategies.length >= 2
    && strategies.at(-1).strategyFingerprint === strategies.at(-2).strategyFingerprint
    && JSON.stringify(surfaceEntries[strategies.at(-1)?.verificationCycle]?.signatures ?? [])
      === JSON.stringify(surfaceEntries[strategies.at(-2)?.verificationCycle]?.signatures ?? []);
  if (lastTwoSameStrategy && !signals.includes("OSCILLATING_STRATEGY")) {
    status = status === REFLECTION_STATUS.ADVANCING ? REFLECTION_STATUS.WATCH : status;
  }

  // Information Gain v2 truth comes fully from the authoritative cycle
  // analysis projection. Consumers must not redefine gain semantics.
  const gainProjection = buildInformationGainProjection(rawEvents, taskId ?? null);
  const cyclesWithoutEffectiveGain = gainProjection
    .filter((entry) => !entry.effectiveGain)
    .map((entry) => entry.verificationCycle);

  // One canonical structured-stall truth shared with phase and progress.
  const stallAnalysis = evaluateStructuredDiagnosticStall(gainProjection);
  const latestNoGain = Boolean(stallAnalysis.stalled);
  let consecutiveNoGainCycles = 0;
  for (let i = gainProjection.length - 1; i >= 0 && gainProjection[i].effectiveGain === false; i--) {
    consecutiveNoGainCycles += 1;
  }
  const previousEntry = gainProjection.length >= 2 ? gainProjection.at(-2) : null;
  const currentEntry = gainProjection.at(-1) ?? null;
  if (latestNoGain) {
    status = REFLECTION_STATUS.STALLED;
    if (!signals.includes("NO_EFFECTIVE_INFORMATION_GAIN")) signals.push("NO_EFFECTIVE_INFORMATION_GAIN");
  }
  if ((trace.actions?.ambiguous ?? 0) > 0) {
    signals.push("EXTERNAL_ACTION_RECONCILIATION_REQUIRED");
    status = status === REFLECTION_STATUS.ADVANCING ? REFLECTION_STATUS.WATCH : status;
  }

  const recommendedProtocolAction = (trace.actions?.ambiguous ?? 0) > 0
    ? "RECONCILE_EXTERNAL_ACTION"
    : oscillation.detected
    ? "INTRODUCE_NEW_OBSERVATION"
    : (status === REFLECTION_STATUS.STALLED ? "REQUIRE_NEW_DIAGNOSTIC_INFORMATION" : "CONTINUE");

  return {
    schemaVersion: 1,
    command: "reflect",
    taskId: trace.task.id,
    taskPhase: trace.task.phase,
    integrityValid: trace.integrity.valid,
    snapshotConsistent: trace.snapshot.consistent,
    status,
    verificationCycles: cycles.length,
    failureSurfaces: trace.failureSurfaces,
    hypotheses: summarizeHypotheses(trace),
    interventions: (() => {
      const evaluated = evaluatedInterventions;
      return {
        count: evaluated.length,
        informative: evaluated.filter((intervention) => ["INFORMATIVE", "IMPROVED"].includes(intervention.effectiveness)).length,
        nonInformative: evaluated.filter((intervention) => intervention.effectiveness === "NON_INFORMATIVE").length,
        details: evaluated,
      };
    })(),
    informationGain: {
      cyclesWithCases: trace.diagnostics.cases.map((diagnosticCase) => diagnosticCase.verificationCycle),
      cyclesWithoutEffectiveGain,
      cycles: gainProjection.map(({ dimensions, ...rest }) => ({ ...rest, dimensions })),
    },
    strategies,
    oscillation,
    signals,
    stallAnalysis: {
      latestNoGain,
      consecutiveNoGainCycles,
      sameStrategyAsPrevious: Boolean(previousEntry && currentEntry
        && previousEntry.evidence.strategyFingerprint === currentEntry.evidence.strategyFingerprint),
      sameFailureSurfaceAsPrevious: Boolean(previousEntry && currentEntry
        && JSON.stringify(previousEntry.evidence.failureSurface) === JSON.stringify(currentEntry.evidence.failureSurface)),
      sameFailureSignaturesAsPrevious: Boolean(previousEntry && currentEntry
        && JSON.stringify(previousEntry.evidence.failureSignatures) === JSON.stringify(currentEntry.evidence.failureSignatures)),
    },
    recommendedProtocolAction,
    actions: trace.actions,
  };
}

export { computeStrategyFingerprintsImpl as computeStrategyFingerprints };
