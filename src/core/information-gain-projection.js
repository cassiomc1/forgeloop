import { ledgerRelationSet, ledgerGroupedSet } from "./ledger-relations.js";
import { isLedgerEventCollection, ledgerEventsOfTypes } from "./ledger-event-collection.js";
import { normalizeDiagnosticSnapshot, compareDiagnosticCycles, classifyGain, isEffectiveGain } from "./information-gain.js";
import { computeFailureSignature } from "./failure-signature.js";

function snapshotFor(event) {
  const details = event.details ?? {};
  if (event.event === "DIAGNOSTIC_CASE_RECORDED") {
    return normalizeDiagnosticSnapshot({ ...details, legacy: false });
  }
  return normalizeDiagnosticSnapshot({ ...details, legacy: true });
}

const sameSortedSet = (a, b) =>
  JSON.stringify([...(a ?? [])].sort()) === JSON.stringify([...(b ?? [])].sort());

// Cycle interval rule (documented contract):
//   For diagnostic event D[n], the analysis interval is
//   (D[n-1].sequence, D[n].sequence] — previous diagnostic sequence exclusive,
//   current diagnostic sequence inclusive.
// Events inside an interval belong to the *current* cycle's knowledge state;
// they are never attributed retroactively to the earlier diagnosis.
function* intervalEvents(taskEvents, fromExclusive, toInclusive) {
  for (const event of taskEvents) if (event.seq > fromExclusive && event.seq <= toInclusive) yield event;
}

function orderedTaskEvents(events, taskId) {
  const belongs = event => !taskId || !event.taskId || event.taskId === taskId;
  if (!Array.isArray(events) && isLedgerEventCollection(events)) {
    let previous = -Infinity;
    let ordered = true;
    for (const event of events) {
      if (!Number.isFinite(event.seq) || event.seq < previous) { ordered = false; break; }
      previous = event.seq;
    }
    if (ordered) return { *[Symbol.iterator]() { for (const event of ledgerEventsOfTypes(events, ["DIAGNOSTIC_CASE_RECORDED", "DIAGNOSIS_RECORDED", "VERIFICATION_STARTED", "VERIFICATION_RECORDED", "INTERVENTION_RECORDED", "HYPOTHESIS_DISPOSITION_RECORDED"])) if (belongs(event)) yield event; } };
  }
  return [...(events ?? [])].filter(belongs).sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
}

function eliminatedHypothesis(previousDiagnostic, diagnostic) {
  if (previousDiagnostic?.event !== "DIAGNOSTIC_CASE_RECORDED" || diagnostic.event !== "DIAGNOSTIC_CASE_RECORDED") return false;
  const previous = previousDiagnostic.details?.hypotheses ?? [];
  const current = diagnostic.details?.hypotheses ?? [];
  const statements = new Set(current.map(hypothesis => `${hypothesis.statement}`.trim().toLowerCase()));
  return previous.some(hypothesis => !current.some(candidate => candidate.id === hypothesis.id)
    && !statements.has(`${hypothesis.statement}`.trim().toLowerCase()));
}

function failureStateByCycle(taskEvents) {
  const surfaces = ledgerGroupedSet();
  const signatures = ledgerGroupedSet();
  const record = (cycle, details) => {
    if (!Number.isInteger(cycle)) cycle = Number(cycle) || 1;
    const requirement = details.requirement ?? details.id ?? details.checkId;
    if (!requirement) return;
    if (details.status === "failed" || details.status === "blocked") {
      surfaces.add(cycle, requirement);
      signatures.add(cycle, computeFailureSignature({
        requirement,
        status: details.status,
        exitCode: Number.isInteger(details.exitCode) ? details.exitCode : null,
        failureToken: typeof details.failureToken === "string" ? details.failureToken : (typeof details.details?.failureToken === "string" ? details.details.failureToken : null),
      }));
    }
  };
  for (const event of taskEvents) {
    if (event.event === "VERIFICATION_RECORDED") {
      record(event.details?.verificationCycle ?? 1, event.details ?? {});
    }
  }
  return { surfaces, signatures };
}


function strategyFingerprintFor(diagnosticEvent, interventionsUpTo) {
  const details = diagnosticEvent?.details ?? {};
  const components = {
    hypotheses: (details.hypotheses ?? []).map((hypothesis) => `${hypothesis.statement}`.trim().toLowerCase()),
    contributors: (details.contributors ?? []).map((contributor) => `${contributor.statement}`.trim().toLowerCase()),
    legacyHypothesis: diagnosticEvent?.event === "DIAGNOSIS_RECORDED"
      ? [`${details.hypothesis ?? ""}`.trim().toLowerCase()]
      : [],
    interventions: interventionsUpTo.map((entry) => entry.fingerprint),
  };
  return JSON.stringify([
    [...components.hypotheses, ...components.legacyHypothesis].sort(),
    components.contributors.sort(),
    components.interventions.sort(),
  ]);
}

