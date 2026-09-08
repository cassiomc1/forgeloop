import { randomUUID } from "node:crypto";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chmod, unlink } from "node:fs/promises";

import { searchRepository } from "../repository-index/search.js";
import { getPackageRoot } from "../core/templates.js";
import { PERSISTENT_TRANSPORT_DEFAULTS, PERSISTENT_TRANSPORT_PROTOCOL_VERSION } from "./constants.js";
import { encodeFrame, FrameDecoder, parseFrame } from "./framing.js";
import { createErrorResponse, createSuccessResponse, validateRequest, assertSearchParams } from "./protocol.js";
import { PERSISTENT_TRANSPORT_ERROR_CODES, persistentTransportError } from "./errors.js";
import { getPersistentTransportPaths } from "./paths.js";
import { writePersistentTransportState, removePersistentTransportState } from "./state.js";
import { ensurePersistentTransportDirectory } from "./lifecycle.js";

function argumentValue(name, fallback = null) {
  const prefix = `${name}=`;
  const argument = process.argv.find((value) => value.startsWith(prefix));
  return argument ? argument.slice(prefix.length) : fallback;
}

function numberArgument(name, fallback) {
  const value = Number(argumentValue(name, ""));
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function safeError(error) {
  if (error?.code) return error;
  return persistentTransportError(PERSISTENT_TRANSPORT_ERROR_CODES.INVALID_REQUEST, error?.message ?? "Transport request failed");
}

function publicSearchRequest(query, homeDirectory) {
  return {
    ...query,
    homeDirectory,
    packageRoot: getPackageRoot(),
  };
}

class PersistentSearchHost {
  #homeDirectory;
  #paths;
  #idleTimeoutMs;
  #server = null;
  #state = null;
  #connections = new Set();
  #inflight = 0;
  #idleTimer = null;
  #closing = false;
  #repositoryQueues = new Map();

  constructor({ homeDirectory, idleTimeoutMs }) {
    this.#homeDirectory = homeDirectory;
    this.#paths = getPersistentTransportPaths({ homeDirectory });
    this.#idleTimeoutMs = idleTimeoutMs;
  }

  async start() {
    await ensurePersistentTransportDirectory({ homeDirectory: this.#homeDirectory });
    this.#state = {
      pid: process.pid,
      protocolVersion: PERSISTENT_TRANSPORT_PROTOCOL_VERSION,
      forgeLoopVersion: await this.#packageVersion(),
      scopeId: this.#paths.scopeId,
      nonce: randomUUID(),
      endpoint: this.#paths.endpoint,
      entrypoint: path.resolve(fileURLToPath(import.meta.url)),
      startedAt: new Date().toISOString(),
    };
    this.#server = net.createServer((socket) => this.#handleConnection(socket));
    await new Promise((resolve, reject) => {
      const onError = (error) => {
        this.#server.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        this.#server.off("error", onError);
        resolve();
      };
      this.#server.once("error", onError);
      this.#server.once("listening", onListening);
      this.#server.listen(this.#paths.endpoint);
    });
    if (process.platform !== "win32") await chmod(this.#paths.endpoint, 0o600);
    await writePersistentTransportState(this.#paths.statePath, this.#state);
    this.#scheduleIdleShutdown();
    return this.#state;
  }

  async #packageVersion() {
    const { readFile } = await import("node:fs/promises");
    const packageJson = JSON.parse(await readFile(path.join(getPackageRoot(), "package.json"), "utf8"));
    return packageJson.version ?? null;
  }

  #handleConnection(socket) {
    this.#connections.add(socket);
    const decoder = new FrameDecoder({ maxFrameBytes: PERSISTENT_TRANSPORT_DEFAULTS.maxRequestFrameBytes });
    const seenIds = new Set();
    let handshaken = false;
    let queue = Promise.resolve();
    const close = () => {
      this.#connections.delete(socket);
      this.#scheduleIdleShutdown();
    };
    socket.on("close", close);
    socket.on("error", close);
    socket.on("data", (chunk) => {
      try {
        for (const frame of decoder.push(chunk)) {
          let raw;
          try {
            raw = parseFrame(frame);
          } catch (error) {
            this.#write(socket, createErrorResponse(null, safeError(error)));
            socket.destroy();
            return;
          }
          queue = queue
            .then(async () => {
              let request;
              try {
                request = validateRequest(raw);
                if (seenIds.has(request.id)) throw persistentTransportError(PERSISTENT_TRANSPORT_ERROR_CODES.INVALID_REQUEST, "Transport request id was reused on one connection");
                seenIds.add(request.id);
                const result = await this.#dispatch(request, () => { handshaken = true; }, () => handshaken);
                this.#write(socket, createSuccessResponse(request.id, result));
              } catch (error) {
                this.#write(socket, createErrorResponse(typeof raw?.id === "string" ? raw.id : null, safeError(error)));
              }
            })
            .catch(() => {
              socket.destroy();
            });
        }
      } catch (error) {
        this.#write(socket, createErrorResponse(null, safeError(error)));
        socket.destroy();
      }
    });
    socket.on("end", () => {
      try { decoder.end(); } catch { socket.destroy(); }
    });
  }

  #write(socket, value) {
    if (!socket.destroyed) {
      try { socket.write(encodeFrame(value)); } catch { socket.destroy(); }
    }
  }

  async #dispatch(request, markHandshake, isHandshaken) {
    if (request.method === "handshake") {
      if (request.params.scopeId !== this.#paths.scopeId) throw persistentTransportError(PERSISTENT_TRANSPORT_ERROR_CODES.OWNERSHIP_UNVERIFIED, "Transport scope does not match the host");
      markHandshake();
      return {
        protocolVersion: PERSISTENT_TRANSPORT_PROTOCOL_VERSION,
        forgeLoopVersion: this.#state.forgeLoopVersion,
        pid: this.#state.pid,
        nonce: this.#state.nonce,
        scopeId: this.#state.scopeId,
      };
    }
    if (!isHandshaken()) throw persistentTransportError(PERSISTENT_TRANSPORT_ERROR_CODES.INVALID_REQUEST, "Transport handshake is required before this method");
    if (request.method === "transport.status") {
      return { status: "READY", protocolVersion: this.#state.protocolVersion, forgeLoopVersion: this.#state.forgeLoopVersion };
    }
    if (request.method === "transport.shutdown") {
      if (request.params.nonce !== this.#state.nonce) throw persistentTransportError(PERSISTENT_TRANSPORT_ERROR_CODES.OWNERSHIP_UNVERIFIED, "Transport shutdown nonce does not match the host");
      globalThis.setImmediate(() => this.shutdown());
      return { status: "SHUTTING_DOWN" };
    }
    if (request.method === "repository.search") {
      const params = assertSearchParams(request.params);
      const repositoryRoot = params.repository;
      return this.#enqueueRepository(repositoryRoot, () => searchRepository(repositoryRoot, publicSearchRequest(params.query, this.#homeDirectory)));
    }
    throw persistentTransportError(PERSISTENT_TRANSPORT_ERROR_CODES.INVALID_REQUEST, `Unsupported transport method: ${request.method}`);
  }

  #enqueueRepository(repositoryRoot, callback) {
    const previous = this.#repositoryQueues.get(repositoryRoot) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(async () => {
      this.#inflight += 1;
      this.#idleTimer && clearTimeout(this.#idleTimer);
      try {
        return await callback();
      } finally {
        this.#inflight -= 1;
        if (this.#repositoryQueues.get(repositoryRoot) === next) this.#repositoryQueues.delete(repositoryRoot);
        this.#scheduleIdleShutdown();
      }
    });
    this.#repositoryQueues.set(repositoryRoot, next);
    return next;
  }

  #scheduleIdleShutdown() {
    if (this.#closing || this.#idleTimeoutMs <= 0) return;
    if (this.#inflight > 0 || this.#connections.size > 0) return;
    if (this.#idleTimer) clearTimeout(this.#idleTimer);
    this.#idleTimer = setTimeout(() => {
      this.#idleTimer = null;
      if (this.#inflight === 0 && this.#connections.size === 0) this.shutdown().catch(() => {});
      else this.#scheduleIdleShutdown();
    }, this.#idleTimeoutMs);
    this.#idleTimer.unref?.();
  }

  async shutdown() {
    if (this.#closing) return;
    this.#closing = true;
    if (this.#idleTimer) clearTimeout(this.#idleTimer);
    await removePersistentTransportState(this.#paths.statePath, this.#state?.nonce ?? null);
    for (const socket of this.#connections) socket.end();
    await new Promise((resolve) => {
      if (!this.#server) return resolve();
      this.#server.close(() => resolve());
      setTimeout(resolve, 1_000).unref?.();
    });
    if (process.platform !== "win32") {
      try { await unlink(this.#paths.endpoint); } catch (error) { if (error.code !== "ENOENT") throw error; }
    }
  }
}

export async function runPersistentSearchHost({ homeDirectory, idleTimeoutMs = PERSISTENT_TRANSPORT_DEFAULTS.idleTimeoutMs } = {}) {
  const host = new PersistentSearchHost({ homeDirectory, idleTimeoutMs });
  await host.start();
  const stop = () => { host.shutdown().catch(() => {}); };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  return host;
}

if (process.argv.includes("--persistent-transport-server")) {
  runPersistentSearchHost({
    homeDirectory: argumentValue("--home-directory", process.env.FORGELOOP_PERSISTENT_TRANSPORT_HOME),
    idleTimeoutMs: numberArgument("--idle-timeout-ms", PERSISTENT_TRANSPORT_DEFAULTS.idleTimeoutMs),
  }).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
