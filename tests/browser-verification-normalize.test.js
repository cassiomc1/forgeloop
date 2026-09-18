import assert from "node:assert/strict";
import test from "node:test";

import { normalizeBrowserVerificationResult } from "../src/core/browser-verification/normalize.js";
import { E_BROWSER_VERIFICATION_RESULT_INVALID } from "../src/core/error-codes.js";

const expectedAssertions = [{ id: "title", kind: "TITLE_EQUALS" }];

test("normalization derives status and stamps observation-only trust", () => {
  const result = normalizeBrowserVerificationResult({
    status: "PASS",
    assertions: [{ id: "title", kind: "TITLE_EQUALS", status: "PASS", actual: "Checkout" }],
  }, { provider: { id: "playwright", version: "1" }, verificationId: "checkout", expectedAssertions });
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
  }, { provider: "playwright", verificationId: "checkout", expectedAssertions }), (error) =>
    error.code === E_BROWSER_VERIFICATION_RESULT_INVALID);
});

test("normalization rejects assertion-set mismatches and status inconsistencies", () => {
  assert.throws(() => normalizeBrowserVerificationResult({
    status: "PASS",
    assertions: [{ id: "other", kind: "TITLE_EQUALS", status: "PASS" }],
  }, { provider: "playwright", verificationId: "checkout", expectedAssertions }), (error) =>
    error.code === E_BROWSER_VERIFICATION_RESULT_INVALID);
  assert.throws(() => normalizeBrowserVerificationResult({
    status: "PASS",
    assertions: [{ id: "title", kind: "TITLE_EQUALS", status: "FAIL" }],
  }, { provider: "playwright", verificationId: "checkout", expectedAssertions }), (error) =>
    error.code === E_BROWSER_VERIFICATION_RESULT_INVALID);
});
