import { createRequire } from "node:module";

export const STORAGE_MINIMUM_NODE = "24.19.0";
export const STORAGE_TESTED_SQLITE = "3.53.3";
const require = createRequire(import.meta.url);
let driver;

function unsupported(message, cause) {
  return Object.assign(new Error(message, cause ? { cause } : undefined), { code: "E_STORAGE_UNSUPPORTED_RUNTIME" });
}

/** Reject older runtimes before loading SQLite or creating any storage files. */
export function assertStorageNodeVersion(version = process.versions.node) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version ?? "");
  if (!match || Number(match[1]) < 24 || (Number(match[1]) === 24 && Number(match[2]) < 19)) {
    throw unsupported(`ForgeLoop SQLite storage requires Node >=${STORAGE_MINIMUM_NODE}; detected ${version ?? "unknown"}`);
  }
}

/** One built-in driver path, loaded only when storage work is requested. */
export function loadStorageDriver() {
  assertStorageNodeVersion();
  if (!driver) {
    let loaded;
    try { loaded = require("node:sqlite"); }
    catch (error) { throw unsupported("This Node build does not provide the required built-in node:sqlite module", error); }
    if (typeof loaded.DatabaseSync !== "function" || typeof loaded.backup !== "function") throw unsupported("This Node build lacks the required SQLite database and native backup APIs");
    driver = loaded;
  }
  return driver;
}
