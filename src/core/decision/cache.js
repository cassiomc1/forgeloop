import { canonicalFingerprint } from "../artifacts.js";
import { DECISION_ERROR_CODES, decisionError } from "./errors.js";

export function decisionCacheKey(input = {}) {
  return canonicalFingerprint({
    engine: input.engine,
    model: input.model,
    questionSetFingerprint: input.questionSetFingerprint,
    stateFingerprint: input.stateFingerprint,
    policyFingerprint: input.policyFingerprint,
    candidateSetFingerprint: input.candidateSetFingerprint ?? null,
  });
}

export function createDecisionCache() {
  const values = new Map();
  return Object.freeze({
    get(input) { return values.get(decisionCacheKey(input)) ?? null; },
    set(input, value) {
      if (!value || typeof value !== "object") throw decisionError(DECISION_ERROR_CODES.CACHE_INVALID, "Only structured semantic decisions may be cached.");
      const key = decisionCacheKey(input);
      values.set(key, Object.freeze({ key, value: structuredClone(value) }));
      return key;
    },
    size() { return values.size; },
  });
}
