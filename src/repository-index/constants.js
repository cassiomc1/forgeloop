export const REPOSITORY_INDEX_SCHEMA_VERSION = 1;
export const REPOSITORY_INDEX_ENGINE = "tgrep";
export const REPOSITORY_INDEX_REQUIRED = true;
export const REPOSITORY_INDEX_RELATIVE_PATH = ".forgeloop/repository-index";
export const REPOSITORY_INDEX_STATE_FILE = "engine-state.json";
export const REPOSITORY_INDEX_METRICS_DIRECTORY = "metrics";

export const REPOSITORY_INDEX_DEFAULTS = Object.freeze({
  maxFileSize: "64M",
  maxCpuPercent: 50,
  watcherQueueCap: 16_384,
  autoSaveMutations: 5_000,
  startupTimeoutMs: 60_000,
  commandTimeoutMs: 120_000,
  maxProcessOutputBytes: 8 * 1024 * 1024,
  maxAssetBytes: 100 * 1024 * 1024,
});

export const REPOSITORY_INDEX_SUPPORTED_PLATFORMS = Object.freeze([
  "darwin-arm64",
  "darwin-x64",
  "linux-x64",
  "windows-x64",
]);

export const REPOSITORY_INDEX_SEARCH_EVENT_TYPES = Object.freeze([
  "begin",
  "match",
  "context",
  "end",
  "summary",
]);

export const REPOSITORY_INDEX_HEALTH = Object.freeze([
  "READY",
  "INDEXING",
  "NOT_INITIALIZED",
  "ENGINE_MISSING",
  "ENGINE_INVALID",
  "SERVER_DOWN",
  "SERVER_UNHEALTHY",
  "ERROR",
]);

export const REPOSITORY_INDEX_ENV_BINARY = "FORGELOOP_TGREP_BINARY";
