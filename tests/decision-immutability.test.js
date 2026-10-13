import { ensureFixtureTask } from "./helpers/native-storage-fixture.js";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { getPackageRoot } from "../src/core/templates.js";
import { buildDecisionArtifact, writeDecisionArtifact } from "../src/core/decision/artifact.js";
import { getQuestionSet } from "../src/core/decision/question-registry.js";

function artifact(decisionId) {
  const questionSet = getQuestionSet("context-v1");
  return buildDecisionArtifact({
    taskId: "decision-immutable-task",
    decisionId,
    decisionKind: "CONTEXT_PLAN",
    questionSetId: questionSet.id,
    questionSetVersion: questionSet.version,
    questionSetFingerprint: questionSet.fingerprint,
    stateFingerprint: "a".repeat(64),
    policyFingerprint: "b".repeat(64),
    answers: Object.fromEntries(Object.keys(questionSet.questions).map((key) => [key, { noul: "no" }])),
    confidence: Object.fromEntries(Object.keys(questionSet.questions).map((key) => [key, 0.9])),
    decision: { needs: {} },
    usage: { inputTokens: 1, outputTokens: 1, reportedBy: "PROVIDER" },
  });
}

test("semantic decision IDs are immutable and supersession must use a new ID", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-decision-immutable-"));
  const packageRoot = getPackageRoot();
  await ensureFixtureTask(target, "decision-immutable-task", packageRoot);
  await writeDecisionArtifact(target, "decision-immutable-task", "context-plan-0001", artifact("context-plan-0001"), packageRoot, { taskId: "decision-immutable-task" });
  await assert.rejects(
    () => writeDecisionArtifact(target, "decision-immutable-task", "context-plan-0001", artifact("context-plan-0001"), packageRoot, { taskId: "decision-immutable-task" }),
    (error) => error.code === "E_DECISION_IMMUTABLE",
  );
  await writeDecisionArtifact(target, "decision-immutable-task", "context-plan-0002", artifact("context-plan-0002"), packageRoot, { taskId: "decision-immutable-task" });
});

