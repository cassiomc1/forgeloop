import { Buffer } from "node:buffer";
import { DECISION_LIMITS } from "./constants.js";
import { DECISION_ERROR_CODES, decisionError } from "./errors.js";

const SECRET_KEY = /(^|[_-])(api[_-]?key|password|passwd|secret|token|refresh|cookie|authorization|private[_-]?key|credential|database[_-]?url|connection[_-]?string|access[_-]?key|client[_-]?secret)([_-]|$)/i;
const SECRET_VALUE = /^(?:bearer\s+)?(?:sk-|pk-|ghp_|github_pat_|xox[baprs]-|AIza|AKIA)[A-Za-z0-9._-]{12,}$/i;

function isHomePath(value) {
  return typeof value === "string" && (/^\/Users\/[^/]+\//.test(value) || /^\/home\/[^/]+\//.test(value));
}

function sanitize(value, depth, counters) {
  if (depth > DECISION_LIMITS.maxDepth) throw decisionError(DECISION_ERROR_CODES.STATE_LIMIT, "Decision state nesting exceeds the supported limit.");
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") {
    if (/[^\x09\x0A\x0D\x20-\uD7FF\uE000-\uFFFD]/u.test(value)) throw decisionError(DECISION_ERROR_CODES.STATE_UNSAFE, "Decision state contains unsafe control characters.");
    if (SECRET_VALUE.test(value)) throw decisionError(DECISION_ERROR_CODES.STATE_UNSAFE, "Decision state contains a secret-like value.");
    if (isHomePath(value)) return "<redacted-user-path>";
    counters.bytes += Buffer.byteLength(value);
    if (value.length > DECISION_LIMITS.maxStringChars) return `${value.slice(0, DECISION_LIMITS.maxStringChars)}…<truncated>`;
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > DECISION_LIMITS.maxItems) throw decisionError(DECISION_ERROR_CODES.STATE_LIMIT, "Decision state contains too many items.");
    return value.map((item) => sanitize(item, depth + 1, counters));
  }
  if (typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.length > DECISION_LIMITS.maxItems) throw decisionError(DECISION_ERROR_CODES.STATE_LIMIT, "Decision state contains too many fields.");
    const result = {};
    for (const [key, child] of entries) {
      if (SECRET_KEY.test(key) || key.toLowerCase() === "env" || key.toLowerCase() === "environment") continue;
      result[key] = sanitize(child, depth + 1, counters);
    }
    return result;
  }
  throw decisionError(DECISION_ERROR_CODES.STATE_UNSAFE, "Decision state contains an unsupported value.");
}

export function buildDecisionState(value) {
  const counters = { bytes: 0 };
  const sanitized = sanitize(value, 0, counters);
  const bytes = Buffer.byteLength(JSON.stringify(sanitized));
  if (bytes > DECISION_LIMITS.maxStateBytes) throw decisionError(DECISION_ERROR_CODES.STATE_LIMIT, "Decision state exceeds the supported byte limit.");
  return sanitized;
}

export function buildLifecycleDecisionState(value = {}) {
  return buildDecisionState(value ?? {});
}

export function buildSemanticDecisionState(value = {}) {
  return buildDecisionState(value ?? {});
}

export function buildCombinedDecisionState({ lifecycle = {}, semantic = {} } = {}) {
  return {
    lifecycle: buildLifecycleDecisionState(lifecycle),
    semantic: buildSemanticDecisionState(semantic),
  };
}

export function decisionStateFingerprint(value, canonicalFingerprint) {
  return canonicalFingerprint(buildDecisionState(value));
}
