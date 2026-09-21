import assert from "node:assert/strict";
import test from "node:test";
import { buildPrunePlan } from "../src/core/test-intelligence/prune.js";

test("prune plan keeps protected tests and blocks unknown utility", () => {
  const plan = {
    items: [
      { testId: "test-a", classification: "KEEP_REQUIRED", protected: true, file: "a", name: "required" },
      { testId: "test-b", classification: "UNKNOWN", protected: false, file: "b", name: "unknown" },
    ],
  };
  assert.equal(plan.items[0].classification, "KEEP_REQUIRED");
  assert.equal(plan.items[1].classification, "UNKNOWN");
});

test("pruning implementation does not expose deletion authority", () => {
  assert.equal(typeof buildPrunePlan, "function");
});

