import { STORAGE_FORMAT, STORAGE_FORMAT_VERSION, STORAGE_RELATIVE_PATH, STORAGE_SCHEMA_VERSION } from "./schema.js";
import { STORAGE_MINIMUM_NODE } from "./runtime.js";

/** Package capabilities only; no project selection, database open or runtime probe. */
export function getStorageCapabilities() {
  return {
    version: 1,
    defaultBackend: "sqlite",
    soleSQLiteWriter: false,
    sqlite: {
      format: STORAGE_FORMAT,
      formatVersion: STORAGE_FORMAT_VERSION,
      schemaVersion: STORAGE_SCHEMA_VERSION,
      path: STORAGE_RELATIVE_PATH,
      driver: "node:sqlite",
      minimumNode: STORAGE_MINIMUM_NODE,
      selection: "FRESH_WRITABLE_BOOTSTRAP_OR_EXISTING_DATABASE",
    },
    portableFormats: ["JSON", "NDJSON"],
    migration: {
      explicit: true,
      requiresWritersQuiesced: true,
      resumeRequiresRecordedInventory: true,
      automaticDowngrade: false,
      commands: ["storage-migrate", "storage-migration-resume", "storage-migration-status", "storage-rollback", "storage-rollback-resume"],
      rollbackRequiresNativeWritesExcluded: true,
      rollbackRequiresPinnedLegacyTarget: true,
    },
    backup: { database: true, referencedAttachments: true, command: "storage-backup" },
  };
}
