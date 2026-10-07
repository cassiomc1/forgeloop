import { resumeStorageMaintenance, withStorageMaintenance } from "./maintenance.js";
import { resumeLegacySourceCapture } from "./migration-source.js";
import { prepareMigrationCandidate, resumeMigrationCandidate } from "./migration-candidate.js";
import { stageMigrationPublication } from "./migration-publication.js";
import { archiveMigrationSources } from "./migration-archive.js";
import { activateArchivedMigration } from "./migration-activate.js";
import { verifyPublishedMigration } from "./migration-terminal.js";

/** Initial cutover only. Failed attempts retain exclusion and evidence for recovery. */
export async function migrateProjectStorage(target, { destination, writersQuiesced = false, packageRoot } = {}) {
  if (typeof destination !== "string" || !destination || writersQuiesced !== true) {
    throw Object.assign(new Error("storage-migrate requires --destination and explicit --writers-quiesced"), { code: "E_CLI_INVOCATION_INVALID" });
  }
  return withStorageMaintenance(target, async () => {
    const options = { writersQuiesced, packageRoot };
    await prepareMigrationCandidate(target, { destination, ...options });
    await stageMigrationPublication(target, destination, options);
    await archiveMigrationSources(target, destination, options);
    const activated = await activateArchivedMigration(target, destination, options);
    const verified = await verifyPublishedMigration(target, destination, options);
    return { ...verified, path: activated.path, destination };
  }, { retainOnError: true });
}


/** Resume retained publication, rebuilding only verified unpublished staging. */
export async function resumeProjectStorageMigration(target, { destination, expectedOwnerId, writersQuiesced = false, packageRoot } = {}) {
  if (typeof destination !== "string" || !destination) {
    throw Object.assign(new Error("Migration resume requires the retained destination"), { code: "E_CLI_INVOCATION_INVALID" });
  }
  return resumeStorageMaintenance(target, { expectedOwnerId, writersQuiesced }, async () => {
    const options = { writersQuiesced, packageRoot };
    await resumeLegacySourceCapture(target, destination, options);
    await resumeMigrationCandidate(target, destination, options);
    const { resumeMigrationPublicationStage } = await import("./migration-publication.js");
    const staged = await resumeMigrationPublicationStage(target, destination, options);
    if (staged.journal.phase !== "PUBLISHED") {
      if (["STAGED", "ARCHIVING"].includes(staged.journal.phase)) await archiveMigrationSources(target, destination, options);
      await activateArchivedMigration(target, destination, options);
    }
    return { ...await verifyPublishedMigration(target, destination, options), destination };
  });
}
