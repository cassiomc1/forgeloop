import assert from "node:assert/strict";
import test from "node:test";

import { verifyBrowserContext } from "../src/core/browser-verification/service.js";
import { E_BROWSER_VERIFICATION_TIMEOUT } from "../src/core/error-codes.js";

const input = {
  providerName: "test-browser",
  verificationId: "checkout",
  requirement: "Checkout works",
  startUrl: "https://app.example.test/checkout",
  allowedOrigins: ["https://app.example.test"],
  steps: [{ id: "open", kind: "NAVIGATE", url: "https://app.example.test/checkout" }],
  assertions: [{ id: "title", kind: "TITLE_EQUALS", expected: "Checkout" }],
};

test("service invokes an injected provider and returns normalized output", async () => {
  let received;
  const result = await verifyBrowserContext({
    ...input,
    runtimeContext: { browserVerificationProviders: {
      "test-browser": {
        id: "test-browser",
        verify(request) {
          received = request;
          return { status: "PASS", assertions: [{ id: "title", kind: "TITLE_EQUALS", status: "PASS" }] };
        },
      },
    } },
  });
  assert.equal(received.startUrl, input.startUrl);
  assert.equal(result.status, "PASS");
  assert.equal(result.authority, "OBSERVATION");
});

test("service bounds provider execution with a timeout", async () => {
  await assert.rejects(() => verifyBrowserContext({
    ...input,
    timeoutMs: 1,
    runtimeContext: { browserVerificationProviders: {
      "test-browser": { id: "test-browser", verify: () => new Promise(() => {}) },
    } },
  }), (error) => error.code === E_BROWSER_VERIFICATION_TIMEOUT);
});
