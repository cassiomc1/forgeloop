import { realpath, stat } from "node:fs/promises";
import path from "node:path";

import { assertSafePath, isPathWithin } from "../../core/filesystem.js";
import {
  normalizeAdvisoryRecallOptions,
} from "../../core/advisory-context/constants.js";
import {
  E_ADVISORY_CONTEXT_PROVIDER_INVALID,
  E_ADVISORY_CONTEXT_PROVIDER_UNAVAILABLE,
  E_ADVISORY_CONTEXT_RESULT_INVALID,
  E_ADVISORY_CONTEXT_TIMEOUT,
} from "../../core/error-codes.js";
import {
  OPENSRC_PROCESS_LIMITS,
  parseOpenSrcVersion,
  runOpenSrcCommand,
} from "./process.js";
import { OPENSRC_SEARCH_LIMITS, searchSourceRoot } from "./search.js";
import { normalizeOpenSrcResult } from "./normalize.js";

const MAX_SOURCES = OPENSRC_SEARCH_LIMITS.maxSources;
const MAX_SOURCE_SPEC_CHARS = 256;

function providerError(code, message) {
  const error = new Error(message);
  error.name = "OpenSrcAdvisoryProviderError";
  error.code = code;
  return error;
}

function assertAbsolutePath(value, label) {
  if (typeof value !== "string" || value.trim() === "" || !path.isAbsolute(value) || /\p{Cc}/u.test(value)) {
    throw providerError(E_ADVISORY_CONTEXT_PROVIDER_INVALID, `${label} must be an absolute portable path`);
  }
  return value;
}

function assertExpectedVersion(value) {
  if (
    typeof value !== "string"
    || value.trim() === ""
    || value.length > 64
    || !/^[A-Za-z0-9][A-Za-z0-9._+-]*$/u.test(value)
  ) {
    throw providerError(E_ADVISORY_CONTEXT_PROVIDER_INVALID, "OpenSrc expectedVersion must be a qualified version token under 64 characters");
  }
  return value;
}

