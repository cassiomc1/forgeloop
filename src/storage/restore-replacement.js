import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdir } from "node:fs/promises";
import { assertSafePath, writeFileAtomic } from "../core/filesystem.js";
import { canonicalFingerprint } from "../core/artifacts.js";
import { assertJsonBytes, assertJsonLimits } from "../core/json-safety.js";
import { getPackageRoot } from "../core/templates.js";
import { getOperationalStore } from "./operational-context.js";
import { MAINTENANCE_OWNER_ID } from "./maintenance-owner.js";
import { assertOwnedStorageMaintenance } from "./maintenance.js";
import { STORAGE_CATALOG_LIMITS, readStorageMetadataJson } from "./metadata-json.js";
import { LEGACY_SOURCE_ROOTS, inventoryStorageRoots } from "./migration-source.js";
import { readStorageVersionMarker, validateStorageVersionMarker } from "./storage-marker.js";
import { restorePathExists } from "./restore-layout.js";
import { checkStorageIntegrity, openStorageDatabase, readStorageMeta } from "./connection.js";
import { backupProjectStorage, withVerifiedProjectStorageBackup } from "./project-backup.js";
import { validateMigrationDatabase } from "./migration-validation.js";
import { iterateAttachmentReferences } from "./attachment-references.js";
import { verifyAttachmentFile } from "./attachment-files.js";
import { logicalSnapshot } from "./migration-candidate.js";

const invalid = message => Object.assign(new Error(message), { code: "E_STORAGE_RESTORE_INVALID" });
const hash = value => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const DATABASE = ".forgeloop/state.sqlite";
export const REPLACEMENT_ACTIVE_ROOTS = Object.freeze([".forgeloop/storage-version.json", ".forgeloop/attachments", DATABASE]);

async function replacementRoot(target, operationId) {
  if (!MAINTENANCE_OWNER_ID.test(operationId ?? "")) throw invalid("Replacement preparation requires an exact restore operation identity");
  return assertSafePath(target, `.forgeloop/storage-restores/${operationId}/outgoing`);
}

async function digest(filename) {
  const result = createHash("sha256");
  for await (const bytes of createReadStream(filename)) result.update(bytes);
  return result.digest("hex");
}

export async function assertReplacementConnectionsClosed(target) {
  for (const suffix of ["-wal", "-shm"]) {
    if (await restorePathExists(target, `${DATABASE}${suffix}`)) throw invalid("Close all SQLite connections before replacement publication; retained sidecars require reconciliation");
  }
}

async function assertActiveLayout(target) {
  const marker = await readStorageVersionMarker(target);
  if (marker?.phase !== "ACTIVE") throw invalid("Active replacement requires an ACTIVE SQLite storage marker");
  if (!(await lstat(await assertSafePath(target, DATABASE))).isFile()) throw invalid("Active replacement requires a regular canonical database");
  for (const relative of LEGACY_SOURCE_ROOTS) {
    if (relative !== ".forgeloop/attachments" && await restorePathExists(target, relative)) throw invalid(`Active replacement refuses mixed legacy operational state: ${relative}`);
  }
  return marker;
}

async function persistManifest(target, root, manifest) {
  await assertOwnedStorageMaintenance(target);
  assertJsonLimits(manifest, "Replacement outgoing manifest", STORAGE_CATALOG_LIMITS);
  const text = `${JSON.stringify(manifest, null, 2)}\n`;
  assertJsonBytes(text, "Replacement outgoing manifest", STORAGE_CATALOG_LIMITS);
  await writeFileAtomic(await assertSafePath(root, "replacement-manifest.json"), text);
}

