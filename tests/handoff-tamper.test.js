import assert from "node:assert/strict";
import { readFixtureText, overwriteFixtureText } from "./helpers/native-storage-fixture.js";
import { test } from "node:test";

import { createCanonicalHandoff, readCanonicalHandoff } from "../src/core/handoff.js";
import { taskHandoffPath } from "../src/core/task-paths.js";
import { getPackageRoot } from "../src/core/templates.js";
import { setupVerifyingTask } from "./helpers/durable-lifecycle.js";
import { createGitRepository } from "./helpers/git-fixture.js";
import { removeTempTree } from "./helpers/rm-safe.js";

const packageRoot = getPackageRoot();

test("handoff tampering is rejected without repairing the artifact implicitly", async () => {
  const target = await createGitRepository("forgeloop-handoff-tamper-");
  const taskId = "handoff-tamper-001";
  const handoffId = "handoff-tamper-fixed";
  try {
    await setupVerifyingTask(target, packageRoot, { taskId });
    await createCanonicalHandoff(target, { target, packageRoot, taskId, handoffId, note: "Read-only snapshot" });
    const relativePath = taskHandoffPath(taskId, handoffId);
    const value = JSON.parse(await readFixtureText(target, relativePath));
    value.intent.note = "Changed outside the protocol";
    await overwriteFixtureText(target, relativePath, `${JSON.stringify(value)}\n`);
    await assert.rejects(
      () => readCanonicalHandoff(target, { taskId, handoffId, packageRoot }),
      (error) => error.code === "E_HANDOFF_TAMPERED",
    );
    assert.equal((await readFixtureText(target, relativePath)).includes("Changed outside"), true);
  } finally {
    await removeTempTree(target);
  }
});
