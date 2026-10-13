import { E_PROTOCOL_MIGRATION_TARGET_UNSUPPORTED } from "./error-codes.js";
import { PROTOCOL_VERSION } from "./protocol.js";
import { detectLegacySingletonLayout } from "./task-migration.js";
import { migrateLegacyTaskStorage } from "./task-storage-migration.js";
import { getPackageRoot } from "./templates.js";

export function assertSupportedProtocolMigrationTarget(to) {
  if (to === undefined || to === null || to === "") {
    const error = new Error("migrate-protocol requires --to <protocolVersion>");
    error.code = E_PROTOCOL_MIGRATION_TARGET_UNSUPPORTED;
    throw error;
  }

  if (String(to) !== String(PROTOCOL_VERSION)) {
    const error = new Error(
      `Protocol version ${to} is not supported by this ForgeLoop release; supported target: ${PROTOCOL_VERSION}.`,
    );
    error.code = E_PROTOCOL_MIGRATION_TARGET_UNSUPPORTED;
    throw error;
  }
}

/**
 * Migrates only state that has an explicitly supported, receipt-backed path.
 * Future protocol versions must add a dedicated migration before becoming an
 * accepted target here; accepting an unknown target would risk silent rewrite.
 */
export async function migrateProtocol(
  target,
  { to, dryRun = false, packageRoot = getPackageRoot(), destination, writersQuiesced = false } = {},
) {
  assertSupportedProtocolMigrationTarget(to);
  const legacy = await detectLegacySingletonLayout(target);

  if (!legacy.hasLegacy) {
    return {
      migrated: false,
      dryRun,
      fromProtocol: PROTOCOL_VERSION,
      toProtocol: PROTOCOL_VERSION,
      status: "ALREADY_COMPATIBLE",
      actions: [],
      message: `Target already uses supported protocol ${PROTOCOL_VERSION}; no migration is required.`,
    };
  }

  const result = await migrateLegacyTaskStorage(target, { dryRun, packageRoot, destination, writersQuiesced });
  return {
    ...result,
    fromProtocol: PROTOCOL_VERSION,
    toProtocol: PROTOCOL_VERSION,
    status: dryRun ? "PLANNED_LEGACY_LAYOUT_MIGRATION" : "MIGRATED_LEGACY_LAYOUT",
    actions: [{
      kind: "LEGACY_LAYOUT_MIGRATION",
      command: "task-migrate",
      receipt: result.migrationReceipt ?? "<destination>/publication/publication-journal.json",
      artifacts: legacy.legacyFiles.map((item) => item.path),
    }],
  };
}
