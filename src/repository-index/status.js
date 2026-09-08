import { execFile as nodeExecFile } from "node:child_process";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";

import { REPOSITORY_INDEX_DEFAULTS, REPOSITORY_INDEX_HEALTH, REPOSITORY_INDEX_SCHEMA_VERSION } from "./constants.js";
import { REPOSITORY_INDEX_ERROR_CODES } from "./errors.js";
import { verifyManagedTgrep } from "./binary-manager.js";
import { getCanonicalRepositoryIndexArgs } from "./args.js";
import { runTgrep } from "./process.js";
import { getRepositoryIndexStatePath, getTgrepIndexPath } from "./paths.js";
import { getPackageRoot } from "../core/templates.js";

async function readJsonIfPresent(filePath) {
  try {
    const info = await lstat(filePath);
    if (info.isSymbolicLink() || !info.isFile()) return { error: "NOT_REGULAR_FILE" };
    const raw = await readFile(filePath, "utf8");
    return { value: JSON.parse(raw) };
  } catch (error) {
    if (error.code === "ENOENT") return { value: null };
    return { error: error.message };
  }
}

export function processIsAlive(pid, processApi = process) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    processApi.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

function execFileAsync(execFileImpl, file, args) {
  return new Promise((resolve) => {
    execFileImpl(file, args, { shell: false, timeout: 5_000, maxBuffer: 128 * 1024 }, (error, stdout, stderr) => {
      resolve({ error, stdout: stdout ?? "", stderr: stderr ?? "" });
    });
  });
}

export async function processCommandLine(pid, { platform = process.platform, execFileImpl = nodeExecFile } = {}) {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  if (platform === "win32") {
    // PowerShell is part of supported Windows hosts. The interpolated value
    // is already an integer, so this remains an exact non-shell process
    // query rather than a user-controlled command string.
    const result = await execFileAsync(execFileImpl, "powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `(Get-CimInstance Win32_Process -Filter \"ProcessId = ${pid}\").CommandLine`,
    ]);
    if (result.error) return null;
    const command = result.stdout.trim();
    return command || null;
  }
  const result = await execFileAsync(execFileImpl, "ps", ["-p", String(pid), "-o", "command="]);
  if (result.error) return null;
  const command = result.stdout.trim();
  return command || null;
}

function parseStatusText(text) {
  const files = Number(text.match(/^\s*Files:\s*(\d+)/mi)?.[1]);
  const trigrams = Number(text.match(/^\s*Trigrams:\s*(\d+)/mi)?.[1]);
  const serverNotRunning = /Server:\s*not running/i.test(text);
  const serverRunning = /Server:\s*running/i.test(text);
  const indexing = text.match(/^\s*(?:Indexing|Status):\s*(.+)$/mi)?.[1]?.trim() ?? null;
  return {
    files: Number.isFinite(files) ? files : null,
    trigrams: Number.isFinite(trigrams) ? trigrams : null,
    serverNotRunning,
    serverRunning,
    indexing,
  };
}

function samePath(left, right, platform = process.platform) {
  const pathApi = platform === "win32" ? path.win32 : path;
  const normalize = (value) => pathApi.normalize(value);
  const comparable = (value) => platform === "win32" ? value.toLowerCase() : value;
  return typeof left === "string" && typeof right === "string"
    && comparable(normalize(left)) === comparable(normalize(right));
}

function stateMatchesIndexPaths(state, repositoryRoot, indexPath, platform) {
  return samePath(state?.repositoryRoot, repositoryRoot, platform)
    && samePath(state?.indexPath, indexPath, platform);
}

function processIdentityReason({ commandLine, repositoryRoot, indexPath, binaryPath, platform }) {
  const comparableCommandLine = platform === "win32" && typeof commandLine === "string"
    ? commandLine.toLowerCase()
    : commandLine;
  const comparableRoot = platform === "win32" ? repositoryRoot.toLowerCase() : repositoryRoot;
  const comparableIndexPath = platform === "win32" ? indexPath.toLowerCase() : indexPath;
  if (typeof commandLine !== "string" || !comparableCommandLine.includes("serve")
    || !comparableCommandLine.includes(comparableRoot) || !comparableCommandLine.includes(comparableIndexPath)) {
    return "PROCESS_IDENTITY_UNVERIFIED";
  }
  const comparableBinaryPath = platform === "win32" && binaryPath
    ? binaryPath.toLowerCase()
    : binaryPath;
  if (binaryPath && !comparableCommandLine.includes(comparableBinaryPath)) return "PROCESS_BINARY_MISMATCH";
  return null;
}

