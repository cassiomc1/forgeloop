import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runTaskCreate } from "../src/commands/task-create.js";
import { runTaskList } from "../src/commands/task-list.js";
import { CONTRACT_PRESET_IDS, createPresetContract } from "../src/core/contract-presets.js";
import { validateContract } from "../src/core/contract.js";
import { getPackageRoot } from "../src/core/templates.js";

const packageRoot = getPackageRoot();

test("all contract presets are schema-valid and deterministic", async () => {
  for (const preset of CONTRACT_PRESET_IDS) {
    const first = createPresetContract({ taskId: `preset-${preset}`, preset, claims: ["src"] });
    const second = createPresetContract({ taskId: `preset-${preset}`, preset, claims: ["src"] });
    assert.deepEqual(first, second);
    await validateContract(first, packageRoot);
  }
  const release = createPresetContract({ taskId: "preset-release", preset: "release", claims: ["package.json"] });
  assert.equal(release.successCriteria[0].type, "PUBLICATION");
  assert.equal(release.successCriteria[0].requiredPublicationStatus, "published");
  const incomplete = createPresetContract({ taskId: "preset-incomplete", preset: "feature" });
  assert.ok(incomplete.unresolvedDecisions.length > 0);
});

test("task-create preset preview validates scope but creates no lifecycle state", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-preset-preview-"));
  try {
    const result = await runTaskCreate({
      target,
      packageRoot,
      taskId: "preview-feature",
      claims: ["src"],
      preset: "feature",
      preview: true,
    });
    assert.equal(result.preview, true);
    assert.equal(result.createsLifecycleState, false);
    assert.equal(result.contract.taskId, "preview-feature");
    await assert.rejects(access(path.join(target, ".forgeloop")));
    await assert.rejects(access(path.join(target, ".forgeloop", "task-state")));
    assert.equal((await runTaskList({ target, packageRoot })).tasks.length, 0);
  } finally {
    await rm(target, { recursive: true, force: true });
  }
});

test("task-create preview does not acquire, remove, or rename an existing claims lock", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-preset-preview-lock-"));
  const lockPath = path.join(target, ".forgeloop", ".claims.lock");
  try {
    await mkdir(path.dirname(lockPath), { recursive: true });
    await writeFile(lockPath, `${JSON.stringify({
      lockId: "stale-preview-lock",
      scope: "claims-reservation",
      operation: "fixture",
      ownerInstanceId: "fixture-owner",
      acquiredAt: "1970-01-01T00:00:00.000Z",
      heartbeatAt: "1970-01-01T00:00:00.000Z",
      leaseMs: 1,
    })}\n`, "utf8");
    const before = await readFile(lockPath);

    const result = await runTaskCreate({
      target,
      packageRoot,
      taskId: "preview-with-lock",
      claims: ["src"],
      preset: "feature",
      preview: true,
    });

    assert.equal(result.preview, true);
    assert.deepEqual(await readFile(lockPath), before);
    assert.deepEqual(await readdir(path.join(target, ".forgeloop")), [".claims.lock"]);
    await assert.rejects(access(path.join(target, ".forgeloop", "task-state")));
  } finally {
    await rm(target, { recursive: true, force: true });
  }
});

test("task-create preset writes the same validated contract used by preview", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-preset-create-"));
  try {
    const result = await runTaskCreate({ target, packageRoot, taskId: "created-bug", claims: ["src"], preset: "bug" });
    assert.equal(result.contractCopied, true);
    const listed = await runTaskList({ target, packageRoot });
    assert.equal(listed.tasks.length, 1);
    assert.equal(listed.tasks[0].taskId, "created-bug");
  } finally {
    await rm(target, { recursive: true, force: true });
  }
});

test("task-list provides stable bounded pagination and active filtering", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-task-list-bounds-"));
  try {
    for (const taskId of ["list-a", "list-b", "list-c"]) {
      await runTaskCreate({ target, packageRoot, taskId, claims: [`src/${taskId}`], preset: "bug" });
    }
    const page = await runTaskList({ target, packageRoot, limit: 1, offset: 1 });
    assert.equal(page.total, 3);
    assert.equal(page.offset, 1);
    assert.equal(page.limit, 1);
    assert.equal(page.hasMore, true);
    assert.deepEqual(page.tasks.map((task) => task.taskId), ["list-b"]);
    const active = await runTaskList({ target, packageRoot, active: true });
    assert.equal(active.total, 3);
    assert.ok(active.tasks.every((task) => task.taskId.startsWith("list-")));
    await assert.rejects(
      () => runTaskList({ target, packageRoot, phase: "NOT_A_PHASE" }),
      (error) => error.code === "E_TASK_PHASE_INVALID",
    );
  } finally {
    await rm(target, { recursive: true, force: true });
  }
});
