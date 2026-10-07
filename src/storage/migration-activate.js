import { lstat, mkdir } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { iterateAttachmentReferences } from "./attachment-references.js";
import { publishAttachmentFile, withVerifiedAttachmentFile } from "./attachment-files.js";
import { assertSafePath, writeFileAtomic } from "../core/filesystem.js";
import { canonicalFingerprint } from "../core/artifacts.js";
import { assertOwnedStorageMaintenance } from "./maintenance.js";
import { verifyMigrationPublicationStage } from "./migration-publication.js";
import { logicalSnapshot } from "./migration-candidate.js";
import { backupStorageDatabase } from "./backup.js";
import { checkStorageIntegrity, openStorageDatabase, readStorageMeta } from "./connection.js";
import { activateStorageVersionMarker, readStorageVersionMarker, writePendingStorageVersionMarker } from "./storage-marker.js";

function invalid(message) { return Object.assign(new Error(message), { code: "E_STORAGE_MIGRATION_ACTIVATION_INVALID" }); }

/** Activate only archived, verified storage inside the complete owner callback. */
export async function activateArchivedMigration(target, destination, { writersQuiesced = false, packageRoot } = {}) {
  if (writersQuiesced !== true) throw Object.assign(new Error("Exclude legacy writers before activation"), { code: "E_STORAGE_MIGRATION_QUIESCENCE_REQUIRED" });
  await assertOwnedStorageMaintenance(target);
  const staged = await verifyMigrationPublicationStage(target, destination, { packageRoot, sourcePartition: true });
  if (staged.journal.phase !== "ARCHIVED") throw invalid("Activation requires completed, verified source archival");
  const source = await assertSafePath(staged.bundle, "state.sqlite");
  const db = openStorageDatabase(source, { readOnly: true });
  const filename = await assertSafePath(target, ".forgeloop/state.sqlite");
  const binding = { operationId: staged.journal.operationId, sourceInventoryFingerprint: staged.journal.sourceInventoryFingerprint, databaseSchemaVersion: readStorageMeta(db).schema_version };
  try {
    const existingMarker = await readStorageVersionMarker(target);
    const alreadyActive = existingMarker?.phase === "ACTIVE";
    if (alreadyActive) {
      if (existingMarker.operationId !== binding.operationId || existingMarker.sourceInventoryFingerprint !== binding.sourceInventoryFingerprint
        || existingMarker.databaseSchemaVersion !== binding.databaseSchemaVersion) throw invalid("Active marker belongs to a different cutover");
    } else await writePendingStorageVersionMarker(target, binding);
    const temporaryRoot = await assertSafePath(staged.path, "activation-attachments");
    await mkdir(temporaryRoot, { recursive: true });
    for (const reference of iterateAttachmentReferences(db)) {
      await assertOwnedStorageMaintenance(target);
      const copied = await withVerifiedAttachmentFile(staged.bundle, reference, sourceFilename => publishAttachmentFile(target, createReadStream(sourceFilename), { db, temporaryRoot }));
      if (copied.size !== reference.size || copied.sha256 !== reference.sha256) throw invalid("Activated attachment differs from staged bytes");
    }
    let exists = false;
    try { await lstat(filename); exists = true; } catch (error) { if (error.code !== "ENOENT") throw error; }
    if (!exists) {
      if (alreadyActive) throw invalid("Active marker has lost its database; automatic recreation is forbidden");
      await backupStorageDatabase(db, filename);
    }
    for (const suffix of ["-wal", "-shm"]) await assertSafePath(target, `.forgeloop/state.sqlite${suffix}`);
    const published = openStorageDatabase(filename, { readOnly: true });
    try {
      if (!checkStorageIntegrity(published).ok || canonicalFingerprint(logicalSnapshot(published)) !== canonicalFingerprint(logicalSnapshot(db))) throw invalid("Published database differs from the validated staged snapshot");
    } finally { published.close(); }
    await assertOwnedStorageMaintenance(target);
    await verifyMigrationPublicationStage(target, destination, { packageRoot, sourcePartition: true });
    const marker = alreadyActive ? existingMarker : await activateStorageVersionMarker(target, binding);
    const journalPath = await assertSafePath(staged.path, "publication-journal.json");
    const journal = { ...staged.journal, phase: "PUBLISHED", publicationReady: true };
    await writeFileAtomic(journalPath, `${JSON.stringify(journal, null, 2)}\n`);
    return { path: filename, marker, journal, source: staged.bundle };
  } finally { db.close(); }
}
