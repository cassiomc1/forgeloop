import { decisionError, DECISION_ERROR_CODES } from "../decision/errors.js";

const RISK_ORDER = Object.freeze({ CRITICAL: 4, HIGH: 3, NORMAL: 2, LOW: 1 });

export function assertContextCompilerPolicy({ profile = "balanced", mandatoryIds = [] } = {}) {
  if (!["light", "balanced", "full"].includes(profile)) throw decisionError(DECISION_ERROR_CODES.POLICY_INVALID, "Context compiler profile is invalid.");
  if (!Array.isArray(mandatoryIds) || mandatoryIds.some((id) => typeof id !== "string" || !id)) throw decisionError(DECISION_ERROR_CODES.POLICY_INVALID, "Context compiler mandatory IDs are invalid.");
  return { profile, mandatoryIds: [...new Set(mandatoryIds)] };
}

export function candidatePriority(candidate) {
  return (candidate.mandatory || candidate.required ? 100 : 0) + (candidate.promptInjection ? -50 : 0) + (RISK_ORDER[candidate.risk] ?? 0);
}
