import { normalizeDecisionResult } from "../../core/decision/result.js";
import { safeDecisionError } from "../../core/decision/errors.js";

export function normalizeTypesafeResult(raw, questionSet) {
  try {
    return normalizeDecisionResult(raw, { questionSet });
  } catch (error) {
    throw safeDecisionError(error, "E_DECISION_RESULT_INVALID");
  }
}
