import net from "node:net";
import path from "node:path";
import { readFile, realpath } from "node:fs/promises";

import { getPackageRoot } from "../core/templates.js";
import { acquirePersistentTransportStartupLock, cleanPersistentTransportState, getPersistentTransportStatus as getLifecycleStatus, inspectPersistentTransport, startPersistentSearchHost } from "./lifecycle.js";
import { PERSISTENT_TRANSPORT_DEFAULTS, PERSISTENT_TRANSPORT_PROTOCOL_VERSION } from "./constants.js";
import { encodeFrame, FrameDecoder, parseFrame } from "./framing.js";
import { assertSearchParams, createRequest, projectSearchQuery, validateResponse } from "./protocol.js";
import { PERSISTENT_TRANSPORT_ERROR_CODES, isPersistentTransportError, persistentTransportError } from "./errors.js";
import { getPersistentTransportPaths } from "./paths.js";
import { readPersistentTransportState } from "./state.js";

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let forgeLoopVersionPromise;

async function currentForgeLoopVersion() {
  forgeLoopVersionPromise ??= readFile(path.join(getPackageRoot(), "package.json"), "utf8")
    .then((raw) => JSON.parse(raw).version ?? null);
  return forgeLoopVersionPromise;
}

function isConnectionFailure(error) {
  return isPersistentTransportError(error)
    && [PERSISTENT_TRANSPORT_ERROR_CODES.UNAVAILABLE, PERSISTENT_TRANSPORT_ERROR_CODES.TIMEOUT, PERSISTENT_TRANSPORT_ERROR_CODES.PROTOCOL_MISMATCH, PERSISTENT_TRANSPORT_ERROR_CODES.INVALID_RESPONSE].includes(error.code);
}

function remoteError(response) {
  const error = persistentTransportError(response.error.code, response.error.message, {
    expectedVersion: response.error.expectedVersion,
    actualVersion: response.error.actualVersion,
  });
  error.remote = true;
  return error;
}

function connect(endpoint, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const socket = net.createConnection(endpoint);
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(persistentTransportError(PERSISTENT_TRANSPORT_ERROR_CODES.TIMEOUT, "Timed out connecting to the persistent search host"));
    }, timeoutMs);
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };
    socket.once("connect", () => {
      socket.setNoDelay?.(true);
      finish(resolve, socket);
    });
    socket.once("error", (cause) => finish(reject, persistentTransportError(PERSISTENT_TRANSPORT_ERROR_CODES.UNAVAILABLE, `Persistent search host is unavailable: ${cause.code ?? cause.message}`)));
  });
}

function exchange(socket, request, timeoutMs, {
  requestMaxFrameBytes = PERSISTENT_TRANSPORT_DEFAULTS.maxRequestFrameBytes,
  responseMaxFrameBytes = PERSISTENT_TRANSPORT_DEFAULTS.maxResponseFrameBytes,
} = {}) {
  return new Promise((resolve, reject) => {
    const decoder = new FrameDecoder({ maxFrameBytes: responseMaxFrameBytes });
    let settled = false;
    const timer = setTimeout(() => finish(reject, persistentTransportError(PERSISTENT_TRANSPORT_ERROR_CODES.TIMEOUT, "Timed out waiting for the persistent search host")), timeoutMs);
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.off("data", onData);
      socket.off("error", onError);
      socket.off("end", onEnd);
      fn(value);
    };
    const onData = (chunk) => {
      try {
        for (const frame of decoder.push(chunk)) {
          const response = validateResponse(parseFrame(frame), request.id);
          finish(resolve, response);
          return;
        }
      } catch (error) {
        finish(reject, error.code ? error : persistentTransportError(PERSISTENT_TRANSPORT_ERROR_CODES.INVALID_RESPONSE, error.message));
      }
    };
    const onError = (cause) => finish(reject, persistentTransportError(PERSISTENT_TRANSPORT_ERROR_CODES.UNAVAILABLE, `Persistent search host connection failed: ${cause.code ?? cause.message}`));
    const onEnd = () => {
      try { decoder.end(); } catch (error) { finish(reject, error); return; }
      finish(reject, persistentTransportError(PERSISTENT_TRANSPORT_ERROR_CODES.UNAVAILABLE, "Persistent search host closed the connection"));
    };
    socket.on("data", onData);
    socket.once("error", onError);
    socket.once("end", onEnd);
    try {
      socket.write(encodeFrame(request, { maxFrameBytes: requestMaxFrameBytes }));
    } catch (error) {
      finish(reject, error);
    }
  });
}

