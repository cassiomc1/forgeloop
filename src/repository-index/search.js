import { realpath } from "node:fs/promises";

import { getCanonicalRepositorySearchArgs, appendSearchFilters } from "./args.js";
import { REPOSITORY_INDEX_DEFAULTS, REPOSITORY_INDEX_ENV_BINARY } from "./constants.js";
import { REPOSITORY_INDEX_ERROR_CODES, repositoryIndexError } from "./errors.js";
import { getManagedTgrepBinaryPath, getTgrepIndexPath } from "./paths.js";
import { getRepositoryIndexPlatform } from "./platform.js";
import { loadTgrepManifest } from "./manifest.js";
import { createTgrepBinaryHandle, runTgrep } from "./process.js";
import { normalizeTgrepJson } from "./normalize-json.js";
import { setupRepositoryIndex } from "./server.js";
import { getRepositoryIndexStatus } from "./status.js";
import { buildRepositorySearchMetrics } from "./metrics.js";
import {
  getRepositoryIndexReadiness,
  invalidateRepositoryIndexReadiness,
  isRepositoryIndexReadinessUsable,
  markRepositoryIndexSearchSucceeded,
  rememberRepositoryIndexReadiness,
} from "./readiness.js";

const MAX_PATTERN_CHARS = 4_096;
const MAX_FILTERS = 32;

function validateSearchRequest({ pattern, globs = [], types = [], context, beforeContext, afterContext, maxCount } = {}) {
  if (typeof pattern !== "string" || pattern.length === 0 || pattern.length > MAX_PATTERN_CHARS) {
    throw repositoryIndexError(REPOSITORY_INDEX_ERROR_CODES.REQUEST_INVALID, `Search pattern must contain 1-${MAX_PATTERN_CHARS} characters`);
  }
  for (const [label, values] of [["globs", globs], ["types", types]]) {
    if (!Array.isArray(values) || values.length > MAX_FILTERS || values.some((value) => typeof value !== "string" || value.length === 0 || value.length > 256)) {
      throw repositoryIndexError(REPOSITORY_INDEX_ERROR_CODES.REQUEST_INVALID, `Search ${label} must contain at most ${MAX_FILTERS} bounded strings`);
    }
  }
  for (const [label, value] of [["context", context], ["beforeContext", beforeContext], ["afterContext", afterContext], ["maxCount", maxCount]]) {
    if (value !== undefined && value !== null && (!Number.isSafeInteger(value) || value < 0 || (label === "maxCount" && value === 0))) {
      throw repositoryIndexError(REPOSITORY_INDEX_ERROR_CODES.REQUEST_INVALID, `Search ${label} must be a valid positive or non-negative integer`);
    }
  }
}

function normalizeSearchInvocation(repositoryRoot, request) {
  if (repositoryRoot && typeof repositoryRoot === "object" && request && Object.keys(request).length === 0) {
    const normalizedRequest = { ...repositoryRoot };
    return {
      repositoryRoot: normalizedRequest.repoRoot ?? normalizedRequest.repositoryRoot ?? normalizedRequest.projectPath,
      request: normalizedRequest,
    };
  }
  return { repositoryRoot, request };
}

async function prepareSearch(repositoryRoot, request) {
  const canonicalRoot = await realpath(repositoryRoot);
  const setupImpl = request.setupRepositoryIndexImpl ?? setupRepositoryIndex;
  const cached = getRepositoryIndexReadiness(canonicalRoot, request.platform ?? process.platform);
  if (cached) {
    const expected = await expectedReadiness(canonicalRoot, request);
    if (isRepositoryIndexReadinessUsable(cached, expected, { isAlive: request.processIsAliveImpl })) {
      return {
        status: cached.status,
        canonicalRoot,
        indexPath: cached.indexPath,
        binaryPath: cached.binaryPath,
        cacheHit: true,
      };
    }
    invalidateRepositoryIndexReadiness(canonicalRoot, request.platform ?? process.platform);
  }

  const setup = await setupImpl(repositoryRoot, request);
  const status = setup.status?.repositoryRoot
    ? setup.status
    : await (request.getRepositoryIndexStatusImpl ?? getRepositoryIndexStatus)(canonicalRoot, { ...request, includeLocalPaths: true });
  if (status.health !== "READY") {
    throw repositoryIndexError(REPOSITORY_INDEX_ERROR_CODES.SERVER_UNHEALTHY, "Repository Index is not ready for search", { status });
  }
  const indexPath = status.indexPath;
  const binaryPath = status.binaryPath ?? request.binaryPath;
  if (!indexPath || !binaryPath) {
    throw repositoryIndexError(REPOSITORY_INDEX_ERROR_CODES.SERVER_UNHEALTHY, "Repository Index readiness did not provide executable paths", { status });
  }
  rememberRepositoryIndexReadiness({ canonicalRoot, status, platform: request.platform });
  return { status, canonicalRoot, indexPath, binaryPath, cacheHit: false };
}

