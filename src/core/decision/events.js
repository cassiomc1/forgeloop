import { ledgerRelationSet } from "../ledger-relations.js";
import { ledgerEventsOfTypes } from "../ledger-event-collection.js";
import { canonicalFingerprint } from "../artifacts.js";
import { readDecisionArtifact } from "./artifact.js";
import { DECISION_KINDS, DECISION_STATUS, SEMANTIC_DECISION_RECORDED_EVENT, SEMANTIC_DECISION_SUPERSEDED_EVENT } from "./constants.js";
import { DECISION_ERROR_CODES } from "./errors.js";

const HEX = /^[a-f0-9]{64}$/;

export function assertSemanticDecisionDetails(details, eventName = SEMANTIC_DECISION_RECORDED_EVENT) {
  if (!details || typeof details !== "object" || Array.isArray(details)) throw Object.assign(new Error(`${eventName} requires structured details`), { code: DECISION_ERROR_CODES.RESULT_INVALID });
  for (const key of ["decisionId", "decisionKind", "artifactFingerprint", "questionSetFingerprint", "stateFingerprint", "model"]) {
    if (typeof details[key] !== "string" || !details[key]) throw Object.assign(new Error(`${eventName} details.${key} is required`), { code: DECISION_ERROR_CODES.RESULT_INVALID });
  }
  if (!DECISION_KINDS.includes(details.decisionKind) || details.model !== "jev-1.13.0" || !HEX.test(details.artifactFingerprint) || !HEX.test(details.questionSetFingerprint) || !HEX.test(details.stateFingerprint)) {
    throw Object.assign(new Error(`${eventName} details are invalid`), { code: DECISION_ERROR_CODES.RESULT_INVALID });
  }
  if (eventName === SEMANTIC_DECISION_RECORDED_EVENT && details.status !== undefined && !DECISION_STATUS.includes(details.status)) {
    throw Object.assign(new Error(`${eventName} details.status is invalid`), { code: DECISION_ERROR_CODES.RESULT_INVALID });
  }
  if (eventName === SEMANTIC_DECISION_SUPERSEDED_EVENT && (typeof details.supersededBy !== "string" || !details.supersededBy)) {
    throw Object.assign(new Error(`${eventName} details.supersededBy is required`), { code: DECISION_ERROR_CODES.RESULT_INVALID });
  }
}

export function decisionEventDetails(artifact) {
  return {
    decisionId: artifact.decisionId,
    decisionKind: artifact.decisionKind,
    artifactFingerprint: canonicalFingerprint(artifact),
    questionSetFingerprint: artifact.questionSetFingerprint,
    stateFingerprint: artifact.stateFingerprint,
    model: artifact.model,
    status: "RECORDED",
  };
}

export function decisionSupersededEventDetails(previousArtifact, supersededBy) {
  return {
    ...decisionEventDetails(previousArtifact),
    supersededBy,
  };
}

export function validateSemanticDecisionEventBindings(events = []) {
  const errors = [];
  const recorded = ledgerRelationSet();
  for (const event of ledgerEventsOfTypes(events, [SEMANTIC_DECISION_RECORDED_EVENT, SEMANTIC_DECISION_SUPERSEDED_EVENT])) {
    if (![SEMANTIC_DECISION_RECORDED_EVENT, SEMANTIC_DECISION_SUPERSEDED_EVENT].includes(event.event)) continue;
    try { assertSemanticDecisionDetails(event.details, event.event); } catch (error) {
      errors.push({ code: error.code ?? DECISION_ERROR_CODES.RESULT_INVALID, message: `event ${event.seq} (${event.event}): ${error.message}` });
      continue;
    }
    if (event.event === SEMANTIC_DECISION_RECORDED_EVENT) {
      const key = `${event.taskId}:${event.details.decisionId}`;
      if (recorded.has(key)) {
        errors.push({ code: DECISION_ERROR_CODES.RESULT_INVALID, message: `event ${event.seq} records duplicate decision ID ${event.details.decisionId}` });
      }
      recorded.add(key);
    }
    if (event.event === SEMANTIC_DECISION_SUPERSEDED_EVENT) {
      const key = `${event.taskId}:${event.details.decisionId}`;
      if (!recorded.has(key)) errors.push({ code: DECISION_ERROR_CODES.RESULT_INVALID, message: `event ${event.seq} supersedes a decision that was not recorded` });
      if (!recorded.has(`${event.taskId}:${event.details.supersededBy}`)) {
        errors.push({ code: DECISION_ERROR_CODES.RESULT_INVALID, message: `event ${event.seq} points to a superseding decision that was not recorded` });
      }
      const next = events.find((candidate) => candidate.seq === event.seq + 1);
      if (next?.event !== "TRANSACTION_COMMITTED" || next.taskId !== event.taskId || next.details?.operation !== "semantic-decision") {
        errors.push({ code: DECISION_ERROR_CODES.LEDGER_INVALID, message: `event ${event.seq} supersession is not closed by a semantic-decision transaction` });
      }
    }
    if (event.event === SEMANTIC_DECISION_RECORDED_EVENT) {
      const next = events.find((candidate) => candidate.seq === event.seq + 1);
      const closesDirectly = next?.event === "TRANSACTION_COMMITTED" && next.taskId === event.taskId && next.details?.operation === "semantic-decision";
      const continuesWithSupersession = next?.event === SEMANTIC_DECISION_SUPERSEDED_EVENT && next.taskId === event.taskId;
      if (!closesDirectly && !continuesWithSupersession) {
        errors.push({ code: DECISION_ERROR_CODES.LEDGER_INVALID, message: `event ${event.seq} is not closed by the semantic-decision transaction boundary` });
      }
    }
  }
  return errors;
}

export async function validateSemanticDecisionArtifactBindings(target, packageRoot, events = [], { reader = readDecisionArtifact } = {}) {
  const errors = [];
  for (const event of ledgerEventsOfTypes(events, [SEMANTIC_DECISION_RECORDED_EVENT])) {
    if (event.event !== SEMANTIC_DECISION_RECORDED_EVENT) continue;
    try {
      const artifact = (await reader(target, event.taskId, event.details.decisionId, packageRoot)).value;
      if (artifact.taskId !== event.taskId
        || artifact.decisionId !== event.details.decisionId
        || canonicalFingerprint(artifact) !== event.details.artifactFingerprint
        || artifact.questionSetFingerprint !== event.details.questionSetFingerprint
        || artifact.stateFingerprint !== event.details.stateFingerprint
        || artifact.model !== event.details.model) {
        errors.push({ code: DECISION_ERROR_CODES.LEDGER_INVALID, message: `event ${event.seq} does not match its immutable semantic decision artifact` });
      }
    } catch (error) {
      errors.push({ code: DECISION_ERROR_CODES.LEDGER_INVALID, message: `event ${event.seq} semantic decision artifact is unavailable or invalid` });
    }
  }
  return errors;
}
