import { DECISION_ERROR_CODES, decisionError } from "./errors.js";

export const DECISION_CUTOVER_MODE = "FAIL_CLOSED";
export const OFFLINE_SAFE_OPERATIONS = Object.freeze([
  "protocol-info", "doctor", "status", "task-show", "task-list", "history", "trace", "audit",
  "validate-state", "validate-protocol", "inspect", "task-recover", "task-abandon", "complete",
]);

export function assertRequiredDecision({ decision = null, operation = "semantic-decision" } = {}) {
  if (!decision || typeof decision !== "object" || Array.isArray(decision)) {
    throw decisionError(DECISION_ERROR_CODES.REQUIRED, `A fresh ForgeLoop semantic decision is required for ${operation}.`);
  }
  if (decision.model !== "jev-1.13.0" || decision.engine !== "typesafe-jev") {
    throw decisionError(DECISION_ERROR_CODES.MODEL_UNSUPPORTED, "Semantic decision is not bound to the pinned ForgeLoop Jev model.");
  }
  return decision;
}

export function isOfflineSafeOperation(operation) { return OFFLINE_SAFE_OPERATIONS.includes(operation); }

