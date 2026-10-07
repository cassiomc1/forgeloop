import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { physicalTemporaryPath } from "../temporary-paths.js";

import {
  EMULATED_SERVICES_ERROR_CODES,
  EMULATED_SERVICES_ID,
  EMULATED_SERVICES_PROCESS_LIMITS,
  EMULATED_SERVICES_SUPPORTED_VERSION,
} from "./constants.js";
import {
  emulatedServicesProcessError,
  runBoundedEmulatedServicesCommand,
  spawnManagedEmulatedServicesProcess,
} from "./process.js";

const FACTORY_KEYS = new Set([
  "executablePath",
  "expectedVersion",
  "tempRoot",
  "targetRoot",
  "spawnImpl",
  "fsImpl",
  "mkdtempImpl",
  "rmImpl",
  "fetchImpl",
  "sleepImpl",
  "nowImpl",
]);

function providerError(code, message, cause) {
  return emulatedServicesProcessError(code, message, cause);
}

function assertPortableString(value, label) {
  if (typeof value !== "string" || value.length === 0 || /\p{Cc}/u.test(value)) {
    throw providerError(EMULATED_SERVICES_ERROR_CODES.CONFIG_INVALID, `${label} must be a non-empty portable string`);
  }
  return value;
}

function assertAbsolutePath(value, label) {
  assertPortableString(value, label);
  if (!path.isAbsolute(value)) {
    throw providerError(EMULATED_SERVICES_ERROR_CODES.CONFIG_INVALID, `${label} must be absolute`);
  }
  return value;
}

function assertRegularFile(filePath, label, fsImpl) {
  assertAbsolutePath(filePath, label);
  let stat;
  try {
    stat = fsImpl.lstatSync(filePath);
  } catch (error) {
    throw providerError(EMULATED_SERVICES_ERROR_CODES.CONFIG_INVALID, `${label} is unavailable`, error);
  }
  if (!stat.isFile() || stat.isSymbolicLink?.()) {
    throw providerError(EMULATED_SERVICES_ERROR_CODES.CONFIG_INVALID, `${label} must be a regular non-symlink file`);
  }
  return filePath;
}

function isWithin(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function assertTempRootSafe(tempRoot, targetRoot) {
  if (targetRoot && (isWithin(targetRoot, tempRoot) || isWithin(tempRoot, targetRoot))) {
    throw providerError(EMULATED_SERVICES_ERROR_CODES.CONFIG_INVALID, "Emulated Services temporary state must be outside the target root");
  }
}

function filteredEnvironment() {
  const allowed = new Set(["PATH", "HOME", "TMPDIR", "TEMP", "TMP", "SystemRoot", "ComSpec", "LANG", "LC_ALL", "NODE_PATH"]);
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => allowed.has(key)));
}

function parseVersion(stdout) {
  if (typeof stdout !== "string") {
    throw providerError(EMULATED_SERVICES_ERROR_CODES.OUTPUT_INVALID, "Emulated Services version output was not text");
  }
  const match = /^\s*(?:emulate(?:\s+|@))?v?(\d+\.\d+\.\d+)\s*$/iu.exec(stdout);
  if (!match) {
    throw providerError(EMULATED_SERVICES_ERROR_CODES.OUTPUT_INVALID, "Emulated Services version output was malformed");
  }
  return match[1];
}

function normalizeServices(services) {
  if (!Array.isArray(services) || services.length === 0 || services.length > EMULATED_SERVICES_PROCESS_LIMITS.maxServices) {
    throw providerError(EMULATED_SERVICES_ERROR_CODES.CONFIG_INVALID, "services must be a non-empty bounded array");
  }
  const normalized = services.map((service) => {
    assertPortableString(service, "service");
    if (!/^[a-z][a-z0-9-]*$/u.test(service)) {
      throw providerError(EMULATED_SERVICES_ERROR_CODES.CONFIG_INVALID, "service identifiers must be portable lowercase names");
    }
    return service;
  });
  if (new Set(normalized).size !== normalized.length) {
    throw providerError(EMULATED_SERVICES_ERROR_CODES.CONFIG_INVALID, "services must not contain duplicates");
  }
  return normalized;
}

