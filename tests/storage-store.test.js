import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, mkdir, symlink } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { withStorageSnapshot } from "../src/storage/snapshot.js";

import { canonicalFingerprint } from "../src/core/artifacts.js";
import { eventHash } from "../src/core/events.js";
import { taskStorageKey } from "../src/core/task-identity.js";
import {
  appendEvent,
  backupStorageDatabase,
  restoreStorageDatabase,
  checkStorageIntegrity,
  commitTaskMutation,
  countEvents,
  countTasks,
  CURRENT_ARTIFACT_ID,
  exportDatabase,
  findActionByIdempotencyKey,
  findArtifact,
  findOverlappingClaims,
  findTaskById,
  importProjectState,
  isInTransaction,
  listArtifacts,
  iterateActions,
  listEvents,
  mutateTaskState,
  openStorageDatabase,
  putAction,
  putArtifact,
  putSession,
  readEventTail,
  readLedgerHead,
  readStorageMeta,
  reserveClaims,
  releaseClaims,
  listClaims,
  runInTransaction,
  STORAGE_SCHEMA_VERSION,
  upsertTask,
} from "../src/storage/index.js";

const TIMESTAMP = "2026-09-11T00:00:00.000Z";

test("export rejects oversized manifest identities before filesystem publication", async () => {
  await withTempDir(async directory => {
    const db = openStore(directory);
    try {
      upsertTask(db, { taskId: "manifest-limit", descriptor: makeDescriptor("manifest-limit") });
      const action = { actionId: "x".repeat(100_001), status: "PROPOSED" };
      putAction(db, { taskId: "manifest-limit", action });
      await assert.rejects(exportDatabase(db, path.join(directory, "export")), error => error.code === "JSON_LIMIT_EXCEEDED");
      assert.equal(countTasks(db), 1);
      assert.deepEqual([...iterateActions(db, "manifest-limit")], [action]);
      assert.equal(checkStorageIntegrity(db).ok, true);
    } finally {
      db.close();
    }
  });
});

test("action iteration decodes only requested rows and releases an abandoned cursor", async () => {
  await withTempDir(async directory => {
    const db = openStore(directory);
    try {
      upsertTask(db, { taskId: "lazy-actions", descriptor: makeDescriptor("lazy-actions") });
      putAction(db, { taskId: "lazy-actions", action: { actionId: "a", status: "PROPOSED" } });
      putAction(db, { taskId: "lazy-actions", action: { actionId: "z", status: "PROPOSED" } });
      db.prepare("UPDATE actions SET payload_json = ? WHERE action_id = ?").run("invalid JSON", "z");
      const rows = iterateActions(db, "lazy-actions");
      assert.equal(rows.next().value.actionId, "a");
      assert.throws(() => rows.next(), { code: "E_STORAGE_PAYLOAD_MISMATCH" });
      const partial = iterateActions(db, "lazy-actions");
      assert.equal(partial.next().value.actionId, "a");
      partial.return();
      db.exec("DELETE FROM actions WHERE action_id = 'z'");
      assert.deepEqual([...iterateActions(db, "lazy-actions")].map(row => row.actionId), ["a"]);
    } finally {
      db.close();
    }
  });
});

test("native foreign-key diagnostics are bounded while counting every violation", async () => {
  await withTempDir(async directory => {
    const db = openStore(directory);
    try {
      db.exec("PRAGMA foreign_keys = OFF; CREATE TABLE integrity_parent (id INTEGER PRIMARY KEY); CREATE TABLE integrity_child (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES integrity_parent(id))");
      const insert = db.prepare("INSERT INTO integrity_child VALUES (?, ?)");
      runInTransaction(db, () => {
        for (let index = 1; index <= 257; index += 1) insert.run(index, index);
      });
      db.exec("PRAGMA foreign_keys = ON");
      const findings = checkStorageIntegrity(db);
      assert.equal(findings.ok, false);
      assert.deepEqual(findings.integrity, ["ok"]);
      assert.equal(findings.foreignKeys.length, 100);
      assert.deepEqual(findings.truncatedFindings, { foreignKeys: { total: 257, reported: 100 } });
      assert.ok(findings.foreignKeys.every(row => row.table === "integrity_child"));
      db.exec("DELETE FROM integrity_child");
      const repaired = checkStorageIntegrity(db);
      assert.equal(repaired.ok, true);
      assert.deepEqual(repaired.foreignKeys, []);
      assert.equal(repaired.truncatedFindings, undefined);
    } finally {
      db.close();
    }
  });
});

test("snapshot includes committed WAL data and remains isolated from independent writers", async () => {
  await withTempDir(async directory => {
    const db = openStore(directory);
    let writer;
    try {
      db.exec("PRAGMA wal_autocheckpoint = 0");
      upsertTask(db, { taskId: "snapshot-task", descriptor: makeDescriptor("snapshot-task"), state: { phase: "PLANNED", revision: 1 } });
      writer = openStore(directory);
      await withStorageSnapshot(db, async snapshot => {
        assert.equal(findTaskById(snapshot, "snapshot-task").state.revision, 1);
        upsertTask(writer, { taskId: "snapshot-task", descriptor: makeDescriptor("snapshot-task"), state: { phase: "EXECUTING", revision: 2 } });
        assert.equal(findTaskById(db, "snapshot-task").state.revision, 2);
        assert.equal(findTaskById(snapshot, "snapshot-task").state.revision, 1);
        assert.throws(() => snapshot.exec("DELETE FROM tasks"), /readonly/i);
        const destination = path.join(directory, "export");
        await exportDatabase(snapshot, destination);
        const state = JSON.parse(await readFile(path.join(destination, ".forgeloop/task-state", taskStorageKey("snapshot-task"), "work-state.json"), "utf8"));
        assert.equal(state.revision, 1);
        const taskDirectory = path.join(destination, ".forgeloop/task-state", taskStorageKey("snapshot-task"));
        const manifest = JSON.parse(await readFile(path.join(taskDirectory, "export-manifest.json"), "utf8"));
        assert.deepEqual(manifest.files.map(file => file.path), manifest.included);
        for (const file of manifest.files) {
          const bytes = await readFile(path.join(taskDirectory, file.path));
          assert.equal(file.size, bytes.length);
          assert.equal(file.sha256, createHash("sha256").update(bytes).digest("hex"));
        }
      });
    } finally { writer?.close(); db.close(); }
  });
});

