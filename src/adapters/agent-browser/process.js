import { spawn as nodeSpawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import {
  E_BROWSER_VERIFICATION_OUTPUT_LIMIT,
  E_BROWSER_VERIFICATION_CANCELLED,
  E_BROWSER_VERIFICATION_EXECUTION_FAILED,
  E_BROWSER_VERIFICATION_PROVIDER_INVALID,
  E_BROWSER_VERIFICATION_PROVIDER_UNAVAILABLE,
  E_BROWSER_VERIFICATION_RESULT_INVALID,
  E_BROWSER_VERIFICATION_TIMEOUT,
} from "../../core/error-codes.js";

export const AGENT_BROWSER_PROCESS_LIMITS = Object.freeze({
  maxStdoutBytes: 1024 * 1024,
  maxStderrBytes: 64 * 1024,
  terminationGraceMs: 150,
  maxVersionBytes: 64 * 1024,
  maxOutputChars: 50_000,
});

function processError(code, message) {
  const error = new Error(message);
  error.name = "AgentBrowserProcessError";
  error.code = code;
  return error;
}

function portableString(value, label) {
  if (typeof value !== "string" || value.length === 0 || /\p{Cc}/u.test(value)) {
    throw processError(E_BROWSER_VERIFICATION_PROVIDER_INVALID, `${label} must be a non-empty portable string`);
  }
  return value;
}

export function assertAbsoluteRegularFile(value, label, fsImpl = fs) {
  portableString(value, label);
  if (!path.isAbsolute(value)) {
    throw processError(E_BROWSER_VERIFICATION_PROVIDER_INVALID, `${label} must be an absolute path`);
  }
  let link;
  let stat;
  try {
    link = fsImpl.lstatSync(value);
    stat = fsImpl.statSync(value);
  } catch {
    throw processError(E_BROWSER_VERIFICATION_PROVIDER_UNAVAILABLE, `${label} is unavailable`);
  }
  if (link.isSymbolicLink?.() || !stat.isFile?.()) {
    throw processError(E_BROWSER_VERIFICATION_PROVIDER_INVALID, `${label} must be a regular file without symlink indirection`);
  }
  return value;
}

function bytes(chunk) {
  return Buffer.isBuffer(chunk) ? chunk.byteLength : Buffer.byteLength(String(chunk));
}

function terminate(child) {
  if (!child || typeof child.kill !== "function") return;
  try { child.kill("SIGTERM"); } catch { /* exited between checks */ }
  const timer = setTimeout(() => {
    try { child.kill("SIGKILL"); } catch { /* preserve original failure */ }
  }, AGENT_BROWSER_PROCESS_LIMITS.terminationGraceMs);
  timer.unref?.();
}

function waitForClose(child) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    child?.once?.("close", finish);
    const timer = setTimeout(finish, AGENT_BROWSER_PROCESS_LIMITS.terminationGraceMs + 500);
    timer.unref?.();
  });
}

function filteredEnvironment(overrides = {}, trustedEnvKeys = new Set()) {
  const forbidden = new Set([
    "AGENT_BROWSER_PROVIDER", "AGENT_BROWSER_PROFILE", "AGENT_BROWSER_RESTORE", "AGENT_BROWSER_STATE",
    "AGENT_BROWSER_CDP", "AGENT_BROWSER_AUTO_CONNECT", "AGENT_BROWSER_PLUGINS", "AGENT_BROWSER_INIT_SCRIPTS",
    "AGENT_BROWSER_EXTENSIONS", "AGENT_BROWSER_ALLOWED_DOMAINS", "AGENT_BROWSER_MAX_OUTPUT",
    "AGENT_BROWSER_CONTENT_BOUNDARIES", "AGENT_BROWSER_NO_WEBMCP", "AGENT_BROWSER_EXECUTABLE_PATH",
    "AGENT_BROWSER_SESSION", "AGENT_BROWSER_SCREENSHOT_DIR", "AGENT_BROWSER_DOWNLOAD_PATH",
    "AGENT_BROWSER_ACTION_POLICY", "AGENT_BROWSER_CONFIRM_ACTIONS", "AGENT_BROWSER_ENGINE",
    "AI_GATEWAY_API_KEY", "AI_GATEWAY_MODEL", "AI_GATEWAY_URL", "BROWSERBASE_API_KEY",
    "BROWSERLESS_API_KEY", "BROWSER_USE_API_KEY", "KERNEL_API_KEY", "AGENT_BROWSER_CONFIG",
  ]);
  const env = {};
  for (const [key, value] of Object.entries({ ...process.env, ...overrides })) {
    if ((!forbidden.has(key) || trustedEnvKeys.has(key)) && typeof value === "string") env[key] = value;
  }
  return env;
}

