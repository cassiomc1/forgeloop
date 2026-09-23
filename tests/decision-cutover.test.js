import assert from "node:assert/strict";
import test from "node:test";
import { assertRequiredDecision, isOfflineSafeOperation, DECISION_CUTOVER_MODE } from "../src/core/decision/cutover.js";

test("mandatory cutover rejects absent or unsupported semantic decisions", () => {
  assert.equal(DECISION_CUTOVER_MODE, "FAIL_CLOSED");
  assert.throws(() => assertRequiredDecision({ operation: "route" }), (error) => error.code === "E_DECISION_REQUIRED");
  assert.throws(() => assertRequiredDecision({ decision: { engine: "other", model: "jev-1.13.0" } }), (error) => error.code === "E_DECISION_MODEL_UNSUPPORTED");
});

test("offline recovery operations remain explicitly safe", () => {
  assert.equal(isOfflineSafeOperation("complete"), true);
  assert.equal(isOfflineSafeOperation("task-recover"), true);
  assert.equal(isOfflineSafeOperation("route"), false);
});

