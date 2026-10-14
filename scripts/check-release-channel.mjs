import { readFileSync, appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { getStorageCapabilities } from "../src/storage/capabilities.js";

export const usesBoundedRcVerification = version => /^2\.0\.0-rc\.[12]$/u.test(version);

export function validateReleaseChannel(version, channel, storage) {
  const rc = /^2\.0\.0-rc\.[1-9]\d*$/u.test(version);
  if (rc) {
    if (channel !== "next") throw new Error("RC releases must use next; latest is prohibited");
  } else {
    if (!/^\d+\.\d+\.\d+$/u.test(version) || channel !== "latest") throw new Error("Stable version/channel mismatch");
    if (Number(version.split(".")[0]) >= 2 && storage.soleSQLiteWriter !== true) throw new Error("Stable SQLite publication refused: sole-writer acceptance is incomplete");
  }
  return { rc, channel, version };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = validateReleaseChannel(JSON.parse(readFileSync("package.json", "utf8")).version, process.env.NPM_DIST_TAG, getStorageCapabilities());
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `rc=${result.rc}\nbounded_rc=${usesBoundedRcVerification(result.version)}\n`);
    console.log(JSON.stringify(result));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
