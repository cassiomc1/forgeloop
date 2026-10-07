import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdir } from "node:fs/promises";
import path from "node:path";
import { assertSafePath, writeFileAtomic } from "../core/filesystem.js";
import { canonicalFingerprint } from "../core/artifacts.js";
import { getPackageRoot } from "../core/templates.js";
import { LEGACY_SOURCE_ROOTS } from "./migration-source.js";
import { assertNoLegacyOperationLocks } from "./legacy-maintenance-boundary.js";
import { withStorageMaintenance, resumeStorageMaintenance, assertOwnedStorageMaintenance, retainStorageMaintenance, allowStorageMaintenanceRelease, assertStorageMaintenanceOwnerContinuity } from "./maintenance.js";
import { readStorageVersionMarker, writePendingStorageVersionMarker, activateStorageVersionMarker } from "./storage-marker.js";
import { backupProjectStorage, withVerifiedProjectStorageBackup } from "./project-backup.js";
import { backupStorageDatabase } from "./backup.js";
import { openStorageDatabase, readStorageMeta, checkStorageIntegrity } from "./connection.js";
import { validateMigrationDatabase } from "./migration-validation.js";
import { iterateAttachmentReferences } from "./attachment-references.js";
import { publishAttachmentFile, withVerifiedAttachmentFile, verifyAttachmentFile } from "./attachment-files.js";
import { logicalSnapshot } from "./migration-candidate.js";
import { verifyProjectRestoreJournal } from "./restore-journal.js";
import { assertRestorePublicationLayout, restorePathExists } from "./restore-layout.js";
import { verifyActiveProjectRestore } from "./restore-terminal.js";
import { ensurePreparedRestoreSnapshot } from "./restore-preparation.js";
import { verifyActiveStorageReplacementArchive, verifyRetainedStorageReplacementArchive } from "./restore-replacement-archive.js";
import { readStorageMetadataJson } from "./metadata-json.js";

/** Publish the verified incoming snapshot only after complete outgoing archival. */
export async function publishArchivedStorageReplacement(target, operationId, { packageRoot = getPackageRoot() } = {}) {
  const ownerId = await assertOwnedStorageMaintenance(target);
  await retainStorageMaintenance(target);
  const operationRoot = await assertSafePath(target, `.forgeloop/storage-restores/${operationId}`);
  const journalPath = await assertSafePath(operationRoot, "restore-journal.json");
  let journal = await readStorageMetadataJson(operationRoot, "restore-journal.json", { optional: true });
  if (!journal) {
    const archived = await verifyActiveStorageReplacementArchive(target, operationId, { packageRoot });
    if (!archived.archived || archived.journal.ownerId !== ownerId) throw invalid("Replacement publication requires complete archival by the current owner");
    await assertFreshOperationalState(target);
    await withVerifiedProjectStorageBackup(archived.incomingSnapshot, async ({ db, root, manifest }) => {
      journal = { schemaVersion: 1, kind: "PROJECT_RESTORE", operationId, ownerId, source: root,
        sourceFingerprint: canonicalFingerprint(manifest), phase: "READY", snapshotFingerprint: canonicalFingerprint(manifest),
        replacement: { outgoingFingerprint: archived.journal.outgoingFingerprint, incomingFingerprint: archived.journal.incomingFingerprint },
        binding: { operationId, databaseSchemaVersion: readStorageMeta(db).schema_version,
          sourceInventoryFingerprint: canonicalFingerprint({ database: manifest.databaseSha256, inventory: manifest.inventorySha256, references: manifest.references }) } };
      await assertOwnedStorageMaintenance(target);
      await writeFileAtomic(journalPath, `${JSON.stringify(journal, null, 2)}\n`);
    });
  }
  const verified = await verifyProjectRestoreJournal(target, operationId, { expectedOwnerId: ownerId });
  if (!verified.journal.replacement) throw invalid("Selected restore is not an archived replacement");
  await verifyRetainedStorageReplacementArchive(target, operationId, { ...verified.journal.replacement, packageRoot });
  const result = verified.journal.phase === "ACTIVE"
    ? await verifyActiveProjectRestore(target, operationId, { expectedOwnerId: ownerId, packageRoot })
    : await publishReadyRestore(target, operationRoot, verified.journal, { packageRoot });
  await verifyActiveProjectRestore(target, operationId, { expectedOwnerId: ownerId, packageRoot });
  await allowStorageMaintenanceRelease(target);
  return { ...result, replaced: true };
}

