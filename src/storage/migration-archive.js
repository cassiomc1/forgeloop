import { mkdir, open, rename } from "node:fs/promises";
import path from "node:path";
import { assertSafePath, writeFileAtomic } from "../core/filesystem.js";
import { assertOwnedStorageMaintenance } from "./maintenance.js";
import { verifyMigrationPublicationStage } from "./migration-publication.js";
import { inspectMigrationSourcePartition } from "./migration-source-partition.js";
import { openStorageDatabase, readStorageMeta } from "./connection.js";
import { writePendingStorageVersionMarker } from "./storage-marker.js";

async function syncDirectory(directory) {
  try {
    const handle = await open(directory, "r");
    try { await handle.sync(); } finally { await handle.close(); }
  } catch (error) {
    if (!["EINVAL", "EPERM", "EISDIR", "ENOTSUP", "UNKNOWN"].includes(error.code)) throw error;
  }
}

/** Must remain inside the owner's complete cutover/recovery callback. */
export async function archiveMigrationSources(target, destination, { writersQuiesced = false, packageRoot } = {}) {
  if (writersQuiesced !== true) throw Object.assign(new Error("Legacy writers must be stopped and excluded before archival"), { code: "E_STORAGE_MIGRATION_QUIESCENCE_REQUIRED" });
  await assertOwnedStorageMaintenance(target);
  const staged = await verifyMigrationPublicationStage(target, destination, { packageRoot, sourcePartition: true });
  const stagedDb = openStorageDatabase(await assertSafePath(staged.bundle, "state.sqlite"), { readOnly: true });
  try {
    await writePendingStorageVersionMarker(target, { operationId: staged.journal.operationId,
      sourceInventoryFingerprint: staged.journal.sourceInventoryFingerprint, databaseSchemaVersion: readStorageMeta(stagedDb).schema_version });
  } finally { stagedDb.close(); }
  const journalPath = await assertSafePath(staged.path, "publication-journal.json");
  const journal = { ...staged.journal, phase: "ARCHIVING" };
  const persist = () => writeFileAtomic(journalPath, `${JSON.stringify(journal, null, 2)}\n`);
  await persist();
  let partition = await inspectMigrationSourcePartition(target, destination);
  await mkdir(partition.archive, { recursive: true });
  await syncDirectory(path.dirname(partition.archive));
  for (const root of partition.roots) {
    // Referenced immutable object paths remain valid in the active project.
    if (root.path === ".forgeloop/attachments" || root.location !== "ACTIVE") continue;
    await assertOwnedStorageMaintenance(target);
    partition = await inspectMigrationSourcePartition(target, destination);
    const current = partition.roots.find(entry => entry.path === root.path);
    if (current.location === "ARCHIVED") continue;
    if (current.location !== "ACTIVE") throw Object.assign(new Error("Source location changed during archival"), { code: "E_STORAGE_MIGRATION_ARCHIVE_INVALID" });
    const original = await assertSafePath(target, root.path);
    const archived = await assertSafePath(partition.archive, root.path);
    await mkdir(path.dirname(archived), { recursive: true });
    await assertSafePath(partition.archive, root.path);
    await rename(original, archived);
    await syncDirectory(path.dirname(original));
    await syncDirectory(path.dirname(archived));
    await syncDirectory(partition.archive);
    await syncDirectory(path.dirname(partition.archive));
    partition = await inspectMigrationSourcePartition(target, destination);
    journal.lastArchivedRoot = root.path;
    await persist();
  }
  partition = await inspectMigrationSourcePartition(target, destination);
  if (partition.roots.some(root => root.path !== ".forgeloop/attachments" && root.location === "ACTIVE")) {
    throw Object.assign(new Error("Legacy source archival is incomplete"), { code: "E_STORAGE_MIGRATION_ARCHIVE_INVALID" });
  }
  journal.phase = "ARCHIVED";
  await persist();
  await verifyMigrationPublicationStage(target, destination, { packageRoot, sourcePartition: true });
  return { ...staged, journal, partition };
}
