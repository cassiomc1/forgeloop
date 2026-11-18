import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runSyncPull } from "../src/commands/sync-pull.js";
import { runSyncPush } from "../src/commands/sync-push.js";
import { executeForgeLoopCommand } from "../src/core/command-runtime.js";
import { classifyTasks } from "../src/core/sync/merge.js";
import { getPackageRoot } from "../src/core/templates.js";
import { withProjectStorage } from "../src/storage/project-boundary.js";
import { buildDiagnosisProject, TEST_TASK_ID } from "./helpers/storage-fixtures.js";
import { removeTempTree } from "./helpers/rm-safe.js";

const { Response } = globalThis;
const REPOSITORY = "acme/app";
const REMOTE = "https://sync.example.test/api/sync";
const packageRoot = getPackageRoot();

function fakeRemote(bearer) {
  const store = new Map();
  let version = 0;
  const fetchImpl = async (url, init = {}) => {
    if (init.headers.authorization !== `Bearer ${bearer}`) return Response.json({ error: "A valid sync token is required" }, { status: 401 });
    const repository = new URL(url).searchParams.get("repo");
    const current = store.get(repository);
    if (init.method === "GET") return current ? new Response(current.body, { headers: { etag: `W/${current.etag}` } }) : Response.json({ error: "none" }, { status: 404 });
    const ifMatch = init.headers["if-match"];
    if (init.headers["if-none-match"] === "*" ? current : current?.etag !== ifMatch) return Response.json({ error: "stale" }, { status: 412 });
    const etag = `"v${++version}"`;
    store.set(repository, { body: Buffer.from(init.body), etag });
    return Response.json({ ok: true, etag });
  };
  return { store, fetchImpl };
}

async function setup() {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "forgeloop-merge-state-"));
  const env = { FORGELOOP_SYNC_TOKEN: "s".repeat(40), FORGELOOP_SYNC_KEY: "correct horse battery staple", FORGELOOP_SYNC_STATE_DIR: stateDir };
  return { stateDir, env, remote: fakeRemote(env.FORGELOOP_SYNC_TOKEN) };
}

const push = (target, env, fetchImpl) => withProjectStorage(target, () => runSyncPush({ target, packageRoot, remote: REMOTE, repository: REPOSITORY, env, fetchImpl }), { readOnly: true });
const pull = (target, env, fetchImpl, extra = {}) => runSyncPull({ target, packageRoot, remote: REMOTE, repository: REPOSITORY, writersQuiesced: true, env, fetchImpl, ...extra });
const createTask = async (target, taskId) => {
  const created = await executeForgeLoopCommand({ command: "task-create", projectPath: target, input: { taskId, claims: [] } });
  assert.equal(created.ok, true, JSON.stringify(created));
};
const taskIds = async (target) => {
  const listed = await executeForgeLoopCommand({ command: "task-list", projectPath: target, input: {} });
  assert.equal(listed.ok, true, JSON.stringify(listed));
  return listed.result.tasks.map((task) => task.taskId).sort();
};

test("classification is three-way per task and fails closed without a base", () => {
  const base = { a: "1", b: "1", c: "1", d: "1" };
  const local = { a: "1", b: "2", c: "2", d: "1", e: "9" };
  const remote = { a: "1", b: "1", c: "3", d: "4", f: "8" };
  const plan = classifyTasks({ local, remote, base });
  assert.deepEqual(plan.same, ["a"]);
  assert.deepEqual(plan.take.map((item) => item.taskId), ["d", "f"]);
  assert.deepEqual(plan.keep.map((item) => item.taskId), ["b", "e"]);
  assert.deepEqual(plan.conflicts.map((item) => item.taskId), ["c"]);
  const unbased = classifyTasks({ local: { a: "1", b: "2" }, remote: { a: "1", b: "3", c: "4" } });
  assert.deepEqual(unbased.conflicts.map((item) => [item.taskId, item.reason]), [["b", "differs and no sync base is recorded"]]);
  assert.deepEqual(unbased.take.map((item) => item.taskId), ["c"]);
});

