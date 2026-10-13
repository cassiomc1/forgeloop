import { migrateProjectStorage } from "../storage/migration.js";

export async function runStorageMigrate({ target, destination, writersQuiesced = false, packageRoot } = {}) {
  return migrateProjectStorage(target, { destination, writersQuiesced, packageRoot });
}
