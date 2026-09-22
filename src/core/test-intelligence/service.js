import { taskArtifactPath } from "../task-paths.js";
import { writeJsonArtifact, readJsonArtifact } from "../artifacts.js";
import { withTaskMutation } from "../task-command.js";
import { inventoryTests } from "./inventory.js";
import { buildTestUtilityArtifact } from "./utility.js";
import { recordSemanticDecision } from "../decision/service.js";
import { canonicalFingerprint } from "../artifacts.js";
import { readWorkState } from "../work-state.js";

export async function runTestInventory({ projectRoot = process.cwd() } = {}) { return inventoryTests(projectRoot); }

export async function runTestUtility({ target, packageRoot, taskId, provider = null } = {}) {
  const inventory = await inventoryTests(target);
  const semantic = await recordSemanticDecision({
    target,
    packageRoot,
    taskId,
    request: {
      decisionKind: "TEST_UTILITY",
      questionSetId: "test-utility-v1",
      state: await readWorkState(target, { packageRoot, taskId }),
      candidateSetFingerprint: canonicalFingerprint(inventory.tests.map((test) => test.testId)),
    },
    provider,
  });
  return withTaskMutation(target, { taskId, packageRoot }, "test-utility", async (ctx) => {
    const artifact = buildTestUtilityArtifact({ taskId: ctx.taskId, inventory, semanticDecision: semantic.artifact });
    const written = await writeJsonArtifact(target, taskArtifactPath(ctx.taskId, "testUtility"), artifact, "test-utility", packageRoot, { taskId: ctx.taskId, operation: "test-utility" });
    return { path: written.path, artifact, inventory };
  });
}

export async function readTestUtility({ target, packageRoot, taskId } = {}) {
  return readJsonArtifact(target, taskArtifactPath(taskId, "testUtility"), "test-utility", packageRoot);
}
