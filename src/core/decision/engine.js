import { DECISION_ENGINE_ID, PINNED_JEV_MODEL } from "./constants.js";
import { validateDecisionRequest } from "./request.js";
import { normalizeDecisionPolicy } from "./policy.js";
import { decisionError, DECISION_ERROR_CODES } from "./errors.js";

export function assertDecisionEngine(engine) {
  if (!engine || engine.id !== DECISION_ENGINE_ID || engine.model !== PINNED_JEV_MODEL || typeof engine.evaluate !== "function" || typeof engine.health !== "function") {
    throw decisionError(DECISION_ERROR_CODES.ENGINE_UNAVAILABLE, "A pinned typesafe-jev decision engine is required.");
  }
  return engine;
}

export function createDecisionEngine({ provider, policy } = {}) {
  const normalizedPolicy = normalizeDecisionPolicy(policy);
  assertDecisionEngine(provider);
  return Object.freeze({
    id: DECISION_ENGINE_ID,
    model: PINNED_JEV_MODEL,
    async evaluate(input) { return provider.evaluate(validateDecisionRequest(input), normalizedPolicy); },
    async health() { return provider.health(normalizedPolicy); },
  });
}