export async function runAgentBrowserCommand(executablePath, args, {
  cwd,
  timeoutMs,
  signal,
  spawnImpl = nodeSpawn,
  env,
  maxStdoutBytes = AGENT_BROWSER_PROCESS_LIMITS.maxStdoutBytes,
  maxStderrBytes = AGENT_BROWSER_PROCESS_LIMITS.maxStderrBytes,
  fsImpl = fs,
  trustedEnvKeys = [],
} = {}) {
  assertAbsoluteRegularFile(executablePath, "Agent Browser executable", fsImpl);
  portableString(cwd, "Agent Browser cwd");
  if (!path.isAbsolute(cwd)) throw processError(E_BROWSER_VERIFICATION_PROVIDER_INVALID, "Agent Browser cwd must be absolute");
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string" || /\p{Cc}/u.test(arg))) {
    throw processError(E_BROWSER_VERIFICATION_PROVIDER_INVALID, "Agent Browser argv must be a portable string array");
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw processError(E_BROWSER_VERIFICATION_PROVIDER_INVALID, "Agent Browser timeout must be a positive integer");
  }
  if (signal?.aborted) throw processError(E_BROWSER_VERIFICATION_CANCELLED, "Agent Browser verification was cancelled");

  let child;
  try {
    child = spawnImpl(executablePath, [...args], {
      cwd,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      env: filteredEnvironment(env, new Set(trustedEnvKeys)),
    });
  } catch (error) {
    throw processError(
      error?.code === "ENOENT" ? E_BROWSER_VERIFICATION_PROVIDER_UNAVAILABLE : E_BROWSER_VERIFICATION_PROVIDER_UNAVAILABLE,
      "Agent Browser executable could not be started",
    );
  }
  if (!child?.stdout || !child?.stderr || typeof child.on !== "function") {
    terminate(child);
    throw processError(E_BROWSER_VERIFICATION_PROVIDER_UNAVAILABLE, "Agent Browser process did not expose safe output streams");
  }

  return new Promise((resolve, reject) => {
    let stdoutBytes = 0;
    let stderrBytes = 0;
    const stdout = [];
    let settled = false;
    const timerRef = { value: null };
    const cleanup = () => {
      if (timerRef.value) clearTimeout(timerRef.value);
      signal?.removeEventListener?.("abort", abortListener);
      child.stdout.removeAllListeners?.("data");
      child.stderr.removeAllListeners?.("data");
    };
    const fail = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      terminate(child);
      child.stdout.resume?.();
      child.stderr.resume?.();
      waitForClose(child).then(() => reject(error));
    };
    const finish = (code, signalName) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (code !== 0) {
        reject(processError(E_BROWSER_VERIFICATION_EXECUTION_FAILED, `Agent Browser command failed (${code ?? "null"}/${signalName ?? "none"})`));
        return;
      }
      resolve({
        stdout: Buffer.concat(stdout).toString("utf8"),
        stdoutBytes,
        stderrBytes,
      });
    };
    const abortListener = () => fail(processError(E_BROWSER_VERIFICATION_CANCELLED, "Agent Browser verification was cancelled"));
    child.stdout.on("data", (chunk) => {
      stdoutBytes += bytes(chunk);
      if (stdoutBytes > maxStdoutBytes) {
        fail(processError(E_BROWSER_VERIFICATION_OUTPUT_LIMIT, "Agent Browser stdout exceeded its bound"));
        return;
      }
      stdout.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    });
    child.stderr.on("data", (chunk) => {
      stderrBytes += bytes(chunk);
      if (stderrBytes > maxStderrBytes) fail(processError(E_BROWSER_VERIFICATION_OUTPUT_LIMIT, "Agent Browser stderr exceeded its bound"));
    });
    child.once?.("error", () => fail(processError(E_BROWSER_VERIFICATION_PROVIDER_UNAVAILABLE, "Agent Browser process failed")));
    child.once?.("close", finish);
    signal?.addEventListener?.("abort", abortListener, { once: true });
    timerRef.value = setTimeout(() => fail(processError(E_BROWSER_VERIFICATION_TIMEOUT, "Agent Browser command timed out")), timeoutMs);
    timerRef.value.unref?.();
  });
}

export function parseAgentBrowserJson(stdout, label = "Agent Browser response") {
  if (typeof stdout !== "string" || stdout.length > AGENT_BROWSER_PROCESS_LIMITS.maxStdoutBytes) {
    throw processError(E_BROWSER_VERIFICATION_OUTPUT_LIMIT, `${label} exceeded its bound`);
  }
  let value;
  try { value = JSON.parse(stdout); } catch { throw processError(E_BROWSER_VERIFICATION_RESULT_INVALID, `${label} was not valid JSON`); }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw processError(E_BROWSER_VERIFICATION_RESULT_INVALID, `${label} must be a JSON object`);
  }
  if (value.success !== true || !Object.prototype.hasOwnProperty.call(value, "data")
    || Object.keys(value).some((key) => !["success", "data"].includes(key))) {
    throw processError(E_BROWSER_VERIFICATION_RESULT_INVALID, `${label} had an unsupported response envelope`);
  }
  return value.data === undefined ? value : value.data;
}

export { filteredEnvironment, processError as agentBrowserProcessError };
