import { buildDecisionState } from "./state-builder.js";
import { DECISION_KINDS, PINNED_JEV_MODEL } from "./constants.js";
import { DECISION_ERROR_CODES, decisionError } from "./errors.js";
import { getQuestionSet } from "./question-registry.js";

export function validateDecisionRequest(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw decisionError(DECISION_ERROR_CODES.REQUEST_INVALID, "Decision request must be an object.");
  if (typeof input.taskId !== "string" || !input.taskId) throw decisionError(DECISION_ERROR_CODES.REQUEST_INVALID, "Decision request requires a taskId.");
  if (!DECISION_KINDS.includes(input.decisionKind)) throw decisionError(DECISION_ERROR_CODES.REQUEST_INVALID, "Decision request has an unsupported decision kind.");
  if (typeof input.questionSetId !== "string") throw decisionError(DECISION_ERROR_CODES.REQUEST_INVALID, "Decision request requires a question set.");
  const questionSet = getQuestionSet(input.questionSetId);
  if (questionSet.decisionKind !== input.decisionKind) throw decisionError(DECISION_ERROR_CODES.REQUEST_INVALID, "Question set does not match decision kind.");
  if (input.model !== undefined && input.model !== PINNED_JEV_MODEL) throw decisionError(DECISION_ERROR_CODES.MODEL_UNSUPPORTED, "Only the pinned ForgeLoop Jev model is supported.");
  return {
    ...input,
    model: PINNED_JEV_MODEL,
    questionSet,
    state: buildDecisionState(input.state ?? {}),
  };
}
