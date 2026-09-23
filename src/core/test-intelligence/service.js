import { taskArtifactPath } from "../task-paths.js";
import { writeJsonArtifact, readJsonArtifact } from "../artifacts.js";
import { withTaskMutation } from "../task-command.js";
import { inventoryTests } from "./inventory.js";
import { buildTestUtilityArtifact } from "./utility.js";
import { canonicalFingerprint } from "../artifacts.js";
import { readWorkState } from "../work-state.js";
import { buildTestUtilityQuestionSet } from "../decision/question-registry.js";
import { ensureSemanticDecision } from "../decision/service.js";
import { batchTests, buildTestSemanticState } from "./semantic-state.js";

export async function runTestInventory({ projectRoot = process.cwd() } = {}) { return inventoryTests(projectRoot); }

export async function runTestUtility({ target, packageRoot, taskId, provider = null } = {}) {
  const inventory = await inventoryTests(target);
  const semanticDecisions = [];
  const state = await readWorkState(target, { packageRoot, taskId });
  for (const [index, batch] of batchTests(inventory.tests).entries()) {
    const questionSet = buildTestUtilityQuestionSet(batch);
    semanticDecisions.push(await ensureSemanticDecision({
      target, packageRoot, taskId, provider,
      decisionId: `test-utility-${index}-${canonicalFingerprint(batch.map((test) => test.testId)).slice(0, 16)}`,
      request: {
        decisionKind: "TEST_UTILITY", questionSetId: questionSet.id, questionSet,
        state: { lifecycle: state, ...buildTestSemanticState(batch) },
        candidateIds: batch.map((test) => test.testId),
        candidateSetFingerprint: canonicalFingerprint(batch.map((test) => test.testId)),
      },
    }));
  }
  return withTaskMutation(target, { taskId, packageRoot }, "test-utility", async (ctx) => {
    const artifact = buildTestUtilityArtifact({ taskId: ctx.taskId, inventory, semanticDecisions: semanticDecisions.map((decision) => decision.artifact) });
    const written = await writeJsonArtifact(target, taskArtifactPath(ctx.taskId, "testUtility"), artifact, "test-utility", packageRoot, { taskId: ctx.taskId, operation: "test-utility" });
    return { path: written.path, artifact, inventory };
  });
}

export async function readTestUtility({ target, packageRoot, taskId } = {}) {
  return readJsonArtifact(target, taskArtifactPath(taskId, "testUtility"), "test-utility", packageRoot);
}
