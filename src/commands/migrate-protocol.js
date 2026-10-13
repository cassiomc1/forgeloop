import { migrateProtocol } from "../core/protocol-migration.js";

export async function runMigrateProtocol({ target, packageRoot, to, dryRun = false, destination, writersQuiesced = false } = {}) {
  return migrateProtocol(target, { to, dryRun, packageRoot, destination, writersQuiesced });
}

export function formatMigrateProtocolResult(result) {
  const lines = [
    `target protocol: ${result.toProtocol}`,
    `status: ${result.status}`,
  ];

  if (result.dryRun) lines.unshift("[dry-run]");
  if (result.taskId) lines.push(`task: ${result.taskId}`);
  if (result.targetDirectory) lines.push(`destination: ${result.targetDirectory}`);
  lines.push(result.message ?? "legacy layout migration completed with a receipt");
  return `${lines.join("\n")}\n`;
}
