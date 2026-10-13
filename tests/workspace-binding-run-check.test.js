import { readFixtureText, overwriteFixtureText } from "./helpers/native-storage-fixture.js";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { runCheck } from "../src/commands/run-check.js";
import { bindTaskWorkspace } from "../src/core/workspace-binding.js";
import { taskWorkspaceBindingPath } from "../src/core/task-paths.js";
import { getPackageRoot } from "../src/core/templates.js";
import { setupVerifyingTask } from "./helpers/durable-lifecycle.js";
import { createGitRepository } from "./helpers/git-fixture.js";
import { removeTempTree } from "./helpers/rm-safe.js";

const packageRoot = getPackageRoot();

test("run-check refuses to launch verification when the bound worktree drifts", async () => {
  const target = await createGitRepository("forgeloop-workspace-run-check-");
  const taskId = "workspace-run-check-001";
  const marker = `${target}/verification-must-not-run.txt`;
  try {
    await setupVerifyingTask(target, packageRoot, { taskId });
    await bindTaskWorkspace(target, { taskId, packageRoot });
    const bindingPath = taskWorkspaceBindingPath(taskId);
    const binding = JSON.parse(await readFixtureText(target, bindingPath));
    binding.workspaceIdentity = "e".repeat(64);
    await overwriteFixtureText(target, bindingPath, `${JSON.stringify(binding)}\n`);

    await assert.rejects(
      () => runCheck({
        target,
        packageRoot,
        taskId,
        id: "workspace-check",
        requirement: "workspace binding remains valid",
        argv: [process.execPath, "-e", `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "ran")`],
      }),
      (error) => error.code === "E_WORKSPACE_BINDING_MISMATCH",
    );
    await assert.rejects(() => readFile(marker), { code: "ENOENT" });
  } finally {
    await removeTempTree(target);
  }
});
