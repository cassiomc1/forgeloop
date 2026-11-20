import assert from "node:assert/strict";
import test from "node:test";

import { completionRelationshipErrors, failedVerificationPlanErrors } from "../src/core/completion-relationships.js";

// Protocol core invariant 4.1.5 (docs/PROTOCOL_SPEC.md): a contract
// verification item whose latest bound check failed or was blocked rejects
// completion; a later passing run supersedes it.

const contract = {
  taskId: "verification-failed",
  verification: [
    { id: "verify-prepush", text: "npm run verify:prepush passes", type: "VERIFICATION" },
    "unit tests pass",
    { id: "ship", text: "release is published", type: "PUBLICATION" },
  ],
};

function check(id, requirement, status, timestamp) {
  return { id, requirement, status, evidenceKind: "OBSERVED", provenance: "FORGELOOP_EXECUTED", timestamp };
}

test("a failed check bound by verification id rejects completion", () => {
  const errors = failedVerificationPlanErrors(contract, [
    check("verify-prepush", "npm run verify:prepush passes", "failed", "2026-11-20T00:00:00.000Z"),
  ]);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, "E_CHECK_FAILED");
  assert.equal(errors[0].requirementId, "verify-prepush");
  assert.equal(errors[0].checkId, "verify-prepush");
});

test("a failed check bound by requirement text rejects completion, including string items", () => {
  const errors = failedVerificationPlanErrors(contract, [
    check("tests-run", "unit tests pass", "blocked", "2026-11-20T00:00:00.000Z"),
  ]);
  assert.deepEqual(errors.map((error) => error.code), ["E_CHECK_FAILED"]);
  assert.match(errors[0].message, /blocked check \(tests-run\)/u);
});

test("a later passing run supersedes the failure", () => {
  const errors = failedVerificationPlanErrors(contract, [
    check("verify-prepush", "npm run verify:prepush passes", "failed", "2026-11-20T00:00:00.000Z"),
    check("verify-prepush", "npm run verify:prepush passes", "passed", "2026-11-20T01:00:00.000Z"),
  ]);
  assert.deepEqual(errors, []);
});

test("items without checks and non-verification items are left to other rules", () => {
  assert.deepEqual(failedVerificationPlanErrors(contract, []), []);
  assert.deepEqual(failedVerificationPlanErrors(contract, [
    check("ship-check", "release is published", "failed", "2026-11-20T00:00:00.000Z"),
  ]), []);
  assert.deepEqual(failedVerificationPlanErrors({ taskId: "x" }, [check("a", "b", "failed")]), []);
});

test("the completion validator reports the failed verification check", () => {
  const errors = completionRelationshipErrors({
    contract: { value: contract },
    receipt: {
      taskId: contract.taskId,
      checks: [check("verify-prepush", "npm run verify:prepush passes", "failed", "2026-11-20T00:00:00.000Z")],
    },
  });
  assert.ok(errors.some((error) => error.code === "E_CHECK_FAILED" && error.requirementId === "verify-prepush"));
});
