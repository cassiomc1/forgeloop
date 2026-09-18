import assert from "node:assert/strict";
import test from "node:test";

import { normalizeBrowserVerificationResult } from "../src/core/browser-verification/normalize.js";
import {
  E_BROWSER_VERIFICATION_OUTPUT_LIMIT,
  E_BROWSER_VERIFICATION_RESULT_INVALID,
} from "../src/core/error-codes.js";
import { BROWSER_VERIFICATION_LIMITS } from "../src/core/browser-verification/constants.js";

const expectedAssertions = [{ id: "title", kind: "TITLE_EQUALS" }];

test("normalization derives status and stamps observation-only trust", () => {
  const result = normalizeBrowserVerificationResult({
    status: "PASS",
    assertions: [{ id: "title", kind: "TITLE_EQUALS", status: "PASS", actual: "Checkout" }],
    finalUrl: "https://app.example.test/checkout",
  }, { provider: { id: "provider", version: "1" }, verificationId: "checkout", taskId: "task-1", requirement: "checkout", target: "/tmp/project", allowedOrigins: ["https://app.example.test"], expectedAssertions });
  assert.equal(result.status, "PASS");
  assert.equal(result.authority, "OBSERVATION");
  assert.equal(result.evidenceAuthority, "NONE");
  assert.equal(result.lifecycleAuthority, false);
  assert.equal(result.completionAuthority, false);
  assert.equal("authority" in result.assertions[0], false);
  assert.throws(() => normalizeBrowserVerificationResult({
    status: "PASS",
    assertions: [{ id: "title", kind: "TITLE_EQUALS", status: "PASS" }],
    authority: "CANONICAL",
    finalUrl: "https://app.example.test/checkout",
  }, { provider: "provider", verificationId: "checkout", taskId: "task-1", requirement: "checkout", target: "/tmp/project", allowedOrigins: ["https://app.example.test"], expectedAssertions }), (error) =>
    error.code === E_BROWSER_VERIFICATION_RESULT_INVALID);
});

test("normalization rejects assertion-set mismatches and status inconsistencies", () => {
  assert.throws(() => normalizeBrowserVerificationResult({
    status: "PASS",
    assertions: [{ id: "other", kind: "TITLE_EQUALS", status: "PASS" }],
    finalUrl: "https://app.example.test/checkout",
  }, { provider: "provider", verificationId: "checkout", taskId: "task-1", requirement: "checkout", target: "/tmp/project", allowedOrigins: ["https://app.example.test"], expectedAssertions }), (error) =>
    error.code === E_BROWSER_VERIFICATION_RESULT_INVALID);
  assert.throws(() => normalizeBrowserVerificationResult({
    status: "PASS",
    assertions: [{ id: "title", kind: "TITLE_EQUALS", status: "FAIL" }],
  }, { provider: "playwright", verificationId: "checkout", expectedAssertions }), (error) =>
    error.code === E_BROWSER_VERIFICATION_RESULT_INVALID);
});

test("navigation is HTTP(S), allowlisted, and credential-free", () => {
  const options = { provider: "provider", verificationId: "checkout", taskId: "task-1", requirement: "checkout", target: "/tmp/project", allowedOrigins: ["https://app.example.test", "https://id.example.test"], expectedAssertions };
  const base = { assertions: [{ id: "title", kind: "TITLE_EQUALS", status: "PASS" }] };
  assert.equal(normalizeBrowserVerificationResult({ ...base, finalUrl: "https://id.example.test/callback", navigations: [{ url: "https://app.example.test/start", kind: "NAVIGATE" }, { url: "https://id.example.test/callback", kind: "REDIRECT" }] }, options).finalUrl, "https://id.example.test/callback");
  for (const finalUrl of ["https://evil.example.test", "file:///tmp/x", "javascript:alert(1)", "https://user:pass@app.example.test"]) {
    assert.throws(() => normalizeBrowserVerificationResult({ ...base, finalUrl }, options));
  }
});

test("authority fields, strict values, and invalid artifacts fail closed", () => {
  const options = { provider: "provider", verificationId: "checkout", taskId: "task-1", requirement: "checkout", target: "/tmp/project", allowedOrigins: ["https://app.example.test"], expectedAssertions };
  const base = { assertions: [{ id: "title", kind: "TITLE_EQUALS", status: "FAIL" }], finalUrl: "https://app.example.test" };
  for (const field of ["complete", "nextAction", "releaseClaims", "evidenceAuthority", "completionAuthority"]) {
    assert.throws(() => normalizeBrowserVerificationResult({ ...base, [field]: true }, options), (error) => error.code === E_BROWSER_VERIFICATION_RESULT_INVALID);
  }
  assert.throws(() => normalizeBrowserVerificationResult({ ...base, artifacts: [{ kind: "SCREENSHOT", mimeType: "image/png", byteLength: 1, sha256: "A".repeat(64), ref: "/tmp/x" }] }, options));
  assert.equal(normalizeBrowserVerificationResult({ ...base, artifacts: [{ kind: "SCREENSHOT", mimeType: "image/png", byteLength: 1, sha256: "a".repeat(64), ref: "artifacts/shot.png" }] }, options).status, "FAIL");
  const getter = { ...base };
  Object.defineProperty(getter, "status", { get() { throw new Error("secret"); }, enumerable: true });
  assert.throws(() => normalizeBrowserVerificationResult(getter, options), (error) => error.code === E_BROWSER_VERIFICATION_RESULT_INVALID);
});

