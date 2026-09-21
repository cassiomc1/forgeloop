import { PINNED_JEV_MODEL } from "./constants.js";
import { DECISION_ERROR_CODES, decisionError } from "./errors.js";

function finite(value) { return typeof value === "number" && Number.isFinite(value); }

function normalizeAnswer(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean" || finite(value)) return value;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const result = {};
    for (const [key, child] of Object.entries(value)) result[key] = normalizeAnswer(child);
    return result;
  }
  if (Array.isArray(value)) return value.slice(0, 64).map(normalizeAnswer);
  throw decisionError(DECISION_ERROR_CODES.RESULT_INVALID, "Semantic decision answer has an unsupported shape.");
}

export function normalizeDecisionResult(raw, { questionSet, model = PINNED_JEV_MODEL } = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw decisionError(DECISION_ERROR_CODES.RESULT_INVALID, "Semantic decision result must be an object.");
  if (raw.model !== model || raw.model !== PINNED_JEV_MODEL) throw decisionError(DECISION_ERROR_CODES.MODEL_UNSUPPORTED, "Semantic decision result used an unsupported model.");
  if (!raw.answers || typeof raw.answers !== "object" || Array.isArray(raw.answers)) throw decisionError(DECISION_ERROR_CODES.RESULT_INVALID, "Semantic decision result is missing answers.");
  const answers = Object.fromEntries(Object.entries(raw.answers).map(([key, value]) => [key, normalizeAnswer(value)]));
  const inputTokens = raw.usage?.input_tokens;
  const outputTokens = raw.usage?.output_tokens;
  if (!Number.isInteger(inputTokens) || inputTokens < 0 || !Number.isInteger(outputTokens) || outputTokens < 0) {
    throw decisionError(DECISION_ERROR_CODES.RESULT_INVALID, "Semantic decision result usage is invalid.");
  }
  return {
    model,
    questionSetId: questionSet?.id ?? null,
    answers,
    confidence: raw.confidence ?? null,
    usage: { inputTokens, outputTokens, reportedBy: "PROVIDER" },
  };
}
