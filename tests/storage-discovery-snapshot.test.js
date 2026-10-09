import { removeTempTree } from "./helpers/rm-safe.js";
import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { setImmediate as nextTurn } from "node:timers/promises";

import { createGitRepository } from "./helpers/git-fixture.js";
import { runTaskCreate } from "../src/commands/task-create.js";
import { discoverTasks, discoverTaskSummaries, findTaskById } from "../src/core/task-discovery.js";
import { readForgeLoopIntegrationResource } from "../src/core/integration-resources.js";
import { createTaskDescriptor } from "../src/core/task-descriptor.js";
import { getPackageRoot } from "../src/core/templates.js";
import { createForgeLoopContext } from "../src/integration.js";
import { loadStorageDriver } from "../src/storage/runtime.js";
import { openStorageDatabase, runInTransaction, upsertTask } from "../src/storage/index.js";
import { getOperationalStore } from "../src/storage/operational-context.js";
import { withProjectStorage } from "../src/storage/project-boundary.js";
import { withOperationalStore, withOperationalReadSnapshot, withOperationalTransaction } from "../src/storage/unit-of-work.js";
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
  } finally { db.prepare = originalPrepare; db.close(); await removeTempTree(target); }
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
    await removeTempTree(target);
  }
});

test("project task summaries preserve unhealthy ordering, parity, and snapshot CAS", async () => {
  const target = await createGitRepository("forgeloop-discovery-task-summaries-");
  const packageRoot = getPackageRoot();
  const validTaskId = "summary-valid";
  const corruptTaskId = "summary-corrupt";
  const filename = path.join(target, ".forgeloop/state.sqlite");
  let db;
  let writer;
  let prototype;
  let originalRead;
  let changed = false;
  try {
    await runTaskCreate({ target, packageRoot, taskId: validTaskId, claims: [] });
    await runTaskCreate({ target, packageRoot, taskId: corruptTaskId, claims: [] });
    db = openStorageDatabase(filename);
    writer = openStorageDatabase(filename);
    db.prepare("UPDATE tasks SET descriptor_json = ? WHERE task_id = ?").run("{}", corruptTaskId);
    const full = await discoverTasks(target, packageRoot);
    const expected = full.map(task => ({
      taskId: task.taskId,
      healthy: task.healthy !== false,
      phase: task.phase ?? null,
      mutationAllowed: task.mutationAllowed !== false,
    }));
    const invalid = expected.find(task => task.healthy === false);
    assert.ok(invalid, "fixture must contain an unhealthy task");
    assert.equal(invalid.taskId, null, "unhealthy entries must retain null task identity");

    const resource = await readForgeLoopIntegrationResource("project/tasks", { projectPath: target, packageRoot });
    assert.equal(resource.data.count, expected.length);
    assert.deepEqual(resource.data.tasks, expected);
    assert.deepEqual(await discoverTaskSummaries(target, packageRoot), expected);

    await withOperationalStore({ db, target }, async source => {
      prototype = Object.getPrototypeOf(source);
      originalRead = prototype.readText;
      prototype.readText = function(relativePath) {
        if (!changed && this.target === target && this.db !== db && relativePath.endsWith("/task.json")) {
          changed = true;
          upsertTask(writer, {
            taskId: "summary-cas-added",
            descriptor: createTaskDescriptor({ taskId: "summary-cas-added", writeClaims: [] }),
          });
        }
        return originalRead.call(this, relativePath);
      };
      try {
        assert.deepEqual(await discoverTaskSummaries(target, packageRoot), expected);
        assert.equal(changed, true, "summary discovery must read through the owned snapshot");
        assert.throws(() => source.commit(), { code: "E_STATE_REVISION_CONFLICT" });
      } finally { prototype.readText = originalRead; }
    });
  } finally {
    if (prototype) prototype.readText = originalRead;
    writer?.close();
    db?.close();
    await removeTempTree(target);
  }
});

test("read-only discovery does not retain detached observations in its project scope", async () => {
  const target = await createGitRepository("forgeloop-discovery-readonly-retention-");
  const packageRoot = getPackageRoot();
  const taskIds = ["retention-a", "retention-b", "retention-c"];
  try {
    for (const taskId of taskIds) await runTaskCreate({ target, packageRoot, taskId, claims: [] });
    await withProjectStorage(target, async source => {
      await withProjectStorage(target, async () => {
        const nested = getOperationalStore(target);
        assert.equal(nested, source);
        assert.equal(nested.readOnly, true);
        await assert.rejects(
          withOperationalTransaction({ target, taskId: taskIds[0], operation: "read-only-nested-mutation", packageRoot }, () => undefined),
          { code: "E_STORAGE_READ_ONLY" },
        );
      }, { readOnly: false });
      const tasks = await discoverTasks(target, packageRoot);
      assert.deepEqual(tasks.map(task => task.taskId).sort(), taskIds.sort());
      assert.equal(source.readOnly, true);
      assert.equal(source.reads.size, 0, "read-only discovery must release detached observations instead of retaining commit state");
    }, { readOnly: true });
  } finally { await removeTempTree(target); }
});

