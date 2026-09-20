import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  createForgeLoopContext,
  createSecurityReviewProviderRegistry,
  normalizeSecurityReviewRequest,
  normalizeSecurityReviewResult,
  runSecurityReview,
} from "../src/integration.js";
import {
  E_SECURITY_REVIEW_CANCELLED,
  E_SECURITY_REVIEW_EXECUTION_FAILED,
  E_SECURITY_REVIEW_PROVIDER_INVALID,
  E_SECURITY_REVIEW_PROVIDER_UNAVAILABLE,
  E_SECURITY_REVIEW_REQUEST_INVALID,
  E_SECURITY_REVIEW_RESULT_INVALID,
  E_SECURITY_REVIEW_TIMEOUT,
} from "../src/core/error-codes.js";

const request = {
  projectPath: "/tmp/forge-project",
  taskId: "security-review-provider",
  providerName: "test-review",
  reviewId: "baseline",
  scope: "SELECTED",
  paths: ["src/security.js"],
  categories: ["INJECTION", "SECRETS"],
  requirements: ["Find unsafe input handling"],
  revision: { head: "abc123" },
};

function provider(overrides = {}) {
  return {
    id: "test-review",
    version: "1.0.0",
    review: async () => ({ findings: [] }),
    ...overrides,
  };
}

test("security-review registration supports object and Map entries without invoking factories", () => {
  let created = false;
  const registry = createSecurityReviewProviderRegistry(new Map([
    ["test-review", async () => {
      created = true;
      return provider();
    }],
  ]));
  assert.equal(created, false);
  assert.equal(typeof registry["test-review"], "function");
  assert.doesNotThrow(() => createForgeLoopContext({ securityReviewProviders: new Map([["test-review", provider()]]) }));
  assert.throws(() => createForgeLoopContext({ securityReviewProviders: { Bad: provider() } }), (error) => error.code === E_SECURITY_REVIEW_PROVIDER_INVALID);
  assert.throws(() => createForgeLoopContext({ securityReviewProviders: { "test-review": { id: "other", review() {} } } }), (error) => error.code === E_SECURITY_REVIEW_PROVIDER_INVALID);
});

test("security-review request normalization enforces explicit bounded scope", () => {
  const { providerName: _providerName, ...requestInput } = request;
  const normalized = normalizeSecurityReviewRequest({ ...requestInput, timeoutMs: 999999 });
  assert.equal(normalized.timeoutMs, 120000);
  assert.equal(Object.isFrozen(normalized), true);
  assert.equal(Object.isFrozen(normalized.paths), true);
  assert.throws(() => normalizeSecurityReviewRequest({ ...requestInput, scope: "SELECTED", paths: [] }), (error) => error.code === E_SECURITY_REVIEW_REQUEST_INVALID);
  assert.throws(() => normalizeSecurityReviewRequest({ ...requestInput, paths: ["../secret"] }), (error) => error.code === E_SECURITY_REVIEW_REQUEST_INVALID);
  assert.throws(() => normalizeSecurityReviewRequest({ ...requestInput, paths: ["/etc/passwd"] }), (error) => error.code === E_SECURITY_REVIEW_REQUEST_INVALID);
  assert.throws(() => normalizeSecurityReviewRequest({ ...requestInput, categories: ["NOT_A_CATEGORY"] }), (error) => error.code === E_SECURITY_REVIEW_REQUEST_INVALID);
  assert.throws(() => normalizeSecurityReviewRequest({ ...requestInput, extra: true }), (error) => error.code === E_SECURITY_REVIEW_REQUEST_INVALID);
});

test("security-review result normalization derives bounded summary and trust metadata", () => {
  const result = normalizeSecurityReviewResult({
    findings: [{
      id: "SEC-1",
      category: "INJECTION",
      severity: "HIGH",
      title: "Untrusted input reaches a sink",
      summary: "The request value is not validated before use.",
      path: "src/security.js",
      line: 42,
      ruleId: "input-boundary",
      confidence: "HIGH",
    }],
    diagnostics: ["analysis completed"],
  }, { provider: provider(), taskId: request.taskId, reviewId: request.reviewId, scope: request.scope, requestedPaths: request.paths });
  assert.equal(result.summary.total, 1);
  assert.equal(result.summary.bySeverity.HIGH, 1);
  assert.equal(result.authority, "OBSERVATION");
  assert.equal(result.persisted, false);
  assert.equal(result.evidenceAuthority, "NONE");
  assert.equal(result.lifecycleAuthority, false);
  assert.equal(result.completionAuthority, false);
  assert.equal(result.trustRole, "NON_EVIDENCE_SECURITY_REVIEW");
  assert.equal(Object.isFrozen(result), true);
});

