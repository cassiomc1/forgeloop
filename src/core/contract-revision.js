import { canonicalFingerprint } from "./artifacts.js";

export const CONTRACT_REVISED_EVENT = "CONTRACT_REVISED";

const FINGERPRINT = /^[a-f0-9]{64}$/;
const REVISION_PHASES = new Set(["CONTRACT_READY", "ROUTED", "PLANNED"]);
const REVISION_DETAIL_KEYS = Object.freeze([
  "previousContractFingerprint",
  "contractFingerprint",
  "previousPhase",
  "phase",
  "previousStateRevision",
  "revisedStateRevision",
  "previousStateFingerprint",
  "revisedStateFingerprint",
  "previousRouteFingerprint",
]);

function invalid(message) {
  const error = new Error(message);
  error.code = "E_CONTRACT_REVISION_UNSAFE";
  return error;
}

export function isFingerprint(value) {
  return typeof value === "string" && FINGERPRINT.test(value);
}

export function assertContractRevisedDetails(details) {
  if (!details || typeof details !== "object" || Array.isArray(details)
    || Object.keys(details).length !== REVISION_DETAIL_KEYS.length
    || REVISION_DETAIL_KEYS.some((key) => !Object.prototype.hasOwnProperty.call(details, key))) {
    throw invalid(`${CONTRACT_REVISED_EVENT} requires its exact contract-transition detail set`);
  }
  for (const key of ["previousContractFingerprint", "contractFingerprint", "previousStateFingerprint", "revisedStateFingerprint"]) {
    if (!isFingerprint(details[key])) throw invalid(`${CONTRACT_REVISED_EVENT} details.${key} must be a lowercase SHA-256 fingerprint`);
  }
  if (details.previousContractFingerprint === details.contractFingerprint) {
    throw invalid(`${CONTRACT_REVISED_EVENT} must change the contract fingerprint`);
  }
  if (!REVISION_PHASES.has(details.previousPhase) || !REVISION_PHASES.has(details.phase)) {
    throw invalid(`${CONTRACT_REVISED_EVENT} details phase is unsupported`);
  }
  const expectedPhase = details.previousPhase === "PLANNED" ? "ROUTED" : details.previousPhase;
  if (details.phase !== expectedPhase) {
    throw invalid(`${CONTRACT_REVISED_EVENT} phase transition is invalid: ${details.previousPhase} -> ${details.phase}`);
  }
  for (const key of ["previousStateRevision", "revisedStateRevision"]) {
    if (!Number.isInteger(details[key]) || details[key] < 0) {
      throw invalid(`${CONTRACT_REVISED_EVENT} details.${key} must be a non-negative integer`);
    }
  }
  if (details.revisedStateRevision !== details.previousStateRevision + 1) {
    throw invalid(`${CONTRACT_REVISED_EVENT} state revisions must advance exactly once`);
  }
  if (details.previousRouteFingerprint !== null && !isFingerprint(details.previousRouteFingerprint)) {
    throw invalid(`${CONTRACT_REVISED_EVENT} details.previousRouteFingerprint must be a fingerprint or null`);
  }
  if (details.previousPhase === "CONTRACT_READY" && details.previousRouteFingerprint !== null) {
    throw invalid(`${CONTRACT_REVISED_EVENT} CONTRACT_READY revisions cannot have a route fingerprint`);
  }
  if (details.previousPhase !== "CONTRACT_READY" && !isFingerprint(details.previousRouteFingerprint)) {
    throw invalid(`${CONTRACT_REVISED_EVENT} routed revisions require the previous route fingerprint`);
  }
  return details;
}

function eventHash(event) {
  const { hash, ...body } = event ?? {};
  return canonicalFingerprint(body);
}

function validRevisionCommit(revisionEvent, commitEvent) {
  return commitEvent?.event === "TRANSACTION_COMMITTED"
    && commitEvent.taskId === revisionEvent.taskId
    && commitEvent.seq === revisionEvent.seq + 1
    && commitEvent.previousHash === revisionEvent.hash
    && revisionEvent.hash === eventHash(revisionEvent)
    && commitEvent.hash === eventHash(commitEvent)
    && commitEvent.details
    && typeof commitEvent.details === "object"
    && !Array.isArray(commitEvent.details)
    && Object.keys(commitEvent.details).length === 2
    && typeof commitEvent.details.transactionId === "string"
    && commitEvent.details.transactionId.length > 0
    && commitEvent.details.operation === "contract-revise";
}

export function resolveContractRevisionBoundary(events, revisionEvent) {
  if (!Array.isArray(events) || !revisionEvent || revisionEvent.event !== CONTRACT_REVISED_EVENT) return null;
  const index = events.findIndex((event) => event === revisionEvent
    || (event?.seq === revisionEvent.seq
      && event?.taskId === revisionEvent.taskId
      && event?.event === CONTRACT_REVISED_EVENT));
  if (index < 0) return null;
  const commitEvent = events[index + 1];
  return validRevisionCommit(revisionEvent, commitEvent)
    ? { revisionEvent, transactionCommitEvent: commitEvent }
    : null;
}

