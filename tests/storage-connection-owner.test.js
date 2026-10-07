import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers";
import { copyFile, rename, rm, symlink } from "node:fs/promises";
import path from "node:path";
import { createForgeLoopContext, executeForgeLoopCommand } from "../src/integration.js";
import { buildDiagnosisProject } from "./helpers/storage-fixtures.js";
import { withProjectStorage } from "../src/storage/project-boundary.js";

test("persistent runtime reuses one project connection, enforces access modes and rechecks metadata", async () => {
  const target = await buildDiagnosisProject();
  const runtimeContext = createForgeLoopContext({ persistentStorage: true });
  try {
    const options = { runtimeContext };
    const first = await withProjectStorage(target, store => store.db, options);
    const second = await withProjectStorage(target, store => store.db, options);
    assert.equal(first, second);
    const created = await executeForgeLoopCommand({ command: "task-create", projectPath: target, input: { taskId: "warm-write", claims: ["other-path"] }, runtimeContext });
    assert.equal(created.ok, true, JSON.stringify(created));
    assert.equal(await withProjectStorage(target, store => store.db, options), first);
    first.prepare("UPDATE storage_meta SET storage_version = 99 WHERE id = 1").run();
    let ran = false;
    await assert.rejects(withProjectStorage(target, () => { ran = true; }, options), { code: "E_STORAGE_VERSION_UNSUPPORTED" });
    assert.equal(ran, false);
    first.prepare("UPDATE storage_meta SET storage_version = 1 WHERE id = 1").run();
    const readonly = await withProjectStorage(target, store => store.db, { ...options, readOnly: true });
    assert.notEqual(readonly, first);
    assert.throws(() => first.prepare("SELECT 1"));
    assert.throws(() => readonly.prepare("UPDATE storage_meta SET storage_version = 2 WHERE id = 1").run());
    assert.equal(await withProjectStorage(target, store => store.db, { ...options, readOnly: true }), readonly);
    await runtimeContext.close();
    await runtimeContext.close();
    assert.throws(() => readonly.prepare("SELECT 1"));
    await assert.rejects(withProjectStorage(target, () => {}, options), { code: "E_STORAGE_RUNTIME_CLOSED" });
  } finally { await runtimeContext.close(); await rm(target, { recursive: true, force: true }); }
});

test("runtime shutdown drains an admitted lease and refuses new work", async () => {
  const target = await buildDiagnosisProject();
  const runtimeContext = createForgeLoopContext({ persistentStorage: true });
  try {
    let release;
    let started;
    const entered = new Promise(resolve => { started = resolve; });
    const blocked = new Promise(resolve => { release = resolve; });
    const pending = withProjectStorage(target, async store => {
      await assert.rejects(runtimeContext.close(), { code: "E_STORAGE_RUNTIME_CLOSED" });
      started(); await blocked;
      return store.db.prepare("SELECT COUNT(*) AS count FROM tasks").get().count;
    }, { runtimeContext });
    await entered;
    const closing = runtimeContext.close();
    await assert.rejects(withProjectStorage(target, () => {}, { runtimeContext }), { code: "E_STORAGE_RUNTIME_CLOSED" });
    release();
    assert.equal(await pending, 1);
    await closing;
  } finally { await runtimeContext.close(); await rm(target, { recursive: true, force: true }); }
});