async function readProcessCommandLineForInspection(pid, processInspector, platform) {
  return processInspector.commandLine === undefined
    ? processCommandLine(pid, { ...processInspector, platform })
    : processInspector.commandLine(pid);
}

export async function inspectRepositoryIndexServer({ state, serve, repositoryRoot, indexPath, processInspector = {} } = {}) {
  const platform = processInspector.platform ?? process.platform;
  if (!state || state.startedByForgeLoop !== true) {
    return { owned: false, running: false, reason: "MISSING_FORGELOOP_OWNERSHIP" };
  }
  if (!stateMatchesIndexPaths(state, repositoryRoot, indexPath, platform)) {
    return { owned: false, running: false, reason: "STATE_PATH_MISMATCH" };
  }
  if (!serve || serve.pid !== state.observedPid || !Number.isInteger(serve.pid) || serve.pid <= 0) {
    return { owned: false, running: false, reason: "SERVE_METADATA_MISMATCH" };
  }
  const alive = (processInspector.isAlive ?? processIsAlive)(serve.pid);
  if (!alive) return { owned: true, running: false, pid: serve.pid, port: serve.port ?? null, reason: "PROCESS_EXITED" };
  const commandLine = await readProcessCommandLineForInspection(serve.pid, processInspector, platform);
  const identityReason = processIdentityReason({ commandLine, repositoryRoot, indexPath, binaryPath: state.binaryPath, platform });
  if (identityReason) return { owned: false, running: false, pid: serve.pid, port: serve.port ?? null, reason: identityReason, commandLine: null };
  return { owned: true, running: true, pid: serve.pid, port: serve.port ?? null, commandLine: null };
}

function baseStatus({ repositoryRoot, indexPath, statePath }) {
  return {
    schemaVersion: REPOSITORY_INDEX_SCHEMA_VERSION,
    required: true,
    engine: "tgrep",
    engineVersion: null,
    managedBinary: false,
    overridden: false,
    binaryPath: null,
    repositoryRoot,
    indexPath,
    statePath,
    policy: {
      maxFileSize: REPOSITORY_INDEX_DEFAULTS.maxFileSize,
      maxCpuPercent: REPOSITORY_INDEX_DEFAULTS.maxCpuPercent,
      watcherQueueCap: REPOSITORY_INDEX_DEFAULTS.watcherQueueCap,
      autoSaveMutations: REPOSITORY_INDEX_DEFAULTS.autoSaveMutations,
    },
    index: {
      present: false,
      complete: false,
      files: null,
      trigrams: null,
      createdAt: null,
      updatedAt: null,
      rootPath: null,
    },
    server: {
      running: false,
      owned: false,
      pid: null,
      port: null,
      watcher: "inactive",
      indexing: "unknown",
      files: null,
    },
    health: "NOT_INITIALIZED",
    diagnostics: [],
  };
}

function redactLocalPaths(message, paths = []) {
  let redacted = typeof message === "string" ? message : String(message ?? "");
  for (const value of paths.filter((item) => typeof item === "string" && item.length > 0).sort((left, right) => right.length - left.length)) {
    redacted = redacted.replaceAll(value, "<local-path>");
  }
  return redacted;
}

export function sanitizeRepositoryIndexStatus(status) {
  if (!status || typeof status !== "object") return status;
  const {
    binaryPath: _binaryPath,
    repositoryRoot: _repositoryRoot,
    indexPath: _indexPath,
    statePath: _statePath,
    index = {},
    diagnostics = [],
    ...publicStatus
  } = status;
  const localPaths = [
    status.binaryPath,
    status.repositoryRoot,
    status.indexPath,
    status.statePath,
    index.rootPath,
    ...diagnostics.map((diagnostic) => diagnostic.path),
  ];
  const { rootPath: _rootPath, ...publicIndex } = index;
  return {
    ...publicStatus,
    index: publicIndex,
    diagnostics: diagnostics.map(({ path: _path, ...diagnostic }) => ({
      ...diagnostic,
      message: redactLocalPaths(diagnostic.message, localPaths),
    })),
  };
}

