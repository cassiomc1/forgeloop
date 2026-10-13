import { assertSafePath } from "../core/filesystem.js";
import { getPackageRoot } from "../core/templates.js";
import { assertOwnedStorageMaintenance } from "./maintenance.js";
import { verifyMigrationPublicationStage } from "./migration-publication.js";
import { readStorageVersionMarker } from "./storage-marker.js";
import { checkStorageIntegrity, openStorageDatabase, readStorageMeta } from "./connection.js";
import { withStorageSnapshot } from "./snapshot.js";
import { validateMigrationDatabase } from "./migration-validation.js";
import { iterateAttachmentReferences } from "./attachment-references.js";
import { verifyAttachmentFile } from "./attachment-files.js";
import { assertSnapshotContinuity } from "./snapshot-continuity.js";

function invalid(message) { return Object.assign(new Error(message), { code: "E_STORAGE_MIGRATION_TERMINAL_INVALID" }); }

/** Verify current state after publication; never write or restore an old snapshot. */
export async function verifyPublishedMigration(target, destination, { writersQuiesced = false, packageRoot = getPackageRoot() } = {}) {
  if (writersQuiesced !== true) throw invalid("Terminal verification requires excluded writers");
  await assertOwnedStorageMaintenance(target);
  const staged = await verifyMigrationPublicationStage(target, destination, { packageRoot, sourcePartition: true, allowPublished: true });
  if (staged.journal.phase !== "PUBLISHED") throw invalid("Publication journal is not terminal");
  const marker = await readStorageVersionMarker(target);
  if (!marker || marker.phase !== "ACTIVE" || marker.operationId !== staged.journal.operationId
    || marker.sourceInventoryFingerprint !== staged.journal.sourceInventoryFingerprint) throw invalid("Active marker does not match terminal publication");
  for (const suffix of ["", "-wal", "-shm"]) await assertSafePath(target, `.forgeloop/state.sqlite${suffix}`);
  const db = openStorageDatabase(await assertSafePath(target, ".forgeloop/state.sqlite"), { readOnly: true });
  let original;
  try {
    original = openStorageDatabase(await assertSafePath(staged.bundle, "state.sqlite"), { readOnly: true });
    return await withStorageSnapshot(db, async current => {
      if (!checkStorageIntegrity(current).ok || readStorageMeta(current).schema_version !== marker.databaseSchemaVersion) throw invalid("Current storage integrity or version differs");
      assertSnapshotContinuity(original, current, invalid);
      const validation = await validateMigrationDatabase(current, { target, packageRoot });
      let attachments = 0;
      for (const reference of iterateAttachmentReferences(current)) { await verifyAttachmentFile(target, reference); attachments += 1; }
      await assertOwnedStorageMaintenance(target);
      return { phase: "PUBLISHED", operationId: marker.operationId, taskCount: validation.tasks.length, attachments, currentStateVerified: true, restored: false };
    });
  } finally { try { original?.close(); } finally { db.close(); } }
}
