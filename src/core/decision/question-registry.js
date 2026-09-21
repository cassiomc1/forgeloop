import { canonicalFingerprint } from "../artifacts.js";
import { DECISION_QUESTION_SETS } from "./constants.js";
import { DECISION_ERROR_CODES, decisionError } from "./errors.js";

const QUESTION_SET_DEFINITIONS = Object.freeze({
  "intake-v1": Object.freeze({
    id: "intake-v1", version: 1, decisionKind: "INTAKE",
    questions: Object.freeze({ work_type: { type: "choice", criteria: { documentation: "Documentation or prose change", code: "Executable code change", security: "Security-sensitive change", unknown: "Insufficient information" } } }),
  }),
  "context-v1": Object.freeze({
    id: "context-v1", version: 1, decisionKind: "CONTEXT_PLAN",
    questions: Object.freeze({ need_history: { type: "noul", criteria: { yes: "History is materially relevant", no: "History is not materially relevant" } }, need_security: { type: "noul", criteria: { yes: "Security context is materially relevant", no: "Security context is not materially relevant" } } }),
  }),
  "model-route-v1": Object.freeze({
    id: "model-route-v1", version: 1, decisionKind: "MODEL_ROUTE",
    questions: Object.freeze({ generation_required: { type: "noul", criteria: { yes: "Generation is required", no: "A deterministic or semantic-only decision is sufficient" } }, reasoning_depth: { type: "choice", criteria: { NONE: "No generation or deep reasoning", FAST: "Small bounded reasoning", STANDARD: "Cross-file reasoning", PRIMARY: "Architecture or high ambiguity reasoning" } } }),
  }),
});

export function getQuestionSet(id) {
  const definition = QUESTION_SET_DEFINITIONS[id];
  if (!definition || !DECISION_QUESTION_SETS[id]) throw decisionError(DECISION_ERROR_CODES.QUESTION_SET_UNKNOWN, `Unknown semantic decision question set: ${id}`);
  return Object.freeze({ ...definition, fingerprint: canonicalFingerprint(definition.questions) });
}

export function listQuestionSets() {
  return Object.values(DECISION_QUESTION_SETS).map((entry) => getQuestionSet(entry.id));
}
