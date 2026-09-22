import { PINNED_JEV_MODEL } from "./constants.js";
import { DECISION_ERROR_CODES, decisionError } from "./errors.js";
import { normalizeCanonicalDecision } from "./normalizers/index.js";

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

function normalizeAnswers(rawAnswers, questionSet) {
  return Object.fromEntries(Object.keys(questionSet.questions).map((key) => {
    if (!Object.prototype.hasOwnProperty.call(rawAnswers, key)) {
      throw decisionError(DECISION_ERROR_CODES.RESULT_INVALID, `Semantic decision result is missing answer ${key}.`);
    }
    return [key, normalizeAnswer(rawAnswers[key])];
  }));
}

function normalizeConfidence(confidence, questionSet) {
  if (!confidence || typeof confidence !== "object" || Array.isArray(confidence)) {
    throw decisionError(DECISION_ERROR_CODES.RESULT_INVALID, "Semantic decision result confidence is invalid.");
  }
  return Object.fromEntries(Object.keys(questionSet.questions).map((key) => [key, confidence[key] ?? null]));
}

function normalizeUsage(raw) {
  const inputTokens = raw?.input_tokens ?? raw?.inputTokens;
  const outputTokens = raw?.output_tokens ?? raw?.outputTokens;
  if (!Number.isInteger(inputTokens) || inputTokens < 0 || !Number.isInteger(outputTokens) || outputTokens < 0) {
    throw decisionError(DECISION_ERROR_CODES.RESULT_INVALID, "Semantic decision result usage is invalid.");
  }
  return { inputTokens, outputTokens, reportedBy: "PROVIDER" };
}

export function normalizeDecisionResult(raw, { questionSet, model = PINNED_JEV_MODEL } = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw decisionError(DECISION_ERROR_CODES.RESULT_INVALID, "Semantic decision result must be an object.");
  if (raw.model !== model || raw.model !== PINNED_JEV_MODEL) throw decisionError(DECISION_ERROR_CODES.MODEL_UNSUPPORTED, "Semantic decision result used an unsupported model.");
  if (!raw.answers || typeof raw.answers !== "object" || Array.isArray(raw.answers)) throw decisionError(DECISION_ERROR_CODES.RESULT_INVALID, "Semantic decision result is missing answers.");
  const answers = normalizeAnswers(raw.answers, questionSet);
  const confidence = normalizeConfidence(raw.confidence, questionSet);
  const usage = normalizeUsage(raw.usage);
  return {
    model,
    questionSetId: questionSet?.id ?? null,
    answers,
    confidence: Object.fromEntries(Object.keys(questionSet.questions).map((key) => [key, confidence[key] ?? null])),
    decision: normalizeCanonicalDecision({ questionSet, answers, confidence }),
    usage,
  };
}
