import assert from "node:assert/strict";
import test from "node:test";
import { fork, execFileSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { Readable } from "node:stream";
import os from "node:os";
import path from "node:path";
import { buildDiagnosisProject, TEST_TASK_ID } from "./helpers/storage-fixtures.js";
import { importProjectState } from "../src/storage/importer.js";
import { openStorageDatabase } from "../src/storage/connection.js";
import { registerAttachment } from "../src/storage/attachment-references.js";
import { backupProjectStorage } from "../src/storage/project-backup.js";
import { restoreProjectStorageToFreshProject, resumeReadyProjectStorageRestore, resumeProjectStorageRestore } from "../src/storage/project-restore.js";
import { readStorageVersionMarker } from "../src/storage/storage-marker.js";
import { executeForgeLoopCommand } from "../src/core/command-runtime.js";
import { putArtifact } from "../src/storage/repository.js";
import { runInTransaction } from "../src/storage/transaction.js";
import { verifyProjectRestoreJournal } from "../src/storage/restore-journal.js";
import { verifyActiveProjectRestore } from "../src/storage/restore-terminal.js";

test("verified restore activates canonical project dispatch and independent attachment bytes", async () => {
  const original = await buildDiagnosisProject({ legacy: true });
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-active-restore-"));
  const { db } = await importProjectState(original, path.join(original, "source.sqlite"));
  try {
    const bytes = Buffer.from([0, 255, 13, 10, 128]);
    const reference = await registerAttachment(db, original, { taskId: TEST_TASK_ID, referenceId: "restore-binary", readable: Readable.from([bytes]) });
    const backup = path.join(original, "retained-backup");
    await backupProjectStorage(db, original, backup);
    const result = await restoreProjectStorageToFreshProject(backup, target, { writersQuiesced: true });
    assert.equal(result.active, true);
    assert.equal(result.references, 1);
    assert.equal((await readStorageVersionMarker(target)).phase, "ACTIVE");
    const journal = JSON.parse(await readFile(result.journalPath));
    assert.equal(journal.phase, "ACTIVE");
    assert.equal(journal.operationId, result.marker.operationId);
    assert.deepEqual(journal.binding, { operationId: result.marker.operationId, databaseSchemaVersion: result.marker.databaseSchemaVersion, sourceInventoryFingerprint: result.marker.sourceInventoryFingerprint });
    assert.equal((await verifyProjectRestoreJournal(target, journal.operationId, { expectedOwnerId: journal.ownerId })).snapshotVerified, true);
    for (const changed of [
      { ...journal, phase: "READY" },
      { ...journal, phase: "PREPARING" },
      { ...journal, snapshotFingerprint: "0".repeat(64) },
      { ...journal, binding: { ...journal.binding, databaseSchemaVersion: journal.binding.databaseSchemaVersion + 1 } },
      { ...journal, binding: { ...journal.binding, sourceInventoryFingerprint: "0".repeat(64) } },
    ]) {
      await writeFile(result.journalPath, JSON.stringify(changed));
      await assert.rejects(verifyProjectRestoreJournal(target, journal.operationId), { code: "E_STORAGE_RESTORE_INVALID" });
    }
    await writeFile(result.journalPath, JSON.stringify(journal));
    await assert.rejects(verifyProjectRestoreJournal(target, "../unbound"), { code: "E_STORAGE_RESTORE_INVALID" });
    const listed = await executeForgeLoopCommand({ command: "task-list", projectPath: target, input: {} });
    assert.equal(listed.ok, true, JSON.stringify(listed));
    assert.match(JSON.stringify(listed.result), new RegExp(TEST_TASK_ID));
    assert.deepEqual(await readFile(path.join(target, reference.path)), bytes);
    const current = openStorageDatabase(path.join(target, ".forgeloop/state.sqlite"));
    try {
      await registerAttachment(current, target, { taskId: TEST_TASK_ID, referenceId: "terminal-later", readable: Readable.from(["later accepted bytes"]) });
      const verified = await verifyActiveProjectRestore(target, journal.operationId);
      assert.equal(verified.currentStateVerified, true);
      assert.equal(verified.references, 2);
      assert.equal(verified.restored, false);
      runInTransaction(current, () => current.prepare("DELETE FROM attachment_references WHERE task_id = ? AND reference_id = ?").run(TEST_TASK_ID, reference.referenceId));
      await assert.rejects(verifyActiveProjectRestore(target, journal.operationId), { code: "E_STORAGE_RESTORE_INVALID" });
      await registerAttachment(current, target, { taskId: TEST_TASK_ID, referenceId: reference.referenceId, readable: Readable.from([bytes]) });
    } finally { current.close(); }
    await writeFile(path.join(target, reference.path), "live corruption");
    assert.deepEqual(await readFile(path.join(backup, reference.path)), bytes);
    assert.deepEqual(await readFile(path.join(result.retainedSnapshot, reference.path)), bytes);
    await assert.rejects(restoreProjectStorageToFreshProject(backup, target, { writersQuiesced: true }), { code: "E_STORAGE_RESTORE_INVALID" });
  } finally { db.close(); await rm(original, { recursive: true, force: true }); await rm(target, { recursive: true, force: true }); }
});

test("restore refuses unquiesced writers, corrupt backup and retained legacy state", async () => {
  const original = await buildDiagnosisProject({ legacy: true });
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-refused-restore-"));
  const { db } = await importProjectState(original, path.join(original, "source.sqlite"));
  try {
    const reference = await registerAttachment(db, original, { taskId: TEST_TASK_ID, referenceId: "restore-guard", readable: Readable.from(["retained"]) });
    const backup = path.join(original, "retained-backup");
    await backupProjectStorage(db, original, backup);
    await assert.rejects(restoreProjectStorageToFreshProject(backup, target), { code: "E_STORAGE_MIGRATION_QUIESCENCE_REQUIRED" });
    await assert.rejects(readFile(path.join(target, ".forgeloop/storage-version.json")), { code: "ENOENT" });
    await assert.rejects(restoreProjectStorageToFreshProject(backup, original, { writersQuiesced: true }), { code: "E_STORAGE_RESTORE_INVALID" });
    await writeFile(path.join(backup, reference.path), "corrupt");
    await assert.rejects(restoreProjectStorageToFreshProject(backup, target, { writersQuiesced: true }), { code: "E_STORAGE_ATTACHMENT_INVALID" });
    await assert.rejects(readFile(path.join(target, ".forgeloop/storage-version.json")), { code: "ENOENT" });
  } finally { db.close(); await rm(original, { recursive: true, force: true }); await rm(target, { recursive: true, force: true }); }
});

test("restore rejects schema-invalid canonical evidence before marker activation and retains exclusion", async () => {
  const original = await buildDiagnosisProject({ legacy: true });
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-invalid-restore-"));
  const { db } = await importProjectState(original, path.join(original, "source.sqlite"));
  try {
    runInTransaction(db, () => putArtifact(db, { taskId: TEST_TASK_ID, kind: "contract", payload: { schemaVersion: 1, taskId: TEST_TASK_ID } }));
    const backup = path.join(original, "invalid-domain-backup");
    await backupProjectStorage(db, original, backup);
    await assert.rejects(restoreProjectStorageToFreshProject(backup, target, { writersQuiesced: true }));
    assert.equal(await readStorageVersionMarker(target), null);
    await assert.rejects(readFile(path.join(target, ".forgeloop/state.sqlite")), { code: "ENOENT" });
    const retained = await readdir(path.join(target, ".forgeloop/storage-restores"));
    assert.equal(retained.length, 1);
    assert.equal(JSON.parse(await readFile(path.join(target, ".forgeloop/storage-restores", retained[0], "snapshot/backup-manifest.json"))).status, "READY");
    const journal = JSON.parse(await readFile(path.join(target, ".forgeloop/storage-restores", retained[0], "restore-journal.json")));
    assert.equal(journal.phase, "PREPARING");
    assert.equal(journal.binding, undefined);
    assert.equal((await verifyProjectRestoreJournal(target, journal.operationId)).snapshotVerified, false);
    const dispatched = await executeForgeLoopCommand({ command: "task-list", projectPath: target, input: {} });
    assert.equal(dispatched.ok, false);
    assert.match(JSON.stringify(dispatched), /E_STORAGE_MAINTENANCE_IN_PROGRESS/);
  } finally { db.close(); await rm(original, { recursive: true, force: true }); await rm(target, { recursive: true, force: true }); }
});

for (const checkpoint of ["PARTIAL", "MISSING", "RETAINING", "RETAINED", "REBUILD", "REBUILD_CONFLICT", "PREPARING", "PREPARING_CHANGED", "READY", "PENDING", "OBJECT", "DATABASE", "ACTIVE_MARKER", "UNBOUND", "CHANGED_DATABASE", "TERMINAL_CHANGED"]) test(`${checkpoint} restore reconciles owned SIGKILL and refuses live-owner adoption`, { timeout: 60000 }, async () => {
  const original = await buildDiagnosisProject({ legacy: true });
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-killed-restore-"));
  const { db } = await importProjectState(original, path.join(original, "source.sqlite"));
  let worker;
  try {
    const bytes = Buffer.from([0, 255, 13, 10, 128]);
    const reference = await registerAttachment(db, original, { taskId: TEST_TASK_ID, referenceId: "resume-binary", readable: Readable.from([bytes]) });
    const backup = path.join(original, "resume-backup");
    await backupProjectStorage(db, original, backup);
    worker = fork(new URL("./helpers/storage-restore-ready-worker.mjs", import.meta.url), [backup, target, checkpoint], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
    let stderr = "";
    worker.stderr.on("data", chunk => { stderr += chunk; });
    const ready = await Promise.race([
      once(worker, "message").then(([value]) => value),
      once(worker, "exit").then(([code]) => { throw new Error(`Restore worker exited ${code}: ${stderr}`); }),
    ]);
    const options = { operationId: ready.operationId, expectedOwnerId: ready.ownerId, writersQuiesced: true };
    if (checkpoint === "OBJECT") {
      const missing = await executeForgeLoopCommand({ command: "storage-restore-resume", projectPath: target, input: { operationId: ready.operationId, expectedOwnerId: ready.ownerId } });
      assert.equal(missing.ok, false);
      const live = await executeForgeLoopCommand({ command: "storage-restore-resume", projectPath: target, input: options });
      assert.equal(live.ok, false);
      assert.match(JSON.stringify(live), /E_STORAGE_MAINTENANCE_IN_PROGRESS/);
    }
    const resume = checkpoint === "READY" ? resumeReadyProjectStorageRestore : resumeProjectStorageRestore;
    await assert.rejects(resume(target, options), { code: "E_STORAGE_MAINTENANCE_IN_PROGRESS" });
    const objectBefore = ["OBJECT", "DATABASE", "ACTIVE_MARKER"].includes(checkpoint) ? await stat(path.join(target, reference.path)) : null;
    const databaseBefore = ["DATABASE", "ACTIVE_MARKER"].includes(checkpoint) ? await stat(path.join(target, ".forgeloop/state.sqlite")) : null;
    const exited = once(worker, "exit");
    assert.equal(worker.kill("SIGKILL"), true);
    await exited;
    if (checkpoint === "REBUILD_CONFLICT") {
      await assert.rejects(resume(target, options), { code: "E_STORAGE_RESTORE_INVALID" });
      const root = path.join(target, ".forgeloop/storage-restores", ready.operationId);
      assert.deepEqual(await readFile(path.join(root, "snapshot/incomplete.bin")), Buffer.from([0, 128, 99]));
      assert.equal(JSON.parse(await readFile(path.join(root, "snapshot-intents", `${ready.previousHistoryId}.json`))).kind, "UNBOUND");
      assert.equal(await readStorageVersionMarker(target), null);
      return;
    }
    if (checkpoint === "PREPARING_CHANGED") {
      await writeFile(path.join(backup, reference.path), "changed source bytes");
      await assert.rejects(resume(target, options), { code: "E_STORAGE_ATTACHMENT_INVALID" });
      assert.equal(await readStorageVersionMarker(target), null);
      const retained = path.join(target, ".forgeloop/storage-restores", ready.operationId);
      assert.equal(JSON.parse(await readFile(path.join(retained, "restore-journal.json"))).phase, "PREPARING");
      assert.deepEqual(await readFile(path.join(retained, "snapshot", reference.path)), bytes);
      return;
    }
    if (checkpoint === "TERMINAL_CHANGED") {
      const current = openStorageDatabase(path.join(target, ".forgeloop/state.sqlite"));
      try { await registerAttachment(current, target, { taskId: TEST_TASK_ID, referenceId: "terminal-new", readable: Readable.from(["new accepted bytes"]) }); }
      finally { current.close(); }
    }
    if (checkpoint === "CHANGED_DATABASE") {
      const current = openStorageDatabase(path.join(target, ".forgeloop/state.sqlite"));
      try {
        await registerAttachment(current, target, { taskId: TEST_TASK_ID, referenceId: "later-accepted", readable: Readable.from([bytes]) });
        await assert.rejects(resume(target, options), { code: "E_STORAGE_RESTORE_INVALID" });
        assert.equal(current.prepare("SELECT count(*) AS count FROM attachment_references WHERE reference_id = 'later-accepted'").get().count, 1);
        assert.equal((await readStorageVersionMarker(target)).phase, "ACTIVE");
      } finally { current.close(); }
      return;
    }
    if (checkpoint === "UNBOUND") {
      const unbound = path.join(target, ".forgeloop/attachments/objects", "f".repeat(64));
      await writeFile(unbound, "unbound retained evidence");
      await assert.rejects(resume(target, options), { code: "E_STORAGE_RESTORE_INVALID" });
      assert.equal(await readFile(unbound, "utf8"), "unbound retained evidence");
      assert.equal((await readStorageVersionMarker(target)).phase, "CUTOVER_PENDING");
      return;
    }
    let restored;
    if (checkpoint === "PENDING") restored = JSON.parse(execFileSync(process.execPath, ["src/cli.js", "storage-restore-resume", "--path", target, "--operation", ready.operationId, "--expected-owner", ready.ownerId, "--writers-quiesced", "--json"], { encoding: "utf8" }));
    else if (checkpoint === "OBJECT") {
      const api = await executeForgeLoopCommand({ command: "storage-restore-resume", projectPath: target, input: options });
      assert.equal(api.ok, true, JSON.stringify(api));
      restored = api.result;
    } else restored = await resume(target, options);
    assert.equal(restored.active, true);
    if (checkpoint === "TERMINAL_CHANGED") {
      assert.equal(restored.restored, false);
      assert.equal(restored.currentStateVerified, true);
      assert.equal(restored.references, 2);
    }
    assert.deepEqual(await readFile(path.join(target, reference.path)), bytes);
    if (objectBefore) assert.equal((await stat(path.join(target, reference.path))).ino, objectBefore.ino);
    if (databaseBefore) assert.equal((await stat(path.join(target, ".forgeloop/state.sqlite"))).ino, databaseBefore.ino);
    const journal = JSON.parse(await readFile(restored.journalPath));
    if (checkpoint === "REBUILD") {
      const root = path.dirname(restored.journalPath);
      assert.notEqual(journal.rebuild.historyId, ready.previousHistoryId);
      assert.deepEqual(await readFile(path.join(root, "snapshot-history", ready.previousHistoryId, "incomplete.bin")), Buffer.from([0, 255, 77]));
      assert.deepEqual(await readFile(path.join(root, "snapshot-history", journal.rebuild.historyId, "incomplete.bin")), Buffer.from([0, 128, 99]));
      const record = JSON.parse(await readFile(path.join(root, "snapshot-intents", `${ready.previousHistoryId}.json`)));
      assert.equal(record.operationId, ready.operationId);
      assert.equal(record.intent.phase, "RETAINED");
    }
    if (["PARTIAL", "RETAINING", "RETAINED"].includes(checkpoint)) {
      assert.equal(journal.rebuild.phase, "RETAINED");
      assert.deepEqual(await readFile(path.join(path.dirname(restored.journalPath), "snapshot-history", journal.rebuild.historyId, "incomplete.bin")), Buffer.from([0, 255, 77]));
      await writeFile(restored.journalPath, JSON.stringify({ ...journal, rebuild: { ...journal.rebuild, phase: "RETAINING" } }));
      await assert.rejects(verifyProjectRestoreJournal(target, ready.operationId), { code: "E_STORAGE_RESTORE_INVALID" });
      await writeFile(restored.journalPath, JSON.stringify(journal));
    }
    assert.equal(journal.phase, "ACTIVE");
    assert.notEqual(journal.ownerId, ready.ownerId);
    const listed = await executeForgeLoopCommand({ command: "task-list", projectPath: target, input: {} });
    assert.equal(listed.ok, true, JSON.stringify(listed));
    assert.match(JSON.stringify(listed.result), new RegExp(TEST_TASK_ID));
  } finally {
    if (worker && worker.exitCode === null && worker.signalCode === null) { const exited = once(worker, "exit"); worker.kill("SIGKILL"); await exited; }
    db.close(); await rm(original, { recursive: true, force: true }); await rm(target, { recursive: true, force: true });
  }
});