function invalid(message) { return Object.assign(new Error(message), { code: "E_STORAGE_RESTORE_INVALID" }); }

export async function assertFreshOperationalState(target) {
  await assertNoLegacyOperationLocks(target, { code: "E_STORAGE_RESTORE_INVALID" });
  if (await readStorageVersionMarker(target)) throw invalid("Restore activation requires a project without an existing storage marker");
  for (const relative of [...LEGACY_SOURCE_ROOTS, ".forgeloop/state.sqlite", ".forgeloop/state.sqlite-wal", ".forgeloop/state.sqlite-shm"]) {
    try { await lstat(await assertSafePath(target, relative)); }
    catch (error) { if (error.code === "ENOENT") continue; throw error; }
    throw invalid(`Restore activation refuses existing operational state: ${relative}`);
  }
}

/** Restore a verified independent snapshot into an operationally fresh project. */
export async function restoreProjectStorageToFreshProject(source, target, { writersQuiesced = false, packageRoot = getPackageRoot() } = {}) {
  if (writersQuiesced !== true) throw Object.assign(new Error("Exclude all writers before restore activation"), { code: "E_STORAGE_MIGRATION_QUIESCENCE_REQUIRED" });
  // Verify source before acquiring exclusion or allocating restore evidence.
  return withVerifiedProjectStorageBackup(source, async ({ db, root, manifest: sourceManifest }) => {
    await assertFreshOperationalState(target);
    await mkdir(await assertSafePath(target, ".forgeloop"), { recursive: true });
    return withStorageMaintenance(target, async () => {
      await assertFreshOperationalState(target);
      const operationId = randomUUID();
      const operationRoot = await assertSafePath(target, `.forgeloop/storage-restores/${operationId}`);
      await mkdir(path.dirname(operationRoot), { recursive: true });
      await mkdir(operationRoot);
      const journalPath = await assertSafePath(operationRoot, "restore-journal.json");
      const journal = { schemaVersion: 1, kind: "PROJECT_RESTORE", operationId, ownerId: await assertOwnedStorageMaintenance(target),
        source: root, sourceFingerprint: canonicalFingerprint(sourceManifest), phase: "PREPARING" };
      const persist = () => writeFileAtomic(journalPath, `${JSON.stringify(journal, null, 2)}\n`);
      await persist();
      const retained = await assertSafePath(operationRoot, "snapshot");
      await backupProjectStorage(db, root, retained);
      return withVerifiedProjectStorageBackup(retained, async ({ db: snapshot, manifest }) => {
        await withVerifiedProjectStorageBackup(root, current => {
          if (canonicalFingerprint(current.manifest) !== canonicalFingerprint(sourceManifest)
            || canonicalFingerprint(logicalSnapshot(current.db)) !== canonicalFingerprint(logicalSnapshot(snapshot))) throw invalid("Source backup changed during restore preparation");
        });
        await validateMigrationDatabase(snapshot, { target: retained, packageRoot });
        const binding = { operationId, databaseSchemaVersion: readStorageMeta(snapshot).schema_version,
          sourceInventoryFingerprint: canonicalFingerprint({ database: manifest.databaseSha256, inventory: manifest.inventorySha256, references: manifest.references }) };
        Object.assign(journal, { phase: "READY", binding, snapshotFingerprint: canonicalFingerprint(manifest) });
        await persist();
        return publishReadyRestore(target, operationRoot, journal, { packageRoot });
      });
    }, { retainOnError: true });
  });
}