function normalizeRequest(request, { fsImpl, targetRoot }) {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw providerError(EMULATED_SERVICES_ERROR_CODES.CONFIG_INVALID, "Emulated Services request must be an object");
  }
  const services = normalizeServices(request.services);
  const basePort = request.basePort ?? 4000;
  if (!Number.isSafeInteger(basePort) || basePort < 1 || basePort + services.length - 1 > 65535) {
    throw providerError(EMULATED_SERVICES_ERROR_CODES.CONFIG_INVALID, "basePort must provide a valid loopback port range");
  }
  const timeoutMs = request.timeoutMs ?? 30_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > EMULATED_SERVICES_PROCESS_LIMITS.maxTimeoutMs) {
    throw providerError(EMULATED_SERVICES_ERROR_CODES.CONFIG_INVALID, "timeoutMs is outside the supported bounded range");
  }
  let seedPath = null;
  if (request.seedPath !== undefined && request.seedPath !== null) {
    seedPath = assertRegularFile(request.seedPath, "seedPath", fsImpl);
    if (targetRoot && isWithin(targetRoot, seedPath)) {
      throw providerError(EMULATED_SERVICES_ERROR_CODES.CONFIG_INVALID, "seedPath must not be inside the target root");
    }
  }
  return { services, basePort, timeoutMs, seedPath, signal: request.signal };
}

function validateSignal(signal) {
  if (signal !== undefined && (!signal || typeof signal.aborted !== "boolean" || typeof signal.addEventListener !== "function")) {
    throw providerError(EMULATED_SERVICES_ERROR_CODES.CONFIG_INVALID, "signal must be an AbortSignal");
  }
}

function assertNotCancelled(signal) {
  if (signal?.aborted) {
    throw providerError(EMULATED_SERVICES_ERROR_CODES.CANCELLED, "Emulated Services operation was cancelled");
  }
}

function normalizeEndpoint(port) {
  const endpoint = `http://127.0.0.1:${port}`;
  const url = new URL(endpoint);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1") {
    throw providerError(EMULATED_SERVICES_ERROR_CODES.ENDPOINT_INVALID, "Emulated Services endpoint was not loopback HTTP");
  }
  return endpoint;
}

async function waitForReady(endpoint, { fetchImpl, signal, deadline, sleepImpl, nowImpl }) {
  while (nowImpl() < deadline) {
    assertNotCancelled(signal);
    try {
      const response = await fetchImpl(endpoint, { method: "GET", redirect: "manual", signal });
      const status = Number(response?.status);
      if (Number.isInteger(status) && status >= 200 && status < 500) return;
    } catch (error) {
      if (signal?.aborted) throw providerError(EMULATED_SERVICES_ERROR_CODES.CANCELLED, "Emulated Services operation was cancelled", error);
    }
    const remaining = deadline - nowImpl();
    if (remaining <= 0) break;
    await sleepImpl(Math.min(EMULATED_SERVICES_PROCESS_LIMITS.readinessPollMs, remaining), signal);
  }
  throw providerError(EMULATED_SERVICES_ERROR_CODES.TIMEOUT, "Emulated Services did not become ready before the timeout");
}

function validateFactoryOptions(options) {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw providerError(EMULATED_SERVICES_ERROR_CODES.CONFIG_INVALID, "Emulated Services provider options must be an object");
  }
  for (const key of Object.keys(options)) {
    if (!FACTORY_KEYS.has(key)) throw providerError(EMULATED_SERVICES_ERROR_CODES.CONFIG_INVALID, `Unsupported Emulated Services option: ${key}`);
  }
}

