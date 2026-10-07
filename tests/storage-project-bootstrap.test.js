import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { bootstrapProjectStorage } from "../src/storage/project-bootstrap.js";
import { executeForgeLoopCommand } from "../src/core/command-runtime.js";
import { withVerifiedProjectStorageBackup } from "../src/storage/project-backup.js";
import { verifyActiveProjectRestore } from "../src/storage/restore-terminal.js";
import { readStorageVersionMarker } from "../src/storage/storage-marker.js";
import { withProjectStorage } from "../src/storage/project-boundary.js";
import { persistGate, readGateIfPresent } from "../src/core/gate-artifact.js";
import { getPackageRoot } from "../src/core/templates.js";
import { execFileSync } from "node:child_process";

test("fresh bootstrap publishes an empty authoritative store and retains its recovery source", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-bootstrap-"));
  try {
    const result = await bootstrapProjectStorage(target, { writersQuiesced: true });
    assert.equal(result.active, true);
    const journal = JSON.parse(await readFile(result.journalPath, "utf8"));
    assert.equal(journal.phase, "ACTIVE");
    await withVerifiedProjectStorageBackup(journal.source, ({ db }) => {
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM tasks").get().count, 0);
    });
    const created = await executeForgeLoopCommand({ command: "task-create", projectPath: target, input: { taskId: "fresh-task", claims: ["README.md"] } });
    assert.equal(created.ok, true, JSON.stringify(created));
    await assert.rejects(readdir(path.join(target, ".forgeloop/task-state")), { code: "ENOENT" });
    assert.equal((await verifyActiveProjectRestore(target, journal.operationId)).currentStateVerified, true);
    await assert.rejects(bootstrapProjectStorage(target, { writersQuiesced: true }), { code: "E_STORAGE_RESTORE_INVALID" });
  } finally { await rm(target, { recursive: true, force: true }); }
});

test("ordinary fresh dispatch bootstraps on mutation while inspection allocates nothing", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-bootstrap-dispatch-"));
  try {
    const listed = await executeForgeLoopCommand({ command: "task-list", projectPath: target });
    assert.equal(listed.ok, true, JSON.stringify(listed));
    assert.deepEqual(await readdir(target), []);
    const created = await executeForgeLoopCommand({ command: "task-create", projectPath: target, input: { taskId: "default-sqlite", claims: ["src"] } });
    assert.equal(created.ok, true, JSON.stringify(created));
    assert.equal((await readStorageVersionMarker(target)).phase, "ACTIVE");
    await assert.rejects(readdir(path.join(target, ".forgeloop/task-state")), { code: "ENOENT" });
    const after = await executeForgeLoopCommand({ command: "task-list", projectPath: target });
    assert.equal(after.ok, true, JSON.stringify(after));
    assert.match(JSON.stringify(after.result), /default-sqlite/);
    const gate = { schemaVersion: 1, protocolVersion: 1, taskId: "default-sqlite", gate: "test", status: "satisfied", requiredBy: ["test"], artifacts: [], decisions: [], unknowns: [], approvedAssumptions: [], evidence: [] };
    await withProjectStorage(target, () => persistGate(target, gate, getPackageRoot(), { taskId: gate.taskId }));
    const retained = await withProjectStorage(target, () => readGateIfPresent(target, "test", getPackageRoot(), { taskId: gate.taskId }), { readOnly: true });
    assert.deepEqual(retained.value, gate);
    assert.equal(await withProjectStorage(target, () => readGateIfPresent(target, "absent", getPackageRoot(), { taskId: gate.taskId }), { readOnly: true }), null);
  } finally { await rm(target, { recursive: true, force: true }); }
});

test("bootstrap rejects an unsupported runtime before allocating evidence", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-bootstrap-runtime-"));
  try {
    execFileSync(process.execPath, ["--input-type=module", "-e", `
      import assert from 'node:assert/strict';
      import { bootstrapProjectStorage } from './src/storage/project-bootstrap.js';
      Object.defineProperty(process.versions, 'node', { value: '22.22.0' });
      await assert.rejects(bootstrapProjectStorage(process.argv[1], { writersQuiesced: true }), { code: 'E_STORAGE_UNSUPPORTED_RUNTIME' });
    `, target]);
    assert.deepEqual(await readdir(target), []);
  } finally { await rm(target, { recursive: true, force: true }); }
});

