import { getCanonicalRepositorySearchArgs, appendSearchFilters } from "./args.js";
import { REPOSITORY_INDEX_DEFAULTS } from "./constants.js";
import { REPOSITORY_INDEX_ERROR_CODES, repositoryIndexError } from "./errors.js";
import { runTgrep } from "./process.js";
import { normalizeTgrepJson } from "./normalize-json.js";
import { setupRepositoryIndex } from "./server.js";
import { getRepositoryIndexStatus } from "./status.js";
import { buildRepositorySearchMetrics } from "./metrics.js";

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
  const setup = await setupRepositoryIndex(repositoryRoot, request);
  const canonicalRoot = setup.status?.repositoryRoot ?? repositoryRoot;
  let indexPath = setup.status?.indexPath;
  let status = setup.status;
  if (!indexPath) {
    status = await getRepositoryIndexStatus(canonicalRoot, request);
    if (status.health !== "READY") {
      throw repositoryIndexError(REPOSITORY_INDEX_ERROR_CODES.SERVER_UNHEALTHY, "Repository Index is not ready for search", { status });
    }
    indexPath = status.indexPath;
  }
  return { setup, status, canonicalRoot, indexPath };
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

async function runSearch({ setup, status, canonicalRoot, request, args }) {
  const startedAt = Date.now();
  const result = await runTgrep({
    binaryPath: setup.status?.binaryPath ?? request.binaryPath,
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

function buildSearchResult({ request, canonicalRoot, status, result, normalized, startedAt }) {
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
    repositoryRoot: canonicalRoot,
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
  const { setup, status, canonicalRoot, indexPath } = await prepareSearch(repositoryRoot, request);
  const args = buildSearchArgs({ indexPath, canonicalRoot, request });
  const execution = await runSearch({ setup, status, canonicalRoot, request, args });
  return buildSearchResult({ request, canonicalRoot, ...execution });
}