function statusOutput(status, includeLocalPaths) {
  return includeLocalPaths ? status : sanitizeRepositoryIndexStatus(status);
}

function healthResult(status, health, diagnostic) {
  status.health = REPOSITORY_INDEX_HEALTH.includes(health) ? health : "ERROR";
  if (diagnostic) status.diagnostics.push(diagnostic);
  return status;
}

async function verifyEngineForStatus(status, options) {
  try {
    const engine = await verifyManagedTgrep(options);
    status.engineVersion = engine.engineVersion;
    status.managedBinary = engine.managed;
    status.overridden = engine.overridden;
    status.binaryPath = engine.binaryPath;
    return engine;
  } catch (error) {
    const missing = error.code === REPOSITORY_INDEX_ERROR_CODES.ENGINE_MISSING;
    healthResult(status, missing ? "ENGINE_MISSING" : "ENGINE_INVALID", {
      code: error.code ?? REPOSITORY_INDEX_ERROR_CODES.ENGINE_MISSING,
      message: error.message,
      path: error.path,
    });
    return null;
  }
}

async function readStatusMetadata(indexPath, statePath) {
  const [metaFile, stateFile, serveFile] = await Promise.all([
    readJsonIfPresent(path.join(indexPath, "meta.json")),
    readJsonIfPresent(statePath),
    readJsonIfPresent(path.join(indexPath, "serve.json")),
  ]);
  if (metaFile.error || stateFile.error || serveFile.error) {
    return { error: { code: REPOSITORY_INDEX_ERROR_CODES.SERVER_UNHEALTHY, message: "Repository Index metadata is not readable as regular JSON files" } };
  }
  return { meta: metaFile.value, state: stateFile.value, serve: serveFile.value };
}

async function projectIndexMetadata(status, meta, canonicalRoot, config) {
  const metaRoot = typeof meta.root_path === "string" ? await realpath(meta.root_path).catch(() => meta.root_path) : null;
  status.index = {
    present: true,
    complete: meta.complete === true,
    files: Number.isInteger(meta.num_files) ? meta.num_files : null,
    trigrams: Number.isInteger(meta.num_trigrams) ? meta.num_trigrams : null,
    createdAt: Number.isFinite(meta.created_at) ? meta.created_at : null,
    updatedAt: Number.isFinite(meta.updated_at) ? meta.updated_at : null,
    rootPath: metaRoot,
  };
  status.policy = {
    maxFileSize: config.maxFileSize ?? REPOSITORY_INDEX_DEFAULTS.maxFileSize,
    maxCpuPercent: config.maxCpuPercent ?? REPOSITORY_INDEX_DEFAULTS.maxCpuPercent,
    watcherQueueCap: config.watcherQueueCap ?? REPOSITORY_INDEX_DEFAULTS.watcherQueueCap,
    autoSaveMutations: config.autoSaveMutations ?? REPOSITORY_INDEX_DEFAULTS.autoSaveMutations,
  };
  if (!samePath(metaRoot, canonicalRoot)) {
    healthResult(status, "SERVER_UNHEALTHY", { code: REPOSITORY_INDEX_ERROR_CODES.SERVER_UNHEALTHY, message: "Index metadata points at a different repository root" });
    return false;
  }
  if (meta.complete !== true) {
    status.server.indexing = "in-progress";
    healthResult(status, "INDEXING", { code: REPOSITORY_INDEX_ERROR_CODES.INDEXING, message: "Repository Index build is incomplete" });
    return false;
  }
  return true;
}

async function readNativeStatus({ engine, canonicalRoot, indexPath, config, spawnImpl }) {
  return runTgrep({
    binaryPath: engine.binaryPath,
    repoRoot: canonicalRoot,
    args: ["status", ...getCanonicalRepositoryIndexArgs({ mode: "status", indexPath, config }), canonicalRoot],
    spawnImpl,
    timeoutMs: 15_000,
    maxOutputBytes: 256 * 1024,
  }).catch((error) => ({ error }));
}

function nativeStatusFailed(native) {
  return native.error || (native.exitCode !== 0 && !native.stdout && !native.stderr);
}

