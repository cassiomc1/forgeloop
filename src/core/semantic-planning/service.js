import { DECISION_ERROR_CODES, decisionError } from "../decision/errors.js";
import { projectDiagnosisPriority, projectFailureTriage, projectReviewPlan } from "./projection.js";

const PROJECTORS = Object.freeze({
  failure: projectFailureTriage,
  diagnosis: projectDiagnosisPriority,
  review: projectReviewPlan,
});

export function runSemanticPlan({ kind, input = {}, semanticRecommendation = null } = {}) {
  const projector = PROJECTORS[kind];
  if (!projector) throw decisionError(DECISION_ERROR_CODES.QUESTION_SET_UNKNOWN, `Unknown semantic plan kind: ${kind}`);
  return projector({ input, semanticRecommendation });
}

