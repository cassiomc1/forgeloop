import { performance } from "node:perf_hooks";
import { types } from "node:util";
import { capabilityFor } from "./capabilities.js";
import { isPlainObject, normalizeProviderInput, normalizeProviderResult } from "./json-snapshot.js";
import {
  E_PROVIDER_EXECUTION_FAILED,
  E_PROVIDER_INVALID,
  E_PROVIDER_TIMEOUT,
  E_PROVIDER_UNAVAILABLE,
  providerError,
} from "./errors.js";

const PROVIDER_ID_REGEX = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const REGISTRY_MAX_PROVIDERS = 256;

function assertEntry(entry, key) {
  if (!isPlainObject(entry)) {
    throw providerError(E_PROVIDER_INVALID, "Provider must be a plain object");
  }
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(entry))) {
    if (!("value" in descriptor)) throw providerError(E_PROVIDER_INVALID, "Provider accessors are not supported");
  }
  if (typeof entry.id !== "string" || !PROVIDER_ID_REGEX.test(entry.id) || entry.id !== key) {
    throw providerError(E_PROVIDER_INVALID, "Provider identity does not match the registry key");
  }
  if (entry.version !== undefined && (typeof entry.version !== "string" || entry.version.trim() === "" || entry.version.length > 64)) {
    throw providerError(E_PROVIDER_INVALID, "Provider version must be a non-empty string of at most 64 characters");
  }
  if (!capabilityFor(entry.kind)) {
    throw providerError(E_PROVIDER_INVALID, "Provider declares an unsupported kind");
  }
  if (entry.capability !== undefined && entry.capability !== capabilityFor(entry.kind)) {
    throw providerError(E_PROVIDER_INVALID, "Provider capability metadata contradicts its kind");
  }
  if (typeof entry.operation !== "function") {
    throw providerError(E_PROVIDER_INVALID, "Provider must implement operation(input, context)");
  }
}

function boundedInteger(value, fallback, maximum) {
  const resolved = value === undefined ? fallback : value;
  if (!Number.isInteger(resolved) || resolved <= 0 || resolved > maximum) {
    throw providerError(E_PROVIDER_INVALID, "Provider limits must be positive bounded integers");
  }
  return resolved;
}

function normalizeOptions(options) {
  if (!isPlainObject(options)) throw providerError(E_PROVIDER_INVALID, "Provider options must be a plain object");
  const descriptors = Object.getOwnPropertyDescriptors(options);
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!["timeoutMs", "maxInputBytes", "maxResultBytes"].includes(key) || !("value" in descriptor)) {
      throw providerError(E_PROVIDER_INVALID, "Unsupported provider option");
    }
  }
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string") throw providerError(E_PROVIDER_INVALID, "Unsupported provider option");
  }
  return {
    timeoutMs: boundedInteger(descriptors.timeoutMs?.value, 10_000, 300_000),
    maxInputBytes: boundedInteger(descriptors.maxInputBytes?.value, 262_144, 4_194_304),
    maxResultBytes: boundedInteger(descriptors.maxResultBytes?.value, 262_144, 4_194_304),
  };
}

function callProvider(operation, normalize) {
  let returned;
  try {
    returned = operation();
  } catch {
    throw providerError(E_PROVIDER_EXECUTION_FAILED, "Provider execution failed");
  }
  if (types.isPromise(returned) && !types.isProxy(returned)) {
    return Promise.prototype.then.call(returned, normalize, () => {
      throw providerError(E_PROVIDER_EXECUTION_FAILED, "Provider execution failed");
    });
  }
  return normalize(returned);
}

async function withProviderDeadline(providerId, timeoutMs, operation) {
  const controller = new AbortController();
  const context = Object.freeze({ signal: controller.signal, timeoutMs, providerId });
  const expires = performance.now() + timeoutMs;
  const timeoutError = providerError(E_PROVIDER_TIMEOUT, "Provider invocation exceeded its deadline");
  const checkpoint = () => {
    if (controller.signal.aborted || performance.now() >= expires) {
      controller.abort();
      throw timeoutError;
    }
  };
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(timeoutError);
      controller.abort();
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      timeout,
      Promise.resolve().then(() => operation(context, checkpoint)),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function createProviderRegistry({ providers = {} } = {}) {
  if (!isPlainObject(providers)) throw providerError(E_PROVIDER_INVALID, "Provider registry requires an object map");
  const map = new Map();
  for (const key of Reflect.ownKeys(providers)) {
    if (typeof key !== "string" || !PROVIDER_ID_REGEX.test(key)) {
      throw providerError(E_PROVIDER_INVALID, "Invalid provider registry key");
    }
    if (map.size >= REGISTRY_MAX_PROVIDERS) throw providerError(E_PROVIDER_INVALID, "Too many providers");
    const descriptor = Object.getOwnPropertyDescriptor(providers, key);
    if (!("value" in descriptor) || !descriptor.enumerable) throw providerError(E_PROVIDER_INVALID, "Invalid provider registry entry");
    const entry = descriptor.value;
    if (typeof entry !== "function") assertEntry(entry, key);
    map.set(key, entry);
  }
  return Object.freeze({
    get(id) { return map.get(id) ?? null; },
    has(id) { return map.has(id); },
    list() { return [...map.keys()].sort(); },
    async invoke(id, input = {}, options = {}) {
      const { timeoutMs, maxInputBytes, maxResultBytes } = normalizeOptions(options);
      if (!map.has(id)) throw providerError(E_PROVIDER_UNAVAILABLE, "Provider is not registered");
      const payload = normalizeProviderInput(input, maxInputBytes);
      const entry = map.get(id);
      return withProviderDeadline(id, timeoutMs, async (context, checkpoint) => {
        checkpoint();
        const validate = provider => {
          checkpoint();
          assertEntry(provider, id);
          return Object.freeze({ provider });
        };
        const { provider } = typeof entry === "function"
          ? await callProvider(() => entry(context), validate)
          : validate(entry);
        checkpoint();
        return callProvider(() => provider.operation(payload, context), result => {
          checkpoint();
          const normalized = normalizeProviderResult(result, maxResultBytes);
          checkpoint();
          return normalized;
        });
      });
    },
  });
}
