import { taskArtifactPath } from "../task-paths.js";
import { writeJsonArtifact, readJsonArtifact } from "../artifacts.js";
import { withTaskMutation } from "../task-command.js";
import { inventoryTests } from "./inventory.js";
import { buildTestUtilityArtifact } from "./utility.js";

export async function runTestInventory({ projectRoot = process.cwd() } = {}) { return inventoryTests(projectRoot); }

export async function runTestUtility({ target, packageRoot, taskId, semanticStatus = "NOT_REQUESTED" } = {}) {
  return withTaskMutation(target, { taskId, packageRoot }, "test-utility", async (ctx) => {
    const inventory = await inventoryTests(target);
    const artifact = buildTestUtilityArtifact({ taskId: ctx.taskId, inventory, semanticStatus });
    const written = await writeJsonArtifact(target, taskArtifactPath(ctx.taskId, "testUtility"), artifact, "test-utility", packageRoot, { taskId: ctx.taskId, operation: "test-utility" });
    return { path: written.path, artifact, inventory };
  });
}

export async function readTestUtility({ target, packageRoot, taskId } = {}) {
  return readJsonArtifact(target, taskArtifactPath(taskId, "testUtility"), "test-utility", packageRoot);
}