async function publishReadyRestore(target, operationRoot, journal, { packageRoot }) {
  if (!["READY", "PUBLISHING"].includes(journal.phase)) throw invalid("Restore publication requires a validated READY or PUBLISHING checkpoint");
  if (journal.phase === "READY") await assertFreshOperationalState(target);
  const retained = await assertSafePath(operationRoot, "snapshot");
  const journalPath = await assertSafePath(operationRoot, "restore-journal.json");
  const persist = () => writeFileAtomic(journalPath, `${JSON.stringify(journal, null, 2)}\n`);
  const { operationId, binding } = journal;
  return withVerifiedProjectStorageBackup(retained, async ({ db: snapshot, manifest }) => {
    await validateMigrationDatabase(snapshot, { target: retained, packageRoot });
    await assertOwnedStorageMaintenance(target);
    await verifyProjectRestoreJournal(target, operationId, { expectedOwnerId: await assertOwnedStorageMaintenance(target) });
    await assertRestorePublicationLayout(target, snapshot);
    const existingMarker = await readStorageVersionMarker(target);
    const alreadyActive = existingMarker?.phase === "ACTIVE";
    const filename = await assertSafePath(target, ".forgeloop/state.sqlite");
    const existingDatabase = await restorePathExists(target, ".forgeloop/state.sqlite");
    if (alreadyActive && !existingDatabase) throw invalid("An active restore database cannot be automatically recreated");
    if (existingDatabase) {
      for (const suffix of ["-wal", "-shm"]) await assertSafePath(target, `.forgeloop/state.sqlite${suffix}`);
      const current = openStorageDatabase(filename, { readOnly: true });
      try {
        if (!checkStorageIntegrity(current).ok || canonicalFingerprint(logicalSnapshot(current)) !== canonicalFingerprint(logicalSnapshot(snapshot))) throw invalid("Existing restore database differs; automatic overwrite is forbidden");
        if (alreadyActive) for (const reference of iterateAttachmentReferences(current)) await verifyAttachmentFile(target, reference);
      } finally { current.close(); }
    }
    journal.phase = "PUBLISHING";
    await persist();
    if (!alreadyActive) await writePendingStorageVersionMarker(target, binding);
    const temporaryRoot = await assertSafePath(retained, "activation-attachments");
    await mkdir(temporaryRoot, { recursive: true });
    for (const reference of alreadyActive ? [] : iterateAttachmentReferences(snapshot)) {
      await assertOwnedStorageMaintenance(target);
      const copied = await withVerifiedAttachmentFile(retained, reference, filename => publishAttachmentFile(target, createReadStream(filename), { db: snapshot, temporaryRoot }));
      if (copied.sha256 !== reference.sha256 || copied.size !== reference.size) throw invalid("Restored attachment differs from retained snapshot");
    }
    if (!existingDatabase) await backupStorageDatabase(snapshot, filename);
    const restored = openStorageDatabase(filename, { readOnly: true });
    try {
      if (!checkStorageIntegrity(restored).ok || canonicalFingerprint(logicalSnapshot(restored)) !== canonicalFingerprint(logicalSnapshot(snapshot))) throw invalid("Restored canonical state differs from retained snapshot");
      await validateMigrationDatabase(restored, { target, packageRoot });
      for (const reference of iterateAttachmentReferences(restored)) await verifyAttachmentFile(target, reference);
    } finally { restored.close(); }
    await assertOwnedStorageMaintenance(target);
    const marker = alreadyActive ? existingMarker : await activateStorageVersionMarker(target, binding);
    journal.phase = "ACTIVE";
    await persist();
    await verifyProjectRestoreJournal(target, operationId, { expectedOwnerId: await assertOwnedStorageMaintenance(target) });
    return { restored: true, active: true, currentStateVerified: true, path: filename, retainedSnapshot: retained, references: manifest.references, marker, journalPath };
  });
}