export function createEmulatedServicesProvider(options = {}) {
  validateFactoryOptions(options);
  const fsImpl = options.fsImpl ?? fs;
  const executablePath = assertRegularFile(options.executablePath, "executablePath", fsImpl);
  const expectedVersion = options.expectedVersion ?? EMULATED_SERVICES_SUPPORTED_VERSION;
  if (expectedVersion !== EMULATED_SERVICES_SUPPORTED_VERSION) {
    throw providerError(EMULATED_SERVICES_ERROR_CODES.CONFIG_INVALID, `Only Emulated Services ${EMULATED_SERVICES_SUPPORTED_VERSION} is supported`);
  }
  const tempRoot = assertAbsolutePath(options.tempRoot ?? os.tmpdir(), "tempRoot");
  const targetRoot = options.targetRoot === undefined ? null : assertAbsolutePath(options.targetRoot, "targetRoot");
  assertTempRootSafe(tempRoot, targetRoot);
  const mkdtempImpl = options.mkdtempImpl ?? fs.promises.mkdtemp;
  const rmImpl = options.rmImpl ?? fs.promises.rm;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const sleepImpl = options.sleepImpl ?? ((delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)));
  const nowImpl = options.nowImpl ?? (() => Date.now());
  if (typeof fetchImpl !== "function" || typeof mkdtempImpl !== "function" || typeof rmImpl !== "function") {
    throw providerError(EMULATED_SERVICES_ERROR_CODES.CONFIG_INVALID, "Emulated Services host capabilities are incomplete");
  }

  return Object.freeze({
    id: EMULATED_SERVICES_ID,
    version: expectedVersion,
    async start(request = {}) {
      const normalized = normalizeRequest(request, { fsImpl, targetRoot });
      validateSignal(normalized.signal);
      assertNotCancelled(normalized.signal);
      let stateRoot = null;
      let managed = null;
      let result = null;
      let operationError = null;
      try {
        const physicalRoot = await physicalTemporaryPath(tempRoot);
        const physicalTarget = targetRoot ? await physicalTemporaryPath(targetRoot) : null;
        assertTempRootSafe(physicalRoot, physicalTarget);
        const candidate = await mkdtempImpl(path.join(physicalRoot, "forgeloop-emulated-"));
        assertAbsolutePath(candidate, "Emulated Services temporary state");
        assertTempRootSafe(candidate, targetRoot);
        const physicalState = await physicalTemporaryPath(candidate);
        assertTempRootSafe(physicalState, physicalTarget);
        // Rejected paths do not grant recursive cleanup authority.
        stateRoot = physicalState;
        const versionResult = await runBoundedEmulatedServicesCommand(executablePath, ["--version"], {
          cwd: stateRoot,
          env: filteredEnvironment(),
          spawnImpl: options.spawnImpl,
          timeoutMs: Math.min(normalized.timeoutMs, 10_000),
        });
        const actualVersion = parseVersion(versionResult.stdout);
        if (actualVersion !== expectedVersion) {
          throw providerError(EMULATED_SERVICES_ERROR_CODES.VERSION_UNSUPPORTED, `Unsupported Emulated Services version: ${actualVersion}`);
        }

        const args = ["--service", normalized.services.join(","), "--port", String(normalized.basePort)];
        if (normalized.seedPath) args.push("--seed", normalized.seedPath);
        managed = spawnManagedEmulatedServicesProcess(executablePath, args, {
          cwd: stateRoot,
          env: filteredEnvironment(),
          spawnImpl: options.spawnImpl,
        });
        const deadline = nowImpl() + normalized.timeoutMs;
        const endpoints = normalized.services.map((service, index) => ({
          id: service,
          endpoint: normalizeEndpoint(normalized.basePort + index),
        }));
        for (const service of endpoints) {
          await waitForReady(service.endpoint, {
            fetchImpl,
            signal: normalized.signal,
            deadline,
            sleepImpl,
            nowImpl,
          });
        }
        result = {
          provider: { id: EMULATED_SERVICES_ID, version: expectedVersion },
          services: endpoints,
          status: "READY",
          diagnostics: ["Host-provided emulated services were observed on loopback"],
          authority: "OBSERVATION",
          evidenceAuthority: "NONE",
          lifecycleAuthority: false,
          completionAuthority: false,
          persisted: false,
          cleanup: { status: "PENDING" },
        };
      } catch (error) {
        operationError = error;
      } finally {
        if (managed) {
          managed.stop();
          await managed.waitForClose();
        }
        if (stateRoot) {
          try {
            await rmImpl(stateRoot, { recursive: true, force: true });
            if (result) result.cleanup = { status: "COMPLETED" };
          } catch (error) {
            const cleanupError = providerError(EMULATED_SERVICES_ERROR_CODES.CLEANUP_FAILED, "Emulated Services temporary state cleanup failed", error);
            if (!operationError) operationError = cleanupError;
            if (result) result.cleanup = { status: "FAILED" };
          }
        }
      }
      if (operationError) throw operationError;
      return Object.freeze(result);
    },
  });
}

export { normalizeEndpoint, parseVersion };