export function resolveCanonicalContractEvolution(events, {
  taskId,
  sourceSeq = 0,
  sourceContractFingerprint,
  targetContractFingerprint,
} = {}) {
  if (!Array.isArray(events)
    || typeof taskId !== "string" || !taskId
    || !Number.isInteger(sourceSeq) || sourceSeq < 0
    || !isFingerprint(sourceContractFingerprint)
    || !isFingerprint(targetContractFingerprint)) return null;

  let currentFingerprint = sourceContractFingerprint;
  const revisionEvents = [];
  for (const event of events) {
    if (event?.seq <= sourceSeq || event?.event !== CONTRACT_REVISED_EVENT) continue;
    if (event.taskId !== taskId) return null;
    try {
      assertContractRevisedDetails(event.details);
    } catch {
      return null;
    }
    if (!resolveContractRevisionBoundary(events, event)
      || event.details.previousContractFingerprint !== currentFingerprint) {
      return null;
    }
    const executionStarted = events.some((candidate) => candidate.taskId === taskId
      && candidate.event === "EXECUTION_STARTED"
      && candidate.seq < event.seq);
    if (executionStarted) return null;
    revisionEvents.push(event);
    currentFingerprint = event.details.contractFingerprint;
  }
  return currentFingerprint === targetContractFingerprint
    ? { valid: true, contractFingerprint: currentFingerprint, revisionEvents }
    : null;
}

export function latestContractRevision(events = []) {
  return events.filter((event) => event.event === CONTRACT_REVISED_EVENT).at(-1) ?? null;
}

export function validateContractRevisionEventBindings(events = []) {
  const errors = [];
  const revisions = events.filter((event) => event.event === CONTRACT_REVISED_EVENT);
  let currentContractFingerprint = null;
  let currentStateRevision = null;
  for (const event of revisions) {
    let details;
    try {
      details = assertContractRevisedDetails(event.details);
    } catch (error) {
      errors.push({ code: error.code ?? "E_CONTRACT_REVISION_UNSAFE", message: `event ${event.seq}: ${error.message}` });
      continue;
    }
    if (!resolveContractRevisionBoundary(events, event)) {
      errors.push({ code: "E_CONTRACT_REVISION_UNSAFE", message: `event ${event.seq} must be immediately followed by its contract-revise transaction commit` });
    }
    if (events.some((candidate) => candidate.taskId === event.taskId
      && candidate.event === "EXECUTION_STARTED"
      && candidate.seq < event.seq)) {
      errors.push({ code: "E_CONTRACT_REVISION_UNSAFE", message: `event ${event.seq} occurs after execution started` });
    }
    if (currentContractFingerprint === null) {
      const initial = events.find((candidate) => candidate.taskId === event.taskId
        && candidate.event === "CONTRACT_VALIDATED"
        && candidate.seq < event.seq);
      const initialFingerprint = initial?.fingerprint ?? initial?.details?.contractFingerprint;
      if (!initial || initialFingerprint !== details.previousContractFingerprint) {
        errors.push({ code: "E_CONTRACT_REVISION_UNSAFE", message: `event ${event.seq} does not continue the initial contract identity` });
      }
    } else if (details.previousContractFingerprint !== currentContractFingerprint) {
      errors.push({ code: "E_CONTRACT_REVISION_UNSAFE", message: `event ${event.seq} is disconnected from the previous contract revision` });
    }
    if (currentStateRevision !== null && details.previousStateRevision < currentStateRevision) {
      errors.push({ code: "E_CONTRACT_REVISION_UNSAFE", message: `event ${event.seq} rolls back the contract revision state` });
    }
    currentContractFingerprint = details.contractFingerprint;
    currentStateRevision = details.revisedStateRevision;
  }
  return errors;
}

export function validateContractRevisionCurrentBinding(state, events = []) {
  const errors = [];
  const revisions = events.filter((event) => event.event === CONTRACT_REVISED_EVENT);
  if (revisions.length === 0) return errors;
  const first = revisions[0];
  const latest = revisions.at(-1);
  const initial = events.find((event) => event.taskId === state?.taskId && event.event === "CONTRACT_VALIDATED");
  const evolution = resolveCanonicalContractEvolution(events, {
    taskId: state?.taskId,
    sourceSeq: initial?.seq ?? 0,
    sourceContractFingerprint: initial?.fingerprint ?? first.details?.previousContractFingerprint,
    targetContractFingerprint: state?.contractFingerprint,
  });
  if (!evolution) {
    errors.push({ code: "E_CONTRACT_REVISION_UNSAFE", message: "current contract identity is not the final canonical contract revision target" });
  }
  if (Number.isInteger(state?.revision) && state.revision < latest.details.revisedStateRevision) {
    errors.push({ code: "E_CONTRACT_REVISION_UNSAFE", message: `current state revision precedes contract revision event ${latest.seq}` });
  }
  if (state?.revision === latest.details.revisedStateRevision
    && (state.phase !== latest.details.phase
      || canonicalFingerprint(state) !== latest.details.revisedStateFingerprint)) {
    errors.push({ code: "E_CONTRACT_REVISION_UNSAFE", message: `event ${latest.seq} does not bind the current revised state` });
  }
  return errors;
}
