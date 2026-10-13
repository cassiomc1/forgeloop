import { isLedgerEventCollection, ledgerEventsOfTypes } from "./ledger-event-collection.js";
import { ledgerRelationMap } from "./ledger-relations.js";
import { DISPOSITION_TRANSITIONS } from "./diagnostic-model.js";

const TERMINAL_STATUSES = Object.freeze(["FALSIFIED", "SUPERSEDED", "UNRESOLVED"]);
export const HYPOTHESIS_LEGACY_ID = "h-legacy";

function canTransition(from, to) {
  if (from === to) return false;
  if (TERMINAL_STATUSES.includes(from)) return false;
  return (DISPOSITION_TRANSITIONS[from] ?? []).includes(to);
}

function blankState(id) {
  return {
    id,
    sourceEventSeq: null,
    sourceCycle: null,
    initialStatus: "OPEN",
    currentStatus: "OPEN",
    dispositionHistory: [],
  };
}

export function projectHypothesisStates(events, { taskId = null } = {}) {
  const ordered = [...events].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  const byId = new Map();
  const invalidTransitions = [];

  const ensure = (id, seq, cycle) => {
    if (!byId.has(id)) {
      const state = blankState(id);
      state.sourceEventSeq = seq ?? null;
      state.sourceCycle = cycle ?? null;
      byId.set(id, state);
    }
    return byId.get(id);
  };

  for (const event of ordered) {
    if (taskId && event.taskId && event.taskId !== taskId) continue;
    const details = event.details ?? {};
    if (event.event === "DIAGNOSTIC_CASE_RECORDED") {
      for (const hypothesis of details.hypotheses ?? []) {
        if (!hypothesis?.id) continue;
        ensure(hypothesis.id, event.seq, details.verificationCycle);
      }
    } else if (event.event === "DIAGNOSIS_RECORDED") {
      ensure(HYPOTHESIS_LEGACY_ID, event.seq, details.verificationCycle);
    } else if (event.event === "HYPOTHESIS_DISPOSITION_RECORDED") {
      const ref = details.hypothesisRef;
      if (!ref || !details.status) continue;
      const state = ensure(ref, null, null);
      if (!canTransition(state.currentStatus, details.status)) {
        invalidTransitions.push({
          sequence: event.seq,
          hypothesisRef: ref,
          from: state.currentStatus,
          to: details.status,
        });
        continue;
      }
      state.currentStatus = details.status;
      state.dispositionHistory.push({
        sequence: event.seq,
        status: details.status,
        evidenceRefs: [...(details.evidenceRefs ?? [])],
        reason: details.reason ?? null,
      });
    }
  }

  const hypotheses = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
  return {
    hypotheses,
    openHypotheses: hypotheses.filter((hypothesis) => hypothesis.currentStatus === "OPEN").map((hypothesis) => hypothesis.id),
    invalidTransitions,
  };
}

export function getOpenHypotheses(projection) {
  return projection?.openHypotheses ?? [];
}

export function getHypothesisState(projection, id) {
  return projection?.hypotheses.find((hypothesis) => hypothesis.id === id) ?? null;
}


/** Internal context needs current IDs, not every historical disposition payload. */
export function summarizeOpenHypotheses(events, taskId = null) {
  if (Array.isArray(events)) return projectHypothesisStates(events.filter(event => !taskId || event.taskId === taskId)).openHypotheses;
  if (!isLedgerEventCollection(events)) throw new TypeError("Hypothesis context requires a ledger collection");
  let previous = -Infinity;
  for (const event of events) {
    if (!Number.isFinite(event.seq) || event.seq < previous) {
      return projectHypothesisStates([...events].filter(candidate => !taskId || candidate.taskId === taskId)).openHypotheses;
    }
    previous = event.seq;
  }
  const statuses = ledgerRelationMap();
  const ensure = id => { if (!statuses.has(id)) statuses.set(id, "OPEN"); };
  for (const event of ledgerEventsOfTypes(events, ["DIAGNOSTIC_CASE_RECORDED", "DIAGNOSIS_RECORDED", "HYPOTHESIS_DISPOSITION_RECORDED"])) {
    if (taskId && event.taskId !== taskId) continue;
    const details = event.details ?? {};
    if (event.event === "DIAGNOSTIC_CASE_RECORDED") {
      for (const hypothesis of details.hypotheses ?? []) if (hypothesis?.id) ensure(hypothesis.id);
    } else if (event.event === "DIAGNOSIS_RECORDED") ensure(HYPOTHESIS_LEGACY_ID);
    else if (details.hypothesisRef && details.status) {
      ensure(details.hypothesisRef);
      if (canTransition(statuses.get(details.hypothesisRef), details.status)) statuses.set(details.hypothesisRef, details.status);
    }
  }
  const open = [];
  for (const [id, status] of statuses) if (status === "OPEN") open.push(id);
  return open.sort();
}
