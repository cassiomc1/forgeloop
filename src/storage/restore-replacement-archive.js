import { mkdir, opendir, rename } from "node:fs/promises";
import path from "node:path";
import { syncDirectory } from "./file-durability.js";
import { assertSafePath, writeFileAtomic } from "../core/filesystem.js";
import { canonicalFingerprint } from "../core/artifacts.js";
import { getPackageRoot } from "../core/templates.js";
import { MAINTENANCE_OWNER_ID, readMaintenanceOwner } from "./maintenance-owner.js";
import { assertOwnedStorageMaintenance, retainStorageMaintenance, assertStorageMaintenanceOwnerContinuity } from "./maintenance.js";
import { readStorageMetadataJson } from "./metadata-json.js";
import { LEGACY_SOURCE_ROOTS, inventoryStorageRoots } from "./migration-source.js";
import { withVerifiedProjectStorageBackup } from "./project-backup.js";
import { validateMigrationDatabase } from "./migration-validation.js";
import { restorePathExists } from "./restore-layout.js";
import { REPLACEMENT_ACTIVE_ROOTS, assertReplacementConnectionsClosed, assertActiveStorageReplacementUnchanged, verifyPreparedActiveStorageReplacement } from "./restore-replacement.js";
import { adoptPreparedReplacementOwner } from "./restore-replacement-owner.js";
import { inventoryPresent, subsetInventory } from "./migration-source-partition.js";

const invalid = message => Object.assign(new Error(message), { code: "E_STORAGE_RESTORE_INVALID" });
const hash = value => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const belongs = (name, root) => name === root || name.startsWith(`${root}/`);

async function incomingSnapshot(target, operationId, packageRoot) {
  const root = await assertSafePath(target, `.forgeloop/storage-restores/${operationId}/snapshot`);
  return withVerifiedProjectStorageBackup(root, async ({ db, manifest }) => {
    await validateMigrationDatabase(db, { target: root, packageRoot });
    return { root, fingerprint: canonicalFingerprint(manifest) };
  });
}

async function inventoryArchive(archive) {
  if (!await restorePathExists(path.dirname(archive), path.basename(archive))) return { files: [], directories: [] };
  for await (const entry of await opendir(archive)) {
    if (entry.name !== ".forgeloop" || !entry.isDirectory()) throw invalid("Replacement archive contains unexpected root membership");
  }
  const inventory = await inventoryStorageRoots(archive, [".forgeloop"]);
  if (inventory.files.some(file => !REPLACEMENT_ACTIVE_ROOTS.some(root => belongs(file.path, root)))
    || inventory.directories.some(name => name !== ".forgeloop" && !belongs(name, ".forgeloop/attachments"))) throw invalid("Replacement archive contains unexpected retained membership");
  return inventory;
}

/** Reconcile location from actual membership/digests, not progress annotations. */
export async function inspectActiveStorageReplacementPartition(target, operationId) {
  const retained = await verifyPreparedActiveStorageReplacement(target, operationId);
  await assertReplacementConnectionsClosed(target);
  for (const relative of LEGACY_SOURCE_ROOTS) {
    if (relative !== ".forgeloop/attachments" && await restorePathExists(target, relative)) throw invalid(`Replacement archival refuses mixed legacy state: ${relative}`);
  }
  const active = await inventoryStorageRoots(target, REPLACEMENT_ACTIVE_ROOTS);
  const archive = await assertSafePath(retained.root, "archive");
  const archived = await inventoryArchive(archive);
  const roots = [];
  for (const root of REPLACEMENT_ACTIVE_ROOTS) {
    const original = subsetInventory(retained.manifest.inventory, root);
    const current = subsetInventory(active, root);
    const historical = subsetInventory(archived, root);
    if (inventoryPresent(current) && inventoryPresent(historical)) throw invalid(`Outgoing root exists in both active and archived locations: ${root}`);
    if (canonicalFingerprint(inventoryPresent(current) ? current : historical) !== canonicalFingerprint(original)) throw invalid(`Outgoing replacement membership or bytes differ: ${root}`);
    roots.push({ path: root, location: inventoryPresent(current) ? "ACTIVE" : inventoryPresent(historical) ? "ARCHIVED" : "ABSENT" });
  }
  if (!retained.manifest.inventory.files.some(file => file.path === ".forgeloop/state.sqlite")
    || !retained.manifest.inventory.files.some(file => file.path === ".forgeloop/storage-version.json")) throw invalid("Outgoing replacement inventory omits database or marker authority");
  return { ...retained, archive, roots };
}

