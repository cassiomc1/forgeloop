import { DECISION_ERROR_CODES, decisionError } from "./errors.js";
import { assertRequiredFreshDecision, resolveRequiredSemanticDecision } from "./resolver.js";

export const DECISION_CUTOVER_MODE = "FAIL_CLOSED";
export const OFFLINE_SAFE_OPERATIONS = Object.freeze([
  "protocol-info", "doctor", "status", "task-show", "task-list", "history", "trace", "audit",
  "validate-state", "validate-protocol", "inspect", "task-recover", "task-abandon", "complete",
]);

export function assertRequiredDecision({ decision = null, artifact = null, operation = "semantic-decision", currentBindings = {}, expectedDecisionKind, expectedTaskId, expectedQuestionSetId, ledger = [] } = {}) {
  const candidate = artifact ?? decision;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw decisionError(DECISION_ERROR_CODES.REQUIRED, `A fresh ForgeLoop semantic decision is required for ${operation}.`);
  }
  if (candidate.model !== "jev-1.13.0" || candidate.engine !== "typesafe-jev") {
    throw decisionError(DECISION_ERROR_CODES.MODEL_UNSUPPORTED, "Semantic decision is not bound to the pinned ForgeLoop Jev model.");
  }
  if (!candidate.taskId || !candidate.decisionId || !candidate.questionSetId || !candidate.stateFingerprint
    || !candidate.questionSetFingerprint || !candidate.policyFingerprint || !candidate.authority) {
    throw decisionError(DECISION_ERROR_CODES.REQUIRED, `A canonical persisted semantic decision is required for ${operation}.`);
  }
  return assertRequiredFreshDecision({
    artifact: candidate,
    currentBindings,
    expectedDecisionKind,
    expectedTaskId,
    expectedQuestionSetId,
    ledger,
  });
}

export { assertRequiredFreshDecision, resolveRequiredSemanticDecision };

export function isOfflineSafeOperation(operation) { return OFFLINE_SAFE_OPERATIONS.includes(operation); }
