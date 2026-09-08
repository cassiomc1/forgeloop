import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rm, unlink } from "node:fs/promises";
import path from "node:path";

import { assertSafePath, realpathWithTransientWindowsRetry, writeFileAtomic } from "../core/filesystem.js";
import { REPOSITORY_INDEX_DEFAULTS } from "./constants.js";
import { REPOSITORY_INDEX_ERROR_CODES as ERROR_CODES, repositoryIndexError, wrapRepositoryIndexError } from "./errors.js";
import { ensureManagedTgrep } from "./binary-manager.js";
import { getCanonicalRepositoryIndexArgs } from "./args.js";
import { withRepositoryIndexLock } from "./lock.js";
import { runTgrep, spawnTgrepServer } from "./process.js";
import {
  getRepositoryIndexRoot,
  getRepositoryIndexStatePath,
  getTgrepIndexPath,
} from "./paths.js";
import { getRepositoryIndexStatus, inspectRepositoryIndexServer, processIsAlive } from "./status.js";

async function readJson(filePath) {
  try {
    const info = await lstat(filePath);
    if (info.isSymbolicLink() || !info.isFile()) return null;
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function writeJson(filePath, value) {
  await writeFileAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function removeFileIfPresent(filePath) {
  try {
    await unlink(filePath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

function serverArgs(indexPath, config) {
  return [
    "serve",
    ...getCanonicalRepositoryIndexArgs({ mode: "serve", indexPath, config }),
  ];
}

function indexArgs(indexPath, config, force) {
  return [
    "index",
    ...(force ? ["--force"] : []),
    ...getCanonicalRepositoryIndexArgs({ mode: "index", indexPath, config }),
  ];
}

async function assertIndexPaths(repositoryRoot) {
  await assertSafePath(repositoryRoot, ".forgeloop/repository-index");
  await assertSafePath(repositoryRoot, ".forgeloop/repository-index/tgrep");
  await assertSafePath(repositoryRoot, ".forgeloop/repository-index/engine-state.json");
  await mkdir(getRepositoryIndexRoot(repositoryRoot), { recursive: true });
}

async function readIndexMetadata(repositoryRoot) {
  const indexPath = getTgrepIndexPath(repositoryRoot);
  const statePath = getRepositoryIndexStatePath(repositoryRoot);
  return {
    meta: await readJson(path.join(indexPath, "meta.json")),
    state: await readJson(statePath),
    serve: await readJson(path.join(indexPath, "serve.json")),
  };
}

function indexIsUsable({ meta, state, repositoryRoot, engineVersion }) {
  return meta?.complete === true
    && typeof meta.root_path === "string"
    && path.normalize(meta.root_path) === path.normalize(repositoryRoot)
    && state?.schemaVersion === 1
    && state?.engine === "tgrep"
    && state?.engineVersion === engineVersion
    && state?.repositoryRoot === repositoryRoot
    && state?.indexPath === getTgrepIndexPath(repositoryRoot);
}

async function waitForServerReady({ repositoryRoot, indexPath, child, engine, timeoutMs, processInspector }) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    if (child?.pid && !processIsAlive(child.pid)) {
      throw repositoryIndexError(ERROR_CODES.SERVER_START_FAILED, "tgrep server exited before becoming ready", { pid: child.pid });
    }
    try {
      const { serve, state, meta } = await readIndexMetadata(repositoryRoot);
      const ownership = await inspectRepositoryIndexServer({
        state,
        serve,
        repositoryRoot,
        indexPath,
        processInspector,
      });
      if (ownership.running && meta?.complete === true) {
        return { serve, state, meta, ownership };
      }
      lastError = ownership.reason ?? "metadata not ready";
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw repositoryIndexError(
    ERROR_CODES.SERVER_START_FAILED,
    `tgrep server did not become ready within ${timeoutMs}ms${lastError ? `: ${lastError.message ?? lastError}` : ""}`,
    { binaryPath: engine.binaryPath, repositoryRoot, indexPath },
  );
}

async function terminateOwnedServer({ repositoryRoot, indexPath, statePath, processInspector = {}, timeoutMs = 15_000 }) {
  const { state, serve } = await readIndexMetadata(repositoryRoot);
  if (state?.startedByForgeLoop === true && !serve) {
    throw repositoryIndexError(ERROR_CODES.SERVER_STOP_FAILED, "ForgeLoop server state has no matching tgrep serve metadata; refusing to guess the process identity");
  }
  const ownership = await inspectRepositoryIndexServer({
    state,
    serve,
    repositoryRoot,
    indexPath,
    processInspector,
  });
  if (ownership.running) {
    try {
      process.kill(ownership.pid);
    } catch (error) {
      if (error.code !== "ESRCH") {
        throw repositoryIndexError(ERROR_CODES.SERVER_STOP_FAILED, `Unable to stop owned tgrep server: ${error.message}`, { cause: error, pid: ownership.pid });
      }
    }
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline && processIsAlive(ownership.pid)) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (processIsAlive(ownership.pid)) {
      throw repositoryIndexError(ERROR_CODES.SERVER_STOP_FAILED, `Owned tgrep server did not stop within ${timeoutMs}ms`, { pid: ownership.pid });
    }
  } else if (serve && !ownership.owned) {
    throw repositoryIndexError(ERROR_CODES.SERVER_STOP_FAILED, "Refusing to remove tgrep server metadata without verifiable ForgeLoop ownership", { reason: ownership.reason });
  }
  if (ownership.owned || !serve) {
    await removeFileIfPresent(path.join(indexPath, "serve.json"));
    const currentState = await readJson(statePath);
    if (currentState?.startedByForgeLoop === true && currentState.repositoryRoot === repositoryRoot) {
      await removeFileIfPresent(statePath);
    }
  }
  return { stopped: ownership.running || ownership.owned, pid: ownership.pid ?? null };
}

async function startUnderLock(repositoryRoot, options, engine) {
  const indexPath = getTgrepIndexPath(repositoryRoot);
  const statePath = getRepositoryIndexStatePath(repositoryRoot);
  const metadata = await readIndexMetadata(repositoryRoot);
  if (!metadata.meta?.complete) {
    throw repositoryIndexError(ERROR_CODES.NOT_INITIALIZED, "Repository Index has not been built; run forgeloop index-setup first");
  }

  if (metadata.serve || metadata.state) {
    const ownership = await inspectRepositoryIndexServer({
      state: metadata.state,
      serve: metadata.serve,
      repositoryRoot,
      indexPath,
      processInspector: options.processInspector,
    });
    if (ownership.running) {
      return {
        started: false,
        alreadyRunning: true,
        pid: ownership.pid,
        port: ownership.port,
        status: await getRepositoryIndexStatus(repositoryRoot, { ...options, packageRoot: options.packageRoot, binaryPath: engine.overridden ? engine.binaryPath : undefined, skipNativeStatus: true }),
      };
    }
    if (metadata.serve && !ownership.owned) {
      throw repositoryIndexError(ERROR_CODES.SERVER_START_FAILED, "Refusing to replace a tgrep server without verifiable ForgeLoop ownership", { reason: ownership.reason });
    }
    if (metadata.state?.startedByForgeLoop === true && !metadata.serve) {
      throw repositoryIndexError(ERROR_CODES.SERVER_START_FAILED, "ForgeLoop server state has no matching tgrep serve metadata; refusing to guess the process identity");
    }
    if (ownership.owned || !metadata.serve) await terminateOwnedServer({ repositoryRoot, indexPath, statePath, processInspector: options.processInspector });
  }

  const startedAt = new Date().toISOString();
  const child = spawnTgrepServer({
    binaryPath: engine.binaryPath,
    repoRoot: repositoryRoot,
    args: serverArgs(indexPath, options.config),
    env: options.env,
    spawnImpl: options.spawnImpl,
    stdio: options.stdio ?? "ignore",
  });
  if (!Number.isInteger(child.pid) || child.pid <= 0) {
    throw repositoryIndexError(ERROR_CODES.SERVER_START_FAILED, "tgrep server did not provide a valid process ID");
  }
  const state = {
    schemaVersion: 1,
    engine: "tgrep",
    engineVersion: engine.engineVersion,
    binaryPath: engine.binaryPath,
    repositoryRoot,
    indexPath,
    observedPid: child.pid,
    startedByForgeLoop: true,
    watcher: true,
    startedAt,
    stateId: randomUUID(),
  };
  await writeJson(statePath, state);
  try {
    const ready = await waitForServerReady({
      repositoryRoot,
      indexPath,
      child,
      engine,
      timeoutMs: options.startupTimeoutMs ?? REPOSITORY_INDEX_DEFAULTS.startupTimeoutMs,
      processInspector: options.processInspector,
    });
    await writeJson(statePath, {
      ...(ready.state ?? state),
      lastReadyAt: new Date().toISOString(),
    });
    return {
      started: true,
      alreadyRunning: false,
      pid: ready.ownership.pid,
      port: ready.ownership.port,
      status: await getRepositoryIndexStatus(repositoryRoot, { ...options, packageRoot: options.packageRoot, binaryPath: engine.overridden ? engine.binaryPath : undefined, skipNativeStatus: true }),
    };
  } catch (error) {
    try { process.kill(child.pid); } catch { /* best effort for the exact child only */ }
    await removeFileIfPresent(statePath);
    throw error;
  }
}

async function buildUnderLock(repositoryRoot, options, engine, { force = false } = {}) {
  const indexPath = getTgrepIndexPath(repositoryRoot);
  const result = await runTgrep({
    binaryPath: engine.binaryPath,
    repoRoot: repositoryRoot,
    args: indexArgs(indexPath, options.config, force),
    env: options.env,
    spawnImpl: options.spawnImpl,
    timeoutMs: options.commandTimeoutMs ?? REPOSITORY_INDEX_DEFAULTS.commandTimeoutMs,
    maxOutputBytes: options.maxProcessOutputBytes ?? REPOSITORY_INDEX_DEFAULTS.maxProcessOutputBytes,
  });
  if (result.timedOut || result.exitCode !== 0) {
    throw repositoryIndexError(ERROR_CODES.REBUILD_FAILED, `tgrep index failed with exit code ${result.exitCode ?? "unknown"}`, {
      exitCode: result.exitCode,
      stderr: result.stderr.slice(0, 4000),
      stdout: result.stdout.slice(0, 4000),
    });
  }
  const meta = await readJson(path.join(indexPath, "meta.json"));
  if (!meta?.complete || typeof meta.root_path !== "string" || path.normalize(meta.root_path) !== path.normalize(repositoryRoot)) {
    throw repositoryIndexError(ERROR_CODES.REBUILD_FAILED, "tgrep index completed without valid repository metadata");
  }
  return { result, meta };
}

function engineOptions(options) {
  return {
    packageRoot: options.packageRoot,
    repoRoot: options.repositoryRoot,
    platform: options.platform,
    arch: options.arch,
    env: options.env,
    binaryPath: options.binaryPath,
    assetPath: options.assetPath,
    homeDirectory: options.homeDirectory,
    fetchImpl: options.fetchImpl,
    spawnImpl: options.spawnImpl,
    execFileImpl: options.execFileImpl,
  };
}

async function prepareEngine(repositoryRoot, options) {
  try {
    return await ensureManagedTgrep(engineOptions({ ...options, repositoryRoot }));
  } catch (error) {
    if (error.code?.startsWith?.("E_REPOSITORY_INDEX_")) throw error;
    throw wrapRepositoryIndexError(ERROR_CODES.ENGINE_EXECUTION_FAILED, "Unable to prepare managed tgrep", error);
  }
}

export async function startRepositoryIndexServer(repositoryRoot, options = {}) {
  const canonicalRoot = await realpathWithTransientWindowsRetry(repositoryRoot);
  await assertIndexPaths(canonicalRoot);
  return withRepositoryIndexLock(canonicalRoot, "index-start", async () => {
    const engine = await prepareEngine(canonicalRoot, options);
    return startUnderLock(canonicalRoot, { ...options, repositoryRoot: canonicalRoot }, engine);
  }, options);
}

export async function restartRepositoryIndexServer(repositoryRoot, options = {}) {
  await stopRepositoryIndexServer(repositoryRoot, options);
  return startRepositoryIndexServer(repositoryRoot, options);
}

export async function stopRepositoryIndexServer(repositoryRoot, options = {}) {
  const canonicalRoot = await realpathWithTransientWindowsRetry(repositoryRoot);
  await assertIndexPaths(canonicalRoot);
  return withRepositoryIndexLock(canonicalRoot, "index-stop", async () => {
    const indexPath = getTgrepIndexPath(canonicalRoot);
    return terminateOwnedServer({
      repositoryRoot: canonicalRoot,
      indexPath,
      statePath: getRepositoryIndexStatePath(canonicalRoot),
      processInspector: options.processInspector,
      timeoutMs: options.stopTimeoutMs ?? 15_000,
    });
  }, options);
}

export async function rebuildRepositoryIndex(repositoryRoot, options = {}) {
  const canonicalRoot = await realpathWithTransientWindowsRetry(repositoryRoot);
  await assertIndexPaths(canonicalRoot);
  return withRepositoryIndexLock(canonicalRoot, "index-rebuild", async () => {
    const engine = await prepareEngine(canonicalRoot, options);
    const indexPath = getTgrepIndexPath(canonicalRoot);
    const metadata = await readIndexMetadata(canonicalRoot);
    if (metadata.serve || metadata.state) {
      await terminateOwnedServer({
        repositoryRoot: canonicalRoot,
        indexPath,
        statePath: getRepositoryIndexStatePath(canonicalRoot),
        processInspector: options.processInspector,
        timeoutMs: options.stopTimeoutMs ?? 15_000,
      });
    }
    await assertSafePath(canonicalRoot, ".forgeloop/repository-index/tgrep");
    await rm(indexPath, { recursive: true, force: true });
    await mkdir(indexPath, { recursive: true });
    const built = await buildUnderLock(canonicalRoot, { ...options, repositoryRoot: canonicalRoot }, engine, { force: true });
    const statePath = getRepositoryIndexStatePath(canonicalRoot);
    await writeJson(statePath, {
      schemaVersion: 1,
      engine: "tgrep",
      engineVersion: engine.engineVersion,
      binaryPath: engine.binaryPath,
      repositoryRoot: canonicalRoot,
      indexPath,
      indexEngineVersion: engine.engineVersion,
      builtAt: new Date().toISOString(),
      startedByForgeLoop: false,
    });
    const started = await startUnderLock(canonicalRoot, { ...options, repositoryRoot: canonicalRoot }, engine);
    return { ...started, rebuilt: true, indexed: built.meta };
  }, options);
}

export async function setupRepositoryIndex(repositoryRoot, options = {}) {
  const canonicalRoot = await realpathWithTransientWindowsRetry(repositoryRoot);
  await assertIndexPaths(canonicalRoot);
  return withRepositoryIndexLock(canonicalRoot, "index-setup", async () => {
    const engine = await prepareEngine(canonicalRoot, options);
    const indexPath = getTgrepIndexPath(canonicalRoot);
    const metadata = await readIndexMetadata(canonicalRoot);
    if (options.force === true || !indexIsUsable({ ...metadata, repositoryRoot: canonicalRoot, engineVersion: engine.engineVersion })) {
      if (metadata.serve || metadata.state) {
        await terminateOwnedServer({
          repositoryRoot: canonicalRoot,
          indexPath,
          statePath: getRepositoryIndexStatePath(canonicalRoot),
          processInspector: options.processInspector,
          timeoutMs: options.stopTimeoutMs ?? 15_000,
        });
      }
      if (options.force === true) {
        await assertSafePath(canonicalRoot, ".forgeloop/repository-index/tgrep");
        await rm(indexPath, { recursive: true, force: true });
      }
      await mkdir(indexPath, { recursive: true });
      const built = await buildUnderLock(canonicalRoot, { ...options, repositoryRoot: canonicalRoot }, engine, { force: true });
      await writeJson(getRepositoryIndexStatePath(canonicalRoot), {
        schemaVersion: 1,
        engine: "tgrep",
        engineVersion: engine.engineVersion,
        binaryPath: engine.binaryPath,
        repositoryRoot: canonicalRoot,
        indexPath,
        indexEngineVersion: engine.engineVersion,
        builtAt: new Date().toISOString(),
        startedByForgeLoop: false,
      });
      const started = await startUnderLock(canonicalRoot, { ...options, repositoryRoot: canonicalRoot }, engine);
      return { ...started, setup: true, rebuilt: true, indexed: built.meta };
    }
    const started = await startUnderLock(canonicalRoot, { ...options, repositoryRoot: canonicalRoot }, engine);
    return { ...started, setup: true, rebuilt: false, indexed: metadata.meta };
  }, options);
}