test("sync-pull --merge combines tasks created on two machines and the result can be pushed", async () => {
  const { stateDir, env, remote } = await setup();
  const laptop = await buildDiagnosisProject();
  const desktop = await mkdtemp(path.join(os.tmpdir(), "forgeloop-merge-desktop-"));
  try {
    await push(laptop, env, remote.fetchImpl);
    await pull(desktop, env, remote.fetchImpl);
    await createTask(desktop, "desktop-task");
    await push(desktop, env, remote.fetchImpl);
    await createTask(laptop, "laptop-task");

    const before = await taskIds(laptop);
    const plan = await pull(laptop, env, remote.fetchImpl, { merge: true, dryRun: true, writersQuiesced: false });
    assert.equal(plan.status, "PLANNED");
    assert.equal(plan.base, "recorded");
    assert.deepEqual(plan.take.map((item) => [item.taskId, item.reason]), [["desktop-task", "remote only"]]);
    assert.deepEqual(plan.keep.map((item) => [item.taskId, item.reason]), [["laptop-task", "local only"]]);
    assert.deepEqual(await taskIds(laptop), before, "--dry-run changes nothing");

    const merged = await pull(laptop, env, remote.fetchImpl, { merge: true });
    assert.equal(merged.status, "MERGED");
    assert.equal(merged.restore.active, true);
    assert.deepEqual(await taskIds(laptop), [TEST_TASK_ID, "desktop-task", "laptop-task"].sort());
    for (const taskId of ["desktop-task", "laptop-task"]) {
      const shown = await executeForgeLoopCommand({ command: "task-show", projectPath: laptop, input: { taskId } });
      assert.equal(shown.ok, true, JSON.stringify(shown));
    }
    const pushed = await push(laptop, env, remote.fetchImpl);
    assert.equal(pushed.status, "PUSHED");

    const again = await pull(laptop, env, remote.fetchImpl, { merge: true, dryRun: true, writersQuiesced: false });
    assert.deepEqual([again.take.length, again.keep.length, again.conflicts.length], [0, 0, 0]);
  } finally {
    await removeTempTree(laptop);
    await removeTempTree(desktop);
    await removeTempTree(stateDir);
  }
});

test("a task changed on both machines is a conflict and nothing changes", async () => {
  const { stateDir, env, remote } = await setup();
  const laptop = await buildDiagnosisProject();
  const desktop = await mkdtemp(path.join(os.tmpdir(), "forgeloop-merge-conflict-"));
  try {
    await push(laptop, env, remote.fetchImpl);
    await pull(desktop, env, remote.fetchImpl);
    await createTask(desktop, "shared-task");
    await push(desktop, env, remote.fetchImpl);
    await createTask(laptop, "shared-task");
    const before = await taskIds(laptop);
    const plan = await pull(laptop, env, remote.fetchImpl, { merge: true, dryRun: true, writersQuiesced: false });
    assert.equal(plan.status, "CONFLICT");
    assert.deepEqual(plan.conflicts.map((item) => item.taskId), ["shared-task"]);
    await assert.rejects(pull(laptop, env, remote.fetchImpl, { merge: true }), (error) => error.code === "E_SYNC_MERGE_CONFLICT" && /shared-task/.test(error.message));
    assert.deepEqual(await taskIds(laptop), before);
    await assert.rejects(pull(laptop, env, remote.fetchImpl, { merge: true, writersQuiesced: false }), { code: "E_STORAGE_MIGRATION_QUIESCENCE_REQUIRED" });
    await assert.rejects(pull(laptop, env, remote.fetchImpl, { merge: true, replaceActive: true }), { code: "E_SYNC_CONFIG" });
  } finally {
    await removeTempTree(laptop);
    await removeTempTree(desktop);
    await removeTempTree(stateDir);
  }
});
