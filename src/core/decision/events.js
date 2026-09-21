import { canonicalFingerprint } from "../artifacts.js";
import { DECISION_KINDS, DECISION_STATUS, SEMANTIC_DECISION_RECORDED_EVENT, SEMANTIC_DECISION_SUPERSEDED_EVENT } from "./constants.js";
import { DECISION_ERROR_CODES } from "./errors.js";

const HEX = /^[a-f0-9]{64}$/;

export function assertSemanticDecisionDetails(details, eventName = SEMANTIC_DECISION_RECORDED_EVENT) {
  if (!details || typeof details !== "object" || Array.isArray(details)) throw Object.assign(new Error(`${eventName} requires structured details`), { code: DECISION_ERROR_CODES.RESULT_INVALID });
  for (const key of ["decisionKind", "artifactFingerprint", "questionSetFingerprint", "stateFingerprint", "model"]) {
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
    decisionKind: artifact.decisionKind,
    artifactFingerprint: canonicalFingerprint(artifact),
    questionSetFingerprint: artifact.questionSetFingerprint,
    stateFingerprint: artifact.stateFingerprint,
    model: artifact.model,
    status: "RECORDED",
  };
}

export function validateSemanticDecisionEventBindings(events = []) {
  const errors = [];
  const recorded = new Map();
  for (const event of events) {
    if (![SEMANTIC_DECISION_RECORDED_EVENT, SEMANTIC_DECISION_SUPERSEDED_EVENT].includes(event.event)) continue;
    try { assertSemanticDecisionDetails(event.details, event.event); } catch (error) {
      errors.push({ code: error.code ?? DECISION_ERROR_CODES.RESULT_INVALID, message: `event ${event.seq} (${event.event}): ${error.message}` });
      continue;
    }
    if (event.event === SEMANTIC_DECISION_RECORDED_EVENT) {
      const key = `${event.taskId}:${event.details.decisionKind}`;
      recorded.set(key, event);
    }
    if (event.event === SEMANTIC_DECISION_SUPERSEDED_EVENT) {
      const key = `${event.taskId}:${event.details.decisionKind}`;
      if (!recorded.has(key)) errors.push({ code: DECISION_ERROR_CODES.RESULT_INVALID, message: `event ${event.seq} supersedes a decision that was not recorded` });
    }
  }
  return errors;
}