function projectServerStatus(status, ownership, serve, state) {
  status.server = {
    running: ownership.running === true,
    owned: ownership.owned === true,
    pid: ownership.pid ?? null,
    port: ownership.port ?? null,
    watcher: ownership.running ? "active" : "inactive",
    indexing: "complete",
    files: status.index.files,
  };
  if (ownership.running) return healthResult(status, "READY");
  if (serve || state) {
    return healthResult(status, ownership.owned ? "SERVER_DOWN" : "SERVER_UNHEALTHY", {
      code: REPOSITORY_INDEX_ERROR_CODES.SERVER_UNHEALTHY,
      message: ownership.owned ? "ForgeLoop Repository Index server is not running" : "A tgrep server exists without verifiable ForgeLoop ownership",
    });
  }
  return healthResult(status, "SERVER_DOWN", { code: REPOSITORY_INDEX_ERROR_CODES.SERVER_UNHEALTHY, message: "Repository Index server is not running" });
}

export async function getRepositoryIndexStatus(repositoryRoot, {
  packageRoot = getPackageRoot(),
  env = process.env,
  binaryPath,
  platform,
  arch,
  homeDirectory,
  config = {},
  spawnImpl,
  processInspector = {},
  skipNativeStatus = false,
  includeLocalPaths = false,
} = {}) {
  const canonicalRoot = await realpath(repositoryRoot);
  const indexPath = getTgrepIndexPath(canonicalRoot);
  const statePath = getRepositoryIndexStatePath(canonicalRoot);
  const status = baseStatus({ repositoryRoot: canonicalRoot, indexPath, statePath });

  const engine = await verifyEngineForStatus(status, {
    packageRoot,
    repoRoot: canonicalRoot,
    env,
    binaryPath,
    platform,
    arch,
    homeDirectory,
    spawnImpl,
  });
  if (!engine) return statusOutput(status, includeLocalPaths);

  const metadata = await readStatusMetadata(indexPath, statePath);
  if (metadata.error) return statusOutput(healthResult(status, "SERVER_UNHEALTHY", metadata.error), includeLocalPaths);
  const { meta, state, serve } = metadata;
  if (!meta) return statusOutput(healthResult(status, "NOT_INITIALIZED", { code: REPOSITORY_INDEX_ERROR_CODES.NOT_INITIALIZED, message: "Repository Index has not been built" }), includeLocalPaths);
  if (!await projectIndexMetadata(status, meta, canonicalRoot, config)) return statusOutput(status, includeLocalPaths);

  if (!skipNativeStatus) {
    const native = await readNativeStatus({ engine, canonicalRoot, indexPath, config, spawnImpl });
    if (nativeStatusFailed(native)) {
      return statusOutput(healthResult(status, "SERVER_UNHEALTHY", {
        code: native.error?.code ?? REPOSITORY_INDEX_ERROR_CODES.SERVER_UNHEALTHY,
        message: native.error?.message ?? "tgrep status failed",
      }), includeLocalPaths);
    }
    status.native = parseStatusText(`${native.stdout}\n${native.stderr}`);
  }

  const ownership = await inspectRepositoryIndexServer({
    state,
    serve,
    repositoryRoot: canonicalRoot,
    indexPath,
    processInspector,
  });
  return statusOutput(projectServerStatus(status, ownership, serve, state), includeLocalPaths);
}

export function formatRepositoryIndexStatus(status) {
  const lines = [
    `Repository Index: ${status.health}`,
    `Engine: ${status.engine} ${status.engineVersion ?? "unknown"}${status.overridden ? " (explicit override)" : ""}`,
    `Repository: ${status.repositoryRoot ?? "hidden"}`,
    `Index: ${status.indexPath ?? "hidden"}`,
    `Indexed files: ${status.index.files ?? "unknown"}`,
    `Server: ${status.server.running ? `running (pid ${status.server.pid ?? "unknown"}, port ${status.server.port ?? "unknown"})` : "not running"}`,
    `Watcher: ${status.server.watcher}`,
  ];
  for (const diagnostic of status.diagnostics ?? []) lines.push(`Diagnostic: ${diagnostic.code}: ${diagnostic.message}`);
  return `${lines.join("\n")}\n`;
}
