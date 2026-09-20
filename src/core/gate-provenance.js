import { canonicalFingerprint } from "./artifacts.js";

export const GATE_SATISFIED_EVENT = "GATE_SATISFIED";
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

function gateIndex(events, gateEvent) {
  return events.findIndex((event) => event === gateEvent
    || (event?.seq === gateEvent?.seq
      && event?.taskId === gateEvent?.taskId
      && event?.event === GATE_SATISFIED_EVENT));
}

function isValidGateRecordCommit(gateEvent, commitEvent) {
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
    && commitEvent.details.operation === "gate-record";
}

export function resolveGateRecordBoundary(events, gateEvent) {
  if (!Array.isArray(events) || !gateEvent || gateEvent.event !== GATE_SATISFIED_EVENT) return null;
  const index = gateIndex(events, gateEvent);
  if (index < 0) return null;
  const commitEvent = events[index + 1];
  return isValidGateRecordCommit(gateEvent, commitEvent)
    ? { gateEvent, transactionCommitEvent: commitEvent }
    : null;
}

export function validateGateSatisfactionBindings(events = []) {
  const errors = [];
  for (const [index, event] of events.entries()) {
    if (event.event !== GATE_SATISFIED_EVENT) continue;
    try {
      assertGateSatisfiedDetails(event.details);
    } catch (error) {
      errors.push({ code: error.code ?? "E_EVENT_INVALID", message: `event ${event.seq} (${event.event}): ${error.message}` });
      continue;
    }
    const revisedBeforeGate = events.slice(0, index).findLast((candidate) => candidate.taskId === event.taskId
      && candidate.event === CONTRACT_REVISED_EVENT);
    if (revisedBeforeGate && !resolveGateRecordBoundary(events, event)) {
      errors.push({
        code: "E_EVENT_INVALID",
        message: `event ${event.seq} must be immediately followed by its gate-record transaction commit after contract revision`,
      });
    }
  }
  return errors;
}