test("security-review result rejects malformed, duplicate, escaping, and authority-injected findings", () => {
  const options = { provider: provider(), taskId: request.taskId, reviewId: request.reviewId, scope: request.scope, requestedPaths: request.paths };
  const finding = { id: "SEC-1", category: "SECRETS", severity: "HIGH", title: "Secret", summary: "Bounded observation." };
  assert.throws(() => normalizeSecurityReviewResult({ findings: [finding, finding] }, options), (error) => error.code === E_SECURITY_REVIEW_RESULT_INVALID);
  assert.throws(() => normalizeSecurityReviewResult({ findings: [{ ...finding, severity: "URGENT" }] }, options), (error) => error.code === E_SECURITY_REVIEW_RESULT_INVALID);
  assert.throws(() => normalizeSecurityReviewResult({ findings: [{ ...finding, path: "../../secret" }] }, options), (error) => error.code === E_SECURITY_REVIEW_RESULT_INVALID);
  assert.throws(() => normalizeSecurityReviewResult({ findings: [], complete: true }, options), (error) => error.code === E_SECURITY_REVIEW_RESULT_INVALID);
  const accessor = {};
  Object.defineProperty(accessor, "findings", { get() { throw new Error("getter executed"); } });
  assert.throws(() => normalizeSecurityReviewResult(accessor, options), (error) => error.code === E_SECURITY_REVIEW_RESULT_INVALID);
});

test("security-review is explicit, lazy, and does not mutate ForgeLoop artifacts", async () => {
  const context = createForgeLoopContext({ securityReviewProviders: { "test-review": provider() } });
  assert.equal(typeof context.securityReviewProviders["test-review"].review, "function");
  const ledgerPath = ".forgeloop/task-state/a15772a08e04e8d441d09c142d349b144b392f7211517578158e0112381460c2/events.ndjson";
  const before = readFileSync(ledgerPath, "utf8");
  const result = await runSecurityReview({ ...request, runtimeContext: context });
  assert.equal(result.summary.total, 0);
  assert.deepEqual(readFileSync(ledgerPath, "utf8"), before);
});

test("security-review provider failures are normalized without leaking provider data", async () => {
  await assert.rejects(() => runSecurityReview({ ...request, runtimeContext: { securityReviewProviders: {
    "test-review": provider({ review() { throw new Error("token=hidden Cookie: session=private"); } }),
  } } }), (error) => {
    assert.equal(error.code, E_SECURITY_REVIEW_EXECUTION_FAILED);
    assert.doesNotMatch(error.message, /hidden|private/);
    assert.doesNotMatch(JSON.stringify(error.details), /hidden|private/);
    return true;
  });
  await assert.rejects(() => runSecurityReview({ ...request, providerName: "missing", runtimeContext: { securityReviewProviders: {} } }), (error) => error.code === E_SECURITY_REVIEW_PROVIDER_UNAVAILABLE);
});

test("security-review shares a deadline with provider factories and review calls", async () => {
  let factoryInput;
  await assert.rejects(() => runSecurityReview({ ...request, timeoutMs: 5, runtimeContext: {
    securityReviewProviders: {
      "test-review": async (input) => {
        factoryInput = input;
        return new Promise(() => {});
      },
    },
  } }), (error) => error.code === E_SECURITY_REVIEW_TIMEOUT);
  assert.equal(factoryInput.signal.aborted, true);
  assert.ok(factoryInput.timeoutMs <= 5);
});

test("security-review caller cancellation aborts the provider and returns no observation", async () => {
  const controller = new AbortController();
  let received;
  const pending = runSecurityReview({ ...request, signal: controller.signal, runtimeContext: {
    securityReviewProviders: { "test-review": provider({ review(input) {
      received = input;
      return new Promise(() => {});
    } }) },
  } });
  await new Promise((resolve) => setTimeout(resolve, 1));
  controller.abort();
  await assert.rejects(pending, (error) => error.code === E_SECURITY_REVIEW_CANCELLED);
  assert.equal(received.signal.aborted, true);
});

test("security-review late provider completion cannot produce a result after timeout", async () => {
  let completed = false;
  await assert.rejects(() => runSecurityReview({ ...request, timeoutMs: 2, runtimeContext: {
    securityReviewProviders: { "test-review": provider({ review: () => new Promise((resolve) => setTimeout(() => {
      completed = true;
      resolve({ findings: [] });
    }, 25)) }) },
  } }), (error) => error.code === E_SECURITY_REVIEW_TIMEOUT);
  await new Promise((resolve) => setTimeout(resolve, 35));
  assert.equal(completed, true);
});
