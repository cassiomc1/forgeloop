import path from "node:path";

import { assertSafePath } from "../../core/filesystem.js";
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
  RIPWIRE_PROCESS_LIMITS,
  parseRipwireVersion,
  runRipwireCommand,
} from "./process.js";
import {
  extractCandidateRows,
  getRipwireRowPath,
  normalizeReportedPath,
  normalizeRipwireResult,
} from "./normalize.js";

function providerError(code, message) {
  const error = new Error(message);
  error.name = "RipwireAdvisoryProviderError";
  error.code = code;
  return error;
}

function assertAbsoluteExecutablePath(value) {
  if (typeof value !== "string" || value.trim() === "" || !path.isAbsolute(value) || /\p{Cc}/u.test(value)) {
    throw providerError(E_ADVISORY_CONTEXT_PROVIDER_INVALID, "Ripwire executablePath must be an absolute portable path");
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
    throw providerError(E_ADVISORY_CONTEXT_PROVIDER_INVALID, "Ripwire expectedVersion must be a qualified version token under 64 characters");
  }
  return value;
}

function assertProcessLimit(value, maximum, label) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw providerError(E_ADVISORY_CONTEXT_PROVIDER_INVALID, `${label} must be an integer between 1 and ${maximum}`);
  }
  return value;
}

function remainingTimeout(deadline) {
  const remaining = deadline - Date.now();
  if (remaining < 1) {
    throw providerError(E_ADVISORY_CONTEXT_TIMEOUT, "Ripwire advisory recall deadline expired");
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

async function runAndReport(executablePath, args, {
  cwd,
  timeoutMs,
  spawnImpl,
  env,
  maxStdoutBytes,
  maxStderrBytes,
  onTransport,
  kind,
} = {}) {
  const result = await runRipwireCommand(executablePath, args, {
    cwd,
    timeoutMs,
    spawnImpl,
    env,
    maxStdoutBytes,
    maxStderrBytes,
  });
  reportTransport(onTransport, {
    kind,
    stdoutBytes: result.stdoutBytes,
    stderrBytes: result.stderrBytes,
    durationMs: result.durationMs,
  });
  return result;
}

function queryArguments(projectPath, query) {
  return [
    projectPath,
    `--for=${query}`,
    "--signatures-only",
    "--json",
    "--no-cache",
    "--exclude=.forgeloop",
  ];
}

/**
 * Create an optional host-injected Ripwire adapter.
 *
 * Construction is inert: it validates the explicit executable/version pair
 * but does not discover binaries, spawn processes, access the network, or
 * write lifecycle state. Version qualification is repeated lazily before a
 * query so a changed executable cannot silently change the provider identity.
 */
export function createRipwireAdvisoryContextProvider({
  executablePath,
  expectedVersion,
  spawnImpl,
  env,
  maxStdoutBytes = RIPWIRE_PROCESS_LIMITS.maxStdoutBytes,
  maxStderrBytes = RIPWIRE_PROCESS_LIMITS.maxStderrBytes,
  onTransport,
} = {}) {
  const qualifiedExecutablePath = assertAbsoluteExecutablePath(executablePath);
  const qualifiedExpectedVersion = assertExpectedVersion(expectedVersion);
  const qualifiedStdoutLimit = assertProcessLimit(maxStdoutBytes, RIPWIRE_PROCESS_LIMITS.maxStdoutBytes, "Ripwire stdout limit");
  const qualifiedStderrLimit = assertProcessLimit(maxStderrBytes, RIPWIRE_PROCESS_LIMITS.maxStderrBytes, "Ripwire stderr limit");

  const provider = {
    id: "ripwire",
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
        throw providerError(E_ADVISORY_CONTEXT_PROVIDER_INVALID, "Ripwire projectPath must be an absolute path");
      }
      if (typeof taskId !== "string" || taskId.trim() === "") {
        throw providerError(E_ADVISORY_CONTEXT_PROVIDER_INVALID, "Ripwire taskId must be a non-empty string");
      }
      if (typeof query !== "string" || query.trim() === "" || /\p{Cc}/u.test(query)) {
        throw providerError(E_ADVISORY_CONTEXT_PROVIDER_INVALID, "Ripwire query must be a non-empty portable string");
      }
      const options = normalizeAdvisoryRecallOptions({ limit, maxItemChars, maxTotalChars, timeoutMs });
      const projectRoot = path.resolve(projectPath);
      try {
        await assertSafePath(projectRoot, ".");
      } catch {
        throw providerError(E_ADVISORY_CONTEXT_PROVIDER_UNAVAILABLE, "Ripwire target directory is unavailable or unsafe");
      }

      const deadline = Date.now() + options.timeoutMs;
      let versionResult;
      try {
        versionResult = await runAndReport(qualifiedExecutablePath, ["--version"], {
          cwd: projectRoot,
          timeoutMs: remainingTimeout(deadline),
          spawnImpl,
          env,
          maxStdoutBytes: Math.min(qualifiedStdoutLimit, 64 * 1024),
          maxStderrBytes: qualifiedStderrLimit,
          onTransport,
          kind: "version",
        });
      } catch (error) {
        throw error.code ? error : providerError(E_ADVISORY_CONTEXT_PROVIDER_UNAVAILABLE, "Ripwire version probe failed");
      }

      let actualVersion;
      try {
        actualVersion = parseRipwireVersion(versionResult.stdout);
      } catch {
        throw providerError(E_ADVISORY_CONTEXT_PROVIDER_INVALID, "Ripwire version probe was not qualified");
      }
      if (actualVersion !== qualifiedExpectedVersion) {
        throw providerError(
          E_ADVISORY_CONTEXT_PROVIDER_INVALID,
          "Ripwire executable version does not match the expected qualified version",
        );
      }

      let queryResult;
      try {
        queryResult = await runAndReport(qualifiedExecutablePath, queryArguments(projectRoot, query), {
          cwd: projectRoot,
          timeoutMs: remainingTimeout(deadline),
          spawnImpl,
          env,
          maxStdoutBytes: qualifiedStdoutLimit,
          maxStderrBytes: qualifiedStderrLimit,
          onTransport,
          kind: "query",
        });
      } catch (error) {
        throw error.code ? error : providerError(E_ADVISORY_CONTEXT_PROVIDER_UNAVAILABLE, "Ripwire query failed");
      }

      let raw;
      try {
        raw = JSON.parse(queryResult.stdout);
      } catch {
        throw providerError(E_ADVISORY_CONTEXT_RESULT_INVALID, "Ripwire query did not return valid JSON");
      }

      if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
        throw providerError(E_ADVISORY_CONTEXT_RESULT_INVALID, "Ripwire query JSON root must be an object");
      }

      const safeSourcePaths = new Set();
      const rows = extractCandidateRows(raw) ?? [];
      for (const row of rows) {
        const relativePath = normalizeReportedPath(getRipwireRowPath(row), projectRoot);
        if (!relativePath) continue;
        try {
          await assertSafePath(projectRoot, relativePath);
          safeSourcePaths.add(relativePath);
        } catch {
          // The normalizer will disclose and drop this candidate.
        }
      }

      return normalizeRipwireResult(raw, {
        projectPath: projectRoot,
        ...options,
        sourcePathValidator: (relativePath) => safeSourcePaths.has(relativePath),
      });
    },
  };

  return Object.freeze(provider);
}

export { queryArguments };
