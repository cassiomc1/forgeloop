import { processCommandLine, processIsAlive } from "../repository-index/status.js";
import { PERSISTENT_TRANSPORT_ERROR_CODES, persistentTransportError } from "./errors.js";

function comparable(value) {
  return process.platform === "win32" ? value.toLowerCase() : value;
}

export async function inspectPersistentTransportOwnership(state, {
  processApi = process,
  processInspector = {},
} = {}) {
  if (!state || state.schemaVersion !== 1 || !Number.isInteger(state.pid) || state.pid <= 0
    || typeof state.nonce !== "string" || typeof state.scopeId !== "string" || typeof state.entrypoint !== "string") {
    return { owned: false, running: false, reason: "STATE_INVALID" };
  }
  const alive = (processInspector.isAlive ?? ((pid) => processIsAlive(pid, processApi)))(state.pid);
  if (!alive) return { owned: true, running: false, reason: "PROCESS_EXITED", pid: state.pid };
  const commandLine = processInspector.commandLine === undefined
    ? await processCommandLine(state.pid, { platform: process.platform })
    : await processInspector.commandLine(state.pid);
  const command = typeof commandLine === "string" ? comparable(commandLine) : "";
  const entrypoint = comparable(state.entrypoint);
  const scopeMarker = comparable(state.scopeId);
  const owned = command.includes(entrypoint) && command.includes("--persistent-transport-server") && command.includes(scopeMarker);
  return {
    owned,
    running: owned,
    pid: state.pid,
    reason: owned ? null : "PROCESS_IDENTITY_UNVERIFIED",
    commandLine: owned ? null : null,
  };
}

export async function requireOwnedPersistentTransport(state, options = {}) {
  const inspection = await inspectPersistentTransportOwnership(state, options);
  if (!inspection.owned) {
    throw persistentTransportError(PERSISTENT_TRANSPORT_ERROR_CODES.OWNERSHIP_UNVERIFIED, "Persistent search host ownership could not be verified");
  }
  return inspection;
}

export async function terminateOwnedPersistentTransport(state, { signal = "SIGTERM", processApi = process, ...options } = {}) {
  const inspection = await requireOwnedPersistentTransport(state, { processApi, ...options });
  if (!inspection.running) return { ...inspection, terminated: false };
  try {
    processApi.kill(state.pid, signal);
  } catch (error) {
    if (error.code !== "ESRCH") throw persistentTransportError(PERSISTENT_TRANSPORT_ERROR_CODES.OWNERSHIP_UNVERIFIED, "Owned persistent search host could not be terminated", { cause: error });
  }
  return { ...inspection, terminated: true };
}
