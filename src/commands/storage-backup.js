import { getOperationalStore } from "../storage/operational-context.js";
import { assertSafePath } from "../core/filesystem.js";

export async function runStorageBackup({ target, destination, includeAttachments = false } = {}) {
  if (typeof destination !== "string" || !destination) throw Object.assign(new Error("storage-backup requires --destination"), { code: "E_CLI_INVOCATION_INVALID" });
  const store = getOperationalStore(target);
  if (!store) throw Object.assign(new Error("storage-backup requires an explicitly migrated SQLite project"), { code: "E_STORAGE_MIGRATION_REQUIRED" });
  const filename = await assertSafePath(target, destination);
  if (includeAttachments) {
    const { backupProjectStorage } = await import("../storage/project-backup.js");
    return backupProjectStorage(store.db, target, filename);
  }
  const { backupStorageDatabase } = await import("../storage/backup.js");
  return backupStorageDatabase(store.db, filename);
}
