import path from "node:path";
import { realpathWithTransientWindowsRetry } from "../core/filesystem.js";

/** Resolve existing ancestors even when a configured target does not exist yet. */
export async function physicalTemporaryPath(filename) {
  let current = path.resolve(filename);
  const missing = [];
  while (true) {
    try { return path.join(await realpathWithTransientWindowsRetry(current), ...missing); }
    catch (error) {
      if (error.code !== "ENOENT") throw error;
      const parent = path.dirname(current);
      if (parent === current) throw error;
      missing.unshift(path.basename(current));
      current = parent;
    }
  }
}
