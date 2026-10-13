import { removeTempTree } from "./helpers/rm-safe.js";
import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { buildDiagnosisProject, TEST_TASK_ID } from "./helpers/storage-fixtures.js";
import { importProjectState } from "../src/storage/importer.js";
import { registerAttachment, iterateAttachmentReferences } from "../src/storage/attachment-references.js";
import { backupProjectStorage, restoreProjectStorageBackup, verifyProjectStorageBackup } from "../src/storage/project-backup.js";
import { openStorageDatabase } from "../src/storage/connection.js";
import { executeForgeLoopCommand } from "../src/core/command-runtime.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

test("project backup and fresh restore retain snapshot references and exact binary bytes", async () => {
  const target = await buildDiagnosisProject({ legacy: true });
  const { db } = await importProjectState(target, path.join(target, "state.sqlite"));
  try {
    db.exec("PRAGMA wal_autocheckpoint = 0");
    const bytes = Buffer.from([0, 255, 13, 10, 128]);
    const reference = await registerAttachment(db, target, { taskId: TEST_TASK_ID, referenceId: "binary-evidence", readable: Readable.from([bytes]) });
    const retained = path.join(target, "retained-backup");
    const result = await backupProjectStorage(db, target, retained);
    assert.equal(result.attachmentsIncluded, true);
    assert.equal(result.references, 1);
    await registerAttachment(db, target, { taskId: TEST_TASK_ID, referenceId: "later", readable: Readable.from(["later bytes"]) });
    assert.equal((await verifyProjectStorageBackup(retained)).references, 1);
    const restored = path.join(target, "restored-backup");
    assert.equal((await restoreProjectStorageBackup(retained, restored)).restored, true);
    assert.deepEqual(await readFile(path.join(restored, reference.path)), bytes);
    const snapshot = openStorageDatabase(path.join(restored, "state.sqlite"), { readOnly: true });
    try { assert.deepEqual([...iterateAttachmentReferences(snapshot)], [reference]); } finally { snapshot.close(); }
    await assert.rejects(restoreProjectStorageBackup(retained, restored), { code: "EEXIST" });
    const manifestPath = path.join(retained, "backup-manifest.json");
    const manifestBytes = await readFile(manifestPath);
    const inventoryPath = path.join(retained, "attachments.ndjson");
    const inventoryBytes = await readFile(inventoryPath);
    const substituted = Buffer.from(`${JSON.stringify({ ...reference, referenceId: "substituted" })}\n`);
    await writeFile(inventoryPath, substituted);
    const rebound = JSON.parse(manifestBytes);
    rebound.inventorySha256 = createHash("sha256").update(substituted).digest("hex");
    await writeFile(manifestPath, JSON.stringify(rebound));
    await assert.rejects(verifyProjectStorageBackup(retained), { code: "E_STORAGE_BACKUP_INVALID" });
    await writeFile(manifestPath, manifestBytes);
    await writeFile(inventoryPath, inventoryBytes);
    await writeFile(path.join(retained, reference.path), "tampered");
    const rejected = path.join(target, "refused-restore");
    await assert.rejects(restoreProjectStorageBackup(retained, rejected), { code: "E_STORAGE_ATTACHMENT_INVALID" });
    await assert.rejects(readFile(path.join(rejected, "backup-manifest.json")), { code: "ENOENT" });
  } finally { db.close(); await removeTempTree(target); }
});

test("project backup retains a refused incomplete bundle when source attachment bytes are corrupt", async () => {
  const target = await buildDiagnosisProject({ legacy: true });
  const { db } = await importProjectState(target, path.join(target, "state.sqlite"));
  try {
    const reference = await registerAttachment(db, target, { taskId: TEST_TASK_ID, referenceId: "evidence", readable: Readable.from(["original"]) });
    await writeFile(path.join(target, reference.path), "corrupt");
    const retained = path.join(target, "failed-backup");
    await assert.rejects(backupProjectStorage(db, target, retained), { code: "E_STORAGE_ATTACHMENT_INVALID" });
    assert.equal(JSON.parse(await readFile(path.join(retained, "backup-manifest.json"))).status, "FAILED");
    await assert.rejects(verifyProjectStorageBackup(retained), { code: "E_STORAGE_BACKUP_INVALID" });
    await assert.rejects(backupProjectStorage(db, target, retained), { code: "EEXIST" });
  } finally { db.close(); await removeTempTree(target); }
});

test("public API and CLI attachment backup select the canonical store and preserve source bindings", async () => {
  const target = await buildDiagnosisProject({ legacy: true });
  const { db } = await importProjectState(target, path.join(target, ".forgeloop/state.sqlite"));
  try {
    const reference = await registerAttachment(db, target, { taskId: TEST_TASK_ID, referenceId: "public-evidence", readable: Readable.from(["public bytes"]) });
    db.close();
    // This disposable imported fixture also retains filesystem transaction
    // history. Remove its legacy operational layout before public selection.
    for (const relative of [".forgeloop/task-state", ".forgeloop/.txn", ".forgeloop/work-state.json", ".forgeloop/events.ndjson"]) {
      await rm(path.join(target, relative), { recursive: true, force: true });
    }
    const api = await executeForgeLoopCommand({ command: "storage-backup", projectPath: target, input: { destination: "api-backup", includeAttachments: true } });
    assert.equal(api.ok, true, JSON.stringify(api));
    assert.equal(api.result.attachmentsIncluded, true);
    assert.equal((await verifyProjectStorageBackup(path.join(target, "api-backup"))).references, 1);
    const { stdout } = await promisify(execFile)(process.execPath, ["src/cli.js", "storage-backup", "--path", target, "--destination", "cli-backup", "--include-attachments", "--json"], { cwd: process.cwd() });
    const cli = JSON.parse(stdout);
    assert.equal(cli.attachmentsIncluded, true);
    assert.deepEqual(await readFile(path.join(target, "cli-backup", reference.path)), Buffer.from("public bytes"));
  } finally { try { db.close(); } catch { /* Already closed before public dispatch. */ } await removeTempTree(target); }
});
