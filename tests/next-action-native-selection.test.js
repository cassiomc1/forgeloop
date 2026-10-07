import assert from "node:assert/strict";
import { mkdtemp, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { getNextAction } from "../src/core/next-action.js";
import { getPackageRoot } from "../src/core/templates.js";
import { ensureFixtureTask } from "./helpers/native-storage-fixture.js";
import { removeTempTree } from "./helpers/rm-safe.js";

const packageRoot = getPackageRoot();

test("direct next API selects existing native read authority and rejects ambiguous tasks", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-next-native-"));
  try {
    await ensureFixtureTask(target, "first", packageRoot);
    const explicit = await getNextAction({ target, packageRoot, taskId: "first" });
    assert.deepEqual(await getNextAction(target, packageRoot), explicit);
    assert.deepEqual(await getNextAction({ target, packageRoot }), explicit);
    assert.equal((await readdir(path.join(target, ".forgeloop"))).includes("task-state"), false);
    await ensureFixtureTask(target, "second", packageRoot);
    await assert.rejects(getNextAction(target, packageRoot), { code: "E_TASK_AMBIGUOUS" });
    assert.deepEqual(await getNextAction({ target, packageRoot, taskId: "first" }), explicit);
  } finally { await removeTempTree(target); }
});

test("direct next query of an empty project does not allocate storage", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-next-empty-"));
  try {
    await getNextAction(target, packageRoot);
    assert.deepEqual(await readdir(target), []);
  } finally { await removeTempTree(target); }
});
