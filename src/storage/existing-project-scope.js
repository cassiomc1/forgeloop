import path from "node:path";
import { assertSafePath, fileExists } from "../core/filesystem.js";
import { LEGACY_TASK_ARTIFACT_PATHS } from "../core/task-paths.js";
import { getOperationalStore } from "./operational-context.js";

/** Select existing native authority only; never bootstrap or convert legacy data. */
export async function needsExistingProjectScope(target) {
  if (getOperationalStore(target)) return false;
  for (const relative of [".forgeloop/state.sqlite", ".forgeloop/storage-version.json"]) {
    if (await fileExists(await assertSafePath(target, relative))) return true;
  }
  for (const relative of [".forgeloop/state.sqlite-wal", ".forgeloop/state.sqlite-shm"]) {
    if (await fileExists(await assertSafePath(target, relative))) {
      throw Object.assign(new Error("Retained SQLite sidecars require explicit storage reconciliation; filesystem fallback is forbidden"), { code: "E_STORAGE_MIGRATION_REQUIRED" });
    }
  }
  return false;
}

export async function withExistingProjectScope(target, callback, { readOnly = false } = {}) {
  const { withProjectStorage } = await import("./project-boundary.js");
  return withProjectStorage(target, callback, { readOnly, existingOnly: true });
}

/** Operational namespaces require canonical SQLite even before first creation. */
export function isOperationalArtifactPath(relativePath) {
  const normalized = path.posix.normalize(relativePath.replaceAll("\\", "/"))
    .split("/").map(segment => segment.replace(/[. ]+$/, "").split(":")[0].toLowerCase()).join("/");
  return [...Object.values(LEGACY_TASK_ARTIFACT_PATHS), ".forgeloop/task-state", ".forgeloop/sessions", ".forgeloop/.txn"]
    .some(root => normalized === root || normalized.startsWith(`${root}/`));
}

/** A native project cannot acquire new writable singleton operational aliases. */
export function assertNativeWritePath(target, relativePath) {
  const store = getOperationalStore(target);
  const normalized = path.posix.normalize(relativePath.replaceAll("\\", "/"))
    .split("/").map(segment => segment.replace(/[. ]+$/, "").split(":")[0].toLowerCase()).join("/");
  const reservedRoots = [...Object.values(LEGACY_TASK_ARTIFACT_PATHS), ".forgeloop/task-state", ".forgeloop/sessions", ".forgeloop/.txn"];
  const databasePath = normalized === ".forgeloop/state.sqlite" || normalized.startsWith(".forgeloop/state.sqlite-")
    || normalized === ".forgeloop/storage-version.json";
  if (!databasePath && (!store || store.recognizes(relativePath))) return;
  if (databasePath || reservedRoots.some(root => normalized === root || normalized.startsWith(`${root}/`))) {
    throw Object.assign(new Error("SQLite operational writes require a canonical task-scoped path; legacy singleton persistence is retired"), { code: "E_STORAGE_OPERATION_UNSUPPORTED", artifacts: [relativePath] });
  }
}