async function readArchiveJournal(retained, operationId) {
  const journal = await readStorageMetadataJson(retained.root, "archive-journal.json");
  if (!journal || journal.schemaVersion !== 1 || journal.kind !== "ACTIVE_PROJECT_REPLACEMENT_ARCHIVE" || journal.operationId !== operationId
    || !MAINTENANCE_OWNER_ID.test(journal.ownerId ?? "") || (journal.resumedFrom !== undefined && !MAINTENANCE_OWNER_ID.test(journal.resumedFrom))
    || !["ARCHIVING", "ARCHIVED"].includes(journal.phase)
    || !hash(journal.outgoingFingerprint) || !hash(journal.incomingFingerprint)
    || journal.outgoingFingerprint !== canonicalFingerprint(retained.manifest)) throw invalid("Replacement archive journal is incomplete or differs from outgoing evidence");
  return journal;
}

/** Verify immutable outgoing evidence after incoming roots occupy the active namespace.
 * Callers must supply the fingerprints persisted in their publication intent.
 */
export async function verifyRetainedStorageReplacementArchive(target, operationId, { outgoingFingerprint, incomingFingerprint, packageRoot = getPackageRoot() } = {}) {
  if (!hash(outgoingFingerprint) || !hash(incomingFingerprint)) throw invalid("Retained archival verification requires explicit publication bindings");
  const retained = await verifyPreparedActiveStorageReplacement(target, operationId);
  const journal = await readArchiveJournal(retained, operationId);
  if (journal.phase !== "ARCHIVED" || journal.outgoingFingerprint !== outgoingFingerprint || journal.incomingFingerprint !== incomingFingerprint) throw invalid("Retained archive differs from publication intent");
  const archive = await assertSafePath(retained.root, "archive");
  const inventory = await inventoryArchive(archive);
  for (const root of REPLACEMENT_ACTIVE_ROOTS) {
    if (canonicalFingerprint(subsetInventory(inventory, root)) !== canonicalFingerprint(subsetInventory(retained.manifest.inventory, root))) throw invalid(`Retained outgoing membership or bytes differ: ${root}`);
  }
  const incoming = await incomingSnapshot(target, operationId, packageRoot);
  if (incoming.fingerprint !== incomingFingerprint) throw invalid("Incoming replacement snapshot differs from publication intent");
  return { ...retained, archive, journal, incomingSnapshot: incoming.root, archived: true, replaced: false };
}

export async function verifyActiveStorageReplacementArchive(target, operationId, { packageRoot = getPackageRoot() } = {}) {
  const partition = await inspectActiveStorageReplacementPartition(target, operationId);
  const journal = await readArchiveJournal(partition, operationId);
  const incoming = await incomingSnapshot(target, operationId, packageRoot);
  if (incoming.fingerprint !== journal.incomingFingerprint) throw invalid("Incoming replacement snapshot changed after archival intent");
  if (journal.phase === "ARCHIVED" && partition.roots.some(root => root.location === "ACTIVE")) throw invalid("Replacement journal claims archival before active roots were retained");
  return { ...partition, journal, incomingSnapshot: incoming.root, archived: journal.phase === "ARCHIVED", replaced: false };
}