test("export refuses symlinked task destinations and escaped stored artifact identities", async () => {
  await withTempDir(async directory => {
    const db = openStore(directory);
    try {
      const taskId = "export-boundary";
      upsertTask(db, { taskId, descriptor: makeDescriptor(taskId) });
      const destination = path.join(directory, "export");
      const stateRoot = path.join(destination, ".forgeloop/task-state");
      const external = path.join(directory, "outside");
      await mkdir(stateRoot, { recursive: true });
      await mkdir(external);
      await symlink(external, path.join(stateRoot, taskStorageKey(taskId)), process.platform === "win32" ? "junction" : "dir");
      await assert.rejects(exportDatabase(db, destination), /symlink/);
      await rm(path.join(stateRoot, taskStorageKey(taskId)));
      putArtifact(db, { taskId, kind: "gate", artifactId: "../escaped", payload: {} });
      await assert.rejects(exportDatabase(db, destination), { code: "E_STORAGE_EXPORT_IDENTITY" });
      const { readdir } = await import("node:fs/promises");
      assert.deepEqual(await readdir(external), []);
    } finally { db.close(); }
  });
});

test("snapshot refuses an uncommitted source transaction", async () => {
  await withTempDir(async directory => {
    const db = openStore(directory);
    try {
      db.exec("BEGIN IMMEDIATE");
      await assert.rejects(exportDatabase(db, path.join(directory, "export")), { code: "E_STORAGE_SNAPSHOT_TRANSACTION" });
      assert.equal(db.isTransaction, true);
      db.exec("ROLLBACK");
    } finally { db.close(); }
  });
});

