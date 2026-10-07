import { resumeProjectStorageMigration } from "../storage/migration.js";

export async function runStorageMigrationResume({ target, destination, expectedOwnerId, writersQuiesced = false, packageRoot } = {}) {
  return resumeProjectStorageMigration(target, { destination, expectedOwnerId, writersQuiesced, packageRoot });
}
