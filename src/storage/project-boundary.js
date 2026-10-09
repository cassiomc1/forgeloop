import { getStorageConnectionOwner } from "../core/storage-runtime-registry.js";
import { lstat, realpath } from "node:fs/promises";
import { assertSafePath } from "../core/filesystem.js";
import { getOperationalStore } from "./operational-context.js";
import { assertStorageMaintenanceInactive } from "./maintenance.js";
import { readStorageVersionMarker } from "./storage-marker.js";
import { assertNoLegacyOperationLocks } from "./legacy-maintenance-boundary.js";

async function exists(filename) {
  try { await lstat(filename); return true; }
  catch (error) { if (error.code === "ENOENT") return false; throw error; }
}

async function bootstrapFreshProject(target) {
  const { assertStorageTopology } = await import("./topology.js");
  assertStorageTopology(await assertSafePath(target, ".forgeloop/state.sqlite"));
  const { LEGACY_SOURCE_ROOTS } = await import("./migration-source.js");
  for (const relative of [...LEGACY_SOURCE_ROOTS, ".forgeloop/state.sqlite-wal", ".forgeloop/state.sqlite-shm"]) {
    if (await exists(await assertSafePath(target, relative))) {
      throw Object.assign(new Error("Legacy operational state requires explicit storage migration before mutation"), { code: "E_STORAGE_MIGRATION_REQUIRED" });
    }
  }
  const { bootstrapProjectStorage } = await import("./project-bootstrap.js");
  // Fresh state has no legacy authority to convert. Restore publication owns
  // exclusive admission and rechecks freshness after acquiring it.
  await bootstrapProjectStorage(target, { writersQuiesced: true });
}

/** Bootstrap fresh writable projects; never convert legacy state implicitly. */
export async function withProjectStorage(target, callback, { readOnly = false, runtimeContext = null, connectionLease = null, existingOnly = false } = {}) {
  const owner = getStorageConnectionOwner(runtimeContext);
  if (owner && !getOperationalStore(target)) return owner.run(target, lease => withProjectStorage(target, callback, { readOnly, connectionLease: lease, existingOnly }), { readOnly });
  await assertStorageMaintenanceInactive(target);
  await assertNoLegacyOperationLocks(target);
  const marker = await readStorageVersionMarker(target);
  if (marker?.phase === "CUTOVER_PENDING") throw Object.assign(new Error("Storage cutover requires explicit recovery before ordinary dispatch"), { code: "E_STORAGE_MIGRATION_REQUIRED" });
  if (getOperationalStore(target)) return callback();
  const filename = await assertSafePath(target, ".forgeloop/state.sqlite");
  if (!(await exists(filename))) {
    connectionLease?.assertUnselected();
    if (marker || existingOnly) throw Object.assign(new Error("Selected SQLite storage requires its active database; filesystem fallback is forbidden"), { code: "E_STORAGE_MIGRATION_REQUIRED" });
    if (readOnly) return callback();
    await bootstrapFreshProject(target);
    return withProjectStorage(target, callback, { readOnly, connectionLease, existingOnly });
  }
  // SQLite opens these adjacent files itself; validate their containment too.
  await assertSafePath(target, ".forgeloop/state.sqlite-wal");
  await assertSafePath(target, ".forgeloop/state.sqlite-shm");
  for (const relativePath of [
    ".forgeloop/task-state",
    ".forgeloop/work-state.json",
    ".forgeloop/events.ndjson",
    ".forgeloop/.txn",
    ".forgeloop/session.json",
    ".forgeloop/sessions",
  ]) {
    if (await exists(await assertSafePath(target, relativePath))) {
      throw Object.assign(new Error("SQLite and writable legacy operational state cannot coexist; explicit migration is required"), { code: "E_STORAGE_MIGRATION_REQUIRED" });
    }
  }
  const [{ openStorageDatabase, readStorageMeta }, { withOperationalStore }] = await Promise.all([
    import("./connection.js"), import("./unit-of-work.js"),
  ]);
  const root = await realpath(target);
  const identity = await lstat(filename, { bigint: true });
  const rootIdentity = await lstat(target, { bigint: true });
  const options = { readOnly, allowSchemaUpgrade: !marker, allowOptionalIndexCreation: !readOnly,
    projectAdmission: { root, target, dev: identity.dev, ino: identity.ino, rootIdentity } };
  const db = connectionLease ? await connectionLease.open(filename, options) : openStorageDatabase(filename, options);
  try {
    if (marker) {
      const metadata = readStorageMeta(db);
      if (metadata.schema_version !== marker.databaseSchemaVersion || metadata.storage_version !== marker.storageVersion
        || metadata.storage_format !== marker.storageFormat) throw Object.assign(new Error("Active database metadata disagrees with its storage marker"), { code: "E_STORAGE_VERSION_MARKER_INVALID" });
    }
    return await withOperationalStore({ db, target, readOnly }, callback);
  }
  finally { if (!connectionLease) db.close(); }
}