async function withTempDir(run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "forgeloop-storage-"));
  try {
    return await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function openStore(directory, name = "state.sqlite") {
  return openStorageDatabase(path.join(directory, name));
}

function makeDescriptor(taskId, writeClaims = []) {
  return {
    schemaVersion: 1,
    protocolVersion: 1,
    taskId,
    taskKey: taskStorageKey(taskId),
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
    writeClaims,
  };
}

function makeEvent(seq, taskId, overrides = {}) {
  return {
    seq,
    schemaVersion: 1,
    protocolVersion: 1,
    taskId,
    event: overrides.event ?? "TASK_RECEIVED",
    at: TIMESTAMP,
    previousHash: seq === 1 ? null : `hash-${seq - 1}`,
    details: {},
    hash: `hash-${seq}`,
    ...overrides,
  };
}

/** Build a filesystem task namespace the importer can consume. */
async function writeTaskNamespace(target, taskId, { events = 1, writeClaims = [], state = true } = {}) {
  const taskKey = taskStorageKey(taskId);
  const directory = path.join(target, ".forgeloop", "task-state", taskKey);
  await mkdir(directory, { recursive: true });
  const descriptor = makeDescriptor(taskId, writeClaims);
  await writeFile(path.join(directory, "task.json"), `${JSON.stringify(descriptor, null, 2)}\n`);
  if (state) {
    const workState = { schemaVersion: 1, protocolVersion: 1, taskId, phase: "RECEIVED", revision: 1, lastUpdated: TIMESTAMP };
    await writeFile(path.join(directory, "work-state.json"), `${JSON.stringify(workState, null, 2)}\n`);
  }
  if (events > 0) {
    const ledger = [];
    let previousHash = null;
    for (let seq = 1; seq <= events; seq += 1) {
      const event = makeEvent(seq, taskId, { previousHash });
      event.hash = eventHash(event);
      previousHash = event.hash;
      ledger.push(JSON.stringify(event));
    }
    await writeFile(path.join(directory, "events.ndjson"), `${ledger.join("\n")}\n`);
  }
  return { taskKey, descriptor, directory };
}

test("opening a store applies WAL, foreign keys, and the schema version", async () => {
  await withTempDir(async (directory) => {
    const db = openStore(directory);
    try {
      const meta = readStorageMeta(db);
      assert.equal(meta.storage_format, "sqlite");
      assert.equal(meta.schema_version, STORAGE_SCHEMA_VERSION);
      assert.equal(db.prepare("PRAGMA journal_mode").get().journal_mode, "wal");
      assert.equal(db.prepare("PRAGMA foreign_keys").get().foreign_keys, 1);
      assert.equal(db.prepare("PRAGMA busy_timeout").get().timeout, 5000);
      // synchronous=FULL (2) preserves the durability the filesystem
      // transaction implementation provided through fsync-before-rename.
      assert.equal(db.prepare("PRAGMA synchronous").get().synchronous, 2);
    } finally {
      db.close();
    }
  });
});

test("reopening an existing store preserves its rows", async () => {
  await withTempDir(async (directory) => {
    const first = openStore(directory);
    upsertTask(first, { taskId: "t1", descriptor: makeDescriptor("t1"), state: { phase: "RECEIVED", revision: 1 } });
    first.close();

    const second = openStore(directory);
    try {
      assert.equal(findTaskById(second, "t1").phase, "RECEIVED");
    } finally {
      second.close();
    }
  });
});

test("task lookup uses the primary key rather than a project-wide scan", async () => {
  await withTempDir(async (directory) => {
    const db = openStore(directory);
    try {
      for (let index = 0; index < 25; index += 1) {
        upsertTask(db, {
          taskId: `task-${index}`,
          descriptor: makeDescriptor(`task-${index}`),
          state: { phase: index % 2 === 0 ? "RECEIVED" : "EXECUTING", revision: 1 },
        });
      }
      const found = findTaskById(db, "task-7");
      assert.equal(found.taskId, "task-7");
      assert.equal(found.phase, "EXECUTING");
      // The plan is a SEARCH using an index, not a full table SCAN: this is the
      // access path that replaces the previous project-wide discovery traversal.
      const plan = db.prepare("EXPLAIN QUERY PLAN SELECT * FROM tasks WHERE task_id = ?").all();
      assert.match(JSON.stringify(plan), /SEARCH tasks USING INDEX/);
      assert.doesNotMatch(JSON.stringify(plan), /SCAN tasks/);
    } finally {
      db.close();
    }
  });
});

test("optimistic concurrency rejects a stale expected revision", async () => {
  await withTempDir(async (directory) => {
    const db = openStore(directory);
    try {
      upsertTask(db, { taskId: "t1", descriptor: makeDescriptor("t1"), state: { phase: "RECEIVED", revision: 1 } });
      const accepted = mutateTaskState(db, { taskId: "t1", expectedRevision: 1, state: { phase: "EXECUTING", revision: 2 } });
      const rejected = mutateTaskState(db, { taskId: "t1", expectedRevision: 1, state: { phase: "VERIFYING", revision: 3 } });
      assert.equal(accepted, true);
      assert.equal(rejected, false);
      assert.equal(findTaskById(db, "t1").phase, "EXECUTING");
    } finally {
      db.close();
    }
  });
});

test("claim reservation is queryable and limited to exact paths", async () => {
  await withTempDir(async (directory) => {
    const db = openStore(directory);
    try {
      upsertTask(db, { taskId: "t1", descriptor: makeDescriptor("t1") });
      upsertTask(db, { taskId: "t2", descriptor: makeDescriptor("t2") });
      reserveClaims(db, { taskId: "t1", claims: ["src/a.js"] });
      reserveClaims(db, { taskId: "t2", claims: ["docs/b.md"] });

      const overlapping = findOverlappingClaims(db, ["src/a.js"]);
      assert.equal(overlapping.length, 1);
      assert.equal(overlapping[0].task_id, "t1");
      // Sibling paths are not exact matches; directory and ancestor overlap
      // remains the caller's responsibility through claimsOverlap().
      assert.equal(findOverlappingClaims(db, ["src/other.js"]).length, 0);
    } finally {
      db.close();
    }
  });
});

test("duplicate action idempotency keys cannot create two accepted actions", async () => {
  await withTempDir(async (directory) => {
    const db = openStore(directory);
    try {
      upsertTask(db, { taskId: "t1", descriptor: makeDescriptor("t1") });
      putAction(db, { taskId: "t1", action: { actionId: "action-1", idempotencyKey: "key-1", status: "PROPOSED" } });
      assert.equal(findActionByIdempotencyKey(db, "t1", "key-1").actionId, "action-1");
      assert.throws(
        () => putAction(db, { taskId: "t1", action: { actionId: "action-2", idempotencyKey: "key-1" } }),
        /UNIQUE constraint failed/,
      );
    } finally {
      db.close();
    }
  });
});

test("events preserve their stored hash and sequence order", async () => {
  await withTempDir(async (directory) => {
    const db = openStore(directory);
    try {
      upsertTask(db, { taskId: "t1", descriptor: makeDescriptor("t1") });
      for (let seq = 1; seq <= 5; seq += 1) {
        appendEvent(db, { taskId: "t1", event: makeEvent(seq, "t1") });
      }
      assert.equal(countEvents(db, "t1"), 5);
      assert.deepEqual(listEvents(db, "t1").map((event) => event.seq), [1, 2, 3, 4, 5]);
      assert.deepEqual(readEventTail(db, "t1", 2).map((event) => event.seq), [4, 5]);
      assert.deepEqual(readLedgerHead(db, "t1"), { seq: 5, hash: "hash-5" });
    } finally {
      db.close();
    }
  });
});

test("artifact fingerprints use the canonical repository function", async () => {
  await withTempDir(async (directory) => {
    const db = openStore(directory);
    try {
      const payload = { b: 2, a: 1 };
      upsertTask(db, { taskId: "t1", descriptor: makeDescriptor("t1") });
      putArtifact(db, { taskId: "t1", kind: "contract", payload });
      assert.deepEqual(findArtifact(db, "t1", "contract"), payload);
      const [artifact] = listArtifacts(db, "t1", "contract");
      assert.equal(artifact.fingerprint, canonicalFingerprint(payload));
      assert.equal(artifact.artifactId, CURRENT_ARTIFACT_ID);
    } finally {
      db.close();
    }
  });
});

test("a failed transaction leaves no partial write", async () => {
  await withTempDir(async (directory) => {
    const db = openStore(directory);
    try {
      upsertTask(db, { taskId: "t1", descriptor: makeDescriptor("t1") });
      appendEvent(db, { taskId: "t1", event: makeEvent(1, "t1") });
      assert.throws(() => {
        runInTransaction(db, () => {
          appendEvent(db, { taskId: "t1", event: makeEvent(2, "t1") });
          throw new Error("simulated failure");
        });
      }, /simulated failure/);
      assert.equal(countEvents(db, "t1"), 1);
      assert.equal(isInTransaction(db), false);
    } finally {
      db.close();
    }
  });
});

test("a state mutation and its audit event commit together", async () => {
  await withTempDir(async (directory) => {
    const db = openStore(directory);
    try {
      upsertTask(db, { taskId: "t1", descriptor: makeDescriptor("t1"), state: { phase: "RECEIVED", revision: 1 } });
      const applied = commitTaskMutation(db, {
        taskId: "t1",
        expectedRevision: 1,
        state: { phase: "EXECUTING", revision: 2 },
        event: makeEvent(1, "t1"),
      });
      assert.equal(applied, true);
      assert.equal(findTaskById(db, "t1").phase, "EXECUTING");
      assert.equal(countEvents(db, "t1"), 1);

      // A revision conflict must not leave the appended event behind.
      const conflicted = commitTaskMutation(db, {
        taskId: "t1",
        expectedRevision: 1,
        state: { phase: "VERIFYING", revision: 3 },
        event: makeEvent(2, "t1"),
      });
      assert.equal(conflicted, false);
      assert.equal(countEvents(db, "t1"), 1);
    } finally {
      db.close();
    }
  });
});

test("nested transactions reuse the active transaction", async () => {
  await withTempDir(async (directory) => {
    const db = openStore(directory);
    try {
      upsertTask(db, { taskId: "t1", descriptor: makeDescriptor("t1") });
      runInTransaction(db, () => {
        assert.equal(isInTransaction(db), true);
        runInTransaction(db, () => appendEvent(db, { taskId: "t1", event: makeEvent(1, "t1") }));
      });
      assert.equal(countEvents(db, "t1"), 1);
    } finally {
      db.close();
    }
  });
});

test("an async transaction callback is rejected rather than awaited", async () => {
  await withTempDir(async (directory) => {
    const db = openStore(directory);
    try {
      upsertTask(db, { taskId: "t1", descriptor: makeDescriptor("t1") });
      assert.throws(
        () => runInTransaction(db, async () => appendEvent(db, { taskId: "t1", event: makeEvent(1, "t1") })),
        (error) => error.code === "E_STORAGE_ASYNC_TRANSACTION",
      );
      assert.equal(countEvents(db, "t1"), 0);
    } finally {
      db.close();
    }
  });
});

test("filesystem state imports with byte-identical events and state", async () => {
  await withTempDir(async (directory) => {
    const source = path.join(directory, "project");
    const { descriptor } = await writeTaskNamespace(source, "task-a", { events: 4, writeClaims: ["src/a.js"] });
    await writeTaskNamespace(source, "task-b", { events: 2 });

    const { db, report } = await importProjectState(source, path.join(directory, "state.sqlite"));
    try {
      assert.equal(report.errors.length, 0);
      assert.equal(report.totals.tasks, 2);
      assert.equal(report.totals.events, 6);
      assert.deepEqual(checkStorageIntegrity(db), { ok: true, integrity: ["ok"], foreignKeys: [], artifactErrors: [], eventErrors: [], attachmentErrors: [] });

      const ledger = await readFile(path.join(source, ".forgeloop", "task-state", descriptor.taskKey, "events.ndjson"), "utf8");
      const sourceEvents = ledger.split("\n").filter(Boolean).map((line) => JSON.parse(line));
      const storedEvents = listEvents(db, "task-a");
      assert.deepEqual(storedEvents, sourceEvents);
      assert.equal(findTaskById(db, "task-a").state.phase, "RECEIVED");
    } finally {
      db.close();
    }
  });
});

test("import aborts rather than publishing a store built from a broken ledger", async () => {
  await withTempDir(async (directory) => {
    const source = path.join(directory, "project");
    const { directory: taskDirectoryPath } = await writeTaskNamespace(source, "task-a", { events: 3 });

    // Break the hash chain of the middle event.
    const ledgerPath = path.join(taskDirectoryPath, "events.ndjson");
    const events = (await readFile(ledgerPath, "utf8")).split("\n").filter(Boolean).map((line) => JSON.parse(line));
    events[1].previousHash = "tampered";
    await writeFile(ledgerPath, `${events.map((event) => JSON.stringify(event)).join("\n")}\n`);

    await assert.rejects(
      () => importProjectState(source, path.join(directory, "broken.sqlite")),
      (error) => {
        assert.equal(error.code, "E_STORAGE_IMPORT_ABORTED");
        assert.ok(error.report.errors.some((entry) => entry.code === "E_LEDGER_HASH_INVALID"));
        return true;
      },
    );
  });
});

test("import aborts on a task key that disagrees with its descriptor", async () => {
  await withTempDir(async (directory) => {
    const source = path.join(directory, "project");
    const { taskKey } = await writeTaskNamespace(source, "task-a", { events: 1 });
    const descriptorPath = path.join(source, ".forgeloop", "task-state", taskKey, "task.json");
    const descriptor = JSON.parse(await readFile(descriptorPath, "utf8"));
    descriptor.taskKey = "0".repeat(64);
    await writeFile(descriptorPath, JSON.stringify(descriptor));

    await assert.rejects(
      () => importProjectState(source, path.join(directory, "mismatch.sqlite")),
      (error) => {
        assert.equal(error.code, "E_STORAGE_IMPORT_ABORTED");
        assert.ok(error.report.errors.some((entry) => entry.code === "E_TASK_KEY_MISMATCH"));
        return true;
      },
    );
  });
});

test("failed project import rolls back previously accepted namespaces and preserves sources", async () => {
  await withTempDir(async (directory) => {
    const source = path.join(directory, "project");
    const first = await writeTaskNamespace(source, "retained-a");
    const second = await writeTaskNamespace(source, "retained-b");
    const sourceBytes = await readFile(path.join(first.directory, "events.ndjson"));
    const later = [first, second].sort((a, b) => a.taskKey.localeCompare(b.taskKey))[1];
    await writeFile(path.join(later.directory, "contract.json"), "invalid JSON");
    const destination = path.join(directory, "aborted.sqlite");
    await assert.rejects(importProjectState(source, destination), { code: "E_STORAGE_IMPORT_ABORTED" });
    const rejected = openStorageDatabase(destination, { readOnly: true });
    try {
      for (const table of ["tasks", "events", "claims", "task_artifacts", "sessions"]) {
        assert.equal(rejected.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, 0);
      }
    } finally { rejected.close(); }
    assert.deepEqual(await readFile(path.join(first.directory, "events.ndjson")), sourceBytes);
  });
});

test("import refuses orphan namespaces and symlinked ledgers", async () => {
  await withTempDir(async (directory) => {
    const orphan = path.join(directory, "orphan");
    await mkdir(path.join(orphan, ".forgeloop/task-state", "0".repeat(64)), { recursive: true });
    await assert.rejects(importProjectState(orphan, path.join(directory, "orphan.sqlite")), error =>
      error.code === "E_STORAGE_IMPORT_ABORTED" && error.report.errors.some(entry => entry.code === "E_TASK_DESCRIPTOR_INVALID"));
    const source = path.join(directory, "symlink");
    const task = await writeTaskNamespace(source, "symlink-ledger", { events: 0 });
    const external = path.join(directory, "external.ndjson");
    await writeFile(external, "");
    await symlink(external, path.join(task.directory, "events.ndjson"));
    await assert.rejects(importProjectState(source, path.join(directory, "symlink.sqlite")), { code: "E_STORAGE_IMPORT_ABORTED" });
  });
});

test("import rejects overlapping ancestor claims across active tasks", async () => {
  await withTempDir(async directory => {
    const source = path.join(directory, "project");
    await writeTaskNamespace(source, "owner", { writeClaims: ["src"] });
    await writeTaskNamespace(source, "descendant", { writeClaims: ["src/module.js"] });
    await assert.rejects(importProjectState(source, path.join(directory, "overlap.sqlite")), error =>
      error.code === "E_STORAGE_IMPORT_ABORTED" && error.report.errors.some(entry => entry.code === "E_TASK_CLAIM_CONFLICT"));
  });
});

test("import refuses an unsupported completion claim release", async () => {
  await withTempDir(async directory => {
    const source = path.join(directory, "project");
    const task = await writeTaskNamespace(source, "false-complete", { writeClaims: ["src"] });
    const statePath = path.join(task.directory, "work-state.json");
    const state = JSON.parse(await readFile(statePath, "utf8"));
    state.phase = "COMPLETE";
    await writeFile(statePath, JSON.stringify(state));
    await assert.rejects(importProjectState(source, path.join(directory, "false-complete.sqlite")), error =>
      error.code === "E_STORAGE_IMPORT_ABORTED" && error.report.errors.some(entry =>
        entry.message.includes("completion proof")));
  });
});

test("import rejects hash-valid lifecycle chronology violations", async () => {
  await withTempDir(async directory => {
    const source = path.join(directory, "project");
    const task = await writeTaskNamespace(source, "chronology", { events: 0 });
    const event = makeEvent(1, "chronology", { event: "EXECUTION_STARTED", previousHash: null });
    event.hash = eventHash(event);
    await writeFile(path.join(task.directory, "events.ndjson"), `${JSON.stringify(event)}\n`);
    await assert.rejects(importProjectState(source, path.join(directory, "chronology.sqlite")), error =>
      error.code === "E_STORAGE_IMPORT_ABORTED" && error.report.errors.some(entry => entry.code === "E_PHASE_CHRONOLOGY_INVALID"));
  });
});

test("import refuses descriptor and state identity substitutions", async () => {
  await withTempDir(async directory => {
    for (const artifact of ["task.json", "work-state.json"]) {
      const source = path.join(directory, artifact);
      const task = await writeTaskNamespace(source, "retained-identity");
      const filename = path.join(task.directory, artifact);
      const payload = JSON.parse(await readFile(filename, "utf8"));
      payload.taskId = "substituted-identity";
      await writeFile(filename, JSON.stringify(payload));
      await assert.rejects(importProjectState(source, path.join(directory, `${artifact}.sqlite`)), error =>
        error.code === "E_STORAGE_IMPORT_ABORTED" && error.report.errors.some(entry =>
          ["E_TASK_KEY_MISMATCH", "E_STORAGE_PAYLOAD_MISMATCH"].includes(entry.code)));
    }
  });
});

test("export reproduces a re-importable bundle that round-trips exactly", async () => {
  await withTempDir(async (directory) => {
    const source = path.join(directory, "project");
    const { descriptor } = await writeTaskNamespace(source, "task-a", { events: 3, writeClaims: ["src/a.js"] });
    await writeTaskNamespace(source, "task-b", { events: 1 });

    const first = await importProjectState(source, path.join(directory, "first.sqlite"));
    const bundle = path.join(directory, "bundle");
    const exported = await exportDatabase(first.db, bundle);
    assert.equal(exported.tasks, 2);

    // The exported bundle is a valid project state root.
    const exportedLedger = await readFile(
      path.join(bundle, ".forgeloop", "task-state", descriptor.taskKey, "events.ndjson"),
      "utf8",
    );
    const originalLedger = await readFile(
      path.join(source, ".forgeloop", "task-state", descriptor.taskKey, "events.ndjson"),
      "utf8",
    );
    assert.equal(exportedLedger, originalLedger);

    const second = await importProjectState(bundle, path.join(directory, "second.sqlite"));
    try {
      assert.equal(second.report.errors.length, 0);
      assert.deepEqual(second.report.totals, first.report.totals);
      assert.equal(
        canonicalFingerprint(findTaskById(second.db, "task-a").state),
        canonicalFingerprint(findTaskById(first.db, "task-a").state),
      );
    } finally {
      second.db.close();
      first.db.close();
    }
  });
});


test("portable export and import retain nested quality, attestation history and evaluations", async () => {
  await withTempDir(async directory => {
    const source = path.join(directory, "source");
    const { descriptor } = await writeTaskNamespace(source, "nested-task", { events: 2 });
    const first = await importProjectState(source, path.join(directory, "first.sqlite"));
    const cases = [
      ["evaluation", "eval-example", "evaluations/eval-example.json"],
      ["structuralQuality", "baseline", "structural-quality/baseline.json"],
      ["structuralQuality", "evaluations/cycle-1-attempt-1", "structural-quality/evaluations/cycle-1-attempt-1.json"],
      ["attestation", "history/cycle-1/statement", "attestations/history/cycle-1/statement.json"],
    ];
    const sourceText = '{ "taskId" : "nested-task", "accepted" : true }\n';
    const destination = path.join(directory, "bundle");
    try {
      for (const [kind, artifactId] of cases) putArtifact(first.db, { taskId: "nested-task", kind, artifactId, payload: JSON.parse(sourceText), sourceText });
      await exportDatabase(first.db, destination);
      const taskDirectory = path.join(destination, ".forgeloop/task-state", descriptor.taskKey);
      const manifest = JSON.parse(await readFile(path.join(taskDirectory, "export-manifest.json"), "utf8"));
      for (const [, , relativePath] of cases) {
        assert.equal(await readFile(path.join(taskDirectory, relativePath), "utf8"), sourceText);
        assert.ok(manifest.included.includes(relativePath));
        assert.equal(manifest.files.find(file => file.path === relativePath).sha256, createHash("sha256").update(sourceText).digest("hex"));
      }
      const second = await importProjectState(destination, path.join(directory, "second.sqlite"));
      try {
        const records = listArtifacts(second.db, "nested-task");
        for (const [kind, artifactId] of cases) assert.equal(records.find(record => record.kind === kind && record.artifactId === artifactId)?.sourceText, sourceText);
      } finally { second.db.close(); }
      putArtifact(first.db, { taskId: "nested-task", kind: "unmappedEvidence", payload: {} });
      await assert.rejects(exportDatabase(first.db, path.join(directory, "unmapped")), { code: "E_STORAGE_EXPORT_UNSUPPORTED" });
      first.db.prepare("DELETE FROM task_artifacts WHERE kind = 'unmappedEvidence'").run();
      putArtifact(first.db, { taskId: "nested-task", kind: "structuralQuality", artifactId: "evaluations/../escaped", payload: {} });
      await assert.rejects(exportDatabase(first.db, path.join(directory, "unsafe")), { code: "E_STORAGE_EXPORT_IDENTITY" });
    } finally { first.db.close(); }
  });
});

test("session snapshot round trip preserves selection and task association and rejects tampered bindings", async () => {
  await withTempDir(async directory => {
    const source = path.join(directory, "source");
    await writeTaskNamespace(source, "session-task", { events: 1 });
    const first = await importProjectState(source, path.join(directory, "first.sqlite"));
    const activation = { schemaVersion: 1, protocolVersion: 1, sessionId: "session-one", activationMarker: "marker-one", createdAt: TIMESTAMP };
    try {
      putSession(first.db, { sessionId: activation.sessionId, taskId: "session-task", activation });
      first.db.prepare("UPDATE storage_meta SET active_session_id = ? WHERE id = 1").run(activation.sessionId);
      const destination = path.join(directory, "export");
      await exportDatabase(first.db, destination);
      const second = await importProjectState(destination, path.join(directory, "second.sqlite"));
      try {
        const row = second.db.prepare("SELECT * FROM sessions").get();
        assert.equal(row.task_id, "session-task");
        assert.deepEqual(JSON.parse(row.activation_json), activation);
        assert.equal(second.db.prepare("SELECT active_session_id FROM storage_meta").get().active_session_id, activation.sessionId);
        assert.equal(second.report.totals.sessions, 1);
      } finally { second.db.close(); }
      await writeFile(path.join(destination, ".forgeloop/session.json"), JSON.stringify({ ...activation, activationMarker: "tampered" }));
      await assert.rejects(importProjectState(destination, path.join(directory, "bad-active.sqlite")), { code: "E_STORAGE_IMPORT_ABORTED" });
      await writeFile(path.join(destination, ".forgeloop/session.json"), JSON.stringify(activation));
      await writeFile(path.join(destination, ".forgeloop/sessions/session-one.json"), JSON.stringify({ ...activation, activationMarker: "tampered" }));
      await assert.rejects(importProjectState(destination, path.join(directory, "bad-binding.sqlite")), { code: "E_STORAGE_IMPORT_ABORTED" });
    } finally { first.db.close(); }
  });
});

test("import refuses an existing destination without modifying its bytes", async () => {
  await withTempDir(async directory => {
    const destination = path.join(directory, "existing.sqlite");
    await writeFile(destination, "preserved destination");
    await assert.rejects(importProjectState(directory, destination), { code: "E_STORAGE_IMPORT_DESTINATION_EXISTS" });
    assert.equal(await readFile(destination, "utf8"), "preserved destination");
  });
});

test("artifact byte evidence preserves noncanonical JSON formatting through export", async () => {
  await withTempDir(async directory => {
    const db = openStore(directory);
    try {
      upsertTask(db, { taskId: "byte-task", descriptor: makeDescriptor("byte-task") });
      const sourceText = '{ "second" : 2, "first": 1 }\n\n';
      putArtifact(db, { taskId: "byte-task", kind: "contract", payload: JSON.parse(sourceText), sourceText });
      const [record] = listArtifacts(db, "byte-task", "contract");
      const { artifactByteDigest } = await import("../src/storage/artifact-bytes.js");
      const { createHash } = await import("node:crypto");
      assert.equal(artifactByteDigest(record), createHash("sha256").update(sourceText).digest("hex"));
      const destination = path.join(directory, "export");
      await exportDatabase(db, destination);
      assert.equal(await readFile(path.join(destination, ".forgeloop/task-state", taskStorageKey("byte-task"), "contract.json"), "utf8"), sourceText);
    } finally {
      db.close();
    }
  });
});

test("tampered artifact source bytes fail integrity and export", async () => {
  await withTempDir(async directory => {
    const db = openStore(directory);
    try {
      upsertTask(db, { taskId: "byte-task", descriptor: makeDescriptor("byte-task") });
      putArtifact(db, { taskId: "byte-task", kind: "contract", payload: { first: 1 } });
      db.prepare("UPDATE task_artifacts SET source_json = ? WHERE task_id = ?").run('{"first":2}', "byte-task");
      const integrity = checkStorageIntegrity(db);
      assert.equal(integrity.ok, false);
      assert.equal(integrity.artifactErrors[0].code, "E_STORAGE_ARTIFACT_INVALID");
      await assert.rejects(exportDatabase(db, path.join(directory, "export")), { code: "E_STORAGE_ARTIFACT_INVALID" });
    } finally {
      db.close();
    }
  });
});

test("database backup includes committed WAL data and never overwrites a retained backup", async () => {
  await withTempDir(async directory => {
    const db = openStorageDatabase(path.join(directory, "live.sqlite"));
    try {
      db.exec("PRAGMA wal_autocheckpoint = 0");
      upsertTask(db, { taskId: "backup-task", taskKey: taskStorageKey("backup-task"), descriptor: { taskId: "backup-task", taskKey: taskStorageKey("backup-task") } });
      const destination = path.join(directory, "backup.sqlite");
      const result = await backupStorageDatabase(db, destination);
      assert.equal(result.attachmentsIncluded, false);
      const restored = openStorageDatabase(destination, { readOnly: true });
      try { assert.equal(findTaskById(restored, "backup-task").taskId, "backup-task"); }
      finally { restored.close(); }
      const retained = await readFile(destination);
      const restorePath = path.join(directory, "restored.sqlite");
      const restoredResult = await restoreStorageDatabase(destination, restorePath);
      assert.equal(restoredResult.restored, true);
      const restoredDb = openStorageDatabase(restorePath, { readOnly: true });
      try { assert.equal(findTaskById(restoredDb, "backup-task").taskId, "backup-task"); }
      finally { restoredDb.close(); }
      await assert.rejects(restoreStorageDatabase(destination, restorePath), { code: "EEXIST" });
      await assert.rejects(backupStorageDatabase(db, destination), { code: "EEXIST" });
      assert.deepEqual(await readFile(destination), retained);
      db.exec("BEGIN IMMEDIATE");
      await assert.rejects(backupStorageDatabase(db, path.join(directory, "uncommitted.sqlite")), { code: "E_STORAGE_SNAPSHOT_TRANSACTION" });
      db.exec("ROLLBACK");
    } finally { db.close(); }
  });
});

test("backup rejects tampered canonical events despite valid SQLite pages", async () => {
  await withTempDir(async directory => {
    const source = path.join(directory, "source");
    await writeTaskNamespace(source, "ledger-backup", { events: 2 });
    const { db } = await importProjectState(source, path.join(directory, "state.sqlite"));
    try {
      assert.equal(checkStorageIntegrity(db).ok, true);
      db.prepare("UPDATE events SET event_type = 'TAMPERED' WHERE seq = 1").run();
      const result = checkStorageIntegrity(db);
      assert.equal(result.ok, false);
      assert.equal(result.eventErrors[0].code, "E_LEDGER_HASH_INVALID");
      await assert.rejects(backupStorageDatabase(db, path.join(directory, "backup.sqlite")), { code: "E_STORAGE_BACKUP_INVALID" });
    } finally { db.close(); }
  });
});

test("opening a current store needs no migration writer reservation", async () => {
  await withTempDir(async directory => {
    const filename = path.join(directory, "state.sqlite");
    const writer = openStorageDatabase(filename);
    writer.exec("BEGIN IMMEDIATE");
    let observer;
    try {
      observer = openStorageDatabase(filename, { busyTimeoutMs: 0 });
      assert.equal(readStorageMeta(observer).schema_version, STORAGE_SCHEMA_VERSION);
    } finally { observer?.close(); writer.exec("ROLLBACK"); writer.close(); }
  });
});

test("artifact fingerprint tampering rejects audit and portable export", async () => {
  await withTempDir(async directory => {
    const db = openStorageDatabase(path.join(directory, "state.sqlite"));
    try {
      upsertTask(db, { taskId: "fingerprint-task", taskKey: taskStorageKey("fingerprint-task"), descriptor: { taskId: "fingerprint-task", taskKey: taskStorageKey("fingerprint-task") } });
      putArtifact(db, { taskId: "fingerprint-task", kind: "contract", payload: {} });
      db.prepare("UPDATE task_artifacts SET fingerprint = ?").run("0".repeat(64));
      assert.equal(checkStorageIntegrity(db).ok, false);
      await assert.rejects(exportDatabase(db, path.join(directory, "export")), { code: "E_STORAGE_ARTIFACT_INVALID" });
    } finally { db.close(); }
  });
});

test("opening a future storage schema fails without downgrading metadata", async () => {
  await withTempDir(async directory => {
    const databasePath = path.join(directory, "state.sqlite");
    const db = openStorageDatabase(databasePath);
    db.prepare("UPDATE storage_meta SET schema_version = ? WHERE id = 1").run(STORAGE_SCHEMA_VERSION + 1);
    db.close();
    assert.throws(() => openStorageDatabase(databasePath), { code: "E_STORAGE_VERSION_UNSUPPORTED" });
    assert.throws(() => openStorageDatabase(databasePath, { readOnly: true }), { code: "E_STORAGE_VERSION_UNSUPPORTED" });
    const { DatabaseSync } = await import("node:sqlite");
    const readonly = new DatabaseSync(databasePath, { readOnly: true });
    try {
      assert.equal(readStorageMeta(readonly).schema_version, STORAGE_SCHEMA_VERSION + 1);
    } finally {
      readonly.close();
    }
  });
});


test("integrity findings remain bounded when many artifact fingerprints are corrupt", async () => {
  await withTempDir(async directory => {
    const db = openStore(directory);
    try {
      upsertTask(db, { taskId: "corrupt-artifacts", descriptor: makeDescriptor("corrupt-artifacts") });
      runInTransaction(db, () => {
        for (let index = 0; index < 250; index += 1) putArtifact(db, { taskId: "corrupt-artifacts", kind: "decision", artifactId: `bad-${index}`, payload: { index } });
        db.prepare("UPDATE task_artifacts SET fingerprint = ? WHERE task_id = ?").run("0".repeat(64), "corrupt-artifacts");
      });
      const result = checkStorageIntegrity(db);
      assert.equal(result.ok, false);
      assert.equal(result.artifactErrors.length, 100);
      assert.ok(result.artifactErrors.every(error => error.code === "E_STORAGE_ARTIFACT_INVALID"));
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM task_artifacts WHERE task_id = ?").get("corrupt-artifacts").count, 250);
      assert.equal(checkStorageIntegrity(db).ok, false);
    } finally { db.close(); }
  });
});


test("claim release rejects an expired continuation while retaining valid synchronous use", async () => {
  await withTempDir(async directory => {
    const db = openStore(directory);
    try {
      const taskId = "late-release";
      upsertTask(db, { taskId, descriptor: makeDescriptor(taskId) });
      reserveClaims(db, { taskId, claims: ["src/claimed.js"] });
      const before = listClaims(db, taskId);
      let scheduled;
      assert.throws(() => runInTransaction(db, () => {
        scheduled = Promise.resolve().then(() => releaseClaims(db, taskId));
        return scheduled;
      }), { code: "E_STORAGE_ASYNC_TRANSACTION" });
      assert.equal(await scheduled.then(() => "persisted", error => error.code), "E_STORAGE_TRANSACTION_EXPIRED");
      assert.deepEqual(listClaims(db, taskId), before);
      assert.throws(() => runInTransaction(db, () => {
        scheduled = Promise.resolve().then(() => runInTransaction(db, () => releaseClaims(db, taskId)));
        return scheduled;
      }), { code: "E_STORAGE_ASYNC_TRANSACTION" });
      assert.equal(await scheduled.then(() => "persisted", error => error.code), "E_STORAGE_TRANSACTION_EXPIRED", "expired callbacks cannot reopen a transaction");
      assert.deepEqual(listClaims(db, taskId), before);
      assert.equal(runInTransaction(db, () => releaseClaims(db, taskId)), 1);
      assert.deepEqual(listClaims(db, taskId), []);
      reserveClaims(db, { taskId, claims: ["src/direct.js"] });
      assert.equal(releaseClaims(db, taskId), 1, "ordinary single-statement release remains supported");
      assert.equal(checkStorageIntegrity(db).ok, true);
    } finally { db.close(); }
  });
});


test("active independent transactions remain usable and expired contexts cannot switch connections", async () => {
  await withTempDir(async directory => {
    const first = openStore(directory);
    const second = openStorageDatabase(path.join(directory, "independent.sqlite"));
    try {
      for (const db of [first, second]) upsertTask(db, { taskId: "independent", descriptor: makeDescriptor("independent") });
      runInTransaction(first, () => {
        reserveClaims(first, { taskId: "independent", claims: ["src/first.js"] });
        runInTransaction(second, () => reserveClaims(second, { taskId: "independent", claims: ["src/second.js"] }));
        assert.equal(isInTransaction(first), true);
        assert.equal(isInTransaction(second), false);
      });
      assert.equal(listClaims(first, "independent").length, 1);
      const before = listClaims(second, "independent");
      let scheduled;
      assert.throws(() => runInTransaction(first, () => {
        scheduled = Promise.resolve().then(() => runInTransaction(second, () => releaseClaims(second, "independent")));
        return scheduled;
      }), { code: "E_STORAGE_ASYNC_TRANSACTION" });
      assert.equal(await scheduled.then(() => "persisted", error => error.code), "E_STORAGE_TRANSACTION_EXPIRED");
      assert.deepEqual(listClaims(second, "independent"), before);
      assert.equal(first.isTransaction, false);
      assert.equal(second.isTransaction, false);
    } finally { second.close(); first.close(); }
  });
});