test("logical read-only scope blocks nested writable access on a writable database", async () => {
  const target = await createGitRepository("forgeloop-discovery-readonly-logical-");
  const packageRoot = getPackageRoot();
  const taskId = "readonly-logical-task";
  const filename = path.join(target, ".forgeloop/state.sqlite");
  let db;
  try {
    await runTaskCreate({ target, packageRoot, taskId, claims: [] });
    db = openStorageDatabase(filename);
    await withOperationalStore({ db, target, readOnly: true }, async source => {
      assert.equal(db.prepare("PRAGMA query_only").get().query_only, 0, "fixture must use a physically writable connection");
      await withProjectStorage(target, async () => {
        const nested = getOperationalStore(target);
        assert.equal(nested, source);
        assert.equal(nested.readOnly, true);
        assert.throws(() => nested.commit(), { code: "E_STORAGE_READ_ONLY" });
        await assert.rejects(
          withOperationalTransaction({ target, taskId, operation: "nested-writable-request", packageRoot }, () => undefined),
          { code: "E_STORAGE_READ_ONLY" },
        );
      }, { readOnly: false });
      assert.equal(source.transaction, null);
      assert.equal(source.writes.size, 0);
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM tasks").get().count, 1);
    });
  } finally {
    db?.close();
    await removeTempTree(target);
  }
});

test("detached read snapshots cannot mutate or commit through a writable parent lease", async () => {
  const target = await createGitRepository("forgeloop-discovery-readonly-lease-");
  const packageRoot = getPackageRoot();
  const taskId = "readonly-lease-task";
  const runtimeContext = createForgeLoopContext({ persistentStorage: true });
  try {
    await runTaskCreate({ target, packageRoot, taskId, claims: [] });
    await withProjectStorage(target, async source => {
      assert.equal(source.readOnly, false);
      await withOperationalReadSnapshot({ db: source.db, target }, async reader => {
        assert.equal(reader.readOnly, true);
        assert.throws(() => reader.commit(), { code: "E_STORAGE_READ_ONLY" });
        await assert.rejects(
          withOperationalTransaction({ target, taskId, operation: "detached-readonly-mutation", packageRoot }, () => undefined),
          { code: "E_STORAGE_READ_ONLY" },
        );
      });
      assert.equal(source.transaction, null);
      assert.equal(source.writes.size, 0);
    }, { runtimeContext });
  } finally {
    await runtimeContext.close();
    await removeTempTree(target);
  }
});

test("nested detached read snapshots retain CAS observations through a writable ancestor", async () => {
  const target = await createGitRepository("forgeloop-discovery-nested-cas-");
  const taskId = "nested-cas-task";
  const descriptor = createTaskDescriptor({ taskId, writeClaims: [] });
  const filename = path.join(target, "state.sqlite");
  const db = openStorageDatabase(filename);
  const writer = openStorageDatabase(filename);
  let outerStore;
  let innerStore;
  try {
    upsertTask(db, { taskId, descriptor });
    await withOperationalStore({ db, target }, async source => {
      await withStorageSnapshot(db, snapshot => withOperationalReadSnapshot({ db: snapshot, target }, async outer => {
        outerStore = outer;
        await withOperationalReadSnapshot({ db: snapshot, target }, async inner => {
          innerStore = inner;
          assert.equal(inner.readOnly, true);
          assert.equal(inner.taskRow(descriptor.taskKey).task_id, taskId);
        });
        assert.equal(innerStore.parent, null, "closed nested snapshot must release its parent chain");
        assert.equal(innerStore.reads.size, 0, "closed nested snapshot must release detached observations");
      }));
      assert.equal(outerStore.parent, null, "closed outer snapshot must release its parent chain");
      assert.equal(outerStore.reads.size, 0, "closed outer snapshot must release detached observations");
      assert.ok(source.reads.size > 0, "nested detached observations must reach the writable ancestor");
      upsertTask(writer, {
        taskId,
        descriptor: { ...descriptor, updatedAt: "2035-01-01T00:00:00.000Z" },
      });
      assert.throws(() => source.commit(), { code: "E_STATE_REVISION_CONFLICT" });
    });
  } finally {
    writer.close();
    db.close();
    await removeTempTree(target);
  }
});

