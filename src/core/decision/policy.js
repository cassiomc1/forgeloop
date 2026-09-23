import { canonicalFingerprint } from "../artifacts.js";
import { DECISION_DEFAULT_POLICY, DECISION_ENGINE_ID, PINNED_JEV_MODEL } from "./constants.js";
import { DECISION_ERROR_CODES, decisionError } from "./errors.js";

export function normalizeDecisionPolicy(input = {}) {
  const policy = { ...DECISION_DEFAULT_POLICY, ...input };
  if (policy.required !== true || policy.provider !== DECISION_ENGINE_ID || policy.model !== PINNED_JEV_MODEL) {
    throw decisionError(DECISION_ERROR_CODES.POLICY_INVALID, "ForgeLoop Jev policy must remain mandatory and pinned.");
  }
  if (!Number.isInteger(policy.policyVersion) || policy.policyVersion < 1 || !Number.isInteger(policy.requestTimeoutMs) || policy.requestTimeoutMs < 500 || policy.requestTimeoutMs > 60_000 || !Number.isInteger(policy.maxRetries) || policy.maxRetries < 0 || policy.maxRetries > 3 || typeof policy.cache !== "boolean") {
    throw decisionError(DECISION_ERROR_CODES.POLICY_INVALID, "ForgeLoop Jev policy limits are invalid.");
  }
  return Object.freeze(policy);
}

export function decisionPolicyFingerprint(policy) {
  return canonicalFingerprint(normalizeDecisionPolicy(policy));
}
