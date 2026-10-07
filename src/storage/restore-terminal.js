import { assertSafePath } from "../core/filesystem.js";
import { getPackageRoot } from "../core/templates.js";
import { verifyProjectRestoreJournal } from "./restore-journal.js";
import { withVerifiedProjectStorageBackup } from "./project-backup.js";
import { checkStorageIntegrity, openStorageDatabase, readStorageMeta } from "./connection.js";
import { withStorageSnapshot } from "./snapshot.js";
import { assertSnapshotContinuity } from "./snapshot-continuity.js";
import { validateMigrationDatabase } from "./migration-validation.js";
import { iterateAttachmentReferences } from "./attachment-references.js";
import { verifyAttachmentFile } from "./attachment-files.js";

const invalid = message => Object.assign(new Error(message), { code: "E_STORAGE_RESTORE_INVALID" });

/** Verify accepted current state; never restore the earlier retained snapshot. */
export async function verifyActiveProjectRestore(target, operationId, { expectedOwnerId = null, packageRoot = getPackageRoot() } = {}) {
  const retained = await verifyProjectRestoreJournal(target, operationId, { expectedOwnerId });
  if (retained.journal.phase !== "ACTIVE" || retained.marker?.phase !== "ACTIVE") throw invalid("Restore verification requires terminal ACTIVE publication");
  for (const suffix of ["", "-wal", "-shm"]) await assertSafePath(target, `.forgeloop/state.sqlite${suffix}`);
  const db = openStorageDatabase(await assertSafePath(target, ".forgeloop/state.sqlite"), { readOnly: true });
  try {
    return await withVerifiedProjectStorageBackup(retained.snapshot, ({ db: original }) => withStorageSnapshot(db, async current => {
      const meta = readStorageMeta(current);
      if (!checkStorageIntegrity(current).ok || meta.schema_version !== retained.marker.databaseSchemaVersion
        || meta.storage_format !== retained.marker.storageFormat || meta.storage_version !== retained.marker.storageVersion) throw invalid("Current restore storage integrity or version differs");
      assertSnapshotContinuity(original, current, invalid);
      const validation = await validateMigrationDatabase(current, { target, packageRoot });
      let references = 0;
      for (const reference of iterateAttachmentReferences(current)) { await verifyAttachmentFile(target, reference); references += 1; }
      return { active: true, phase: "ACTIVE", operationId, taskCount: validation.tasks.length, references, currentStateVerified: true, restored: false };
    }));
  } finally { db.close(); }
}
