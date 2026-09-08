import { spawn } from "node:child_process";
import { clearInterval, setInterval } from "node:timers";
import path from "node:path";

import { REPOSITORY_INDEX_DEFAULTS } from "./constants.js";
import { REPOSITORY_INDEX_ERROR_CODES, repositoryIndexError } from "./errors.js";

const MAX_COMMAND_TIMEOUT_MS = 120_000;
const PROCESS_TIMER_INTERVAL_MS = 50;
const trustedBinaryPaths = new WeakMap();

function assertArgs(args) {
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string" || arg.length === 0)) {
    throw repositoryIndexError(REPOSITORY_INDEX_ERROR_CODES.ENGINE_EXECUTION_FAILED, "tgrep arguments must be a non-empty string array");
  }
}

function assertExecutablePath(binaryPath) {
  if (typeof binaryPath !== "string" || binaryPath.trim() === "") {
    throw repositoryIndexError(REPOSITORY_INDEX_ERROR_CODES.ENGINE_EXECUTION_FAILED, "A verified managed tgrep binary path is required");
  }
  if (!path.isAbsolute(binaryPath) || !binaryPath.match(/^[\w./\\: @%+=~-]+$/u)) {
    throw repositoryIndexError(REPOSITORY_INDEX_ERROR_CODES.ENGINE_EXECUTION_FAILED, "The managed tgrep binary path contains unsafe command characters");
  }
  return binaryPath;
}

export function createTgrepBinaryHandle(binaryPath) {
  const handle = Object.freeze({});
  trustedBinaryPaths.set(handle, assertExecutablePath(binaryPath));
  return handle;
}

function resolveTgrepBinaryHandle(handle) {
  const binaryPath = trustedBinaryPaths.get(handle);
  if (!binaryPath) {
    throw repositoryIndexError(REPOSITORY_INDEX_ERROR_CODES.ENGINE_EXECUTION_FAILED, "A validated managed tgrep binary handle is required");
  }
  return binaryPath;
}

export async function runTgrep({ binary, repoRoot, args, stdin = null, timeoutMs = REPOSITORY_INDEX_DEFAULTS.commandTimeoutMs, env = {}, spawnImpl = spawn, maxOutputBytes = REPOSITORY_INDEX_DEFAULTS.maxProcessOutputBytes } = {}) {
  const binaryPath = resolveTgrepBinaryHandle(binary);
  if (typeof repoRoot !== "string" || repoRoot.trim() === "") {
    throw repositoryIndexError(REPOSITORY_INDEX_ERROR_CODES.ENGINE_EXECUTION_FAILED, "A repository root is required to execute tgrep");
  }
  assertArgs(args);
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw repositoryIndexError(REPOSITORY_INDEX_ERROR_CODES.ENGINE_EXECUTION_FAILED, "tgrep timeoutMs must be a positive integer");
  }
  const effectiveTimeoutMs = Math.min(timeoutMs, MAX_COMMAND_TIMEOUT_MS);

  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnImpl(binaryPath, args, {
        cwd: repoRoot,
        env: { ...process.env, ...env },
        shell: false,
        windowsHide: true,
      });
    } catch (cause) {
      reject(repositoryIndexError(REPOSITORY_INDEX_ERROR_CODES.ENGINE_EXECUTION_FAILED, `Unable to launch managed tgrep: ${cause.message}`, { cause }));
      return;
    }

    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    const timeoutDeadline = startedAt + effectiveTimeoutMs;
    const timer = setInterval(() => {
      if (Date.now() < timeoutDeadline) return;
      timedOut = true;
      clearInterval(timer);
      try { child.kill("SIGTERM"); } catch { /* process may already be gone */ }
    }, PROCESS_TIMER_INTERVAL_MS);
    timer.unref?.();

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearInterval(timer);
      fn(value);
    };
    const append = (current, chunk) => {
      const next = `${current}${chunk.toString("utf8")}`;
      if (Buffer.byteLength(next, "utf8") > maxOutputBytes) {
        try { child.kill("SIGTERM"); } catch { /* process may already be gone */ }
        finish(reject, repositoryIndexError(REPOSITORY_INDEX_ERROR_CODES.ENGINE_OUTPUT_LIMIT, `tgrep output exceeded ${maxOutputBytes} bytes`));
        return current;
      }
      return next;
    };
    child.stdout?.on("data", (chunk) => { stdout = append(stdout, chunk); });
    child.stderr?.on("data", (chunk) => { stderr = append(stderr, chunk); });
    child.once("error", (cause) => finish(reject, repositoryIndexError(REPOSITORY_INDEX_ERROR_CODES.ENGINE_EXECUTION_FAILED, `Managed tgrep failed to start: ${cause.message}`, { cause })));
    child.once("close", (exitCode, signal) => {
      if (settled) return;
      const result = {
        exitCode: Number.isInteger(exitCode) ? exitCode : null,
        signal: signal ?? null,
        stdout,
        stderr,
        durationMs: Date.now() - startedAt,
        timedOut,
      };
      finish(resolve, result);
    });
    if (stdin !== null && stdin !== undefined) {
      child.stdin?.end(stdin);
    } else {
      child.stdin?.end();
    }
  });
}

export function spawnTgrepServer({ binary, repoRoot, args, env = {}, spawnImpl = spawn, stdio = "ignore" } = {}) {
  const binaryPath = resolveTgrepBinaryHandle(binary);
  if (typeof repoRoot !== "string" || !repoRoot) {
    throw repositoryIndexError(REPOSITORY_INDEX_ERROR_CODES.SERVER_START_FAILED, "A verified managed tgrep binary and repository root are required");
  }
  assertArgs(args);
  let child;
  try {
    child = spawnImpl(binaryPath, args, {
      cwd: repoRoot,
      env: { ...process.env, ...env },
      shell: false,
      detached: true,
      stdio,
      windowsHide: true,
    });
  } catch (cause) {
    throw repositoryIndexError(REPOSITORY_INDEX_ERROR_CODES.SERVER_START_FAILED, `Unable to launch managed tgrep server: ${cause.message}`, { cause });
  }
  child.unref?.();
  return child;
}