function snapshotHasContentDelta(previousDetails, currentDetails) {
  const statementsOf = (details) => ({
    observations: new Set((details.observations ?? []).map((o) => `${o.statement}`.trim().toLowerCase())),
    contributors: new Set((details.contributors ?? []).map((c) => `${c.statement}`.trim().toLowerCase())),
    hypotheses: new Set((details.hypotheses ?? []).map((h) => `${h.statement}`.trim().toLowerCase())),
    legacyHypothesis: details.hypothesis ? new Set([`${details.hypothesis}`.trim().toLowerCase()]) : null,
    evidence: new Set([
      ...((details.hypotheses ?? []).flatMap((h) => h.evidenceRefs ?? [])),
      ...((details.observations ?? []).map((o) => o.evidenceRef).filter(Boolean)),
      ...(details.evidenceRefs ?? []),
    ]),
  });
  const prev = statementsOf(previousDetails);
  const cur = statementsOf(currentDetails);
  const differs = (a, b) => {
    if (!a || !b) return false;
    for (const value of b) if (!a.has(value)) return true;
    return false;
  };
  return differs(prev.observations, cur.observations)
    || differs(prev.contributors, cur.contributors)
    || differs(prev.hypotheses, cur.hypotheses)
    || differs(prev.legacyHypothesis, cur.legacyHypothesis)
    || differs(prev.evidence, cur.evidence);
}

function intervalKnowledge(taskEvents, previousDiagnostic, diagnostic) {
  const intervalStart = previousDiagnostic ? previousDiagnostic.seq : -Infinity;
  let hypothesisDispositionChanged = false;
  const knownUpToPrev = ledgerRelationSet();
  for (const event of taskEvents) {
    if (event.event === "INTERVENTION_RECORDED" && previousDiagnostic && (event.seq ?? 0) <= previousDiagnostic.seq) {
      const fingerprint = event.details?.interventionSemanticFingerprint
        ?? `${event.details?.intervention?.statement ?? ""}`.trim().toLowerCase();
      if (fingerprint) knownUpToPrev.add(fingerprint);
    }
  }
  let novelIntervention = false;
  for (const event of intervalEvents(taskEvents, intervalStart, diagnostic.seq)) {
    if (event.event === "HYPOTHESIS_DISPOSITION_RECORDED") hypothesisDispositionChanged = true;
    if (event.event === "INTERVENTION_RECORDED") {
    const fingerprint = event.details?.interventionSemanticFingerprint
      ?? `${event.details?.intervention?.statement ?? ""}`.trim().toLowerCase();
    if (fingerprint && !knownUpToPrev.has(fingerprint)) novelIntervention = true;
    }
  }
  return { hypothesisDispositionChanged, novelIntervention };
}

