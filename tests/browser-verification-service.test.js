import assert from "node:assert/strict";
import test from "node:test";

import { runBrowserVerification } from "../src/core/browser-verification/service.js";
import { E_BROWSER_VERIFICATION_PROVIDER_UNAVAILABLE, E_BROWSER_VERIFICATION_TIMEOUT } from "../src/core/error-codes.js";

const input = {
  taskId: "task-1",
  target: "/tmp/project",
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
  const result = await runBrowserVerification({
    ...input,
    runtimeContext: { browserVerificationProviders: {
      "test-browser": {
        id: "test-browser",
        verify(request) {
          received = request;
           return { status: "PASS", finalUrl: input.startUrl, assertions: [{ id: "title", kind: "TITLE_EQUALS", status: "PASS" }] };
        },
      },
    } },
  });
  assert.equal(received.startUrl, input.startUrl);
  assert.equal(result.status, "PASS");
  assert.equal(result.authority, "OBSERVATION");
});

test("service bounds provider execution with a timeout", async () => {
  await assert.rejects(() => runBrowserVerification({
    ...input,
    timeoutMs: 1,
    runtimeContext: { browserVerificationProviders: {
      "test-browser": { id: "test-browser", verify: () => new Promise(() => {}) },
    } },
}), (error) => error.code === E_BROWSER_VERIFICATION_TIMEOUT);
});

test("factory shares the deadline and receives cancellation input", async () => {
  let factoryInput;
  await assert.rejects(() => runBrowserVerification({ ...input, timeoutMs: 5,
    runtimeContext: { browserVerificationProviders: { "test-browser": async (received) => {
      factoryInput = received;
      return new Promise(() => {});
    } } },
  }), (error) => error.code === E_BROWSER_VERIFICATION_TIMEOUT);
  assert.equal(factoryInput.signal.aborted, true);
  assert.ok(factoryInput.timeoutMs <= 5);
});

test("provider failures are generic and do not leak secrets", async () => {
  await assert.rejects(() => runBrowserVerification({ ...input,
    runtimeContext: { browserVerificationProviders: { "test-browser": { id: "test-browser", verify() {
      throw new Error("token=super-secret Cookie: session=abc Authorization: Bearer xyz /Users/private/signed-url");
    } } } },
  }), (error) => {
    assert.equal(error.code, E_BROWSER_VERIFICATION_PROVIDER_UNAVAILABLE);
    assert.doesNotMatch(error.message, /super-secret|session=abc|Bearer xyz|Users\/private/);
    assert.doesNotMatch(JSON.stringify(error.details), /super-secret|session=abc|Bearer xyz|Users\/private/);
    return true;
  });
});
