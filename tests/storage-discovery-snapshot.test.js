import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { rm } from "node:fs/promises";
import { createGitRepository } from "./helpers/git-fixture.js";
import { runTaskCreate } from "../src/commands/task-create.js";
import { discoverTasks, findTaskById } from "../src/core/task-discovery.js";
import { createTaskDescriptor } from "../src/core/task-descriptor.js";
import { getPackageRoot } from "../src/core/templates.js";
import { loadStorageDriver } from "../src/storage/runtime.js";
import { openStorageDatabase, runInTransaction, upsertTask } from "../src/storage/index.js";
import { withOperationalStore, withOperationalReadSnapshot } from "../src/storage/unit-of-work.js";
import { withStorageSnapshot } from "../src/storage/snapshot.js";

test("task-row statement reuse preserves fresh rows and live snapshot rechecks", async () => {
  const target = await createGitRepository("forgeloop-task-query-reuse-");
  const db = openStorageDatabase(path.join(target, "state.sqlite"));
  const descriptor = createTaskDescriptor({ taskId: "query-reuse", writeClaims: [] });
  upsertTask(db, { taskId: descriptor.taskId, descriptor });
  const originalPrepare = db.prepare;
  let preparations = 0;
  db.prepare = function(sql) {
    if (sql === "SELECT * FROM tasks WHERE task_key = ?") preparations++;
    return originalPrepare.call(this, sql);
  };
  try {
    await withOperationalStore({ db, target }, async source => {
      assert.equal(source.taskRow(descriptor.taskKey).descriptor_json, JSON.stringify(descriptor));
      assert.equal(source.taskRow(descriptor.taskKey).task_id, descriptor.taskId);
      assert.equal(preparations, 1);
      await withStorageSnapshot(db, snapshot => withOperationalReadSnapshot({ db: snapshot, target }, async reader => {
        assert.equal(reader.taskRow(descriptor.taskKey).task_id, descriptor.taskId);
      }));
      const changed = { ...descriptor, updatedAt: "2030-01-01T00:00:00.000Z" };
      upsertTask(db, { taskId: descriptor.taskId, descriptor: changed });
      assert.equal(JSON.parse(source.taskRow(descriptor.taskKey).descriptor_json).updatedAt, changed.updatedAt);
      assert.throws(() => source.commit(), { code: "E_STATE_REVISION_CONFLICT" });
      assert.equal(preparations, 1);
    });
    // A snapshot-only observation must query the live connection after its handle closes.
    await withOperationalStore({ db, target }, async source => {
      await withStorageSnapshot(db, snapshot => withOperationalReadSnapshot({ db: snapshot, target }, async reader => {
        assert.equal(reader.taskRow(descriptor.taskKey).task_id, descriptor.taskId);
      }));
      upsertTask(db, { taskId: descriptor.taskId, descriptor: { ...descriptor, updatedAt: "2031-01-01T00:00:00.000Z" } });
      assert.throws(() => source.commit(), { code: "E_STATE_REVISION_CONFLICT" });
      assert.equal(preparations, 1);
    });
    await withOperationalStore({ db, target }, async source => {
      db.prepare("UPDATE tasks SET task_key = ? WHERE task_id = ?").run("f".repeat(64), descriptor.taskId);
      assert.throws(() => source.taskRow("f".repeat(64)), { code: "E_STORAGE_PAYLOAD_MISMATCH" });
    });
  } finally { db.prepare = originalPrepare; db.close(); await rm(target, { recursive: true, force: true }); }
});

test("discovery owns one project snapshot for its catalog and all task projections", async () => {
  const target = await createGitRepository("forgeloop-discovery-snapshot-");
  const packageRoot = getPackageRoot();
  const taskIds = ["catalog-a", "catalog-b", "catalog-c"];
  for (const taskId of taskIds) await runTaskCreate({ target, packageRoot, taskId, claims: [] });
  const filename = path.join(target, ".forgeloop/state.sqlite");
  const db = openStorageDatabase(filename);
  const writer = openStorageDatabase(filename);
  const driver = loadStorageDriver();
  const Original = driver.DatabaseSync;
  const handles = [];
  try {
    const expected = await discoverTasks(target, packageRoot);
    driver.DatabaseSync = function (...args) {
      const handle = new Original(...args);
      handles.push({ db: handle, filename: String(args[0]), options: args[1] });
      return handle;
    };
    await withOperationalStore({ db, target }, async source => {
      const prototype = Object.getPrototypeOf(source);
      const originalRead = prototype.readText;
      let changed = false;
      prototype.readText = function(relativePath) {
        if (!changed && this.target === target && this.db !== db && relativePath.endsWith("/task.json")) {
          changed = true;
          runInTransaction(writer, () => {
            for (const taskId of taskIds) {
              const row = writer.prepare("SELECT descriptor_json, state_json FROM tasks WHERE task_id = ?").get(taskId);
              const descriptor = { ...JSON.parse(row.descriptor_json), updatedAt: "2030-01-01T00:00:00.000Z" };
              upsertTask(writer, { taskId, descriptor, state: row.state_json ? JSON.parse(row.state_json) : null });
            }
            upsertTask(writer, { taskId: "catalog-added", descriptor: createTaskDescriptor({ taskId: "catalog-added", writeClaims: [] }) });
          });
        }
        return originalRead.call(this, relativePath);
      };
      try {
        assert.deepEqual(await discoverTasks(target, packageRoot), expected);
        assert.equal(changed, true);
        assert.throws(() => source.commit(), { code: "E_STATE_REVISION_CONFLICT" });
      } finally { prototype.readText = originalRead; }
    });
    assert.equal(handles.length, 1, "All three task audits must share one owned database copy");
    assert.equal(handles[0].options.readOnly, true);
    assert.throws(() => handles[0].db.prepare("SELECT 1"));
    const current = await discoverTasks(target, packageRoot);
    assert.equal(current.length, 4);
    assert.ok(current.filter(task => taskIds.includes(task.taskId)).every(task => task.updatedAt === "2030-01-01T00:00:00.000Z"));
  } finally {
    driver.DatabaseSync = Original;
    writer.close(); db.close();
    await rm(target, { recursive: true, force: true });
  }
});

