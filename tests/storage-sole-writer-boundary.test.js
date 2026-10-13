import { removeTempTree } from "./helpers/rm-safe.js";
import assert from "node:assert/strict";
import test from "node:test";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createTaskDescriptor, writeTaskDescriptor, readTaskDescriptor } from "../src/core/task-descriptor.js";
import { createWorkState, writeWorkState, readWorkState, clearWorkState } from "../src/core/work-state.js";
import { clearContinuity } from "../src/core/continuity.js";
import { taskArtifactPath } from "../src/core/task-paths.js";
import { runTaskCreate } from "../src/commands/task-create.js";
import { proposeAction, readAction, listActions, findActionByIdempotencyKey } from "../src/core/actions.js";
import { getPackageRoot } from "../src/core/templates.js";
import { acquireTaskLock, forceUnlockTask, readLockInfo } from "../src/core/task-lock.js";
import { assertFreshOperationalState } from "../src/storage/project-restore.js";
import { writeJsonArtifact, writePortableJsonArtifact } from "../src/core/artifacts.js";

async function project(callback) {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-sole-writer-"));
  try { await callback(target); }
  finally { await removeTempTree(target); }
}

test("direct descriptor and state writers create only canonical SQLite authority", async () => {
  await project(async target => {
    const taskId = "direct-state";
    await writeTaskDescriptor(target, createTaskDescriptor({ taskId, writeClaims: [] }));
    await writeWorkState(target, createWorkState({ taskId, phase: "RECEIVED", contractFingerprint: "0".repeat(64) }));
    assert.equal((await readTaskDescriptor(target, taskId)).taskId, taskId);
    assert.equal((await readWorkState(target, { taskId })).taskId, taskId);
    await access(path.join(target, ".forgeloop/state.sqlite"));
    await assert.rejects(access(path.join(target, ".forgeloop/task-state")), { code: "ENOENT" });
    await assert.rejects(access(path.join(target, ".forgeloop/work-state.json")), { code: "ENOENT" });
  });
});

test("portable output cannot recreate retired transaction staging or block native admission", async () => {
  await project(async target => {
    const taskId = "retired-staging";
    const state = createWorkState({ taskId, phase: "RECEIVED", contractFingerprint: "0".repeat(64) });
    for (const native of [false, true]) {
      if (native) await runTaskCreate({ target, packageRoot: getPackageRoot(), taskId, claims: [] });
      for (const relative of [".forgeloop/.txn/manifest.json", ".forgeloop/.TXN/manifest.json", ".forgeloop/./.txn/manifest.json"]) {
        await assert.rejects(writePortableJsonArtifact(target, relative, state, "work-state"), { code: "E_STORAGE_OPERATION_UNSUPPORTED" });
      }
      await assert.rejects(access(path.join(target, ".forgeloop/.txn")), { code: "ENOENT" });
      if (native) assert.equal((await readTaskDescriptor(target, taskId)).taskId, taskId);
      else await assert.rejects(access(path.join(target, ".forgeloop/state.sqlite")), { code: "ENOENT" });
    }
  });
});

test("direct operational writers refuse legacy authority without converting or altering it", async () => {
  await project(async target => {
    await mkdir(path.join(target, ".forgeloop"));
    const filename = path.join(target, ".forgeloop/work-state.json");
    const bytes = "retained legacy evidence\n";
    await writeFile(filename, bytes);
    await assert.rejects(writeTaskDescriptor(target, createTaskDescriptor({ taskId: "refused", writeClaims: [] })), { code: "E_STORAGE_MIGRATION_REQUIRED" });
    assert.equal(await readFile(filename, "utf8"), bytes);
    await assert.rejects(access(path.join(target, ".forgeloop/state.sqlite")), { code: "ENOENT" });
  });
});

test("direct action APIs read native records outside command dispatch without legacy directories", async () => {
  await project(async target => {
    const taskId = "direct-actions";
    const packageRoot = getPackageRoot();
    await runTaskCreate({ target, packageRoot, taskId, claims: [] });
    const input = { actionId: "action-direct", effectClass: "EXTERNAL_PUBLICATION", capability: "repository.push", target: "origin/test", operation: "push test", idempotencyKey: "direct:key", provenance: "HOST_REPORTED" };
    await proposeAction(target, { packageRoot, taskId, input });
    assert.equal((await readAction(target, { packageRoot, taskId, actionId: input.actionId })).actionId, input.actionId);
    assert.equal((await listActions(target, { packageRoot, taskId })).length, 1);
    assert.equal((await findActionByIdempotencyKey(target, { packageRoot, taskId, idempotencyKey: input.idempotencyKey })).actionId, input.actionId);
    await assert.rejects(access(path.join(target, ".forgeloop/task-state")), { code: "ENOENT" });
  });
});

test("standalone task reservation remains durable across independent readers and releases without a filesystem lock", async () => {
  await project(async target => {
    const taskId = "standalone-reservation";
    await runTaskCreate({ target, packageRoot: getPackageRoot(), taskId, claims: [] });
    const handle = await acquireTaskLock(target, taskId, "external-observation");
    try {
      assert.equal((await readLockInfo(target, taskId)).lockId, handle.lockData.lockId);
      await assert.rejects(acquireTaskLock(target, taskId, "competing-observation"), { code: "E_TASK_LOCKED" });
      await assert.rejects(access(path.join(target, ".forgeloop/locks")), { code: "ENOENT" });
    } finally { await handle.release(); }
    assert.equal(await readLockInfo(target, taskId), null);
    const next = await acquireTaskLock(target, taskId, "next-observation");
    await next.release();
  });
});