test("cached runtime validates a replacement database instead of retaining stale project state", async () => {
  const target = await buildDiagnosisProject();
  const runtimeContext = createForgeLoopContext({ persistentStorage: true });
  try {
    const first = await withProjectStorage(target, store => store.db, { runtimeContext, readOnly: true });
    if (process.platform === "win32") {
      // Windows SQLite handles prohibit renaming an open database. Verify the
      // refusal retains authority, then exercise replacement after shutdown.
      await assert.rejects(rename(path.join(target, ".forgeloop/state.sqlite"), path.join(target, ".forgeloop/retained.sqlite")), { code: "EBUSY" });
      assert.equal(await withProjectStorage(target, store => store.db, { runtimeContext, readOnly: true }), first);
      assert.equal(first.prepare("SELECT COUNT(*) AS count FROM tasks").get().count, 1);
      await runtimeContext.close();
      assert.throws(() => first.prepare("SELECT 1"));
      await copyFile(path.join(target, ".forgeloop/state.sqlite"), path.join(target, ".forgeloop/replacement.sqlite"));
      await rename(path.join(target, ".forgeloop/state.sqlite"), path.join(target, ".forgeloop/retained.sqlite"));
      await rename(path.join(target, ".forgeloop/replacement.sqlite"), path.join(target, ".forgeloop/state.sqlite"));
      const reopenedContext = createForgeLoopContext({ persistentStorage: true });
      try {
        const replacement = await withProjectStorage(target, store => store.db, { runtimeContext: reopenedContext, readOnly: true });
        assert.notEqual(replacement, first);
        assert.equal(replacement.prepare("SELECT COUNT(*) AS count FROM tasks").get().count, 1);
      } finally { await reopenedContext.close(); }
      return;
    }
    await rename(path.join(target, ".forgeloop/state.sqlite"), path.join(target, ".forgeloop/retained.sqlite"));
    await assert.rejects(withProjectStorage(target, () => {}, { runtimeContext }), { code: "E_STORAGE_MIGRATION_REQUIRED" });
    await rename(path.join(target, ".forgeloop/retained.sqlite"), path.join(target, ".forgeloop/state.sqlite"));
    assert.equal(await withProjectStorage(target, store => store.db, { runtimeContext, readOnly: true }), first);
    await copyFile(path.join(target, ".forgeloop/state.sqlite"), path.join(target, ".forgeloop/replacement.sqlite"));
    await rename(path.join(target, ".forgeloop/state.sqlite"), path.join(target, ".forgeloop/retained.sqlite"));
    await rename(path.join(target, ".forgeloop/replacement.sqlite"), path.join(target, ".forgeloop/state.sqlite"));
    const replacement = await withProjectStorage(target, store => store.db, { runtimeContext, readOnly: true });
    assert.notEqual(replacement, first);
    assert.throws(() => first.prepare("SELECT 1"));
    assert.equal(replacement.prepare("SELECT COUNT(*) AS count FROM tasks").get().count, 1);
  } finally { await runtimeContext.close(); await rm(target, { recursive: true, force: true }); }
});

test("runtime refuses a leaked native transaction and reopens a clean connection", async () => {
  const target = await buildDiagnosisProject();
  const runtimeContext = createForgeLoopContext({ persistentStorage: true });
  try {
    let leaked;
    await assert.rejects(withProjectStorage(target, store => {
      leaked = store.db;
      store.db.exec("BEGIN IMMEDIATE");
    }, { runtimeContext }), { code: "E_STORAGE_TRANSACTION_LEAKED" });
    assert.throws(() => leaked.prepare("SELECT 1"));
    const next = await withProjectStorage(target, store => store.db, { runtimeContext });
    assert.notEqual(next, leaked);
    assert.equal(next.isTransaction, false);
  } finally { await runtimeContext.close(); await rm(target, { recursive: true, force: true }); }
});

test("project aliases reuse one connection and shutdown drains path resolution", async () => {
  const target = await buildDiagnosisProject();
  const alias = `${target}-alias`;
  const aliasTarget = path.join(alias, path.basename(target));
  const runtimeContext = createForgeLoopContext({ persistentStorage: true });
  try {
    await symlink(path.dirname(target), alias, "dir");
    const options = { runtimeContext, readOnly: true };
    const first = await withProjectStorage(target, store => store.db, options);
    assert.equal(await withProjectStorage(aliasTarget, store => store.db, options), first);
    const admitted = withProjectStorage(aliasTarget, store => store.db.prepare("SELECT COUNT(*) AS count FROM tasks").get().count, options);
    const closing = runtimeContext.close();
    assert.equal(await admitted, 1);
    await closing;
    assert.throws(() => first.prepare("SELECT 1"));
  } finally { await runtimeContext.close(); await rm(alias, { force: true }); await rm(target, { recursive: true, force: true }); }
});

