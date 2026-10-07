import { lstat } from "node:fs/promises";
import path from "node:path";
import { realpathWithTransientWindowsRetry } from "../core/filesystem.js";
import { isOperationalArtifactPath } from "./existing-project-scope.js";

const NATIVE_EVIDENCE = ["state.sqlite", "state.sqlite-wal", "state.sqlite-shm", "storage-version.json"];

async function physicalDestination(destination) {
  let ancestor = path.resolve(destination);
  const missing = [];
  while (true) {
    try { return path.join(await realpathWithTransientWindowsRetry(ancestor), ...missing); }
    catch (error) {
      if (error.code !== "ENOENT") throw error;
      missing.unshift(path.basename(ancestor));
      const parent = path.dirname(ancestor);
      if (parent === ancestor) throw error;
      ancestor = parent;
    }
  }
}

async function exists(filename) {
  try { await lstat(filename); return true; }
  catch (error) { if (error.code === "ENOENT") return false; throw error; }
}

/** Portable output cannot recreate operational files alongside native authority. */
export async function assertPortableExportDestination(destination) {
  const physical = await physicalDestination(destination);
  let ancestor = physical;
  while (true) {
    const relative = path.relative(ancestor, physical).split(path.sep).join("/");
    if (relative === "" || isOperationalArtifactPath(relative)) {
      const evidence = await Promise.all(NATIVE_EVIDENCE.map(name => exists(path.join(ancestor, ".forgeloop", name))));
      if (evidence.some(Boolean)) {
        throw Object.assign(new Error("Portable export requires a separate destination outside native operational namespaces"), { code: "E_STORAGE_EXPORT_DESTINATION" });
      }
    }
    const parent = path.dirname(ancestor);
    if (parent === ancestor) return;
    ancestor = parent;
  }
}
