import { spawn as nodeSpawn } from "node:child_process";

import {
  EMULATED_SERVICES_ERROR_CODES,
  EMULATED_SERVICES_PROCESS_LIMITS,
} from "./constants.js";

function processError(code, message, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.name = "EmulatedServicesProcessError";
  error.code = code;
  return error;
}

function byteLength(value) {
  return Buffer.isBuffer(value) ? value.byteLength : Buffer.byteLength(String(value));
}

function terminateChild(child) {
  if (!child || typeof child.kill !== "function") return;
  try {
    child.kill("SIGTERM");
  } catch {
    // The process may have exited between a boundary failure and termination.
  }
  const timer = setTimeout(() => {
    try {
      child.kill("SIGKILL");
    } catch {
      // Preserve the original boundary error.
    }
  }, EMULATED_SERVICES_PROCESS_LIMITS.terminationGraceMs);
  timer.unref?.();
}

function waitForClose(child, alreadyClosed = () => false) {
  if (alreadyClosed()) return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    child.once?.("close", finish);
    const timer = setTimeout(finish, EMULATED_SERVICES_PROCESS_LIMITS.terminationGraceMs + 1000);
    timer.unref?.();
  });
}

function assertArgv(args) {
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string" || /\p{Cc}/u.test(arg))) {
    throw processError(EMULATED_SERVICES_ERROR_CODES.CONFIG_INVALID, "Emulated Services arguments must be portable strings");
  }
}

export function spawnManagedEmulatedServicesProcess(executablePath, args, options = {}) {
  assertArgv(args);
  const spawnImpl = options.spawnImpl ?? nodeSpawn;
  if (typeof spawnImpl !== "function") {
    throw processError(EMULATED_SERVICES_ERROR_CODES.CONFIG_INVALID, "Emulated Services spawn implementation must be a function");
  }

  let child;
  try {
    child = spawnImpl(executablePath, [...args], {
      cwd: options.cwd,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      env: options.env,
    });
  } catch (error) {
    throw processError(EMULATED_SERVICES_ERROR_CODES.UNAVAILABLE, "Unable to start the Emulated Services executable", error);
  }

  if (!child || !child.stdout || !child.stderr || typeof child.on !== "function") {
    terminateChild(child);
    throw processError(EMULATED_SERVICES_ERROR_CODES.UNAVAILABLE, "Emulated Services process did not expose piped output");
  }

  const maxStdoutBytes = options.maxStdoutBytes ?? EMULATED_SERVICES_PROCESS_LIMITS.maxStdoutBytes;
  const maxStderrBytes = options.maxStderrBytes ?? EMULATED_SERVICES_PROCESS_LIMITS.maxStderrBytes;
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let overflowError = null;
  const stdoutChunks = [];

  child.stdout.on("data", (chunk) => {
    stdoutBytes += byteLength(chunk);
    if (stdoutBytes > maxStdoutBytes && !overflowError) {
      overflowError = processError(EMULATED_SERVICES_ERROR_CODES.OUTPUT_LIMIT, "Emulated Services stdout exceeded its safety limit");
      terminateChild(child);
      return;
    }
    if (!overflowError) stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  });
  child.stderr.on("data", (chunk) => {
    stderrBytes += byteLength(chunk);
    if (stderrBytes > maxStderrBytes && !overflowError) {
      overflowError = processError(EMULATED_SERVICES_ERROR_CODES.OUTPUT_LIMIT, "Emulated Services stderr exceeded its safety limit");
      terminateChild(child);
    }
  });

  let processErrorValue = null;
  child.on("error", (error) => {
    processErrorValue = processError(
      error?.code === "ENOENT" ? EMULATED_SERVICES_ERROR_CODES.UNAVAILABLE : EMULATED_SERVICES_ERROR_CODES.EXECUTION_FAILED,
      "Emulated Services process failed",
      error,
    );
  });

  let hasClosed = false;
  const closed = new Promise((resolve) => {
    child.on("close", (code, signal) => {
      hasClosed = true;
      resolve({ code, signal });
    });
  });

  return Object.freeze({
    child,
    closed,
    output: () => ({
      stdout: Buffer.concat(stdoutChunks).toString("utf8"),
      stdoutBytes,
      stderrBytes,
    }),
    failure: () => overflowError ?? processErrorValue,
    stop: () => terminateChild(child),
    waitForClose: () => waitForClose(child, () => hasClosed),
  });
}

export async function runBoundedEmulatedServicesCommand(executablePath, args, options = {}) {
  const managed = spawnManagedEmulatedServicesProcess(executablePath, args, options);
  const timeoutMs = options.timeoutMs ?? 10_000;
  const timeout = new Promise((_, reject) => {
    const timer = setTimeout(() => {
      managed.stop();
      reject(processError(EMULATED_SERVICES_ERROR_CODES.TIMEOUT, "Emulated Services command exceeded its timeout"));
    }, timeoutMs);
    timer.unref?.();
  });
  try {
    const result = await Promise.race([managed.closed, timeout]);
    const failure = managed.failure();
    if (failure) throw failure;
    if (result.code !== 0) {
      throw processError(EMULATED_SERVICES_ERROR_CODES.EXECUTION_FAILED, "Emulated Services command exited unsuccessfully");
    }
    return managed.output();
  } finally {
    managed.stop();
    await managed.waitForClose();
  }
}

export function emulatedServicesProcessError(code, message, cause) {
  return processError(code, message, cause);
}
