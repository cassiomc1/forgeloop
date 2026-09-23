import { DECISION_ERROR_CODES, decisionError } from "./errors.js";

export function decisionFreshnessErrors(artifact, current = {}) {
  if (!artifact || typeof artifact !== "object") return [{ code: DECISION_ERROR_CODES.CACHE_INVALID, message: "Semantic decision artifact is missing." }];
  const bindings = [
    "stateFingerprint", "taskStateFingerprint", "semanticStateFingerprint",
    "repositoryFingerprint", "contractFingerprint", "routeFingerprint",
    "verificationCycle", "questionSetFingerprint", "policyFingerprint", "model",
    "candidateSetFingerprint",
  ];
  return bindings.flatMap((key) => artifact[key] !== undefined && current[key] !== undefined && JSON.stringify(artifact[key]) !== JSON.stringify(current[key])
    ? [{ code: DECISION_ERROR_CODES.STALE, message: `Semantic decision binding is stale: ${key}` }] : []);
}

export function assertDecisionFresh(artifact, current) {
  const errors = decisionFreshnessErrors(artifact, current);
  if (errors.length) throw decisionError(DECISION_ERROR_CODES.STALE, errors[0].message);
  return artifact;
}
