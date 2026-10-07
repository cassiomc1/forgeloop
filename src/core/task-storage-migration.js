import { detectLegacySingletonLayout, migrateLegacyLayout } from "./task-migration.js";
import { migrateProjectStorage } from "../storage/migration.js";

/** Explicit legacy conversion now publishes canonical SQLite storage. */
export async function migrateLegacyTaskStorage(target, { packageRoot, dryRun = false, destination, writersQuiesced = false } = {}) {
  const detected = await detectLegacySingletonLayout(target);
  if (!detected.hasLegacy) return migrateLegacyLayout(target, { packageRoot, dryRun });
  if (dryRun) return { ...await migrateLegacyLayout(target, { packageRoot, dryRun }), targetDirectory: ".forgeloop/state.sqlite" };
  if (typeof destination !== "string" || !destination || writersQuiesced !== true) throw Object.assign(new Error("Legacy task migration requires --destination and explicit --writers-quiesced for SQLite cutover"), { code: "E_CLI_INVOCATION_INVALID" });
  const planned = await migrateLegacyLayout(target, { packageRoot, dryRun: true });
  const storage = await migrateProjectStorage(target, { destination, writersQuiesced, packageRoot });
  return {
    migrated: true, taskId: planned.taskId, taskKey: planned.taskKey,
    targetDirectory: ".forgeloop/state.sqlite", storage,
    migrationReceipt: `${destination}/publication/publication-journal.json`,
    migratedArtifacts: detected.legacyFiles.map(item => item.path),
  };
}
