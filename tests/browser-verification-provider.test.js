import assert from "node:assert/strict";
import test from "node:test";

import {
  assertBrowserVerificationProvider,
  createBrowserVerificationProviderRegistry,
  normalizeBrowserVerificationRequest,
  resolveBrowserVerificationProvider,
} from "../src/core/browser-verification/provider.js";
import { E_BROWSER_VERIFICATION_PROVIDER_INVALID, E_BROWSER_VERIFICATION_REQUEST_INVALID } from "../src/core/error-codes.js";

const request = {
  verificationId: "checkout",
  requirement: "The checkout page is usable.",
  startUrl: "https://app.example.test/checkout",
  allowedOrigins: ["https://app.example.test"],
  steps: [{ id: "open", kind: "NAVIGATE", url: "https://app.example.test/checkout" }],
  assertions: [{ id: "title", kind: "TITLE_EQUALS", expected: "Checkout" }],
};

test("browser provider validation requires a bounded provider interface", () => {
  assert.doesNotThrow(() => assertBrowserVerificationProvider({ id: "playwright", verify() {} }));
  assert.throws(() => assertBrowserVerificationProvider({ id: "Bad ID", verify() {} }), (error) =>
    error.code === E_BROWSER_VERIFICATION_PROVIDER_INVALID);
  assert.throws(() => assertBrowserVerificationProvider({ id: "playwright" }), (error) =>
    error.code === E_BROWSER_VERIFICATION_PROVIDER_INVALID);
});

test("provider registry validates keys and preserves lazy factories", async () => {
  let created = false;
  const registry = createBrowserVerificationProviderRegistry({
    playwright: async () => {
      created = true;
      return { id: "playwright", verify() {} };
    },
  });
  assert.equal(created, false);
  assert.equal((await resolveBrowserVerificationProvider(registry, "playwright")).id, "playwright");
  assert.equal(created, true);
  assert.throws(() => createBrowserVerificationProviderRegistry({ other: { id: "playwright", verify() {} } }), (error) =>
    error.code === E_BROWSER_VERIFICATION_PROVIDER_INVALID);
});

test("request normalization enforces origins and freezes bounded options", () => {
  const normalized = normalizeBrowserVerificationRequest({
    ...request,
    viewport: { width: 1280, height: 720 },
    capture: { screenshot: "ON_FAILURE" },
    timeoutMs: 999999,
  });
  assert.equal(normalized.startUrl, request.startUrl);
  assert.equal(normalized.timeoutMs, 120000);
  assert.equal(Object.isFrozen(normalized), true);
  assert.equal(Object.isFrozen(normalized.viewport), true);
  assert.throws(() => normalizeBrowserVerificationRequest({ ...request, startUrl: "https://other.example.test" }), (error) =>
    error.code === E_BROWSER_VERIFICATION_REQUEST_INVALID);
  assert.throws(() => normalizeBrowserVerificationRequest({ ...request, steps: [{ ...request.steps[0], url: "file:///tmp/test" }] }), (error) =>
    error.code === E_BROWSER_VERIFICATION_REQUEST_INVALID);
});
