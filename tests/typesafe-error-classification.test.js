import assert from "node:assert/strict";
import test from "node:test";

import {
  DECISION_ERROR_CODES,
  DecisionError,
  classifyProviderFailure,
  decisionError,
  safeDecisionError,
} from "../src/core/decision/errors.js";

function providerError(name, { status, code, requestId, errorType } = {}) {
  const error = new Error(`provider ${status ?? code ?? name}`);
  error.name = name;
  if (status !== undefined) error.status = status;
  if (code !== undefined) error.code = code;
  if (requestId !== undefined) error.requestId = requestId;
  if (errorType !== undefined) error.body = { detail: { error_type: errorType } };
  return error;
}

const SECRETISH = "sk-supersecretkeymaterial000000";

test("authentication and outage failures remain distinguishable from a generic path", () => {
  assert.equal(safeDecisionError(providerError("APIError", { status: 401 })).code, DECISION_ERROR_CODES.AUTH_INVALID);
  assert.equal(safeDecisionError(providerError("APIError", { status: 403 })).code, DECISION_ERROR_CODES.AUTH_INVALID);
  assert.equal(safeDecisionError(providerError("AuthenticationError")).code, DECISION_ERROR_CODES.AUTH_INVALID);
  assert.equal(safeDecisionError(providerError("APIError", { status: 500 })).code, DECISION_ERROR_CODES.ENGINE_UNAVAILABLE);
  assert.equal(safeDecisionError(new Error("dns blowup")).code, DECISION_ERROR_CODES.ENGINE_UNAVAILABLE);
});

test("rate limit, timeout, and connection failures map to stable codes", () => {
  assert.equal(safeDecisionError(providerError("RateLimitError", { status: 429 })).code, DECISION_ERROR_CODES.RATE_LIMITED);
  assert.equal(safeDecisionError(providerError("APITimeoutError")).code, DECISION_ERROR_CODES.TIMEOUT);
  assert.equal(safeDecisionError(providerError("Error", { code: "ETIMEDOUT" })).code, DECISION_ERROR_CODES.TIMEOUT);
  assert.equal(safeDecisionError(providerError("APIConnectionError")).code, DECISION_ERROR_CODES.ENGINE_UNAVAILABLE);
  assert.equal(classifyProviderFailure(providerError("APIConnectionError")).networkClass, "connection");
});

test("existing canonical decision errors pass through untouched", () => {
  const original = decisionError(DECISION_ERROR_CODES.RESULT_INVALID, "malformed provider result");
  assert.equal(safeDecisionError(original), original);
  assert.ok(original instanceof DecisionError);
});

test("a provider billing failure is diagnosable without a secret-bearing generic collapse", () => {
  const error = providerError("APIError", { status: 402, requestId: "req_01a0ca4", errorType: "billing_error" });
  const normalized = safeDecisionError(error);
  assert.equal(normalized.code, DECISION_ERROR_CODES.ENGINE_UNAVAILABLE);
  assert.equal(normalized.diagnostics.httpStatus, 402);
  assert.equal(normalized.diagnostics.providerErrorType, "billing_error");
  assert.equal(normalized.diagnostics.requestId, "req_01a0ca4");
});

test("diagnostics never carry secret-bearing values and bound request ids", () => {
  const leaky = providerError("APIError", { status: 500, requestId: `sk-supersecret.${SECRETISH}` });
  leaky.headers = { authorization: `Bearer ${SECRETISH}` };
  const diagnostics = classifyProviderFailure(leaky);
  const serialized = JSON.stringify(diagnostics);
  assert.equal(diagnostics.requestId, null, "secret-shaped request id must be dropped");
  assert.doesNotMatch(serialized, /supersecret|Bearer/u);
  assert.ok(Object.keys(diagnostics).every((key) => ["httpStatus", "providerErrorType", "requestId", "networkClass"].includes(key)));
});

test("safe normalization preserves measured fields only when present", () => {
  const ok = providerError("APIError", { status: 200, requestId: "req_ABC-123" });
  const diagnostics = classifyProviderFailure(ok);
  assert.equal(diagnostics.httpStatus, 200);
  assert.equal(diagnostics.requestId, "req_ABC-123");
  assert.equal(diagnostics.providerErrorType, null);
  assert.equal(classifyProviderFailure(new Error("bare")).httpStatus, null);
});