test("ordinary legacy mutation requires explicit migration and preserves its bytes", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-bootstrap-legacy-"));
  try {
    await mkdir(path.join(target, ".forgeloop"));
    const filename = path.join(target, ".forgeloop/work-state.json");
    await writeFile(filename, "legacy evidence\n");
    const result = await executeForgeLoopCommand({ command: "task-create", projectPath: target, input: { taskId: "refused", claims: ["src"] } });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "E_STORAGE_MIGRATION_REQUIRED");
    assert.equal(await readFile(filename, "utf8"), "legacy evidence\n");
    assert.deepEqual(await readdir(path.join(target, ".forgeloop")), ["work-state.json"]);
  } finally { await rm(target, { recursive: true, force: true }); }
});

test("bootstrap requires explicit exclusion and preserves legacy state before allocation", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-bootstrap-refuse-"));
  try {
    await assert.rejects(bootstrapProjectStorage(target), { code: "E_STORAGE_MIGRATION_QUIESCENCE_REQUIRED" });
    assert.deepEqual(await readdir(target), []);
    await mkdir(path.join(target, ".forgeloop"));
    const legacy = path.join(target, ".forgeloop/events.ndjson");
    await writeFile(legacy, "retained legacy bytes\n");
    await assert.rejects(bootstrapProjectStorage(target, { writersQuiesced: true }), { code: "E_STORAGE_RESTORE_INVALID" });
    assert.equal(await readFile(legacy, "utf8"), "retained legacy bytes\n");
    assert.deepEqual(await readdir(path.join(target, ".forgeloop")), ["events.ndjson"]);
  } finally { await rm(target, { recursive: true, force: true }); }
});


test("direct task transaction selects existing SQLite and preserves atomic rollback", async () => {
  const { withTaskTransaction } = await import("../src/core/transaction.js");
  const { taskArtifactPath } = await import("../src/core/task-paths.js");
  const { readTaskDescriptor } = await import("../src/core/task-descriptor.js");
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-direct-native-transaction-"));
  const taskId = "direct-native";
  const packageRoot = getPackageRoot();
  try {
    const created = await executeForgeLoopCommand({ command: "task-create", projectPath: target, input: { taskId, claims: [] } });
    assert.equal(created.ok, true, JSON.stringify(created));
    const relative = taskArtifactPath(taskId, "descriptor");
    const before = await withProjectStorage(target, () => readTaskDescriptor(target, taskId, packageRoot), { readOnly: true });
    let calls = 0;
    await assert.rejects(withTaskTransaction({ target, taskId, packageRoot, operation: "direct-rollback" }, async tx => {
      calls += 1;
      assert.equal(tx.kind, "sqlite");
      const state = JSON.parse(await tx.readText(relative));
      await tx.stageText(relative, JSON.stringify({ ...state, updatedAt: "2026-10-02T12:00:00.000Z" }));
      throw new Error("planned rollback");
    }), /planned rollback/);
    assert.equal(calls, 1);
    assert.deepEqual(await withProjectStorage(target, () => readTaskDescriptor(target, taskId, packageRoot), { readOnly: true }), before);
    await withTaskTransaction({ target, taskId, packageRoot, operation: "direct-commit" }, async tx => {
      const state = JSON.parse(await tx.readText(relative));
      await tx.stageText(relative, JSON.stringify({ ...state, updatedAt: "2026-10-02T12:00:00.000Z" }));
    });
    assert.equal((await withProjectStorage(target, () => readTaskDescriptor(target, taskId, packageRoot), { readOnly: true })).updatedAt, "2026-10-02T12:00:00.000Z");
    await assert.rejects(readdir(path.join(target, ".forgeloop/.txn")), { code: "ENOENT" });
    await assert.rejects(readdir(path.join(target, ".forgeloop/task-state")), { code: "ENOENT" });
    const database = path.join(target, ".forgeloop/state.sqlite");
    const retained = await readFile(database);
    await rm(database);
    calls = 0;
    await assert.rejects(withTaskTransaction({ target, taskId, packageRoot }, () => { calls += 1; }), { code: "E_STORAGE_MIGRATION_REQUIRED" });
    assert.equal(calls, 0);
    await assert.rejects(readdir(path.join(target, ".forgeloop/.txn")), { code: "ENOENT" });
    await writeFile(database, retained);
  } finally { await rm(target, { recursive: true, force: true }); }
});