test("independent warm-runtime work proceeds while another callback awaits external work", async () => {
  const target = await buildDiagnosisProject();
  const runtimeContext = createForgeLoopContext({ persistentStorage: true });
  let release;
  let first;
  let second;
  let timer;
  try {
    let started;
    const entered = new Promise(resolve => { started = resolve; });
    const externalWork = new Promise(resolve => { release = resolve; });
    first = withProjectStorage(target, async store => {
      started();
      await externalWork;
      return store.db.prepare("SELECT COUNT(*) AS count FROM tasks").get().count;
    }, { runtimeContext });
    await entered;
    second = executeForgeLoopCommand({ command: "task-create", projectPath: target, input: { taskId: "parallel-created", claims: ["parallel-path"] }, runtimeContext });
    const result = await Promise.race([
      second,
      new Promise(resolve => { timer = setTimeout(() => resolve("SERIALIZED_EXTERNAL_WORK"), 1000); }),
    ]);
    assert.equal(result?.ok, true, "Independent mutation must not wait for another callback's external operation: " + JSON.stringify(result));
  } finally {
    clearTimeout(timer);
    release?.();
    await Promise.allSettled([first, second]);
    await runtimeContext.close();
    await rm(target, { recursive: true, force: true });
  }
});

test("access-mode transition drains shared leases before closing their handle", async () => {
  const target = await buildDiagnosisProject();
  const runtimeContext = createForgeLoopContext({ persistentStorage: true });
  let release;
  let first;
  let readonly;
  try {
    let started;
    let writable;
    let released = false;
    const entered = new Promise(resolve => { started = resolve; });
    const externalWork = new Promise(resolve => { release = () => { released = true; resolve(); }; });
    first = withProjectStorage(target, async store => {
      writable = store.db;
      started();
      await externalWork;
      return store.db.prepare("SELECT COUNT(*) AS count FROM tasks").get().count;
    }, { runtimeContext });
    await entered;
    const shared = await withProjectStorage(target, store => store.db, { runtimeContext });
    assert.equal(shared, writable);
    readonly = withProjectStorage(target, store => {
      assert.equal(released, true, "Mode change cannot close an in-use writable connection");
      return store.db;
    }, { runtimeContext, readOnly: true });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(writable.prepare("SELECT COUNT(*) AS count FROM tasks").get().count, 1);
    release();
    assert.equal(await first, 1);
    const readHandle = await readonly;
    assert.notEqual(readHandle, writable);
    assert.throws(() => writable.prepare("SELECT 1"));
    assert.throws(() => readHandle.prepare("UPDATE storage_meta SET storage_version = 99 WHERE id = 1").run());
  } finally {
    release?.();
    await Promise.allSettled([first, readonly]);
    await runtimeContext.close();
    await rm(target, { recursive: true, force: true });
  }
});

test("overlapping lease cannot observe another callback's leaked native transaction", async () => {
  const target = await buildDiagnosisProject();
  const runtimeContext = createForgeLoopContext({ persistentStorage: true });
  let release;
  let first;
  try {
    let started;
    const entered = new Promise(resolve => { started = resolve; });
    const blocked = new Promise(resolve => { release = resolve; });
    first = withProjectStorage(target, async store => {
      store.db.exec("BEGIN IMMEDIATE");
      store.db.prepare("UPDATE storage_meta SET storage_version = 99 WHERE id = 1").run();
      started();
      await blocked;
    }, { runtimeContext });
    await entered;
    await assert.rejects(withProjectStorage(target, () => assert.fail("Uncommitted bytes cannot be observed"), { runtimeContext }), { code: "E_STORAGE_TRANSACTION_LEAKED" });
    release();
    await assert.rejects(first, { code: "E_STORAGE_TRANSACTION_LEAKED" });
    const version = await withProjectStorage(target, store => store.db.prepare("SELECT storage_version FROM storage_meta WHERE id = 1").get().storage_version, { runtimeContext });
    assert.equal(version, 1);
  } finally {
    release?.();
    await Promise.allSettled([first]);
    await runtimeContext.close();
    await rm(target, { recursive: true, force: true });
  }
});