async function ownerAdoption(target, currentOwnerId, recordedOwnerId, expectedOwnerId) {
  if (currentOwnerId === recordedOwnerId) return {};
  const owner = (await readMaintenanceOwner(target)).value;
  if (owner.resumedFrom !== expectedOwnerId) throw invalid("Replacement archival requires exact recorded owner adoption");
  await assertStorageMaintenanceOwnerContinuity(target, { expectedOwnerId: currentOwnerId, recordedOwnerId });
  return { resumedFrom: recordedOwnerId };
}

/** Archive only after both outgoing authority and incoming snapshot are verified. */
export async function archiveActiveStorageReplacement(target, operationId, { packageRoot = getPackageRoot(), expectedOwnerId = null } = {}) {
  const ownerId = await assertOwnedStorageMaintenance(target);
  await retainStorageMaintenance(target);
  const retained = await verifyPreparedActiveStorageReplacement(target, operationId);
  const filename = await assertSafePath(retained.root, "archive-journal.json");
  let journal = await readStorageMetadataJson(retained.root, "archive-journal.json", { optional: true });
  if (!journal) {
    await adoptPreparedReplacementOwner(target, operationId, { expectedOwnerId });
    await assertActiveStorageReplacementUnchanged(target, operationId);
    const incoming = await incomingSnapshot(target, operationId, packageRoot);
    if (await restorePathExists(retained.root, "archive")) throw invalid("Unrecorded replacement archive requires reconciliation");
    journal = { schemaVersion: 1, kind: "ACTIVE_PROJECT_REPLACEMENT_ARCHIVE", operationId, ownerId, phase: "ARCHIVING",
      outgoingFingerprint: canonicalFingerprint(retained.manifest), incomingFingerprint: incoming.fingerprint };
    await assertOwnedStorageMaintenance(target);
    await writeFileAtomic(filename, `${JSON.stringify(journal, null, 2)}\n`);
  } else {
    journal = await readArchiveJournal(retained, operationId);
    if (journal.ownerId !== ownerId) {
      const adoption = await ownerAdoption(target, ownerId, journal.ownerId, expectedOwnerId);
      journal = { ...journal, ownerId, ...adoption };
      await assertOwnedStorageMaintenance(target);
      await writeFileAtomic(filename, `${JSON.stringify(journal, null, 2)}\n`);
    }
    await verifyActiveStorageReplacementArchive(target, operationId, { packageRoot });
    if (journal.phase === "ARCHIVED") {
      return verifyActiveStorageReplacementArchive(target, operationId, { packageRoot });
    }
  }
  let partition = await inspectActiveStorageReplacementPartition(target, operationId);
  await mkdir(partition.archive, { recursive: true });
  await syncDirectory(partition.root);
  for (const root of partition.roots) {
    if (root.location !== "ACTIVE") continue;
    await assertOwnedStorageMaintenance(target);
    partition = await inspectActiveStorageReplacementPartition(target, operationId);
    if (partition.roots.find(current => current.path === root.path).location !== "ACTIVE") throw invalid("Outgoing source location changed during replacement archival");
    const source = await assertSafePath(target, root.path);
    const destination = await assertSafePath(partition.archive, root.path);
    await mkdir(path.dirname(destination), { recursive: true });
    await rename(source, destination);
    await syncDirectory(path.dirname(source));
    await syncDirectory(path.dirname(destination));
    await syncDirectory(partition.archive);
    await inspectActiveStorageReplacementPartition(target, operationId);
  }
  const final = await verifyActiveStorageReplacementArchive(target, operationId, { packageRoot });
  if (final.roots.some(root => root.location === "ACTIVE")) throw invalid("Replacement archival is incomplete");
  journal.phase = "ARCHIVED";
  await assertOwnedStorageMaintenance(target);
  await writeFileAtomic(filename, `${JSON.stringify(journal, null, 2)}\n`);
  return verifyActiveStorageReplacementArchive(target, operationId, { packageRoot });
}
