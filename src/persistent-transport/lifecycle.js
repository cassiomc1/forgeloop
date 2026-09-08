import { spawn } from "node:child_process";
import { mkdir, readFile, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { acquireRepositoryIndexLock } from "../repository-index/lock.js";
import { processIsAlive, processCommandLine } from "../repository-index/status.js";
import { getPackageRoot } from "../core/templates.js";
import { getPersistentTransportPaths } from "./paths.js";
import { PERSISTENT_TRANSPORT_DEFAULTS, PERSISTENT_TRANSPORT_PROTOCOL_VERSION } from "./constants.js";
import { PERSISTENT_TRANSPORT_ERROR_CODES, persistentTransportError } from "./errors.js";
import { readPersistentTransportState, removePersistentTransportState } from "./state.js";
import { inspectPersistentTransportOwnership, terminateOwnedPersistentTransport } from "./ownership.js";

async function readPackageVersion() {
  const packageJson = await readFile(path.join(getPackageRoot(), "package.json"), "utf8");
  return JSON.parse(packageJson).version ?? null;
}

async function removeEndpoint(endpoint, platform = process.platform) {
  if (platform === "win32" || typeof endpoint !== "string") return;
  try {
    await unlink(endpoint);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

export async function ensurePersistentTransportDirectory({ homeDirectory = os.homedir() } = {}) {
  const paths = getPersistentTransportPaths({ homeDirectory });
  await mkdir(paths.root, { recursive: true, mode: 0o700 });
  return paths;
}

export async function inspectPersistentTransport({ homeDirectory = os.homedir(), processApi = process, processInspector = {} } = {}) {
  const paths = getPersistentTransportPaths({ homeDirectory });
  const { state, invalid } = await readPersistentTransportState(paths.statePath);
  if (invalid) return { status: "STALE", running: false, owned: false, paths, state: null, reason: "STATE_INVALID" };
  if (!state) return { status: "NOT_RUNNING", running: false, owned: false, paths, state: null };
  const ownership = await inspectPersistentTransportOwnership(state, { processApi, processInspector });
  if (!ownership.running && ownership.reason === "PROCESS_EXITED") return { status: "STALE", running: false, owned: true, paths, state, reason: ownership.reason };
  if (!ownership.owned) return { status: "OWNERSHIP_UNVERIFIED", running: false, owned: false, paths, state, reason: ownership.reason };
  const packageVersion = await readPackageVersion();
  if (state.protocolVersion !== PERSISTENT_TRANSPORT_PROTOCOL_VERSION || (packageVersion && state.forgeLoopVersion !== packageVersion)) {
    return { status: "INCOMPATIBLE", running: true, owned: true, paths, state, reason: "VERSION_MISMATCH", packageVersion };
  }
  return { status: "READY", running: true, owned: true, paths, state, packageVersion };
}

export async function getPersistentTransportStatus(options = {}) {
  const inspection = await inspectPersistentTransport(options);
  return {
    schemaVersion: 1,
    status: inspection.status,
    running: inspection.running,
    owned: inspection.owned,
    protocolVersion: inspection.state?.protocolVersion ?? null,
    forgeLoopVersion: inspection.state?.forgeLoopVersion ?? null,
  };
}

export async function cleanPersistentTransportState(inspection, { processApi = process } = {}) {
  if (!inspection?.state || inspection.owned !== true) return;
  if (inspection.owned && inspection.running) {
    await terminateOwnedPersistentTransport(inspection.state, { processApi });
    const deadline = Date.now() + 1_000;
    while (Date.now() < deadline && processIsAlive(inspection.state.pid, processApi)) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  await removePersistentTransportState(inspection.paths.statePath, inspection.state.nonce);
  await removeEndpoint(inspection.paths.endpoint);
}

export async function startPersistentSearchHost({ homeDirectory = os.homedir(), idleTimeoutMs = PERSISTENT_TRANSPORT_DEFAULTS.idleTimeoutMs, env = {}, spawnImpl = spawn } = {}) {
  const paths = await ensurePersistentTransportDirectory({ homeDirectory });
  const entrypoint = path.join(getPackageRoot(), "src", "persistent-transport", "server.js");
  const args = [entrypoint, "--persistent-transport-server", `--scope-id=${paths.scopeId}`, `--home-directory=${homeDirectory}`, `--idle-timeout-ms=${String(idleTimeoutMs)}`];
  let child;
  try {
    child = spawnImpl(process.execPath, args, {
      cwd: getPackageRoot(),
      env: {
        ...process.env,
        ...env,
        HOME: homeDirectory,
        USERPROFILE: homeDirectory,
        FORGELOOP_PERSISTENT_TRANSPORT_HOME: homeDirectory,
        FORGELOOP_PERSISTENT_TRANSPORT_SCOPE: paths.scopeId,
      },
      detached: true,
      stdio: "ignore",
      shell: false,
      windowsHide: true,
    });
  } catch (cause) {
    throw persistentTransportError(PERSISTENT_TRANSPORT_ERROR_CODES.START_FAILED, `Unable to start persistent search host: ${cause.message}`, { cause });
  }
  child.unref?.();
  return { child, paths, entrypoint };
}

export async function acquirePersistentTransportStartupLock({ homeDirectory = os.homedir(), tryOnly = false } = {}) {
  const paths = await ensurePersistentTransportDirectory({ homeDirectory });
  return acquireRepositoryIndexLock(paths.lockPath, "persistent-search-host-startup", { timeoutMs: PERSISTENT_TRANSPORT_DEFAULTS.startupTimeoutMs, tryOnly });
}

export async function removeDeadPersistentTransport({ homeDirectory = os.homedir() } = {}) {
  const inspection = await inspectPersistentTransport({ homeDirectory });
  if (inspection.status !== "STALE") return inspection;
  await removePersistentTransportState(inspection.paths.statePath, inspection.state?.nonce ?? null);
  await removeEndpoint(inspection.paths.endpoint);
  return { ...inspection, removed: true };
}

export { processIsAlive, processCommandLine };
