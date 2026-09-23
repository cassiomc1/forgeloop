import assert from "node:assert/strict";
import test from "node:test";
import { projectModelRoute } from "../src/core/model-router/router.js";

test("model routing uses NONE when no generation is required", () => {
  const result = projectModelRoute({ input: { workType: "documentation" } });
  assert.equal(result.floor, "NONE");
  assert.equal(result.resolved, "NONE");
  assert.equal(result.generationRequired, false);
});

test("model routing uses STANDARD for ordinary generation", () => {
  const result = projectModelRoute({ input: { workType: "code", executableChange: true } });
  assert.equal(result.floor, "STANDARD");
  assert.equal(result.resolved, "STANDARD");
  assert.equal(result.generationRequired, true);
});

test("security and architectural signals require PRIMARY", () => {
  const result = projectModelRoute({ input: { workType: "code", risks: ["secrets"], architectureChange: true } });
  assert.equal(result.floor, "PRIMARY");
  assert.equal(result.resolved, "PRIMARY");
});

test("Jev can escalate but cannot lower the deterministic floor", () => {
  const raised = projectModelRoute({
    input: { workType: "code", executableChange: true },
    semanticRecommendation: { tier: "PRIMARY", confidence: 0.91 },
  });
  assert.equal(raised.floor, "STANDARD");
  assert.equal(raised.resolved, "PRIMARY");
  assert.equal(raised.authority, "SEMANTIC_DECISION");
  assert.equal(raised.lifecycleAuthority, false);

  const protectedFloor = projectModelRoute({
    input: { workType: "code", risks: ["secrets"] },
    semanticRecommendation: { tier: "FAST", confidence: 0.99 },
  });
  assert.equal(protectedFloor.floor, "PRIMARY");
  assert.equal(protectedFloor.resolved, "PRIMARY");
});

test("low-confidence Jev recommendation escalates to PRIMARY", () => {
  const result = projectModelRoute({
    input: { workType: "code", executableChange: true },
    semanticRecommendation: { tier: "STANDARD", confidence: 0.31, requiresEscalation: true },
  });
  assert.equal(result.resolved, "PRIMARY");
  assert.ok(result.reasons.includes("JEV_LOW_CONFIDENCE_ESCALATION"));
});

