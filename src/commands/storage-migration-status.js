import { lstat } from "node:fs/promises";
import { assertSafePath } from "../core/filesystem.js";
import { readMaintenanceOwner } from "../storage/maintenance-owner.js";

async function present(target, relativePath) {
  try { await lstat(await assertSafePath(target, relativePath)); return true; }
  catch (error) { if (error.code === "ENOENT") return false; throw error; }
}

async function inspectOwner(target) {
  const marker = await assertSafePath(target, ".forgeloop/.storage-maintenance");
  if (!(await lstat(marker)).isDirectory()) return { status: "MALFORMED", owner: null };
  try {
    const { value } = await readMaintenanceOwner(target);
    return {
      status: "RETAINED",
      owner: { ownerId: value.ownerId, pid: value.pid, acquiredAt: value.acquiredAt, ...(value.hostname ? { hostname: value.hostname } : {}) },
      ownerLiveness: "NOT_VERIFIED",
      handoffPresent: await present(target, ".forgeloop/.storage-maintenance/handoff")
        || await present(target, `.forgeloop/storage-maintenance-history/handoffs/${value.ownerId}.json`),
    };
  } catch (error) {
    if (error.code === "ENOENT") return { status: "INCOMPLETE", owner: null };
    if (error.code === "E_STORAGE_MAINTENANCE_OWNER_INVALID") return { status: "MALFORMED", owner: null };
    throw error;
  }
}

/** Inspect bootstrap layout even when ordinary database dispatch is excluded. */
export async function runStorageMigrationStatus({ target }) {
  const databasePresent = await present(target, ".forgeloop/state.sqlite");
  const legacyOperationalPaths = [];
  for (const relativePath of [".forgeloop/task-state", ".forgeloop/work-state.json", ".forgeloop/events.ndjson", ".forgeloop/.txn"]) {
    if (await present(target, relativePath)) legacyOperationalPaths.push(relativePath);
  }
  const maintenance = await present(target, ".forgeloop/.storage-maintenance")
    ? await inspectOwner(target) : { status: "NONE", owner: null };
  return {
    schemaVersion: 1,
    layout: databasePresent ? legacyOperationalPaths.length ? "MIXED" : "SQLITE_PRESENT" : "FILESYSTEM",
    databasePresent, legacyOperationalPaths, maintenance,
    databaseValidation: "NOT_RUN", publicationValidation: "NOT_VERIFIED",
  };
}
