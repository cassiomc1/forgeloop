import { types } from "node:util";
import { deepFreeze } from "../core/portable-context.js";
import {
  E_PROVIDER_AUTHORITY_ESCALATION,
  E_PROVIDER_INVALID,
  E_PROVIDER_OUTPUT_INVALID,
  E_PROVIDER_OUTPUT_LIMIT,
  providerError,
} from "./errors.js";

const AUTHORITY_KEYS = new Set([
  "lifecycleAuthority", "completionAuthority", "evidenceAuthority",
  "executableAuthority", "installAuthority",
]);

export function isPlainObject(value) {
  if (value === null || typeof value !== "object" || types.isProxy(value) || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function serializeSnapshot(value, maxBytes, invalidCode) {
  const ancestors = new WeakSet();
  let bytes = 0;
  let nodes = 0;
  const invalid = () => { throw providerError(invalidCode, "Provider payload must contain only plain JSON data without accessors"); };
  const limit = () => { throw providerError(E_PROVIDER_OUTPUT_LIMIT, "Provider payload exceeds its byte or structural limit"); };
  function charge(text) {
    bytes += Buffer.byteLength(text, "utf8");
    if (bytes > maxBytes) limit();
    return text;
  }
  function string(value) {
    if (value.length > maxBytes - bytes) limit();
    return charge(JSON.stringify(value));
  }
  function visit(value, depth) {
    nodes += 1;
    if (depth > 64 || nodes > 100_000) limit();
    if (value === null) return charge("null");
    if (typeof value === "string") return string(value);
    if (typeof value === "boolean") return charge(String(value));
    if (typeof value === "number" && Number.isFinite(value)) return charge(JSON.stringify(value));
    if (typeof value !== "object" || types.isProxy(value)) invalid();
    return visitContainer(value, depth);
  }
  function assertContainer(value, array) {
    const valid = array ? Object.getPrototypeOf(value) === Array.prototype : isPlainObject(value);
    if (!valid) invalid();
  }
  function visitContainer(value, depth) {
    const array = Array.isArray(value);
    assertContainer(value, array);
    if (ancestors.has(value)) invalid();
    ancestors.add(value);
    const keys = Reflect.ownKeys(value);
    if (keys.length > 100_000 || keys.length > maxBytes) limit();
    const parts = [];
    charge(array ? "[]" : "{}");
    const length = array ? Object.getOwnPropertyDescriptor(value, "length").value : 0;
    if (array && keys.length !== length + 1) invalid();
    let index = 0;
    for (const key of keys) {
      if (array && key === "length") continue;
      if (typeof key !== "string") invalid();
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) invalid();
      if (array && key !== String(index)) invalid();
      if (index > 0) charge(",");
      const prefix = array ? "" : string(key) + charge(":");
      parts.push(prefix + visit(descriptor.value, depth + 1));
      index += 1;
    }
    if (array && index !== length) invalid();
    ancestors.delete(value);
    return array ? `[${parts.join(",")}]` : `{${parts.join(",")}}`;
  }
  return visit(value, 0);
}

function assertAuthorityFree(value) {
  if (value === null || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (AUTHORITY_KEYS.has(key) && child === true) {
      throw providerError(E_PROVIDER_AUTHORITY_ESCALATION, "Provider result declares forbidden authority");
    }
    assertAuthorityFree(child);
  }
}

export function normalizeProviderInput(value, maxBytes) {
  return deepFreeze(JSON.parse(serializeSnapshot(value, maxBytes, E_PROVIDER_INVALID)));
}

export function normalizeProviderResult(value, maxBytes) {
  if (!isPlainObject(value)) {
    throw providerError(E_PROVIDER_OUTPUT_INVALID, "Provider result must be a plain JSON object");
  }
  const normalized = JSON.parse(serializeSnapshot(value, maxBytes, E_PROVIDER_OUTPUT_INVALID));
  assertAuthorityFree(normalized);
  if (normalized.status === "COMPLETE") {
    throw providerError(E_PROVIDER_AUTHORITY_ESCALATION, "Provider result cannot assign lifecycle completion");
  }
  return deepFreeze(normalized);
}