test("native catalog discovery yields while retaining one immutable project snapshot", async () => {
  const target = await createGitRepository("forgeloop-discovery-fairness-");
  const db = openStorageDatabase(path.join(target, "state.sqlite"));
  const writer = openStorageDatabase(path.join(target, "state.sqlite"));
  let prototype;
  let originalRead;
  let scheduled;
  const seen = new Set();
  let observedAtTurn = null;
  try {
    for (let index = 0; index < 64; index++) {
      const taskId = `fair-${String(index).padStart(3, "0")}`;
      upsertTask(db, { taskId, descriptor: createTaskDescriptor({ taskId, writeClaims: [] }) });
    }
    await withOperationalStore({ db, target }, async source => {
      await discoverTasks(target);
      prototype = Object.getPrototypeOf(source);
      originalRead = prototype.readText;
      prototype.readText = function(relativePath) {
        if (this.target === target && this.db !== db && relativePath.endsWith("/task.json")) {
          seen.add(relativePath);
          if (!scheduled) scheduled = nextTurn().then(() => {
            observedAtTurn = seen.size;
            upsertTask(writer, { taskId: "fair-added", descriptor: createTaskDescriptor({ taskId: "fair-added", writeClaims: [] }) });
          });
        }
        return originalRead.call(this, relativePath);
      };
      const tasks = await discoverTasks(target);
      await scheduled;
      assert.ok(observedAtTurn > 0 && observedAtTurn < 64, "Other event-loop work must run before the catalog completes");
      assert.equal(tasks.length, 64, "Concurrent additions must remain outside the owned snapshot");
      assert.ok(tasks.every(task => task.healthy));
      assert.throws(() => source.commit(), { code: "E_STATE_REVISION_CONFLICT" });
    });
  } finally {
    if (prototype) prototype.readText = originalRead;
    await scheduled;
    writer.close(); db.close(); await removeTempTree(target);
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
  } finally { db.close(); await removeTempTree(target); }
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
    db.close(); await removeTempTree(target);
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
    await removeTempTree(target);
  }
});


test("owned immutable snapshot validates each task row once without hiding live commit conflicts", async () => {
  const target = await createGitRepository("forgeloop-task-row-snapshot-");
  const db = openStorageDatabase(path.join(target, "state.sqlite"));
  const descriptor = createTaskDescriptor({ taskId: "snapshot-row-reuse", writeClaims: [] });
  upsertTask(db, { taskId: descriptor.taskId, descriptor });
  try {
    await withOperationalStore({ db, target }, async source => {
      await withStorageSnapshot(db, snapshot => withOperationalReadSnapshot({ db: snapshot, target }, async reader => {
        const prepare = snapshot.prepare;
        let rowReads = 0;
        snapshot.prepare = function(sql) {
          const statement = prepare.call(this, sql);
          if (sql === "SELECT * FROM tasks WHERE task_key = ?") {
            const get = statement.get;
            statement.get = function(...args) { rowReads++; return get.apply(this, args); };
          }
          return statement;
        };
        const admitted = reader.taskRow(descriptor.taskKey);
        assert.equal(admitted.task_id, descriptor.taskId);
        upsertTask(db, { taskId: descriptor.taskId, descriptor: { ...descriptor, updatedAt: "2032-01-01T00:00:00.000Z" } });
        assert.deepEqual(reader.taskRow(descriptor.taskKey), admitted);
        assert.deepEqual(reader.taskRow(descriptor.taskKey), admitted);
        assert.equal(rowReads, 1, "immutable task bytes should be decoded only once");
      }));
      assert.throws(() => source.commit(), { code: "E_STATE_REVISION_CONFLICT" });
    });
    // A failed validation must not admit the row to a subsequent cached read.
    db.prepare("UPDATE tasks SET task_key = ? WHERE task_id = ?").run("f".repeat(64), descriptor.taskId);
    await withStorageSnapshot(db, snapshot => withOperationalReadSnapshot({ db: snapshot, target }, async reader => {
      for (let index = 0; index < 2; index++) {
        assert.throws(() => reader.taskRow("f".repeat(64)), { code: "E_STORAGE_PAYLOAD_MISMATCH" });
      }
    }));
  } finally { db.close(); await removeTempTree(target); }
});
