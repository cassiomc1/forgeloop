import assert from "node:assert/strict";
import test from "node:test";

import { canonicalFingerprint } from "../src/core/artifacts.js";
import { buildDecisionArtifact } from "../src/core/decision/artifact.js";
import { assertRequiredFreshDecision } from "../src/core/decision/resolver.js";
import { decisionEventDetails } from "../src/core/decision/events.js";
import { getQuestionSet } from "../src/core/decision/question-registry.js";

function fixture() {
  const questionSet = getQuestionSet("model-route-v1");
  const state = { phase: "ROUTED", revision: 4 };
  const artifact = buildDecisionArtifact({
    taskId: "decision-binding-task",
    decisionId: "model-route-0001",
    decisionKind: "MODEL_ROUTE",
    questionSetId: questionSet.id,
    questionSetVersion: questionSet.version,
    questionSetFingerprint: questionSet.fingerprint,
    stateFingerprint: canonicalFingerprint(state),
    policyFingerprint: "a".repeat(64),
    repositoryFingerprint: { branch: "main", head: "b".repeat(64) },
    contractFingerprint: "c".repeat(64),
    routeFingerprint: "d".repeat(64),
    verificationCycle: 1,
    answers: { generation_required: { noul: "yes" }, reasoning_depth: { choice: "STANDARD" } },
    confidence: { generation_required: 0.99, reasoning_depth: 0.99 },
    decision: { tier: "STANDARD", generationRequired: true, confidence: 0.99, requiresEscalation: false },
    usage: { inputTokens: 1, outputTokens: 1, reportedBy: "PROVIDER" },
  });
  const events = [{ taskId: artifact.taskId, event: "SEMANTIC_DECISION_RECORDED", details: decisionEventDetails(artifact) }];
  return { artifact, events, state };
}

test("fresh semantic decisions require the canonical ledger record and exact bindings", () => {
  const { artifact, events, state } = fixture();
  assert.equal(assertRequiredFreshDecision({
    artifact,
    expectedTaskId: artifact.taskId,
    expectedDecisionKind: artifact.decisionKind,
    currentBindings: {
      stateFingerprint: canonicalFingerprint(state),
      repositoryFingerprint: artifact.repositoryFingerprint,
      contractFingerprint: artifact.contractFingerprint,
      routeFingerprint: artifact.routeFingerprint,
      verificationCycle: 1,
      questionSetFingerprint: artifact.questionSetFingerprint,
      policyFingerprint: artifact.policyFingerprint,
      model: artifact.model,
    },
    ledger: events,
  }), artifact);
  assert.throws(() => assertRequiredFreshDecision({ artifact, expectedTaskId: artifact.taskId, currentBindings: { stateFingerprint: "e".repeat(64) }, ledger: events }), (error) => error.code === "E_DECISION_STALE");
  assert.throws(() => assertRequiredFreshDecision({ artifact: { ...artifact, engine: "caller" }, expectedTaskId: artifact.taskId, ledger: events }), (error) => error.code === "E_DECISION_MODEL_UNSUPPORTED");
  assert.throws(() => assertRequiredFreshDecision({ artifact, expectedTaskId: artifact.taskId, ledger: [] }), (error) => error.code === "E_DECISION_LEDGER_INVALID");
});

