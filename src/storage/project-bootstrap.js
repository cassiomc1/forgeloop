import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { assertSafePath } from "../core/filesystem.js";
import { openStorageDatabase } from "./connection.js";
import { backupProjectStorage } from "./project-backup.js";
import { assertFreshOperationalState, restoreProjectStorageToFreshProject } from "./project-restore.js";
import { assertStorageNodeVersion } from "./runtime.js";

/** Publish an empty store through the same journaled path as a verified restore.
 * Retain the seed: a PREPARING restore needs its independent source on recovery.
 * This primitive requires writer exclusion from its caller, just like restore.
 */
export async function bootstrapProjectStorage(target, { writersQuiesced = false, packageRoot } = {}) {
  if (writersQuiesced !== true) throw Object.assign(new Error("Exclude all writers before storage bootstrap"), { code: "E_STORAGE_MIGRATION_QUIESCENCE_REQUIRED" });
  assertStorageNodeVersion();
  await assertFreshOperationalState(target);
  const root = await assertSafePath(target, `.forgeloop/storage-bootstrap/${randomUUID()}`);
  await mkdir(root, { recursive: true });
  const db = openStorageDatabase(await assertSafePath(root, "seed.sqlite"));
  const source = await assertSafePath(root, "snapshot");
  try { await backupProjectStorage(db, root, source); }
  finally { db.close(); }
  return restoreProjectStorageToFreshProject(source, target, { writersQuiesced, packageRoot });
}
