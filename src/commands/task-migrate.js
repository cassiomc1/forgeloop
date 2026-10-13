import { migrateLegacyTaskStorage } from "../core/task-storage-migration.js";

export async function runTaskMigrate({ target, packageRoot, dryRun = false, destination, writersQuiesced = false } = {}) {
  const result = await migrateLegacyTaskStorage(target, { packageRoot, dryRun, destination, writersQuiesced });
  return result;
}

export function formatTaskMigrateResult(result) {
  if (!result.migrated) {
    if (result.dryRun) {
      const lines = [
        `[dry-run] task: ${result.taskId}`,
        `key: ${result.taskKey}`,
        `destination: ${result.targetDirectory}`,
        "legacy artifacts:",
        ...(result.legacyFiles ?? []).map((artifact) => `  - ${artifact}`),
      ];

      return `${lines.join("\n")}\n`;
    }

    return `${result.message ?? "no legacy layout detected; nothing to migrate"}\n`;
  }

  const lines = [
    `migrated task: ${result.taskId}`,
    `key: ${result.taskKey}`,
    `destination: ${result.targetDirectory}`,
    "migrated artifacts:",
    ...(result.migratedArtifacts ?? []).map((artifact) => `  - ${artifact}`),
  ];

  return `${lines.join("\n")}\n`;
}
