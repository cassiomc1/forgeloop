import assert from "node:assert/strict";
import test from "node:test";
import { readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildDiagnosisProject, TEST_TASK_ID } from "./helpers/storage-fixtures.js";
import { openStorageDatabase } from "../src/storage/connection.js";
import { registerAttachment } from "../src/storage/attachment-references.js";
import { Readable } from "node:stream";
import { prepareMigrationCandidate } from "../src/storage/migration-candidate.js";
import { stageMigrationPublication } from "../src/storage/migration-publication.js";
import { archiveMigrationSources } from "../src/storage/migration-archive.js";
import { activateArchivedMigration } from "../src/storage/migration-activate.js";
import { withStorageMaintenance } from "../src/storage/maintenance.js";
import { executeForgeLoopCommand } from "../src/core/command-runtime.js";
import { verifyPublishedMigration } from "../src/storage/migration-terminal.js";

test("validated archival activates an independent SQLite copy and releases public dispatch", async () => {
  const target = await buildDiagnosisProject({ legacy: true });
  try {
    const candidate = await prepareMigrationCandidate(target, { destination: "retained", writersQuiesced: true });
    const staged = await stageMigrationPublication(target, "retained", { writersQuiesced: true });
    const candidateBytes = await readFile(candidate.candidatePath);
    const stagedBytes = await readFile(path.join(staged.bundle, "state.sqlite"));
    await assert.rejects(activateArchivedMigration(target, "retained", { writersQuiesced: true }), { code: "E_STORAGE_MAINTENANCE_IN_PROGRESS" });
    const activated = await withStorageMaintenance(target, async () => {
      await assert.rejects(activateArchivedMigration(target, "retained", { writersQuiesced: true }), { code: "E_STORAGE_MIGRATION_ACTIVATION_INVALID" });
      await archiveMigrationSources(target, "retained", { writersQuiesced: true });
      return activateArchivedMigration(target, "retained", { writersQuiesced: true });
    }, { retainOnError: true });
    assert.equal(activated.marker.phase, "ACTIVE");
    assert.equal(activated.journal.phase, "PUBLISHED");
    const journalPath = path.join(staged.path, "publication-journal.json");
    const interruptedJournal = { ...activated.journal, phase: "ARCHIVED", publicationReady: false };
    await writeFile(journalPath, JSON.stringify(interruptedJournal));
    const beforeResume = (await stat(activated.path)).ino;
    const resumed = await withStorageMaintenance(target, () => activateArchivedMigration(target, "retained", { writersQuiesced: true }), { retainOnError: true });
    assert.equal(resumed.journal.phase, "PUBLISHED");
    assert.equal((await stat(activated.path)).ino, beforeResume);
    assert.notEqual((await stat(activated.path)).ino, (await stat(path.join(staged.bundle, "state.sqlite"))).ino);
    const listed = await executeForgeLoopCommand({ command: "task-list", projectPath: target, input: {} });
    assert.equal(listed.ok, true, JSON.stringify(listed));
    const created = await executeForgeLoopCommand({ command: "task-create", projectPath: target, input: { taskId: "after-cutover", claims: ["different-path"] } });
    assert.equal(created.ok, true, JSON.stringify(created));
    const terminal = await withStorageMaintenance(target, () => verifyPublishedMigration(target, "retained", { writersQuiesced: true }));
    assert.equal(terminal.currentStateVerified, true);
    assert.equal(terminal.taskCount, 2);
    assert.equal(terminal.restored, false);
    const altered = openStorageDatabase(activated.path);
    const importedKey = altered.prepare("SELECT task_key FROM tasks WHERE task_id = ?").get(TEST_TASK_ID).task_key;
    altered.prepare("UPDATE tasks SET task_key = ? WHERE task_id = ?").run("0".repeat(64), TEST_TASK_ID);
    altered.close();
    await assert.rejects(withStorageMaintenance(target, () => verifyPublishedMigration(target, "retained", { writersQuiesced: true })), error => error.code === "E_STORAGE_MIGRATION_TERMINAL_INVALID" && error.message.includes("identity"));
    const restoredIdentity = openStorageDatabase(activated.path);
    restoredIdentity.prepare("UPDATE tasks SET task_key = ? WHERE task_id = ?").run(importedKey, TEST_TASK_ID);
    restoredIdentity.close();
    assert.deepEqual(await readFile(candidate.candidatePath), candidateBytes);
    assert.deepEqual(await readFile(path.join(staged.bundle, "state.sqlite")), stagedBytes);
    const updatedBytes = await readFile(activated.path);
    await writeFile(journalPath, JSON.stringify(interruptedJournal));
    await assert.rejects(withStorageMaintenance(target, () => activateArchivedMigration(target, "retained", { writersQuiesced: true })), { code: "E_STORAGE_MIGRATION_ACTIVATION_INVALID" });
    assert.deepEqual(await readFile(activated.path), updatedBytes);
    await assert.rejects(stat(path.join(target, ".forgeloop/task-state")), { code: "ENOENT" });
    await writeFile(journalPath, JSON.stringify(activated.journal));
    const attachmentDb = openStorageDatabase(activated.path);
    let reference;
    try { reference = await registerAttachment(attachmentDb, target, { taskId: "after-cutover", referenceId: "new-evidence", readable: Readable.from(["new immutable bytes"]) }); }
    finally { attachmentDb.close(); }
    const grown = await withStorageMaintenance(target, () => verifyPublishedMigration(target, "retained", { writersQuiesced: true }));
    assert.equal(grown.attachments, 1);
    await writeFile(path.join(target, reference.path), "tampered");
    await assert.rejects(withStorageMaintenance(target, () => verifyPublishedMigration(target, "retained", { writersQuiesced: true })), { code: "E_STORAGE_MIGRATION_ARCHIVE_INVALID" });
  } finally { await rm(target, { recursive: true, force: true }); }
});