/** Retain outgoing authority before any active-project archival or overwrite. */
export async function prepareActiveStorageReplacement(target, operationId, { writersQuiesced = false, packageRoot = getPackageRoot() } = {}) {
  if (writersQuiesced !== true) throw Object.assign(new Error("Stop all writers and close their database connections before active replacement"), { code: "E_STORAGE_MIGRATION_QUIESCENCE_REQUIRED" });
  const ownerId = await assertOwnedStorageMaintenance(target);
  if (getOperationalStore(target)) throw invalid("Replacement cannot run inside an active operational command scope");
  const root = await replacementRoot(target, operationId);
  const marker = await assertActiveLayout(target);
  const db = openStorageDatabase(await assertSafePath(target, DATABASE), { allowSchemaUpgrade: false });
  let manifest;
  try {
    const metadata = readStorageMeta(db);
    if (metadata.schema_version !== marker.databaseSchemaVersion || metadata.storage_version !== marker.storageVersion
      || metadata.storage_format !== marker.storageFormat || !checkStorageIntegrity(db).ok) throw invalid("Outgoing database integrity or storage marker disagrees");
    if (db.prepare("SELECT 1 FROM task_artifacts WHERE kind = 'operationLease' LIMIT 1").get()) throw invalid("Reconcile every retained task operation reservation before active replacement");
    await validateMigrationDatabase(db, { target, packageRoot });
    await mkdir(await assertSafePath(target, `.forgeloop/storage-restores/${operationId}`), { recursive: true });
    if (await restorePathExists(target, `.forgeloop/storage-restores/${operationId}/outgoing`)) throw Object.assign(invalid("An earlier outgoing preparation must not be overwritten"), { code: "EEXIST" });
    const initialCheckpoint = db.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get();
    if (initialCheckpoint.busy !== 0 || initialCheckpoint.log !== 0) throw invalid("Outgoing preparation requires checkpointed authority");
    const baselineInventory = await inventoryStorageRoots(target, REPLACEMENT_ACTIVE_ROOTS);
    manifest = { schemaVersion: 2, kind: "ACTIVE_PROJECT_REPLACEMENT_OUTGOING", operationId, ownerId, status: "PREPARING", marker,
      preparationBaseline: { logicalFingerprint: canonicalFingerprint(logicalSnapshot(db)), inventory: baselineInventory, inventoryFingerprint: canonicalFingerprint(baselineInventory) } };
    await persistManifest(target, await assertSafePath(target, `.forgeloop/storage-restores/${operationId}`), manifest);
    await mkdir(root); // Never overwrite an earlier preparation or its evidence.
    await persistManifest(target, root, manifest);
    const backup = await assertSafePath(root, "backup");
    await backupProjectStorage(db, target, backup);
    await withVerifiedProjectStorageBackup(backup, async retained => {
      await validateMigrationDatabase(retained.db, { target: retained.root, packageRoot });
      const logicalFingerprint = canonicalFingerprint(logicalSnapshot(retained.db));
      if (logicalFingerprint !== canonicalFingerprint(logicalSnapshot(db))) throw invalid("Outgoing state changed while its retained backup was prepared");
      Object.assign(manifest, { backupFingerprint: canonicalFingerprint(retained.manifest), logicalFingerprint });
    });
    await assertOwnedStorageMaintenance(target);
    const checkpoint = db.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get();
    if (checkpoint.busy !== 0 || checkpoint.log !== 0) throw invalid("Outgoing database still has active readers or required WAL contents");
    const inventory = await inventoryStorageRoots(target, REPLACEMENT_ACTIVE_ROOTS);
    Object.assign(manifest, { databaseSha256: await digest(await assertSafePath(target, DATABASE)), inventory, inventoryFingerprint: canonicalFingerprint(inventory) });
    if (canonicalFingerprint(logicalSnapshot(db)) !== manifest.logicalFingerprint) throw invalid("Outgoing state changed before its closed database binding was recorded");
  } catch (error) {
    if (manifest) { manifest.status = "FAILED"; manifest.error = { code: error.code ?? "E_STORAGE_RESTORE_INVALID", message: error.message }; try { await persistManifest(target, root, manifest); } catch { /* PREPARING is also refused. */ } }
    throw error;
  } finally { db.close(); }
  try {
    await assertReplacementConnectionsClosed(target);
    if (canonicalFingerprint(await assertActiveLayout(target)) !== canonicalFingerprint(marker)) throw invalid("Outgoing storage marker changed during preparation");
    manifest.status = "READY";
    await assertOwnedStorageMaintenance(target);
    await persistManifest(target, root, manifest);
    return assertActiveStorageReplacementUnchanged(target, operationId);
  } catch (error) {
    manifest.status = "FAILED"; manifest.error = { code: error.code ?? "E_STORAGE_RESTORE_INVALID", message: error.message };
    try { await persistManifest(target, root, manifest); } catch { /* PREPARING is also refused. */ }
    throw error;
  }
}

/** Read-only verification of retained outgoing authority, independent of publication. */
export async function verifyPreparedActiveStorageReplacement(target, operationId) {
  const root = await replacementRoot(target, operationId);
  const manifest = await readStorageMetadataJson(root, "replacement-manifest.json");
  if (!manifest || manifest.schemaVersion !== 2 || manifest.kind !== "ACTIVE_PROJECT_REPLACEMENT_OUTGOING" || manifest.operationId !== operationId
    || !MAINTENANCE_OWNER_ID.test(manifest.ownerId ?? "") || manifest.status !== "READY" || manifest.marker?.phase !== "ACTIVE"
    || !hash(manifest.databaseSha256) || !hash(manifest.backupFingerprint) || !hash(manifest.logicalFingerprint)
    || !hash(manifest.inventoryFingerprint) || canonicalFingerprint(manifest.inventory ?? null) !== manifest.inventoryFingerprint) throw invalid("Outgoing replacement evidence is incomplete or inconsistent");
  validateStorageVersionMarker(manifest.marker);
  await withVerifiedProjectStorageBackup(await assertSafePath(root, "backup"), retained => {
    const metadata = readStorageMeta(retained.db);
    if (canonicalFingerprint(retained.manifest) !== manifest.backupFingerprint || canonicalFingerprint(logicalSnapshot(retained.db)) !== manifest.logicalFingerprint
      || metadata.schema_version !== manifest.marker.databaseSchemaVersion || metadata.storage_version !== manifest.marker.storageVersion
      || metadata.storage_format !== manifest.marker.storageFormat) throw invalid("Outgoing backup differs from its replacement binding");
  });
  return { root, manifest, backup: await assertSafePath(root, "backup"), outgoingVerified: true, replaced: false };
}

/** Must pass immediately before archiving the closed outgoing active layout. */
export async function assertActiveStorageReplacementUnchanged(target, operationId) {
  await assertOwnedStorageMaintenance(target);
  const retained = await verifyPreparedActiveStorageReplacement(target, operationId);
  await assertReplacementConnectionsClosed(target);
  if (canonicalFingerprint(await assertActiveLayout(target)) !== canonicalFingerprint(retained.manifest.marker)
    || await digest(await assertSafePath(target, DATABASE)) !== retained.manifest.databaseSha256
    || canonicalFingerprint(await inventoryStorageRoots(target, REPLACEMENT_ACTIVE_ROOTS)) !== retained.manifest.inventoryFingerprint) throw invalid("Active state changed after outgoing replacement preparation; archival is forbidden");
  await withVerifiedProjectStorageBackup(retained.backup, async ({ db }) => {
    for (const reference of iterateAttachmentReferences(db)) await verifyAttachmentFile(target, reference);
  });
  return retained;
}