test("releasing an old standalone reservation cannot delete a replacement owner", async () => {
  await project(async target => {
    const taskId = "replacement-reservation";
    await runTaskCreate({ target, packageRoot: getPackageRoot(), taskId, claims: [] });
    const original = await acquireTaskLock(target, taskId, "original-observation");
    let replacement;
    try {
      assert.equal((await forceUnlockTask(target, taskId, { staleOnly: true })).unlocked, false);
      assert.equal((await forceUnlockTask(target, taskId)).unlocked, true);
      replacement = await acquireTaskLock(target, taskId, "replacement-observation");
      assert.equal(await original.release(), false);
      assert.equal((await readLockInfo(target, taskId)).lockId, replacement.lockData.lockId);
    } finally {
      await original.release();
      await replacement?.release();
    }
  });
});

test("bootstrap and restore preserve retained legacy owners before allocating native authority", async () => {
  for (const relativePath of [".forgeloop/.claims.lock", ".forgeloop/locks/retained.json"]) {
    await project(async target => {
      const filename = path.join(target, relativePath);
      await mkdir(path.dirname(filename), { recursive: true });
      const bytes = "retained owner evidence\n";
      await writeFile(filename, bytes);
      await assert.rejects(writeTaskDescriptor(target, createTaskDescriptor({ taskId: "refused-owner", writeClaims: [] })), { code: "E_STORAGE_MIGRATION_REQUIRED" });
      await assert.rejects(assertFreshOperationalState(target), { code: "E_STORAGE_RESTORE_INVALID" });
      assert.equal(await readFile(filename, "utf8"), bytes);
      await assert.rejects(access(path.join(target, ".forgeloop/state.sqlite")), { code: "ENOENT" });
      await assert.rejects(access(path.join(target, ".forgeloop/storage-bootstrap")), { code: "ENOENT" });
    });
  }
});

test("state writes reject portable paths before allocating SQLite or producing a second authority", async () => {
  await project(async target => {
    const state = createWorkState({ taskId: "portable-state", phase: "RECEIVED", contractFingerprint: "0".repeat(64) });
    await assert.rejects(writeWorkState(target, state, { statePath: "portable-state.json" }), { code: "E_STORAGE_OPERATION_UNSUPPORTED" });
    await assert.rejects(access(path.join(target, "portable-state.json")), { code: "ENOENT" });
    await assert.rejects(access(path.join(target, ".forgeloop/state.sqlite")), { code: "ENOENT" });
  });
});

test("canonical clearing preserves unconverted legacy state and continuity", async () => {
  await project(async target => {
    const taskId = "legacy-clearing";
    for (const [kind, clear] of [["state", clearWorkState], ["continuity", clearContinuity]]) {
      const filename = path.join(target, taskArtifactPath(taskId, kind));
      const bytes = `retained ${kind} evidence\n`;
      await mkdir(path.dirname(filename), { recursive: true });
      await writeFile(filename, bytes);
      await assert.rejects(clear(target, { taskId }), { code: "E_STORAGE_MIGRATION_REQUIRED" });
      assert.equal(await readFile(filename, "utf8"), bytes);
      await assert.rejects(access(path.join(target, ".forgeloop/state.sqlite")), { code: "ENOENT" });
    }
  });
});

test("canonical clearing cannot delete an independent portable file or its native checkpoint", async () => {
  await project(async target => {
    const taskId = "portable-clearing";
    await runTaskCreate({ target, packageRoot: getPackageRoot(), taskId, claims: [] });
    await writeWorkState(target, createWorkState({ taskId, phase: "RECEIVED", contractFingerprint: "0".repeat(64) }));
    const filename = path.join(target, "portable-checkpoint.json");
    const bytes = "independent portable evidence\n";
    await writeFile(filename, bytes);
    await assert.rejects(clearWorkState(target, { taskId, statePath: "portable-checkpoint.json" }), { code: "E_STORAGE_OPERATION_UNSUPPORTED" });
    await assert.rejects(clearContinuity(target, { taskId, continuityPath: "portable-checkpoint.json" }), { code: "E_STORAGE_OPERATION_UNSUPPORTED" });
    assert.equal(await readFile(filename, "utf8"), bytes);
    assert.equal((await readWorkState(target, { taskId })).taskId, taskId);
  });
});

test("explicit portable JSON output cannot become canonical authority or overwrite storage metadata", async () => {
  await project(async target => {
    const state = createWorkState({ taskId: "portable-output", phase: "RECEIVED", contractFingerprint: "0".repeat(64) });
    await assert.rejects(writeJsonArtifact(target, "portable-state.json", state, "work-state"), { code: "E_STORAGE_OPERATION_UNSUPPORTED" });
    await writePortableJsonArtifact(target, "portable-state.json", state, "work-state");
    assert.deepEqual(JSON.parse(await readFile(path.join(target, "portable-state.json"), "utf8")), state);
    for (const relativePath of [taskArtifactPath(state.taskId, "state"), ".forgeloop/state.sqlite", ".forgeloop/state.sqlite-wal", ".forgeloop/storage-version.json"]) {
      await assert.rejects(writePortableJsonArtifact(target, relativePath, state, "work-state"), { code: "E_STORAGE_OPERATION_UNSUPPORTED" });
      await assert.rejects(access(path.join(target, relativePath)), { code: "ENOENT" });
    }
  });
});