function assertSourceSpec(value) {
  if (typeof value !== "string" || value.trim() === "" || value.length > MAX_SOURCE_SPEC_CHARS) {
    throw providerError(E_ADVISORY_CONTEXT_PROVIDER_INVALID, "OpenSrc source specs must be non-empty strings under 256 characters");
  }
  if (/[\0\p{Cc}\s]/u.test(value)) {
    throw providerError(E_ADVISORY_CONTEXT_PROVIDER_INVALID, "OpenSrc source specs must not contain whitespace or control characters");
  }
  if (value.startsWith("-")) {
    throw providerError(E_ADVISORY_CONTEXT_PROVIDER_INVALID, "OpenSrc source specs must not begin with '-'");
  }
  if (/[;|&$`<>(){}[\]!*?~#"']/u.test(value)) {
    throw providerError(E_ADVISORY_CONTEXT_PROVIDER_INVALID, "OpenSrc source specs must not contain shell metacharacters");
  }
  return value;
}

function assertSources(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw providerError(E_ADVISORY_CONTEXT_PROVIDER_INVALID, "OpenSrc sources must be a non-empty array");
  }
  if (value.length > MAX_SOURCES) {
    throw providerError(E_ADVISORY_CONTEXT_PROVIDER_INVALID, `OpenSrc sources must contain at most ${MAX_SOURCES} entries`);
  }
  return value.map(assertSourceSpec);
}

function remainingTimeout(deadline) {
  const remaining = deadline - Date.now();
  if (remaining < 1) {
    throw providerError(E_ADVISORY_CONTEXT_TIMEOUT, "OpenSrc advisory recall deadline expired");
  }
  return remaining;
}

function reportTransport(callback, payload) {
  if (typeof callback !== "function") return;
  try {
    callback(Object.freeze({ ...payload }));
  } catch {
    // Observability hooks cannot change advisory correctness or failure mapping.
  }
}

async function canonicalizeExisting(candidate) {
  try {
    return await realpath(candidate);
  } catch {
    return path.resolve(candidate);
  }
}

async function assertCacheOutsideProject(cacheRoot, projectRoot) {
  // Compare both the lexical and the canonicalized spellings: either side may
  // traverse symlinked prefixes (for example /var versus /private/var), so a
  // single spelling can miss a genuine containment relationship. The roots
  // must be disjoint in both directions: neither may contain the other.
  const spellings = [
    [path.resolve(cacheRoot), path.resolve(projectRoot)],
    [await canonicalizeExisting(cacheRoot), await canonicalizeExisting(projectRoot)],
  ];
  for (const [candidateCache, candidateProject] of spellings) {
    if (isPathWithin(candidateProject, candidateCache) || isPathWithin(candidateCache, candidateProject)) {
      throw providerError(E_ADVISORY_CONTEXT_PROVIDER_INVALID, "OpenSrc cacheRoot and project root must be disjoint");
    }
    if (isPathWithin(path.join(candidateProject, ".forgeloop"), candidateCache)) {
      throw providerError(E_ADVISORY_CONTEXT_PROVIDER_INVALID, "OpenSrc cacheRoot must be outside .forgeloop");
    }
  }
  return path.resolve(cacheRoot);
}

async function runAndReport(executablePath, args, {
  cwd,
  timeoutMs,
  spawnImpl,
  env,
  maxStdoutBytes,
  maxStderrBytes,
  onTransport,
  kind,
  sourceIndex,
} = {}) {
  const result = await runOpenSrcCommand(executablePath, args, {
    cwd,
    timeoutMs,
    spawnImpl,
    env,
    maxStdoutBytes,
    maxStderrBytes,
  });
  reportTransport(onTransport, {
    kind,
    ...(sourceIndex === undefined ? {} : { sourceIndex }),
    stdoutBytes: result.stdoutBytes,
    stderrBytes: result.stderrBytes,
    durationMs: result.durationMs,
  });
  return result;
}

async function resolveSourceRoot({
  executablePath,
  source,
  sourceIndex,
  projectRoot,
  cacheRoot,
  timeoutMs,
  spawnImpl,
  env,
  onTransport,
}) {
  let result;
  try {
    result = await runAndReport(executablePath, ["path", source, "--cwd", projectRoot], {
      cwd: projectRoot,
      timeoutMs,
      spawnImpl,
      env,
      maxStdoutBytes: OPENSRC_PROCESS_LIMITS.maxStdoutBytes,
      maxStderrBytes: OPENSRC_PROCESS_LIMITS.maxStderrBytes,
      onTransport,
      kind: "path",
      sourceIndex,
    });
  } catch (error) {
    throw error.code ? error : providerError(E_ADVISORY_CONTEXT_PROVIDER_UNAVAILABLE, "OpenSrc source resolution failed");
  }
  const lines = result.stdout.split("\n").map((line) => line.trim()).filter((line) => line !== "");
  if (lines.length !== 1) {
    throw providerError(E_ADVISORY_CONTEXT_RESULT_INVALID, "OpenSrc path must print exactly one path");
  }
  const [printed] = lines;
  if (/\p{Cc}/u.test(printed)) {
    throw providerError(E_ADVISORY_CONTEXT_RESULT_INVALID, "OpenSrc path output must be portable text");
  }
  if (!path.isAbsolute(printed)) {
    throw providerError(E_ADVISORY_CONTEXT_RESULT_INVALID, "OpenSrc path output must be absolute");
  }
  let resolved;
  try {
    resolved = await realpath(printed);
  } catch {
    throw providerError(E_ADVISORY_CONTEXT_RESULT_INVALID, "OpenSrc source path could not be canonicalized");
  }
  let canonicalCache;
  try {
    canonicalCache = await realpath(cacheRoot);
  } catch {
    throw providerError(E_ADVISORY_CONTEXT_RESULT_INVALID, "OpenSrc cache root could not be canonicalized");
  }
  if (resolved !== canonicalCache && !isPathWithin(canonicalCache, resolved)) {
    throw providerError(E_ADVISORY_CONTEXT_RESULT_INVALID, "OpenSrc source path escaped the configured cache");
  }
  let rootStat;
  try {
    rootStat = await stat(resolved);
  } catch {
    throw providerError(E_ADVISORY_CONTEXT_RESULT_INVALID, "OpenSrc source path is not an accessible directory");
  }
  if (!rootStat.isDirectory()) {
    throw providerError(E_ADVISORY_CONTEXT_RESULT_INVALID, "OpenSrc source path is not a directory");
  }
  return resolved;
}

/**
 * Create an optional host-injected OpenSrc adapter.
 *
 * Construction is inert: it validates the explicit executable, version,
 * cache, and source allowlist but does not discover binaries, spawn
 * processes, access the network, or write lifecycle state. Version
 * qualification repeats lazily before every recall so a changed executable
 * cannot silently change the provider identity.
 */
export function createOpenSrcAdvisoryContextProvider({
  executablePath,
  expectedVersion,
  cacheRoot,
  sources,
  spawnImpl,
  env,
  onTransport,
} = {}) {
  const qualifiedExecutablePath = assertAbsolutePath(executablePath, "OpenSrc executablePath");
  const qualifiedExpectedVersion = assertExpectedVersion(expectedVersion);
  const qualifiedCacheRoot = assertAbsolutePath(cacheRoot, "OpenSrc cacheRoot");
  const qualifiedSources = assertSources(sources);
  if (spawnImpl !== undefined && typeof spawnImpl !== "function") {
    throw providerError(E_ADVISORY_CONTEXT_PROVIDER_INVALID, "OpenSrc spawn implementation must be a function");
  }
  if (env !== undefined && (!env || typeof env !== "object" || Array.isArray(env))) {
    throw providerError(E_ADVISORY_CONTEXT_PROVIDER_INVALID, "OpenSrc process environment must be an object");
  }

  const provider = {
    id: "opensrc",
    version: qualifiedExpectedVersion,
    async recall({
      projectPath,
      taskId,
      query,
      limit,
      maxItemChars,
      maxTotalChars,
      timeoutMs,
    } = {}) {
      if (typeof projectPath !== "string" || !path.isAbsolute(projectPath) || /\p{Cc}/u.test(projectPath)) {
        throw providerError(E_ADVISORY_CONTEXT_PROVIDER_INVALID, "OpenSrc projectPath must be an absolute path");
      }
      if (typeof taskId !== "string" || taskId.trim() === "") {
        throw providerError(E_ADVISORY_CONTEXT_PROVIDER_INVALID, "OpenSrc taskId must be a non-empty string");
      }
      if (typeof query !== "string" || query.trim() === "" || /\p{Cc}/u.test(query)) {
        throw providerError(E_ADVISORY_CONTEXT_PROVIDER_INVALID, "OpenSrc query must be a non-empty portable string");
      }
      const options = normalizeAdvisoryRecallOptions({ limit, maxItemChars, maxTotalChars, timeoutMs });
      const projectRoot = path.resolve(projectPath);
      try {
        await assertSafePath(projectRoot, ".");
      } catch {
        throw providerError(E_ADVISORY_CONTEXT_PROVIDER_UNAVAILABLE, "OpenSrc target directory is unavailable or unsafe");
      }
      await assertCacheOutsideProject(qualifiedCacheRoot, projectRoot);

      const childEnv = { ...(env ?? {}), OPENSRC_HOME: qualifiedCacheRoot };
      const deadline = Date.now() + options.timeoutMs;
      let versionResult;
      try {
        versionResult = await runAndReport(qualifiedExecutablePath, ["--version"], {
          cwd: projectRoot,
          timeoutMs: remainingTimeout(deadline),
          spawnImpl,
          env: childEnv,
          maxStdoutBytes: OPENSRC_PROCESS_LIMITS.maxStdoutBytes,
          maxStderrBytes: OPENSRC_PROCESS_LIMITS.maxStderrBytes,
          onTransport,
          kind: "version",
        });
      } catch (error) {
        throw error.code ? error : providerError(E_ADVISORY_CONTEXT_PROVIDER_UNAVAILABLE, "OpenSrc version probe failed");
      }

      let actualVersion;
      try {
        actualVersion = parseOpenSrcVersion(versionResult.stdout);
      } catch {
        throw providerError(E_ADVISORY_CONTEXT_PROVIDER_INVALID, "OpenSrc version probe was not qualified");
      }
      if (actualVersion !== qualifiedExpectedVersion) {
        throw providerError(
          E_ADVISORY_CONTEXT_PROVIDER_INVALID,
          "OpenSrc executable version does not match the expected qualified version",
        );
      }

      const matches = [];
      const sharedBudget = { remainingReadBytes: OPENSRC_SEARCH_LIMITS.maxTotalReadBytes };
      const boundedSources = qualifiedSources.slice(0, MAX_SOURCES);
      for (let sourceIndex = 0; sourceIndex < boundedSources.length; sourceIndex += 1) {
        const source = boundedSources[sourceIndex];
        const sourceRoot = await resolveSourceRoot({
          executablePath: qualifiedExecutablePath,
          source,
          sourceIndex,
          projectRoot,
          cacheRoot: qualifiedCacheRoot,
          timeoutMs: remainingTimeout(deadline),
          spawnImpl,
          env: childEnv,
          onTransport,
        });
        const sourceMatches = await searchSourceRoot({
          sourceRoot,
          sourceSpec: source,
          sourceIndex,
          query,
          budget: sharedBudget,
          deadline,
        });
        matches.push(...sourceMatches);
      }

      return normalizeOpenSrcResult(matches, options);
    },
  };

  return Object.freeze(provider);
}
