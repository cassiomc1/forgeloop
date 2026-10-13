import { loadStorageDriver } from "./runtime.js";
import { mkdtemp, rm, link, open } from "node:fs/promises";
import path from "node:path";
import { assertSafePath } from "../core/filesystem.js";
import { checkStorageIntegrity, openStorageDatabase } from "./connection.js";

/** Database-only backup; attachment restore requires its own verified inventory. */
export async function backupStorageDatabase(db, destination) {
  const { backup, DatabaseSync } = loadStorageDriver();
  if (db.isTransaction) throw Object.assign(new Error("Backup requires committed storage state"), { code: "E_STORAGE_SNAPSHOT_TRANSACTION" });
  const absolute = path.resolve(destination);
  const parent = path.dirname(absolute);
  await assertSafePath(parent, path.basename(absolute));
  const temporary = await mkdtemp(path.join(parent, ".forgeloop-backup-"));
  const filename = path.join(temporary, "state.sqlite");
  try {
    await backup(db, filename);
    const snapshot = new DatabaseSync(filename, { readOnly: true, enableForeignKeyConstraints: true });
    try {
      const integrity = checkStorageIntegrity(snapshot);
      if (!integrity.ok) throw Object.assign(new Error("Backup snapshot failed storage integrity validation"), { code: "E_STORAGE_BACKUP_INVALID", integrity });
    } finally { snapshot.close(); }
    // FlushFileBuffers on Windows requires write access to this owned snapshot.
    const file = await open(filename, "r+");
    try { await file.sync(); } finally { await file.close(); }
    // Same-directory hard-link publication is atomic and cannot overwrite a
    // retained backup. The private temporary name is removed afterward.
    await link(filename, absolute);
    try {
      const directory = await open(parent, "r");
      try { await directory.sync(); } finally { await directory.close(); }
    } catch (error) {
      // Match the existing portable atomic-file boundary on platforms that
      // cannot open/sync directories. Other I/O failures remain visible.
      if (!["EINVAL", "EPERM", "EISDIR", "ENOTSUP", "UNKNOWN"].includes(error.code)) throw error;
    }
    return { path: absolute, kind: "DATABASE_ONLY", attachmentsIncluded: false };
  } finally { await rm(temporary, { recursive: true, force: true }); }
}

/** Restore into a fresh database pathname; never replace an active project. */
export async function restoreStorageDatabase(source, destination) {
  const absolute = path.resolve(source);
  const parent = path.dirname(absolute);
  for (const suffix of ["", "-wal", "-shm"]) await assertSafePath(parent, `${path.basename(absolute)}${suffix}`);
  // Read-only open rejects unsupported schema/format metadata rather than
  // silently upgrading a retained backup during a restore drill.
  const db = openStorageDatabase(absolute, { readOnly: true });
  try {
    const restored = await backupStorageDatabase(db, destination);
    return { ...restored, source: absolute, restored: true };
  } finally { db.close(); }
}
