import assert from "node:assert/strict";
import test from "node:test";

import { createTypesafeClient, validateTypesafeCredential } from "../src/adapters/typesafe/client.js";
import { normalizeDecisionPolicy } from "../src/core/decision/policy.js";

test("TypeSafe credentials reject whitespace, controls, and unreasonable lengths without echoing values", () => {
  assert.throws(() => validateTypesafeCredential(" key"), (error) => error.code === "E_DECISION_ENGINE_AUTH_INVALID");
  assert.throws(() => validateTypesafeCredential("key\nvalue"), (error) => error.code === "E_DECISION_ENGINE_AUTH_INVALID");
  assert.throws(() => validateTypesafeCredential("x".repeat(4097)), (error) => error.code === "E_DECISION_ENGINE_AUTH_INVALID");
  assert.throws(() => createTypesafeClient(normalizeDecisionPolicy(), { env: { TYPESAFE_API_KEY: "key\rvalue" } }), (error) => error.code === "E_DECISION_ENGINE_AUTH_INVALID");
});

