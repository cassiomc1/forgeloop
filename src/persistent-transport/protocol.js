import { randomUUID } from "node:crypto";
import path from "node:path";

import { PERSISTENT_TRANSPORT_METHODS, PERSISTENT_TRANSPORT_PROTOCOL_VERSION } from "./constants.js";
import { PERSISTENT_TRANSPORT_ERROR_CODES, persistentTransportError } from "./errors.js";

const MAX_REQUEST_ID_CHARS = 128;
export const PERSISTENT_SEARCH_QUERY_KEYS = Object.freeze([
  "pattern", "globs", "types", "context", "beforeContext", "afterContext", "maxCount",
  "filesWithMatches", "stats", "fixedStrings", "ignoreCase", "smartCase", "wordRegexp",
]);

function invalid(message, details = {}) {
  return persistentTransportError(PERSISTENT_TRANSPORT_ERROR_CODES.INVALID_REQUEST, message, details);
}

export function validateRequest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid("Transport request must be an object");
  if (value.protocolVersion !== PERSISTENT_TRANSPORT_PROTOCOL_VERSION) {
    throw persistentTransportError(PERSISTENT_TRANSPORT_ERROR_CODES.PROTOCOL_MISMATCH, `Unsupported transport protocol version: ${value.protocolVersion ?? "missing"}`, { expectedVersion: PERSISTENT_TRANSPORT_PROTOCOL_VERSION, actualVersion: value.protocolVersion });
  }
  if (typeof value.id !== "string" || value.id.length === 0 || value.id.length > MAX_REQUEST_ID_CHARS) throw invalid("Transport request id is invalid");
  if (typeof value.method !== "string" || !PERSISTENT_TRANSPORT_METHODS.includes(value.method)) throw invalid(`Unsupported transport method: ${value.method ?? "missing"}`);
  if (value.params !== undefined && (!value.params || typeof value.params !== "object" || Array.isArray(value.params))) throw invalid("Transport request params must be an object");
  return {
    protocolVersion: value.protocolVersion,
    id: value.id,
    method: value.method,
    params: value.params ?? {},
  };
}

export function createRequest(method, params = {}, id = randomUUID()) {
  return { protocolVersion: PERSISTENT_TRANSPORT_PROTOCOL_VERSION, id, method, params };
}

export function createSuccessResponse(id, result) {
  return { protocolVersion: PERSISTENT_TRANSPORT_PROTOCOL_VERSION, id, ok: true, result };
}

export function createErrorResponse(id, error) {
  return {
    protocolVersion: PERSISTENT_TRANSPORT_PROTOCOL_VERSION,
    id: id ?? null,
    ok: false,
    error: {
      code: error?.code ?? PERSISTENT_TRANSPORT_ERROR_CODES.INVALID_RESPONSE,
      message: String(error?.message ?? "Transport request failed").slice(0, 4_000),
      ...(error?.expectedVersion !== undefined ? { expectedVersion: error.expectedVersion } : {}),
      ...(error?.actualVersion !== undefined ? { actualVersion: error.actualVersion } : {}),
    },
  };
}

export function validateResponse(value, expectedId) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw persistentTransportError(PERSISTENT_TRANSPORT_ERROR_CODES.INVALID_RESPONSE, "Transport response must be an object");
  }
  if (value.protocolVersion !== PERSISTENT_TRANSPORT_PROTOCOL_VERSION) {
    throw persistentTransportError(PERSISTENT_TRANSPORT_ERROR_CODES.PROTOCOL_MISMATCH, "Transport response protocol version is unsupported", { expectedVersion: PERSISTENT_TRANSPORT_PROTOCOL_VERSION, actualVersion: value.protocolVersion });
  }
  if (value.id !== expectedId) throw persistentTransportError(PERSISTENT_TRANSPORT_ERROR_CODES.INVALID_RESPONSE, "Transport response id does not match the request");
  if (typeof value.ok !== "boolean") throw persistentTransportError(PERSISTENT_TRANSPORT_ERROR_CODES.INVALID_RESPONSE, "Transport response ok flag is invalid");
  if (!value.ok && (!value.error || typeof value.error !== "object" || typeof value.error.code !== "string")) throw persistentTransportError(PERSISTENT_TRANSPORT_ERROR_CODES.INVALID_RESPONSE, "Transport error response is malformed");
  return value;
}

export function assertSearchParams(params) {
  if (!params || typeof params !== "object" || Array.isArray(params)) throw invalid("repository.search params must be an object");
  if (typeof params.repository !== "string" || !path.isAbsolute(params.repository) || params.repository.length > 4_096) throw invalid("repository.search repository identity is invalid");
  if (!params.query || typeof params.query !== "object" || Array.isArray(params.query)) throw invalid("repository.search query must be an object");
  const unknownKeys = Object.keys(params.query).filter((key) => !PERSISTENT_SEARCH_QUERY_KEYS.includes(key));
  if (unknownKeys.length > 0) throw invalid(`repository.search query contains unsupported fields: ${unknownKeys.join(", ")}`);
  if (typeof params.query.pattern !== "string" || params.query.pattern.length === 0 || params.query.pattern.length > 4_096) throw invalid("repository.search query pattern is invalid");
  return params;
}

export function projectSearchQuery(query) {
  const projected = {
    pattern: query.pattern,
    globs: query.globs,
    types: query.types,
    context: query.context,
    beforeContext: query.beforeContext,
    afterContext: query.afterContext,
    maxCount: query.maxCount,
    filesWithMatches: query.filesWithMatches,
    stats: query.stats,
    fixedStrings: query.fixedStrings,
    ignoreCase: query.ignoreCase,
    smartCase: query.smartCase,
    wordRegexp: query.wordRegexp,
  };
  return Object.fromEntries(Object.entries(projected).filter(([, value]) => value !== undefined));
}