test("nested storage snapshots reuse only an active module-owned readonly copy", async () => {
  const target = await createGitRepository("forgeloop-snapshot-owner-");
  const packageRoot = getPackageRoot();
  await runTaskCreate({ target, packageRoot, taskId: "owner-task", claims: [] });
  const db = openStorageDatabase(path.join(target, ".forgeloop/state.sqlite"));
  let retained;
  try {
    await withStorageSnapshot(db, async outer => {
      retained = outer;
      await withStorageSnapshot(outer, inner => {
        assert.equal(inner, outer);
        assert.throws(() => inner.exec("DELETE FROM tasks"), /readonly/i);
      });
      assert.equal(outer.prepare("SELECT COUNT(*) AS count FROM tasks").get().count, 1);
      await assert.rejects(withStorageSnapshot(outer, async () => { throw new Error("projection failed"); }), /projection failed/);
      assert.equal(outer.prepare("SELECT COUNT(*) AS count FROM tasks").get().count, 1);
    });
    assert.throws(() => retained.prepare("SELECT 1"));
    const externalReadonly = openStorageDatabase(path.join(target, ".forgeloop/state.sqlite"), { readOnly: true });
    try { await withStorageSnapshot(externalReadonly, owned => assert.notEqual(owned, externalReadonly)); }
    finally { externalReadonly.close(); }
  } finally { db.close(); await rm(target, { recursive: true, force: true }); }
});


test("direct native task lookup never expands into project-wide discovery", async () => {
  const target = await createGitRepository("forgeloop-direct-task-lookup-");
  const packageRoot = getPackageRoot();
  for (const taskId of ["direct-selected", "direct-unrelated"]) await runTaskCreate({ target, packageRoot, taskId, claims: [] });
  const db = openStorageDatabase(path.join(target, ".forgeloop/state.sqlite"));
  let prototype;
  let originalCatalog;
  try {
    await withOperationalStore({ db, target }, source => {
      prototype = Object.getPrototypeOf(source);
      originalCatalog = prototype.listTaskKeys;
    });
    prototype.listTaskKeys = () => { throw new Error("Global task discovery is forbidden in direct lookup"); };
    const selected = await findTaskById(target, "direct-selected", packageRoot);
    assert.equal(selected.taskId, "direct-selected");
    assert.equal(selected.healthy, true);
    assert.equal(await findTaskById(target, "direct-missing", packageRoot), null);
  } finally {
    if (prototype) prototype.listTaskKeys = originalCatalog;
    db.close(); await rm(target, { recursive: true, force: true });
  }
});

test("snapshot acquisition does not restart behind independent writes between backup steps", async () => {
  const target = await createGitRepository("forgeloop-snapshot-backup-progress-");
  const filename = path.join(target, "state.sqlite");
  const db = openStorageDatabase(filename);
  const writer = openStorageDatabase(filename);
  const driver = loadStorageDriver();
  const originalBackup = driver.backup;
  let writerUpdates = 0;
  try {
    runInTransaction(db, () => {
      for (let index = 0; index < 500; index++) {
        const taskId = `backup-progress-${index}`;
        upsertTask(db, { taskId, descriptor: createTaskDescriptor({ taskId,
          writeClaims: Array.from({ length: 20 }, (_, claim) => `src/task-${index}/claim-${claim}.js`) }) });
      }
    });
    assert.ok(db.prepare("PRAGMA page_count").get().page_count > 100, "Fixture must require multiple default backup batches");
    driver.backup = (source, destination, options = {}) => originalBackup(source, destination, {
      ...options,
      progress({ remainingPages }) {
        // An independent connection changes the source between unfinished steps.
        // Bound the injected writer so the old implementation terminates and fails.
        if (remainingPages > 0 && writerUpdates < 3) {
          writerUpdates++;
          const descriptor = createTaskDescriptor({ taskId: "backup-progress-0", writeClaims: [], updatedAt: `2030-01-0${writerUpdates}T00:00:00.000Z` });
          upsertTask(writer, { taskId: descriptor.taskId, descriptor });
        }
      },
    });
    await withStorageSnapshot(db, snapshot => {
      assert.equal(snapshot.prepare("SELECT COUNT(*) AS count FROM tasks").get().count, 500);
      assert.equal(snapshot.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
    });
    assert.ok(writerUpdates < 3, "Snapshot must finish before the bounded independent writer exhausts every restart opportunity");
  } finally {
    driver.backup = originalBackup;
    writer.close(); db.close();
    await rm(target, { recursive: true, force: true });
  }
});
