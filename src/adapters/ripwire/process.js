import { spawn as nodeSpawn } from "node:child_process";
import path from "node:path";

import {
  E_ADVISORY_CONTEXT_OUTPUT_LIMIT,
  E_ADVISORY_CONTEXT_PROVIDER_INVALID,
  E_ADVISORY_CONTEXT_PROVIDER_UNAVAILABLE,
  E_ADVISORY_CONTEXT_RESULT_INVALID,
  E_ADVISORY_CONTEXT_TIMEOUT,
} from "../../core/error-codes.js";

export const RIPWIRE_PROCESS_LIMITS = Object.freeze({
  maxStdoutBytes: 1024 * 1024,
  maxStderrBytes: 64 * 1024,
  terminationGraceMs: 100,
});

function processError(code, message) {
  const error = new Error(message);
  error.name = "RipwireProcessError";
  error.code = code;
  return error;
}

function assertSafeText(value, label) {
  if (typeof value !== "string" || value.length === 0 || /\p{Cc}/u.test(value)) {
    throw processError(E_ADVISORY_CONTEXT_PROVIDER_INVALID, `${label} must be a non-empty portable string`);
  }
  return value;
}

function assertAbsolutePath(value, label) {
  assertSafeText(value, label);
  if (!path.isAbsolute(value)) {
    throw processError(E_ADVISORY_CONTEXT_PROVIDER_INVALID, `${label} must be an absolute path`);
  }
  return value;
}

function outputBytes(chunk) {
  return Buffer.isBuffer(chunk) ? chunk.byteLength : Buffer.byteLength(String(chunk));
}

function terminateChild(child) {
  if (!child || typeof child.kill !== "function") return;
  try {
    child.kill("SIGTERM");
  } catch {
    // The process may have exited between the limit check and kill.
  }
  setTimeout(() => {
    try {
      child.kill("SIGKILL");
    } catch {
      // Preserve the original timeout or output-limit error.
    }
  }, RIPWIRE_PROCESS_LIMITS.terminationGraceMs).unref?.();
}

function waitForChildClose(child) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(fallbackTimer);
      resolve();
    };
    const finishAfterClose = () => {
      // Windows can retain a child working directory for a short interval
      // after close; allow the OS to release it before the caller tears down
      // a temporary project tree.
      setTimeout(finish, 500);
    };
    child.once?.("close", finishAfterClose);
    const fallbackTimer = setTimeout(finish, RIPWIRE_PROCESS_LIMITS.terminationGraceMs + 1000);
  });
}

function normalizeRunOptions({
  cwd,
  timeoutMs,
  maxStdoutBytes,
  maxStderrBytes,
  spawnImpl,
  env,
} = {}) {
  assertAbsolutePath(cwd, "Ripwire project path");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw processError(E_ADVISORY_CONTEXT_PROVIDER_INVALID, "Ripwire timeout must be a positive integer");
  }
  if (!Number.isSafeInteger(maxStdoutBytes) || maxStdoutBytes < 1) {
    throw processError(E_ADVISORY_CONTEXT_PROVIDER_INVALID, "Ripwire stdout limit must be a positive integer");
  }
  if (!Number.isSafeInteger(maxStderrBytes) || maxStderrBytes < 1) {
    throw processError(E_ADVISORY_CONTEXT_PROVIDER_INVALID, "Ripwire stderr limit must be a positive integer");
  }
  if (typeof spawnImpl !== "function") {
    throw processError(E_ADVISORY_CONTEXT_PROVIDER_INVALID, "Ripwire spawn implementation must be a function");
  }
  if (env !== undefined && (!env || typeof env !== "object" || Array.isArray(env))) {
    throw processError(E_ADVISORY_CONTEXT_PROVIDER_INVALID, "Ripwire process environment must be an object");
  }
  return {
    cwd,
    timeoutMs,
    maxStdoutBytes,
    maxStderrBytes,
    spawnImpl,
    env,
  };
}

/**
 * Run one explicitly constructed Ripwire command.
 *
 * This helper is intentionally private to the adapter boundary: callers pass
 * an absolute executable and an argv array, while this function always keeps
 * shell execution disabled and never returns raw stderr in an error message.
 */
