import net from "node:net";

import { processCommandLine, processIsAlive } from "../repository-index/status.js";
import { PERSISTENT_TRANSPORT_DEFAULTS } from "./constants.js";
import { PERSISTENT_TRANSPORT_ERROR_CODES, persistentTransportError } from "./errors.js";
import { encodeFrame, FrameDecoder, parseFrame } from "./framing.js";
import { createRequest, validateResponse } from "./protocol.js";

const ENDPOINT_PROBE_TIMEOUT_MS = 1_000;

function comparable(value) {
  if (process.platform !== "win32") return value;
  return value.toLowerCase().replaceAll("\\", "/");
}

function endpointRequest(state, method = null, params = {}, timeoutMs = ENDPOINT_PROBE_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    if (typeof state.endpoint !== "string" || state.endpoint.length === 0) {
      reject(persistentTransportError(PERSISTENT_TRANSPORT_ERROR_CODES.OWNERSHIP_UNVERIFIED, "Persistent search host endpoint is invalid"));
      return;
    }
    const socket = net.createConnection(state.endpoint);
    const decoder = new FrameDecoder({ maxFrameBytes: PERSISTENT_TRANSPORT_DEFAULTS.maxResponseFrameBytes });
    const handshakeRequest = createRequest("handshake", { scopeId: state.scopeId });
    let activeRequest = handshakeRequest;
    let handshakeResult = null;
    let settled = false;
    const timer = setTimeout(() => finish(reject, persistentTransportError(PERSISTENT_TRANSPORT_ERROR_CODES.TIMEOUT, "Timed out verifying the persistent search host endpoint")), timeoutMs);
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.off("data", onData);
      socket.off("error", onError);
      socket.off("end", onEnd);
      socket.destroy();
      fn(value);
    };
    const send = (request) => {
      activeRequest = request;
      try {
        socket.write(encodeFrame(request, { maxFrameBytes: PERSISTENT_TRANSPORT_DEFAULTS.maxRequestFrameBytes }));
      } catch (error) {
        finish(reject, error);
      }
    };
    const onData = (chunk) => {
      try {
        for (const frame of decoder.push(chunk)) {
          const response = validateResponse(parseFrame(frame), activeRequest.id);
          if (!response.ok) {
            finish(reject, persistentTransportError(response.error.code, response.error.message));
            return;
          }
          if (activeRequest === handshakeRequest) {
            handshakeResult = response.result;
            if (!handshakeResult || handshakeResult.pid !== state.pid
              || handshakeResult.nonce !== state.nonce
              || handshakeResult.scopeId !== state.scopeId
              || handshakeResult.protocolVersion !== state.protocolVersion
              || handshakeResult.forgeLoopVersion !== state.forgeLoopVersion) {
              finish(reject, persistentTransportError(PERSISTENT_TRANSPORT_ERROR_CODES.OWNERSHIP_UNVERIFIED, "Persistent search host endpoint identity does not match its state"));
              return;
            }
            if (method === null) {
              finish(resolve, response);
              return;
            }
            send(createRequest(method, params));
            continue;
          }
          finish(resolve, response);
          return;
        }
      } catch (error) {
        finish(reject, error);
      }
    };
    const onError = (cause) => finish(reject, persistentTransportError(PERSISTENT_TRANSPORT_ERROR_CODES.UNAVAILABLE, `Persistent search host endpoint failed: ${cause.code ?? cause.message}`));
    const onEnd = () => finish(reject, persistentTransportError(PERSISTENT_TRANSPORT_ERROR_CODES.UNAVAILABLE, "Persistent search host endpoint closed the connection"));
    socket.on("data", onData);
    socket.once("error", onError);
    socket.once("end", onEnd);
    socket.once("connect", () => {
      socket.setNoDelay?.(true);
      send(handshakeRequest);
    });
  });
}

async function endpointMatchesState(state, expectedEndpoint) {
  if (typeof expectedEndpoint === "string" && comparable(state.endpoint) !== comparable(expectedEndpoint)) return false;
  try {
    await endpointRequest(state);
    return true;
  } catch {
    return false;
  }
}

function validPersistentTransportState(state) {
  if (!state || state.schemaVersion !== 1) return false;
  if (!Number.isInteger(state.pid) || state.pid <= 0) return false;
  if (typeof state.nonce !== "string" || typeof state.scopeId !== "string") return false;
  if (typeof state.entrypoint !== "string") return false;
  return typeof state.endpoint === "string" && state.endpoint.length > 0;
}

function ownershipResult(state, owned, ownershipMode = null) {
  return {
    owned,
    running: owned,
    pid: state.pid,
    ownershipMode,
    reason: owned ? null : "PROCESS_IDENTITY_UNVERIFIED",
    commandLine: null,
  };
}

async function inspectEndpointIdentity(state, expectedEndpoint) {
  const owned = await endpointMatchesState(state, expectedEndpoint);
  return ownershipResult(state, owned, owned ? "ENDPOINT_HANDSHAKE" : null);
}

function inspectCommandLineIdentity(state, commandLine) {
  const command = comparable(commandLine);
  const entrypoint = comparable(state.entrypoint);
  const scopeMarker = comparable(state.scopeId);
  const owned = command.includes(entrypoint) && command.includes("--persistent-transport-server") && command.includes(scopeMarker);
  return ownershipResult(state, owned, owned ? "PROCESS_COMMAND_LINE" : null);
}

export async function inspectPersistentTransportOwnership(state, {
  processApi = process,
  processInspector = {},
  expectedEndpoint = null,
} = {}) {
  if (!validPersistentTransportState(state)) {
    return { owned: false, running: false, reason: "STATE_INVALID" };
  }
  if (typeof expectedEndpoint === "string" && comparable(state.endpoint) !== comparable(expectedEndpoint)) {
    return { owned: false, running: false, reason: "STATE_ENDPOINT_MISMATCH" };
  }
  const alive = (processInspector.isAlive ?? ((pid) => processIsAlive(pid, processApi)))(state.pid);
  if (!alive) return { owned: true, running: false, reason: "PROCESS_EXITED", pid: state.pid };
  if (process.platform === "win32" && processInspector.commandLine === undefined) {
    return inspectEndpointIdentity(state, expectedEndpoint);
  }
  const commandLine = processInspector.commandLine === undefined
    ? await processCommandLine(state.pid, { platform: process.platform })
    : await processInspector.commandLine(state.pid);
  if (typeof commandLine !== "string" || commandLine.length === 0) {
    return inspectEndpointIdentity(state, expectedEndpoint);
  }
  return inspectCommandLineIdentity(state, commandLine);
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
  if (inspection.ownershipMode === "ENDPOINT_HANDSHAKE") {
    try {
      const response = await endpointRequest(state, "transport.shutdown", { nonce: state.nonce });
      if (!response.result || response.result.status !== "SHUTTING_DOWN") throw new Error("Persistent search host did not accept shutdown");
    } catch (cause) {
      throw persistentTransportError(PERSISTENT_TRANSPORT_ERROR_CODES.OWNERSHIP_UNVERIFIED, "Owned persistent search host could not be shut down through its verified endpoint", { cause });
    }
    return { ...inspection, terminated: true, termination: "ENDPOINT_SHUTDOWN" };
  }
  try {
    processApi.kill(state.pid, signal);
  } catch (error) {
    if (error.code !== "ESRCH") throw persistentTransportError(PERSISTENT_TRANSPORT_ERROR_CODES.OWNERSHIP_UNVERIFIED, "Owned persistent search host could not be terminated", { cause: error });
  }
  return { ...inspection, terminated: true };
}