async function openHost({
  paths,
  timeoutMs,
  state,
  requestMaxFrameBytes = PERSISTENT_TRANSPORT_DEFAULTS.maxRequestFrameBytes,
  responseMaxFrameBytes = PERSISTENT_TRANSPORT_DEFAULTS.maxResponseFrameBytes,
}) {
  const socket = await connect(paths.endpoint, timeoutMs);
  try {
    const handshakeRequest = createRequest("handshake", { scopeId: paths.scopeId });
    const handshake = await exchange(socket, handshakeRequest, timeoutMs, { requestMaxFrameBytes, responseMaxFrameBytes });
    if (!handshake.ok) throw remoteError(handshake);
    const expectedForgeLoopVersion = await currentForgeLoopVersion();
    if (!handshake.result
      || handshake.result.protocolVersion !== PERSISTENT_TRANSPORT_PROTOCOL_VERSION
      || handshake.result.scopeId !== paths.scopeId
      || handshake.result.forgeLoopVersion !== expectedForgeLoopVersion
      || (state?.forgeLoopVersion && handshake.result.forgeLoopVersion !== state.forgeLoopVersion)) {
      throw persistentTransportError(PERSISTENT_TRANSPORT_ERROR_CODES.PROTOCOL_MISMATCH, "Persistent search host handshake is incompatible", { expectedVersion: PERSISTENT_TRANSPORT_PROTOCOL_VERSION, actualVersion: handshake.result?.protocolVersion });
    }
    if (state?.nonce && handshake.result.nonce !== state.nonce) {
      throw persistentTransportError(PERSISTENT_TRANSPORT_ERROR_CODES.OWNERSHIP_UNVERIFIED, "Persistent search host handshake ownership does not match its state");
    }
    return { socket, handshake: handshake.result };
  } catch (error) {
    socket.destroy();
    throw error;
  }
}

async function pingHost({ homeDirectory, timeoutMs, maxFrameBytes }) {
  const paths = getPersistentTransportPaths({ homeDirectory });
  const { state } = await readPersistentTransportState(paths.statePath);
  if (!state) throw persistentTransportError(PERSISTENT_TRANSPORT_ERROR_CODES.UNAVAILABLE, "Persistent search host has not published its state");
  const connection = await openHost({ paths, timeoutMs, state, responseMaxFrameBytes: maxFrameBytes });
  try {
    return connection.handshake;
  } finally {
    connection.socket.end();
  }
}

export async function pingPersistentSearchHost({ homeDirectory = undefined, timeoutMs = 2_000 } = {}) {
  const resolvedHome = homeDirectory ?? process.env.FORGELOOP_PERSISTENT_TRANSPORT_HOME ?? undefined;
  return pingHost({
    homeDirectory: resolvedHome,
    timeoutMs,
    maxFrameBytes: PERSISTENT_TRANSPORT_DEFAULTS.maxResponseFrameBytes,
  });
}

function searchQuery(request) {
  return projectSearchQuery(request);
}

async function requestSearch({ repositoryRoot, request, options, timeoutMs, maxFrameBytes }) {
  const homeDirectory = options.homeDirectory;
  const paths = getPersistentTransportPaths({ homeDirectory });
  const { state } = await readPersistentTransportState(paths.statePath);
  const params = assertSearchParams({ repository: repositoryRoot, query: searchQuery(request) });
  const connection = await openHost({ paths, timeoutMs, state, responseMaxFrameBytes: maxFrameBytes });
  try {
    const response = await exchange(connection.socket, createRequest("repository.search", params), timeoutMs, {
      responseMaxFrameBytes: maxFrameBytes,
    });
    if (!response.ok) throw remoteError(response);
    return response.result;
  } finally {
    connection.socket.end();
  }
}