export function runRipwireCommand(executablePath, args, options = {}) {
  assertAbsolutePath(executablePath, "Ripwire executable path");
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string" || /\p{Cc}/u.test(arg))) {
    throw processError(E_ADVISORY_CONTEXT_PROVIDER_INVALID, "Ripwire arguments must be a portable string array");
  }

  const runOptions = normalizeRunOptions({
    cwd: options.cwd,
    timeoutMs: options.timeoutMs,
    maxStdoutBytes: options.maxStdoutBytes ?? RIPWIRE_PROCESS_LIMITS.maxStdoutBytes,
    maxStderrBytes: options.maxStderrBytes ?? RIPWIRE_PROCESS_LIMITS.maxStderrBytes,
    spawnImpl: options.spawnImpl ?? nodeSpawn,
    env: options.env,
  });

  const startedAt = Date.now();
  let child;
  try {
    child = runOptions.spawnImpl(executablePath, [...args], {
      cwd: runOptions.cwd,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      ...(runOptions.env ? { env: { ...process.env, ...runOptions.env } } : {}),
    });
  } catch (error) {
    throw processError(
      E_ADVISORY_CONTEXT_PROVIDER_UNAVAILABLE,
      error?.code === "ENOENT" ? "Ripwire executable is unavailable" : "Unable to start Ripwire",
      error,
    );
  }

  if (!child || !child.stdout || !child.stderr || typeof child.on !== "function") {
    terminateChild(child);
    throw processError(E_ADVISORY_CONTEXT_PROVIDER_UNAVAILABLE, "Ripwire process did not expose piped stdout and stderr");
  }

  return new Promise((resolve, reject) => {
    let stdoutBytes = 0;
    let stderrBytes = 0;
    const stdoutChunks = [];
    let settled = false;
    let timer = null;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      child.stdout?.removeAllListeners?.("data");
      child.stderr?.removeAllListeners?.("data");
    };

    const fail = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      terminateChild(child);
      child.stdout?.resume?.();
      child.stderr?.resume?.();
      waitForChildClose(child).then(() => reject(error));
    };

    const succeed = (code, signal) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (code !== 0) {
        reject(processError(
          E_ADVISORY_CONTEXT_RESULT_INVALID,
          `Ripwire exited unsuccessfully (${code ?? "null"}/${signal ?? "none"})`,
        ));
        return;
      }
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderrBytes,
        stdoutBytes,
        durationMs: Math.max(0, Date.now() - startedAt),
      });
    };

    child.stdout.on("data", (chunk) => {
      stdoutBytes += outputBytes(chunk);
      if (stdoutBytes > runOptions.maxStdoutBytes) {
        fail(processError(
          E_ADVISORY_CONTEXT_OUTPUT_LIMIT,
          `Ripwire stdout exceeded ${runOptions.maxStdoutBytes} bytes`,
        ));
        return;
      }
      stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    });
    child.stderr.on("data", (chunk) => {
      stderrBytes += outputBytes(chunk);
      if (stderrBytes > runOptions.maxStderrBytes) {
        fail(processError(
          E_ADVISORY_CONTEXT_OUTPUT_LIMIT,
          `Ripwire stderr exceeded ${runOptions.maxStderrBytes} bytes`,
        ));
      }
    });
    child.on("error", (error) => {
      fail(processError(
        E_ADVISORY_CONTEXT_PROVIDER_UNAVAILABLE,
        error?.code === "ENOENT" ? "Ripwire executable is unavailable" : "Ripwire process failed",
        error,
      ));
    });
    child.on("close", (code, signal) => succeed(code, signal));
    timer = setTimeout(() => {
      fail(processError(
        E_ADVISORY_CONTEXT_TIMEOUT,
        `Ripwire exceeded the ${runOptions.timeoutMs}ms timeout`,
      ));
    }, runOptions.timeoutMs);
  });
}

export function parseRipwireVersion(stdout) {
  if (typeof stdout !== "string") {
    throw processError(E_ADVISORY_CONTEXT_RESULT_INVALID, "Ripwire version output was not text");
  }
  const match = /^\s*ripwire\s+([^\s]+)(?:\s|$)/iu.exec(stdout);
  if (!match) {
    throw processError(E_ADVISORY_CONTEXT_RESULT_INVALID, "Ripwire version output did not contain a qualified version");
  }
  return match[1];
}

export { processError as ripwireProcessError };
