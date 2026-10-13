import { isLedgerEventCollection, ledgerEventAt, ledgerEntriesOfTypes } from "./ledger-event-collection.js";
import { canonicalFingerprint } from "./artifacts.js";

export const GATE_SATISFIED_EVENT = "GATE_SATISFIED";
export const GATE_REVALIDATED_EVENT = "GATE_REVALIDATED";
const CONTRACT_REVISED_EVENT = "CONTRACT_REVISED";
const TRANSACTION_COMMITTED_EVENT = "TRANSACTION_COMMITTED";

function eventHash(event) {
  const { hash, ...body } = event ?? {};
  return canonicalFingerprint(body);
}

export function assertGateSatisfiedDetails(details) {
  if (!details || typeof details !== "object" || Array.isArray(details)
    || Object.keys(details).length !== 1
    || typeof details.gate !== "string"
    || details.gate.trim().length === 0) {
    const error = new Error("GATE_SATISFIED requires exactly one non-empty gate detail");
    error.code = "E_EVENT_INVALID";
    throw error;
  }
  return details;
}

export function assertGateRevalidatedDetails(details) {
  const keys = ["gate", "previousGateFingerprint", "gateFingerprint", "stalePaths"];
  if (!details || typeof details !== "object" || Array.isArray(details)
    || Object.keys(details).length !== keys.length
    || keys.some((key) => !Object.prototype.hasOwnProperty.call(details, key))
    || typeof details.gate !== "string"
    || details.gate.trim().length === 0
    || !/^[a-z0-9][a-z0-9-]*$/.test(details.gate)
    || !/^[a-f0-9]{64}$/.test(details.previousGateFingerprint)
    || !/^[a-f0-9]{64}$/.test(details.gateFingerprint)
    || !Array.isArray(details.stalePaths)
    || details.stalePaths.length === 0
    || details.stalePaths.some((value) => typeof value !== "string" || value.trim().length === 0)
    || [...details.stalePaths].sort().join("\0") !== details.stalePaths.join("\0")
    || new Set(details.stalePaths).size !== details.stalePaths.length) {
    const error = new Error("GATE_REVALIDATED requires a gate, two fingerprints, and sorted stale paths");
    error.code = "E_GATE_REVALIDATION_INVALID";
    throw error;
  }
  return details;
}

function gateIndex(events, gateEvent, eventName) {
  return events.findIndex((event) => event === gateEvent
    || (event?.seq === gateEvent?.seq
      && event?.taskId === gateEvent?.taskId
      && event?.event === eventName));
}

function isValidGateCommit(gateEvent, commitEvent, operation) {
  return commitEvent?.event === TRANSACTION_COMMITTED_EVENT
    && commitEvent.taskId === gateEvent.taskId
    && commitEvent.seq === gateEvent.seq + 1
    && commitEvent.previousHash === gateEvent.hash
    && gateEvent.hash === eventHash(gateEvent)
    && commitEvent.hash === eventHash(commitEvent)
    && commitEvent.details
    && typeof commitEvent.details === "object"
    && !Array.isArray(commitEvent.details)
    && Object.keys(commitEvent.details).length === 2
    && typeof commitEvent.details.transactionId === "string"
    && commitEvent.details.transactionId.length > 0
    && commitEvent.details.operation === operation;
}

export function resolveGateRecordBoundary(events, gateEvent) {
  if (!isLedgerEventCollection(events) || !gateEvent || gateEvent.event !== GATE_SATISFIED_EVENT) return null;
  const index = gateIndex(events, gateEvent, GATE_SATISFIED_EVENT);
  if (index < 0) return null;
  const commitEvent = ledgerEventAt(events, index + 1);
  return isValidGateCommit(gateEvent, commitEvent, "gate-record")
    ? { gateEvent, transactionCommitEvent: commitEvent }
    : null;
}

export function resolveGateRevalidationBoundary(events, gateEvent) {
  if (!isLedgerEventCollection(events) || !gateEvent || gateEvent.event !== GATE_REVALIDATED_EVENT) return null;
  const index = gateIndex(events, gateEvent, GATE_REVALIDATED_EVENT);
  if (index < 0) return null;
  const commitEvent = ledgerEventAt(events, index + 1);
  return isValidGateCommit(gateEvent, commitEvent, "gate-revalidate")
    ? { gateEvent, transactionCommitEvent: commitEvent }
    : null;
}

export function hasCurrentGateEvidence(events, taskId, gate, latestContractRevisionSeq = 0) {
  return events.some((event) => [GATE_SATISFIED_EVENT, GATE_REVALIDATED_EVENT].includes(event.event)
    && event.taskId === taskId
    && event.details?.gate === gate
    && event.seq > latestContractRevisionSeq);
}

export function validateGateSatisfactionBindings(events = []) {
  const errors = [];
  for (const [index, event] of ledgerEntriesOfTypes(events, [GATE_SATISFIED_EVENT, GATE_REVALIDATED_EVENT])) {
    if (![GATE_SATISFIED_EVENT, GATE_REVALIDATED_EVENT].includes(event.event)) continue;
    const revalidated = event.event === GATE_REVALIDATED_EVENT;
    try {
      if (revalidated) assertGateRevalidatedDetails(event.details);
      else assertGateSatisfiedDetails(event.details);
    } catch (error) {
      errors.push({ code: error.code ?? "E_EVENT_INVALID", message: `event ${event.seq} (${event.event}): ${error.message}` });
      continue;
    }
    const revisedBeforeGate = events.slice(0, index).findLast((candidate) => candidate.taskId === event.taskId
      && candidate.event === CONTRACT_REVISED_EVENT);
    const boundary = revalidated
      ? resolveGateRevalidationBoundary(events, event)
      : resolveGateRecordBoundary(events, event);
    if ((revalidated || revisedBeforeGate) && !boundary) {
      errors.push({
        code: revalidated ? "E_GATE_REVALIDATION_INVALID" : "E_EVENT_INVALID",
        message: revalidated
          ? `event ${event.seq} must be immediately followed by its gate-revalidate transaction commit`
          : `event ${event.seq} must be immediately followed by its gate-record transaction commit after contract revision`,
      });
    }
  }
  return errors;
}
