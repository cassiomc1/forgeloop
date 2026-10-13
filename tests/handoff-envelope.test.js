import assert from "node:assert/strict";
import { readFixtureText, overwriteFixtureText } from "./helpers/native-storage-fixture.js";
import { test } from "node:test";

import { createCanonicalHandoff, listCanonicalHandoffs, readCanonicalHandoff } from "../src/core/handoff.js";
import { bindTaskWorkspace } from "../src/core/workspace-binding.js";
import { taskHandoffPath } from "../src/core/task-paths.js";
import { getPackageRoot } from "../src/core/templates.js";
import { setupVerifyingTask } from "./helpers/durable-lifecycle.js";
import { createGitRepository } from "./helpers/git-fixture.js";
import { removeTempTree } from "./helpers/rm-safe.js";

const packageRoot = getPackageRoot();

test("canonical handoffs are protocol-derived, immutable, and tamper-evident", async () => {
  const target = await createGitRepository("forgeloop-handoff-");
  const taskId = "handoff-001";
  const handoffId = "handoff-fixed-001";
  try {
    await setupVerifyingTask(target, packageRoot, { taskId });
    await bindTaskWorkspace(target, { taskId, packageRoot });
    const created = await createCanonicalHandoff(target, {
      taskId,
      packageRoot,
      handoffId,
      recipientHint: "verification-harness",
      note: "Continue from the canonical snapshot.",
      createdAt: "2026-08-29T00:00:00.000Z",
    });
    assert.equal(created.handoff.taskId, taskId);
    assert.equal((await listCanonicalHandoffs(target, { taskId, packageRoot })).length, 1);
    assert.equal((await readCanonicalHandoff(target, { taskId, handoffId, packageRoot })).value.artifactDigest, created.handoff.artifactDigest);

    await assert.rejects(
      () => createCanonicalHandoff(target, { taskId, packageRoot, handoffId, createdAt: "2026-08-29T00:01:00.000Z" }),
      (error) => error.code === "E_HANDOFF_INVALID",
    );

    const relativePath = taskHandoffPath(taskId, handoffId);
    const tampered = JSON.parse(await readFixtureText(target, relativePath));
    tampered.state.phase = "COMPLETE";
    await overwriteFixtureText(target, relativePath, `${JSON.stringify(tampered)}\n`);
    await assert.rejects(
      () => readCanonicalHandoff(target, { taskId, handoffId, packageRoot }),
      (error) => error.code === "E_HANDOFF_TAMPERED",
    );
  } finally {
    await removeTempTree(target);
  }
});
