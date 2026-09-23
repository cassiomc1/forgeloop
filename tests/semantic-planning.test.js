import assert from "node:assert/strict";
import test from "node:test";
import { projectDiagnosisPriority, projectFailureTriage, projectReviewPlan } from "../src/core/semantic-planning/projection.js";

test("failure triage keeps deterministic candidates and fails toward unknown", () => {
  const result = projectFailureTriage({ input: { message: "request timed out" } });
  assert.equal(result.ranked[0], "timeout");
  assert.equal(result.unknownEscalates, true);
  assert.equal(result.evidenceAuthority, "NONE");
});

test("diagnosis priority deprioritizes previously failed strategies without authorizing action", () => {
  const result = projectDiagnosisPriority({
    input: { error: "lock race", previouslyFailed: ["inspect caller"] },
    semanticRecommendation: ["inspect concurrency path"],
  });
  assert.equal(result.ranked[0], "inspect concurrency path");
  assert.deepEqual(result.previouslyFailed, ["inspect caller"]);
  assert.equal(result.authority, "SEMANTIC_DECISION");
});

test("review plans union deterministic mandatory review requirements", () => {
  const result = projectReviewPlan({ input: { risks: ["secrets"], objective: "public API migration" } });
  assert.ok(result.mandatory.includes("needs_security_review"));
  assert.ok(result.mandatory.includes("needs_api_compatibility_review"));
  assert.ok(result.ranked.includes("needs_full_diff_context"));
});

test("unknown semantic recommendations fail closed", () => {
  assert.throws(() => projectReviewPlan({ semanticRecommendation: ["skip verification"] }), (error) => error.code === "E_DECISION_RESULT_INVALID");
});