function* iterateInformationGainProjection(events, taskId) {
  const taskEvents = orderedTaskEvents(events, taskId);
  const diagnosticEvents = { *[Symbol.iterator]() {
    for (const event of taskEvents) {
      if (["DIAGNOSTIC_CASE_RECORDED", "DIAGNOSIS_RECORDED"].includes(event.event)
        && (!taskId || event.taskId === taskId)) yield event;
    }
  } };

  const failure = failureStateByCycle(taskEvents);

  let previousDiagnostic = null;
  let previousSnapshot = null;
  for (const diagnostic of diagnosticEvents) {
    const { hypothesisDispositionChanged, novelIntervention } = intervalKnowledge(taskEvents, previousDiagnostic, diagnostic);

    // A genuinely new intervention counts as information only when the
    // diagnosis itself moves: an identical re-proposal of the previous
    // diagnosis after executing its already-known corrective action carries
    // no new semantic state.
    const sameSemanticsAsPrevious = Boolean(previousDiagnostic)
      && !snapshotHasContentDelta(previousDiagnostic.details ?? {}, diagnostic.details ?? {});
    const interventionChanged = Boolean(previousDiagnostic)
      && novelIntervention
      && !sameSemanticsAsPrevious;

    const cycle = diagnostic.details?.verificationCycle ?? 1;
    const previousCycle = previousDiagnostic?.details?.verificationCycle ?? null;
    const surface = [...(failure.surfaces.values(cycle))].sort();
    const signatures = [...(failure.signatures.values(cycle))].sort();
    const previousSurface = previousCycle !== null && previousCycle !== undefined
      ? [...(failure.surfaces.values(previousCycle))].sort()
      : null;
    const previousSignatures = previousCycle !== null && previousCycle !== undefined
      ? [...(failure.signatures.values(previousCycle))].sort()
      : null;
    const hasPreviousFailureState = previousSurface !== null;
    const failureSurfaceChanged = hasPreviousFailureState
      ? !sameSortedSet(surface, previousSurface)
      : false;
    const failureSignatureChanged = hasPreviousFailureState
      ? !sameSortedSet(signatures, previousSignatures)
      : false;

    // Strategy compares the PROPOSED diagnostic approach: the case's own
    // semantic content on both sides (identical bases, so the delta is real).
    const strategyFingerprint = strategyFingerprintFor(diagnostic, []);
    const previousStrategyFingerprint = previousDiagnostic
      ? strategyFingerprintFor(previousDiagnostic, [])
      : null;
    const strategyChanged = Boolean(previousStrategyFingerprint
      && strategyFingerprint !== previousStrategyFingerprint);

    const snapshot = snapshotFor(diagnostic);

    const entry = {
      verificationCycle: cycle,
      sequence: diagnostic.seq ?? null,
      diagnosticSequence: diagnostic.seq ?? null,
      sourceModel: diagnostic.event === "DIAGNOSTIC_CASE_RECORDED"
        ? "STRUCTURED_DIAGNOSTIC_CASE_V1"
        : "LEGACY_DIAGNOSIS_V1",
      snapshot,
      dimensionsInput: {
        hypothesisDispositionChanged,
        failureSignatureChanged,
        failureSurfaceChanged,
        interventionChanged,
        strategyChanged,
        hypothesisEliminated: eliminatedHypothesis(previousDiagnostic, diagnostic),
      },
      evidence: {
        semanticRefs: [...(snapshot.evidenceRefs ?? [])].sort(),
        surface, signatures, strategyFingerprint,
      },
    };
    const dimensions = compareDiagnosticCycles(previousSnapshot, snapshot, entry.dimensionsInput);
    const classification = classifyGain(dimensions, { first: previousDiagnostic === null });
    const effectiveGain = isEffectiveGain(dimensions, classification);
    yield finalizeGainEntry(entry, { dimensions, classification, effectiveGain });
    previousDiagnostic = diagnostic;
    previousSnapshot = snapshot;
  }
}

function finalizeGainEntry(entry, { dimensions, classification, effectiveGain }) {
  return Object.freeze({
    verificationCycle: entry.verificationCycle,
    sequence: entry.sequence,
    diagnosticSequence: entry.diagnosticSequence,
    sourceModel: entry.sourceModel,
    evidence: Object.freeze({
      semanticRefs: Object.freeze(entry.evidence.semanticRefs),
      failureSurface: Object.freeze(entry.evidence.surface),
      failureSignatures: Object.freeze(entry.evidence.signatures),
      strategyFingerprint: entry.evidence.strategyFingerprint,
    }),
    dimensions: Object.freeze({ ...dimensions }),
    classification,
    effectiveGain,
  });
}

export function buildInformationGainProjection(events, taskId) {
  return [...iterateInformationGainProjection(events, taskId)];
}

/** Internal latest-only use does not retain all diagnostic result objects. */
export function summarizeInformationGain(events, taskId, { verificationCycle = null } = {}) {
  let latest = null;
  for (const entry of iterateInformationGainProjection(events, taskId)) {
    if (verificationCycle === null || verificationCycle === undefined || entry.verificationCycle === verificationCycle) latest = entry;
  }
  return evaluateStructuredDiagnosticStall(latest ? [latest] : []);
}

// One canonical structured-stall policy (fail-fast):
//   The latest comparable diagnostic state that produces no effective
//   information gain is stalled and may not trigger another blind correction
//   retry. The first diagnosis is never stalled. Legacy diagnosis keeps its
//   own compatibility rule (informationGain === NONE).
export function evaluateStructuredDiagnosticStall(gainProjection, { verificationCycle = null } = {}) {
  const candidates = verificationCycle === null || verificationCycle === undefined
    ? (gainProjection ?? [])
    : (gainProjection ?? []).filter((entry) => entry.verificationCycle === verificationCycle);

  const latest = candidates.at(-1) ?? null;
  if (!latest) {
    return { stalled: false, latestGain: null, reason: null };
  }
  if (latest.classification === "FIRST_DIAGNOSIS") {
    return { stalled: false, latestGain: latest, reason: null };
  }
  const stalled = latest.effectiveGain === false;
  return {
    stalled,
    latestGain: latest,
    reason: stalled ? "NO_DIAGNOSTIC_INFORMATION_GAIN" : null,
  };
}

export function computeCycleInformationGain(events, taskId, verificationCycle) {
  const projection = buildInformationGainProjection(events, taskId);
  const matching = projection.filter((entry) => entry.verificationCycle === verificationCycle);
  return matching.at(-1) ?? null;
}