/** Resume a validated prepublication snapshot after confirmed local owner death. */
export async function resumeProjectStorageRestore(target, { operationId, expectedOwnerId, writersQuiesced = false, packageRoot = getPackageRoot() } = {}) {
  if (writersQuiesced !== true) throw Object.assign(new Error("Exclude all writers before restore resume"), { code: "E_STORAGE_MIGRATION_QUIESCENCE_REQUIRED" });
  const verified = await verifyProjectRestoreJournal(target, operationId);
  await assertStorageMaintenanceOwnerContinuity(target, { expectedOwnerId, recordedOwnerId: verified.journal.ownerId });
  if (!["PREPARING", "READY", "PUBLISHING", "ACTIVE"].includes(verified.journal.phase)) throw invalid("Restore checkpoint does not support resume");
  if (["PREPARING", "READY"].includes(verified.journal.phase)) await assertFreshOperationalState(target);
  return resumeStorageMaintenance(target, { expectedOwnerId, writersQuiesced }, async () => {
    const current = await verifyProjectRestoreJournal(target, operationId);
    if (canonicalFingerprint(current.journal) !== canonicalFingerprint(verified.journal)) throw invalid("Restore journal changed during owner adoption");
    await assertStorageMaintenanceOwnerContinuity(target, { expectedOwnerId: await assertOwnedStorageMaintenance(target), recordedOwnerId: current.journal.ownerId });
    current.journal.ownerId = await assertOwnedStorageMaintenance(target);
    await writeFileAtomic(await assertSafePath(current.root, "restore-journal.json"), `${JSON.stringify(current.journal, null, 2)}\n`);
    if (current.journal.replacement) return publishArchivedStorageReplacement(target, operationId, { packageRoot });
    if (current.journal.phase === "PREPARING") await validatePreparedRestore(target, current.root, current.journal, packageRoot);
    if (current.journal.phase === "ACTIVE") {
      const result = await verifyActiveProjectRestore(target, operationId, { expectedOwnerId: current.journal.ownerId, packageRoot });
      await assertOwnedStorageMaintenance(target);
      return { ...result, path: await assertSafePath(target, ".forgeloop/state.sqlite"), retainedSnapshot: current.snapshot,
        journalPath: await assertSafePath(current.root, "restore-journal.json"), marker: current.marker };
    }
    return publishReadyRestore(target, current.root, current.journal, { packageRoot });
  });
}

async function validatePreparedRestore(target, root, journal, packageRoot) {
  await ensurePreparedRestoreSnapshot(target, root, journal);
  const snapshotPath = await assertSafePath(root, "snapshot");
  await withVerifiedProjectStorageBackup(snapshotPath, async ({ db: snapshot, manifest }) => {
    await withVerifiedProjectStorageBackup(journal.source, async source => {
      if (canonicalFingerprint(source.manifest) !== journal.sourceFingerprint
        || canonicalFingerprint(logicalSnapshot(source.db)) !== canonicalFingerprint(logicalSnapshot(snapshot))) throw invalid("Prepared restore differs from its recorded source backup");
      await validateMigrationDatabase(snapshot, { target: snapshotPath, packageRoot });
    });
    await assertOwnedStorageMaintenance(target);
    Object.assign(journal, { phase: "READY", snapshotFingerprint: canonicalFingerprint(manifest), binding: {
      operationId: journal.operationId, databaseSchemaVersion: readStorageMeta(snapshot).schema_version,
      sourceInventoryFingerprint: canonicalFingerprint({ database: manifest.databaseSha256, inventory: manifest.inventorySha256, references: manifest.references }) } });
    await writeFileAtomic(await assertSafePath(root, "restore-journal.json"), `${JSON.stringify(journal, null, 2)}\n`);
  });
}

export async function resumeReadyProjectStorageRestore(target, options = {}) {
  const verified = await verifyProjectRestoreJournal(target, options.operationId);
  if (verified.journal.phase !== "READY") throw invalid("This compatibility entry point requires READY");
  return resumeProjectStorageRestore(target, options);
}
