import { assertSafePath } from "../core/filesystem.js";
import { lstat, readdir } from "node:fs/promises";

/** A retained legacy owner cannot be silently displaced by native admission. */
export async function assertNoLegacyOperationLocks(target, { code = "E_STORAGE_MIGRATION_REQUIRED" } = {}) {
  async function exists(relativePath) {
    const filename = await assertSafePath(target, relativePath);
    try { return { filename, info: await lstat(filename) }; }
    catch (error) { if (error.code === "ENOENT") return null; throw error; }
  }
  if (await exists(".forgeloop/.claims.lock")) {
    throw Object.assign(new Error("Retained lock requires reconciliation: .forgeloop/.claims.lock"), { code });
  }
  const locks = await exists(".forgeloop/locks");
  if (locks && (!locks.info.isDirectory() || (await readdir(locks.filename)).length)) {
    throw Object.assign(new Error("Task locks require reconciliation before native admission"), { code });
  }
}