async function expectedReadiness(canonicalRoot, request) {
  const manifest = await loadTgrepManifest(request.packageRoot);
  const selectedPlatform = getRepositoryIndexPlatform({ platform: request.platform, arch: request.arch });
  const override = request.binaryPath
    ?? (request.env === undefined ? process.env[REPOSITORY_INDEX_ENV_BINARY] : request.env?.[REPOSITORY_INDEX_ENV_BINARY]);
  const binaryPath = override ?? getManagedTgrepBinaryPath(manifest.version, selectedPlatform.key, {
    homeDirectory: request.homeDirectory,
    windows: selectedPlatform.platform === "win32",
  });
  return {
    canonicalRoot,
    indexPath: getTgrepIndexPath(canonicalRoot),
    binaryPath,
    engineVersion: manifest.version,
    platform: selectedPlatform.platform,
  };
}

function assertSearchInvocation(repositoryRoot, request) {
  if (typeof repositoryRoot !== "string" || repositoryRoot.length === 0) {
    throw repositoryIndexError(REPOSITORY_INDEX_ERROR_CODES.REQUEST_INVALID, "Search repoRoot is required");
  }
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw repositoryIndexError(REPOSITORY_INDEX_ERROR_CODES.REQUEST_INVALID, "Search request must be an object");
  }
}

function buildSearchArgs({ indexPath, canonicalRoot, request }) {
  const args = [...getCanonicalRepositorySearchArgs({
    indexPath,
    pattern: request.pattern,
    options: request,
    config: request.config,
  })];
  appendSearchFilters(args, { globs: request.globs, types: request.types });
  args.push(canonicalRoot);
  return args;
}

async function runSearch({ binaryPath, status, canonicalRoot, request, args }) {
  const startedAt = Date.now();
  const result = await (request.runTgrepImpl ?? runTgrep)({
    binary: createTgrepBinaryHandle(binaryPath),
    repoRoot: canonicalRoot,
    args,
    env: request.env,
    spawnImpl: request.spawnImpl,
    timeoutMs: request.commandTimeoutMs ?? REPOSITORY_INDEX_DEFAULTS.commandTimeoutMs,
    maxOutputBytes: request.maxProcessOutputBytes ?? REPOSITORY_INDEX_DEFAULTS.maxProcessOutputBytes,
  });
  if (result.timedOut || ![0, 1].includes(result.exitCode)) {
    throw repositoryIndexError(REPOSITORY_INDEX_ERROR_CODES.SEARCH_FAILED, `tgrep search failed with exit code ${result.exitCode ?? "unknown"}`, {
      exitCode: result.exitCode,
      stderr: result.stderr.slice(0, 4000),
    });
  }
  const normalized = await normalizeTgrepJson(result.stdout, {
    repositoryRoot: canonicalRoot,
    filesWithMatches: request.filesWithMatches === true,
  });
  return { result, normalized, startedAt, status };
}

function isRecoverableSearchFailure(error) {
  if (error?.code === REPOSITORY_INDEX_ERROR_CODES.ENGINE_EXECUTION_FAILED) return true;
  if (error?.code !== REPOSITORY_INDEX_ERROR_CODES.SEARCH_FAILED) return false;
  return /server|index|connect|connection|not running|metadata|broken pipe|no such file|unavailable/i.test(error.stderr ?? "");
}

function collectErrorPaths(error) {
  const paths = [];
  const seen = new Set();
  for (let current = error; current && !seen.has(current); current = current.cause) {
    seen.add(current);
    for (const key of ["path", "binaryPath", "repositoryRoot", "indexPath", "statePath", "archivePath", "manifestPath", "source"]) {
      if (typeof current[key] === "string") paths.push(current[key]);
    }
    const status = current.status;
    if (status && typeof status === "object") {
      for (const value of [status.binaryPath, status.repositoryRoot, status.indexPath, status.statePath, status.index?.rootPath]) {
        if (typeof value === "string") paths.push(value);
      }
    }
  }
  return [...new Set(paths)].sort((left, right) => right.length - left.length);
}

