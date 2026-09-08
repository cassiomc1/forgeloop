import os from "node:os";
import path from "node:path";

import { REPOSITORY_INDEX_RELATIVE_PATH, REPOSITORY_INDEX_STATE_FILE } from "./constants.js";

export function getEngineHome({ homeDirectory = os.homedir() } = {}) {
  return path.join(homeDirectory, ".forgeloop", "engines", "tgrep");
}
export function getTgrepVersionDirectory(version, options = {}) {
  return path.join(getEngineHome(options), version);
}

export function getManagedTgrepDirectory(version, platformKey, options = {}) {
  return path.join(getTgrepVersionDirectory(version, options), platformKey);
}

export function getManagedTgrepBinaryPath(version, platformKey, { windows = platformKey.startsWith("windows-") || process.platform === "win32", ...options } = {}) {
  return path.join(getManagedTgrepDirectory(version, platformKey, options), windows ? "tgrep.exe" : "tgrep");
}

export function getRepositoryIndexRoot(repoRoot) {
  return path.join(repoRoot, REPOSITORY_INDEX_RELATIVE_PATH);
}

export function getTgrepIndexPath(repoRoot) {
  return path.join(getRepositoryIndexRoot(repoRoot), "tgrep");
}

export function getRepositoryIndexStatePath(repoRoot) {
  return path.join(getRepositoryIndexRoot(repoRoot), REPOSITORY_INDEX_STATE_FILE);
}

export function getRepositoryIndexMetricsPath(repoRoot) {
  return path.join(getRepositoryIndexRoot(repoRoot), "metrics");
}

export function getRepositoryIndexLockPath(repoRoot) {
  return path.join(getRepositoryIndexRoot(repoRoot), "operation.lock");
}