test("diagnostics and snapshots require bounded arrays", () => {
  const options = { provider: "provider", verificationId: "checkout", taskId: "task-1", requirement: "checkout", target: "/tmp/project", allowedOrigins: ["https://app.example.test"], expectedAssertions };
  const base = { assertions: [{ id: "title", kind: "TITLE_EQUALS", status: "PASS" }], finalUrl: "https://app.example.test" };
  assert.throws(() => normalizeBrowserVerificationResult({ ...base, diagnostics: "not-an-array" }, options), (error) => error.code === E_BROWSER_VERIFICATION_RESULT_INVALID);
  assert.throws(() => normalizeBrowserVerificationResult({ ...base, diagnostics: Array(BROWSER_VERIFICATION_LIMITS.maxDiagnostics + 1).fill("x") }, options), (error) => error.code === E_BROWSER_VERIFICATION_OUTPUT_LIMIT);
  assert.throws(() => normalizeBrowserVerificationResult({ ...base, snapshots: "not-an-array" }, options), (error) => error.code === E_BROWSER_VERIFICATION_RESULT_INVALID);
  assert.throws(() => normalizeBrowserVerificationResult({ ...base, snapshots: Array(BROWSER_VERIFICATION_LIMITS.maxSnapshots + 1).fill({ kind: "ACCESSIBILITY", text: "x" }) }, options), (error) => error.code === E_BROWSER_VERIFICATION_OUTPUT_LIMIT);
});

test("nested result objects fail closed on unknown fields", () => {
  const options = { provider: "provider", verificationId: "checkout", taskId: "task-1", requirement: "checkout", target: "/tmp/project", allowedOrigins: ["https://app.example.test"], expectedAssertions };
  const base = { assertions: [{ id: "title", kind: "TITLE_EQUALS", status: "PASS" }], finalUrl: "https://app.example.test" };
  const cases = [
    ["assertions", { ...base.assertions[0], randomField: true }],
    ["assertions", { ...base.assertions[0], completionAuthority: true }],
    ["navigations", { url: "https://app.example.test", kind: "NAVIGATE", randomField: true }],
    ["snapshots", { kind: "ACCESSIBILITY", text: "x", randomField: true }],
    ["artifacts", { kind: "SCREENSHOT", mimeType: "image/png", byteLength: 1, sha256: "a".repeat(64), ref: "artifact:shot", randomField: true }],
  ];
  for (const [field, value] of cases) {
    assert.throws(() => normalizeBrowserVerificationResult({ ...base, [field]: [value] }, options), (error) => error.code === E_BROWSER_VERIFICATION_RESULT_INVALID);
  }
});

test("artifact refs reject portable path forms but accept opaque refs", () => {
  const options = { provider: "provider", verificationId: "checkout", taskId: "task-1", requirement: "checkout", target: "/tmp/project", allowedOrigins: ["https://app.example.test"], expectedAssertions };
  const base = { assertions: [{ id: "title", kind: "TITLE_EQUALS", status: "PASS" }], finalUrl: "https://app.example.test" };
  for (const ref of ["/tmp/screenshot.png", "C:\\Users\\user\\screenshot.png", "C:/Users/user/screenshot.png", "\\\\server\\share\\screenshot.png", "//server/share/screenshot.png", "file:///tmp/x.png", "FILE:///tmp/x.png"]) {
    assert.throws(() => normalizeBrowserVerificationResult({ ...base, artifacts: [{ kind: "SCREENSHOT", mimeType: "image/png", byteLength: 1, sha256: "a".repeat(64), ref }] }, options), (error) => error.code === E_BROWSER_VERIFICATION_RESULT_INVALID);
  }
  for (const ref of ["artifact:shot-123", "screenshot/shot-123", "provider-artifact-abc"]) {
    assert.equal(normalizeBrowserVerificationResult({ ...base, artifacts: [{ kind: "SCREENSHOT", mimeType: "image/png", byteLength: 1, sha256: "a".repeat(64), ref }] }, options).artifacts[0].ref, ref);
  }
});
