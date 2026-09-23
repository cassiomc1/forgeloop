import assert from "node:assert/strict";
import test from "node:test";

import { normalizeTypesafeResult } from "../src/adapters/typesafe/normalize.js";
import { buildExecutionProfileQuestionSet } from "../src/core/decision/question-registry.js";

const REAL_SYSTEM_ONE_ANSWERS = {
  model: "jev-1.13.0",
  answers: {
    recommended_depth: { type: "choice", choice: "full", confidence: 0.43, probabilities: { light: 0.2, balanced: 0.37, full: 0.43 } },
    needs_broad_context: { type: "noul", noul: 0.68 },
    needs_deep_review: { type: "noul", noul: 0.68 },
    high_ambiguity: { type: "noul", noul: 0.5 },
    cross_component_reasoning: { type: "noul", noul: 0.5 },
  },
  usage: { input_tokens: 353, output_tokens: 57 },
};

test("real provider responses translate per-answer confidence into the canonical map", () => {
  const result = normalizeTypesafeResult(REAL_SYSTEM_ONE_ANSWERS, buildExecutionProfileQuestionSet());
  assert.equal(result.model, "jev-1.13.0");
  assert.equal(result.confidence.recommended_depth, 0.43);
  assert.equal(result.confidence.needs_broad_context, 0.68);
  assert.equal(result.usage.inputTokens, 353);
  assert.equal(result.decision.recommendedProfile, "full");
});

test("provider-reported top-level confidence remains authoritative when present", () => {
  const result = normalizeTypesafeResult(
    { ...REAL_SYSTEM_ONE_ANSWERS, confidence: { recommended_depth: 0.9 } },
    buildExecutionProfileQuestionSet(),
  );
  assert.equal(result.confidence.recommended_depth, 0.9);
});

test("a choice answer without reported confidence fails closed as a malformed result", () => {
  const raw = structuredClone(REAL_SYSTEM_ONE_ANSWERS);
  raw.answers.recommended_depth = { type: "choice", choice: "full" };
  assert.throws(
    () => normalizeTypesafeResult(raw, buildExecutionProfileQuestionSet()),
    (error) => error.code === "E_DECISION_RESULT_INVALID",
  );
});

test("unsupported model fails closed after the confidence translation", () => {
  assert.throws(
    () => normalizeTypesafeResult({ ...REAL_SYSTEM_ONE_ANSWERS, model: "jev-0.0.1" }, buildExecutionProfileQuestionSet()),
    (error) => error.code === "E_DECISION_MODEL_UNSUPPORTED",
  );
});
