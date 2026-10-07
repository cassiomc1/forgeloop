import { readFixtureText, overwriteFixtureText } from "./helpers/native-storage-fixture.js";
import assert from "node:assert/strict";

import { test } from "node:test";

import { bindTaskWorkspace, resolveWorkspaceBindingStatus, assertWorkspaceBinding, validateWorkspaceBinding } from "../src/core/workspace-binding.js";
import { taskWorkspaceBindingPath } from "../src/core/task-paths.js";
import { runTaskCreate } from "../src/commands/task-create.js";
import { getPackageRoot } from "../src/core/templates.js";
import { createGitRepository } from "./helpers/git-fixture.js";
import { removeTempTree } from "./helpers/rm-safe.js";

const packageRoot = getPackageRoot();

test("workspace binding is immutable and matches the current Git worktree", async () => {
  const target = await createGitRepository("forgeloop-workspace-binding-");
  const taskId = "workspace-binding-001";
  try {
    await runTaskCreate({ target, packageRoot, taskId, claims: ["src"] });
    const first = await bindTaskWorkspace(target, { taskId, packageRoot, now: "2026-08-29T00:00:00.000Z" });
    assert.equal(first.status, "MATCH");
    assert.equal(first.alreadyBound, false);

    const repeated = await bindTaskWorkspace(target, { taskId, packageRoot, now: "2026-08-29T00:01:00.000Z" });
    assert.equal(repeated.alreadyBound, true);
    assert.equal((await resolveWorkspaceBindingStatus(target, { taskId, packageRoot })).status, "MATCH");

    const relativePath = taskWorkspaceBindingPath(taskId);
    const stored = JSON.parse(await readFixtureText(target, relativePath));
    stored.workspaceIdentity = "f".repeat(64);
    await overwriteFixtureText(target, relativePath, `${JSON.stringify(stored)}\n`);
    const status = await resolveWorkspaceBindingStatus(target, { taskId, packageRoot });
    assert.equal(status.status, "MISMATCH");
    await assert.rejects(
      () => assertWorkspaceBinding(target, { taskId, packageRoot, operation: "test mutation" }),
      (error) => error.code === "E_WORKSPACE_BINDING_MISMATCH",
    );
  } finally {
    await removeTempTree(target);
  }
});

test("workspace binding validation rejects secret-bearing identities", async () => {
  await assert.rejects(
    () => validateWorkspaceBinding({
      schemaVersion: 1,
      protocolVersion: 1,
      taskId: "workspace-binding-secret",
      mode: "GIT_WORKTREE",
      repositoryIdentity: "a".repeat(64),
      workspaceIdentity: "b".repeat(64),
      branchAtBind: "main",
      headAtBind: "c".repeat(64),
      boundAt: "2026-08-29T00:00:00.000Z",
      metadata: { token: "ghp_" + "A".repeat(30) },
    }, packageRoot),
    /secret/i,
  );
});
