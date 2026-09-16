import { capabilityFor } from "./capabilities.js";
import {
  E_PROVIDER_AUTHORITY_ESCALATION,
  E_PROVIDER_EXECUTION_FAILED,
  E_PROVIDER_INVALID,
  E_PROVIDER_OUTPUT_INVALID,
  E_PROVIDER_OUTPUT_LIMIT,
  E_PROVIDER_TIMEOUT,
  E_PROVIDER_UNAVAILABLE,
  providerError,
} from "./errors.js";

const PROVIDER_ID_REGEX = /^[a-z0-9][a-z0-9_-]*$/;
const REGISTRY_MAX_PROVIDERS = 256;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_PAYLOAD_BYTES = 262_144;
const AUTHORITY_KEYS = Object.freeze([
  "lifecycleAuthority",
  "completionAuthority",
  "evidenceAuthority",
  "executableAuthority",
  "installAuthority",
]);

function assertEntry(entry, key) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw providerError(E_PROVIDER_INVALID, `Provider "${key}" must be an object`);
  }
  if (typeof entry.id !== "string" || !PROVIDER_ID_REGEX.test(entry.id)) {
    throw providerError(E_PROVIDER_INVALID, `Provider "${key}" has an invalid id`);
  }
  if (entry.id !== key) {
    throw providerError(E_PROVIDER_INVALID, `Provider id "${entry.id}" does not match registry key "${key}"`);
  }
  if (entry.version !== undefined && (typeof entry.version !== "string" || entry.version.trim() === "" || entry.version.length > 64)) {
    throw providerError(E_PROVIDER_INVALID, `Provider "${key}" version must be a non-empty string of at most 64 characters`);
  }
  if (typeof entry.kind !== "string" || !capabilityFor(entry.kind)) {
    throw providerError(E_PROVIDER_INVALID, `Provider "${key}" declares an unsupported kind`);
  }
  if (entry.capability !== undefined && entry.capability !== capabilityFor(entry.kind)) {
    throw providerError(E_PROVIDER_INVALID, `Provider "${key}" capability metadata contradicts its kind`);
  }
  if (typeof entry.operation !== "function") {
    throw providerError(E_PROVIDER_INVALID, `Provider "${key}" must implement operation(input)`);
  }
}

function assertSerializablePayload(value, maxBytes) {
  let payload;
  try {
    payload = JSON.parse(JSON.stringify(value ?? {}));
  } catch {
    throw providerError(E_PROVIDER_INVALID, "Provider input must be JSON-serializable");
  }
  if (Buffer.byteLength(JSON.stringify(payload), "utf8") > maxBytes) {
    throw providerError(E_PROVIDER_OUTPUT_LIMIT, "Provider input exceeds the bounded payload size");
  }
  return payload;
}

function assertAuthorityFree(result) {
  for (const key of AUTHORITY_KEYS) {
    if (result[key] === true) {
      throw providerError(E_PROVIDER_AUTHORITY_ESCALATION, `Provider result declared forbidden authority key "${key}"`);
    }
  }
  if (result.status === "COMPLETE") {
    throw providerError(E_PROVIDER_AUTHORITY_ESCALATION, "Provider result cannot assign lifecycle completion");
  }
  return result;
}

function assertBoundedResult(result, maxResultBytes) {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw providerError(E_PROVIDER_OUTPUT_INVALID, "Provider result must be a plain JSON object");
  }
  let serialized;
  try {
    serialized = JSON.stringify(result);
  } catch {
    throw providerError(E_PROVIDER_OUTPUT_INVALID, "Provider result must be JSON-serializable");
  }
  if (Buffer.byteLength(serialized, "utf8") > maxResultBytes) {
    throw providerError(E_PROVIDER_OUTPUT_LIMIT, "Provider result exceeds the bounded result size");
  }
  return assertAuthorityFree(result);
}

async function resolveEntry(entry, id) {
  if (typeof entry !== "function") return entry;
  let resolved;
  try {
    resolved = await entry();
  } catch {
    throw providerError(E_PROVIDER_INVALID, `Provider "${id}" factory failed`);
  }
  assertEntry(resolved, id);
  return resolved;
}

export function createProviderRegistry({ providers = {} } = {}) {
  if (!providers || typeof providers !== "object" || Array.isArray(providers)) {
    throw providerError(E_PROVIDER_INVALID, "Provider registry must be an object map");
  }

  const map = new Map();
  for (const [key, entry] of Object.entries(providers)) {
    if (!PROVIDER_ID_REGEX.test(key)) {
      throw providerError(E_PROVIDER_INVALID, `Invalid provider registry key "${key}"`);
    }
    if (map.has(key)) {
      throw providerError(E_PROVIDER_INVALID, `Duplicate provider key "${key}"`);
    }
    if (map.size >= REGISTRY_MAX_PROVIDERS) {
      throw providerError(E_PROVIDER_INVALID, "Provider registry exceeds the supported maximum size");
    }
    if (typeof entry !== "function") {
      assertEntry(entry, key);
    }
    map.set(key, entry);
  }

  return Object.freeze({
    get(id) {
      return map.get(id) ?? null;
    },
    has(id) {
      return map.has(id);
    },
    list() {
      return [...map.keys()].sort();
    },
    async invoke(id, input = {}, { timeoutMs = DEFAULT_TIMEOUT_MS, maxInputBytes, maxResultBytes } = {}) {
      const entry = map.get(id);
      if (!entry) {
        throw providerError(E_PROVIDER_UNAVAILABLE, `Provider "${id}" is not registered`);
      }

      const provider = await resolveEntry(entry, id);
      const payload = assertSerializablePayload(input, maxInputBytes ?? DEFAULT_MAX_PAYLOAD_BYTES);

      let timer = null;
      try {
        const result = await Promise.race([
          Promise.resolve().then(() => provider.operation(payload)),
          new Promise((_, reject) => {
            timer = setTimeout(() => {
              reject(providerError(E_PROVIDER_TIMEOUT, `Provider "${id}" exceeded ${timeoutMs}ms`));
            }, Math.max(1, timeoutMs));
          }),
        ]);
        return assertBoundedResult(result, maxResultBytes ?? DEFAULT_MAX_PAYLOAD_BYTES);
      } catch (error) {
        if (error?.code?.startsWith("E_PROVIDER_")) throw error;
        throw providerError(E_PROVIDER_EXECUTION_FAILED, `Provider "${id}" operation failed: ${error?.name ?? "Error"}`);
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
  });
}
