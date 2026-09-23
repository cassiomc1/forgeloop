export const DECISION_ERROR_CODES = Object.freeze({
  ENGINE_UNAVAILABLE: "E_DECISION_ENGINE_UNAVAILABLE",
  AUTH_REQUIRED: "E_DECISION_ENGINE_AUTH_REQUIRED",
  AUTH_INVALID: "E_DECISION_ENGINE_AUTH_INVALID",
  MODEL_UNSUPPORTED: "E_DECISION_MODEL_UNSUPPORTED",
  REQUEST_INVALID: "E_DECISION_REQUEST_INVALID",
  RESULT_INVALID: "E_DECISION_RESULT_INVALID",
  TIMEOUT: "E_DECISION_TIMEOUT",
  RATE_LIMITED: "E_DECISION_RATE_LIMITED",
  STATE_UNSAFE: "E_DECISION_STATE_UNSAFE",
  STATE_LIMIT: "E_DECISION_STATE_LIMIT",
  LOW_CONFIDENCE: "E_DECISION_LOW_CONFIDENCE",
  STALE: "E_DECISION_STALE",
  POLICY_INVALID: "E_DECISION_POLICY_INVALID",
  CACHE_INVALID: "E_DECISION_CACHE_INVALID",
  QUESTION_SET_UNKNOWN: "E_DECISION_QUESTION_SET_UNKNOWN",
  QUESTION_SET_STALE: "E_DECISION_QUESTION_SET_STALE",
  REQUIRED: "E_DECISION_REQUIRED",
  IMMUTABLE: "E_DECISION_IMMUTABLE",
  LEDGER_INVALID: "E_DECISION_LEDGER_INVALID",
  BINDING_INVALID: "E_DECISION_BINDING_INVALID",
});

export class DecisionError extends Error {
  constructor(code, message, artifacts = []) {
    super(message);
    this.name = "DecisionError";
    this.code = code;
    this.artifacts = artifacts;
  }
}

export function decisionError(code, message, artifacts = []) {
  return new DecisionError(code, message, artifacts);
}

const NETWORK_ERROR_CODES = new Set(["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "ECONNRESET", "EPIPE", "EHOSTUNREACH", "ENETUNREACH"]);

export function classifyProviderFailure(error) {
  const status = Number(error?.status);
  const detail = error?.body?.detail;
  const providerErrorType = typeof detail?.error_type === "string" ? detail.error_type : null;
  const requestId = typeof error?.requestId === "string" && /^[A-Za-z0-9_-]{1,64}$/u.test(error.requestId) ? error.requestId : null;
  let networkClass = null;
  if (error?.name === "APITimeoutError" || error?.code === "ETIMEDOUT") networkClass = "timeout";
  else if (error?.name === "APIConnectionError" || NETWORK_ERROR_CODES.has(error?.code)) networkClass = "connection";
  return {
    httpStatus: Number.isFinite(status) ? status : null,
    providerErrorType,
    requestId,
    networkClass,
  };
}

export function safeDecisionError(error, fallbackCode = DECISION_ERROR_CODES.ENGINE_UNAVAILABLE) {
  if (error instanceof DecisionError) return error;
  const diagnostics = classifyProviderFailure(error);
  const build = (code, message) => {
    const normalized = decisionError(code, message);
    normalized.diagnostics = diagnostics;
    return normalized;
  };
  if (diagnostics.httpStatus === 401 || diagnostics.httpStatus === 403) return build(DECISION_ERROR_CODES.AUTH_INVALID, "The semantic decision service rejected authentication.");
  if (diagnostics.httpStatus === 429) return build(DECISION_ERROR_CODES.RATE_LIMITED, "The semantic decision service rate limit was reached.");
  if (diagnostics.networkClass === "timeout") return build(DECISION_ERROR_CODES.TIMEOUT, "The semantic decision request timed out.");
  if (error?.name === "AuthenticationError") return build(DECISION_ERROR_CODES.AUTH_INVALID, "The semantic decision service rejected authentication.");
  return build(fallbackCode, "The semantic decision service is unavailable.");
}
