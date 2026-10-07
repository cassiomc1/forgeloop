import { removeTempTree } from "./helpers/rm-safe.js";
import assert from "node:assert/strict";
import test from "node:test";
import { copyFile, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { buildDiagnosisProject, TEST_TASK_ID } from "./helpers/storage-fixtures.js";
import { importProjectState } from "../src/storage/importer.js";
import { exportDatabase } from "../src/storage/exporter.js";
import { registerAttachment, iterateAttachmentReferences } from "../src/storage/attachment-references.js";
import { publishAttachmentFile } from "../src/storage/attachment-files.js";
import { prepareMigrationCandidate } from "../src/storage/migration-candidate.js";
import { stageMigrationPublication } from "../src/storage/migration-publication.js";
import { migrateProjectStorage } from "../src/storage/migration.js";
import { openStorageDatabase } from "../src/storage/connection.js";
import { backupProjectStorage, restoreProjectStorageBackup } from "../src/storage/project-backup.js";

const bytes = Buffer.from([0, 255, 128, 13, 10]);
async function attachmentSource() {
  const target = await buildDiagnosisProject({ legacy: true });
  let db;
  try {
    ({ db } = await importProjectState(target, path.join(target, "fixture.sqlite")));
    const reference = await registerAttachment(db, target, { taskId: TEST_TASK_ID, referenceId: "portable-binary", readable: Readable.from([bytes]) });
    const portable = path.join(target, "portable");
    await exportDatabase(db, portable, { attachmentRoot: target });
    await copyFile(path.join(portable, "export-index.json"), path.join(target, "export-index.json"));
    return { target, reference };
  } catch (error) { db?.close(); db = null; await rm(target, { recursive: true, force: true }); throw error; }
  finally { db?.close(); }
}

test("migration verifies portable attachment bindings and retains bytes through publication and backup", async () => {
  const { target, reference } = await attachmentSource();
  try {
    const result = await migrateProjectStorage(target, { destination: "retained", writersQuiesced: true });
    assert.equal(result.phase, "PUBLISHED");
    assert.equal(result.attachments, 1);
    const manifest = JSON.parse(await readFile(path.join(target, "retained/candidate-manifest.json")));
    assert.equal(manifest.parity.attachmentReferenceValidation, "VERIFIED");
    assert.deepEqual(await readFile(path.join(target, reference.path)), bytes);
    assert.deepEqual(await readFile(path.join(target, "retained/source", reference.path)), bytes);
    const db = openStorageDatabase(path.join(target, ".forgeloop/state.sqlite"), { readOnly: true });
    try {
      assert.deepEqual([...iterateAttachmentReferences(db)], [reference]);
      await backupProjectStorage(db, target, path.join(target, "after-backup"));
    } finally { db.close(); }
    await restoreProjectStorageBackup(path.join(target, "after-backup"), path.join(target, "restored-backup"));
    assert.deepEqual(await readFile(path.join(target, "restored-backup", reference.path)), bytes);
  } finally { await removeTempTree(target); }
});

test("unmapped captured objects remain retained and prevent attachment coverage publication", async () => {
  const { target, reference } = await attachmentSource();
  try {
    const orphan = await publishAttachmentFile(target, Readable.from(["unmapped object"]));
    const candidate = await prepareMigrationCandidate(target, { destination: "retained", writersQuiesced: true });
    assert.equal(candidate.manifest.parity.attachmentReferenceValidation, "NOT_VERIFIED");
    await assert.rejects(stageMigrationPublication(target, "retained", { writersQuiesced: true }), error => error.code === "E_STORAGE_MIGRATION_PUBLICATION_INVALID" && error.message.includes("Attachment reference coverage"));
    assert.deepEqual(await readFile(path.join(target, reference.path)), bytes);
    assert.equal(await readFile(path.join(target, orphan.path), "utf8"), "unmapped object");
  } finally { await removeTempTree(target); }
});