async function ensureHost({ homeDirectory, idleTimeoutMs, startupTimeoutMs, env, recover = false }) {
  const deadline = Date.now() + startupTimeoutMs;
  let lock = null;
  while (!lock) {
    lock = await acquirePersistentTransportStartupLock({ homeDirectory, tryOnly: true });
    if (lock) break;
    if (Date.now() >= deadline) {
      throw persistentTransportError(PERSISTENT_TRANSPORT_ERROR_CODES.START_FAILED, "Persistent search host startup coordination exceeded its bounded timeout");
    }
    await delay(Math.min(25, Math.max(1, deadline - Date.now())));
  }
  try {
    let inspection = await inspectPersistentTransport({ homeDirectory });
    if (inspection.status === "OWNERSHIP_UNVERIFIED") {
      throw persistentTransportError(PERSISTENT_TRANSPORT_ERROR_CODES.OWNERSHIP_UNVERIFIED, "A process owns the persistent search endpoint but is not a verified ForgeLoop host");
    }
    if (inspection.status === "STALE") {
      await cleanPersistentTransportState(inspection);
      inspection = await inspectPersistentTransport({ homeDirectory });
    }
    if (inspection.status === "INCOMPATIBLE" || (recover && inspection.status === "READY")) {
      await cleanPersistentTransportState(inspection);
      inspection = await inspectPersistentTransport({ homeDirectory });
    }
    if (inspection.status === "READY") {
      try {
        await pingHost({ homeDirectory, timeoutMs: Math.min(startupTimeoutMs, 2_000), maxFrameBytes: PERSISTENT_TRANSPORT_DEFAULTS.maxResponseFrameBytes });
        return inspection;
      } catch (error) {
        if (!recover && !isConnectionFailure(error)) throw error;
        await cleanPersistentTransportState(inspection);
      }
    }
    await startPersistentSearchHost({ homeDirectory, idleTimeoutMs, env });
    const deadline = Date.now() + startupTimeoutMs;
    while (Date.now() < deadline) {
      try {
        await pingHost({ homeDirectory, timeoutMs: Math.min(1_000, Math.max(100, deadline - Date.now())), maxFrameBytes: PERSISTENT_TRANSPORT_DEFAULTS.maxResponseFrameBytes });
        return await inspectPersistentTransport({ homeDirectory });
      } catch (error) {
        if (!isConnectionFailure(error) && error.code !== PERSISTENT_TRANSPORT_ERROR_CODES.UNAVAILABLE) throw error;
        await delay(25);
      }
    }
    throw persistentTransportError(PERSISTENT_TRANSPORT_ERROR_CODES.START_FAILED, "Persistent search host did not become ready within the startup timeout");
  } finally {
    await lock.release();
  }
}

const startupCoordinators = new Map();

function coordinateEnsureHost(options) {
  const key = getPersistentTransportPaths({ homeDirectory: options.homeDirectory }).root;
  const active = startupCoordinators.get(key);
  if (active) return active;
  const pending = ensureHost(options);
  startupCoordinators.set(key, pending);
  const clear = () => {
    if (startupCoordinators.get(key) === pending) startupCoordinators.delete(key);
  };
  pending.then(clear, clear);
  return pending;
}

export async function searchViaPersistentTransport(repositoryRoot, request = {}, options = {}) {
  const canonicalRoot = await realpath(repositoryRoot);
  const homeDirectory = options.homeDirectory ?? process.env.FORGELOOP_PERSISTENT_TRANSPORT_HOME ?? undefined;
  const transportOptions = {
    homeDirectory,
    idleTimeoutMs: options.idleTimeoutMs ?? PERSISTENT_TRANSPORT_DEFAULTS.idleTimeoutMs,
    startupTimeoutMs: options.startupTimeoutMs ?? PERSISTENT_TRANSPORT_DEFAULTS.startupTimeoutMs,
    requestTimeoutMs: options.requestTimeoutMs ?? PERSISTENT_TRANSPORT_DEFAULTS.requestTimeoutMs,
    maxFrameBytes: options.maxResponseFrameBytes ?? PERSISTENT_TRANSPORT_DEFAULTS.maxResponseFrameBytes,
    env: options.env ?? {},
  };
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await requestSearch({ repositoryRoot: canonicalRoot, request, options: transportOptions, timeoutMs: transportOptions.requestTimeoutMs, maxFrameBytes: transportOptions.maxFrameBytes });
    } catch (error) {
      lastError = error;
      if (error.remote || !isConnectionFailure(error)) throw error;
      await coordinateEnsureHost({ ...transportOptions, recover: attempt === 1 });
    }
  }
  throw lastError ?? persistentTransportError(PERSISTENT_TRANSPORT_ERROR_CODES.UNAVAILABLE, "Persistent search host is unavailable");
}

export async function shutdownPersistentSearchHost({ homeDirectory = undefined, timeoutMs = 2_000 } = {}) {
  const resolvedHome = homeDirectory ?? process.env.FORGELOOP_PERSISTENT_TRANSPORT_HOME ?? undefined;
  const inspection = await inspectPersistentTransport({ homeDirectory: resolvedHome });
  if (inspection.status === "NOT_RUNNING") return { status: "NOT_RUNNING" };
  if (!inspection.owned) throw persistentTransportError(PERSISTENT_TRANSPORT_ERROR_CODES.OWNERSHIP_UNVERIFIED, "Persistent search host ownership could not be verified");
  const paths = getPersistentTransportPaths({ homeDirectory: resolvedHome });
  const connection = await openHost({ paths, timeoutMs, state: inspection.state });
  try {
    const response = await exchange(connection.socket, createRequest("transport.shutdown", { nonce: inspection.state.nonce }), timeoutMs);
    if (!response.ok) throw remoteError(response);
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const status = await getLifecycleStatus({ homeDirectory: resolvedHome });
      if (status.status === "NOT_RUNNING" || status.status === "STALE") break;
      await delay(25);
    }
    return response.result;
  } finally {
    connection.socket.end();
  }
}

export async function getPersistentTransportStatus(options = {}) {
  return getLifecycleStatus(options);
}