function sanitizeSearchError(error, request, repositoryRoot) {
  const localPaths = [...new Set([
    repositoryRoot,
    request.binaryPath,
    request.homeDirectory,
    request.assetPath,
    process.cwd(),
    ...collectErrorPaths(error),
  ].filter((value) => typeof value === "string" && value.length > 0))].sort((left, right) => right.length - left.length);
  const redact = (value) => localPaths.reduce((result, localPath) => result.replaceAll(localPath, "<local-path>"), String(value ?? ""));
  if (localPaths.length === 0) return error;
  const sanitized = repositoryIndexError(error.code ?? REPOSITORY_INDEX_ERROR_CODES.SEARCH_FAILED, redact(error.message));
  for (const key of ["exitCode", "signal", "timedOut", "stderr", "stdout", "expectedVersion", "actualVersion"]) {
    if (error[key] !== undefined) sanitized[key] = typeof error[key] === "string" ? redact(error[key]) : error[key];
  }
  return sanitized;
}

function buildSearchResult({ request, status, result, normalized, startedAt }) {
  return {
    schemaVersion: 1,
    query: {
      pattern: request.pattern,
      globs: [...(request.globs ?? [])],
      types: [...(request.types ?? [])],
      filesWithMatches: request.filesWithMatches === true,
      stats: request.stats === true,
      fixedStrings: request.fixedStrings === true,
      ignoreCase: request.ignoreCase === true,
      smartCase: request.smartCase === true,
      wordRegexp: request.wordRegexp === true,
      context: request.context ?? null,
      beforeContext: request.beforeContext ?? null,
      afterContext: request.afterContext ?? null,
      maxCount: request.maxCount ?? null,
    },
    repositoryIndex: {
      engine: status?.engine ?? "tgrep",
      engineVersion: status?.engineVersion ?? null,
      indexed: true,
      server: status?.server?.running === true,
    },
    matches: normalized.matches,
    contexts: normalized.contexts,
    files: normalized.files,
    stats: normalized.stats,
    metrics: buildRepositorySearchMetrics({
      durationMs: Date.now() - startedAt,
      nativeDurationMs: result.durationMs,
      result: { ...normalized, exitCode: result.exitCode },
      engine: status?.engine ?? "tgrep",
      engineVersion: status?.engineVersion ?? null,
      serverUsed: status?.server?.running === true,
    }),
  };
}

export async function searchRepository(repositoryRoot, request = {}) {
  ({ repositoryRoot, request } = normalizeSearchInvocation(repositoryRoot, request));
  assertSearchInvocation(repositoryRoot, request);
  validateSearchRequest(request);
  let prepared;
  try {
    prepared = await prepareSearch(repositoryRoot, request);
  } catch (error) {
    throw sanitizeSearchError(error, request, repositoryRoot);
  }
  let args = buildSearchArgs({ indexPath: prepared.indexPath, canonicalRoot: prepared.canonicalRoot, request });
  try {
    const execution = await runSearch({ binaryPath: prepared.binaryPath, status: prepared.status, canonicalRoot: prepared.canonicalRoot, request, args });
    markRepositoryIndexSearchSucceeded(prepared.canonicalRoot, request.platform ?? process.platform);
    return buildSearchResult({ request, ...execution });
  } catch (error) {
    if (!isRecoverableSearchFailure(error)) throw sanitizeSearchError(error, request, prepared.canonicalRoot);
    invalidateRepositoryIndexReadiness(prepared.canonicalRoot, request.platform ?? process.platform);
    try {
      prepared = await prepareSearch(prepared.canonicalRoot, request);
    } catch (recoveryError) {
      throw sanitizeSearchError(recoveryError, request, prepared.canonicalRoot);
    }
    args = buildSearchArgs({ indexPath: prepared.indexPath, canonicalRoot: prepared.canonicalRoot, request });
    try {
      const execution = await runSearch({ binaryPath: prepared.binaryPath, status: prepared.status, canonicalRoot: prepared.canonicalRoot, request, args });
      markRepositoryIndexSearchSucceeded(prepared.canonicalRoot, request.platform ?? process.platform);
      return buildSearchResult({ request, ...execution });
    } catch (retryError) {
      throw sanitizeSearchError(retryError, request, prepared.canonicalRoot);
    }
  }
}
