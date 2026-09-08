import path from "node:path";

import { processIsAlive } from "./status.js";

const readinessByRepository = new Map();

function normalize(value, platform = process.platform) {
  if (typeof value !== "string" || value.length === 0) return value;
  const pathApi = platform === "win32" ? path.win32 : path;
  const normalized = pathApi.normalize(value);
  return platform === "win32" ? normalized.toLowerCase() : normalized;
}

export function rememberRepositoryIndexReadiness({ canonicalRoot, status, platform } = {}) {
  if (typeof canonicalRoot !== "string" || !status?.indexPath || !status?.binaryPath || status.server?.running !== true) return null;
  const selectedPlatform = platform ?? status.platform?.platform ?? process.platform;
  const readiness = Object.freeze({
    canonicalRoot,
    indexPath: status.indexPath,
    binaryPath: status.binaryPath,
    engineVersion: status.engineVersion ?? null,
    serverRunning: true,
    pid: Number.isInteger(status.server?.pid) ? status.server.pid : null,
    platform: selectedPlatform,
    status,
    lastSuccessfulSearchAt: null,
  });
  readinessByRepository.set(normalize(canonicalRoot, selectedPlatform), readiness);
  return readiness;
}

export function getRepositoryIndexReadiness(canonicalRoot, platform = process.platform) {
  return readinessByRepository.get(normalize(canonicalRoot, platform)) ?? null;
}

export function invalidateRepositoryIndexReadiness(canonicalRoot, platform = process.platform) {
  if (typeof canonicalRoot !== "string") return;
  readinessByRepository.delete(normalize(canonicalRoot, platform));
}

export function clearRepositoryIndexReadiness() {
  readinessByRepository.clear();
}

export function markRepositoryIndexSearchSucceeded(canonicalRoot, platform = process.platform) {
  const current = getRepositoryIndexReadiness(canonicalRoot, platform);
  if (!current) return null;
  const next = Object.freeze({ ...current, lastSuccessfulSearchAt: new Date().toISOString() });
  readinessByRepository.set(normalize(canonicalRoot, platform), next);
  return next;
}

export function isRepositoryIndexReadinessUsable(readiness, expected = {}, { isAlive = processIsAlive } = {}) {
  if (!readiness || readiness.serverRunning !== true || typeof readiness.canonicalRoot !== "string") return false;
  const platform = expected.platform ?? readiness.platform ?? process.platform;
  if (expected.canonicalRoot && normalize(readiness.canonicalRoot, platform) !== normalize(expected.canonicalRoot, platform)) return false;
  if (expected.indexPath && normalize(readiness.indexPath, platform) !== normalize(expected.indexPath, platform)) return false;
  if (expected.binaryPath && normalize(readiness.binaryPath, platform) !== normalize(expected.binaryPath, platform)) return false;
  if (expected.engineVersion && readiness.engineVersion !== expected.engineVersion) return false;
  if (!Number.isInteger(readiness.pid) || !isAlive(readiness.pid)) return false;
  return true;
}
