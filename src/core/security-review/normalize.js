import {
  E_SECURITY_REVIEW_OUTPUT_LIMIT,
  E_SECURITY_REVIEW_RESULT_INVALID,
} from "../error-codes.js";
import { deepFreeze, normalizePortableText } from "../portable-context.js";
import {
  SECURITY_REVIEW_BLOCKED_RESULT_FIELDS,
  SECURITY_REVIEW_CATEGORIES,
  SECURITY_REVIEW_CONFIDENCE,
  SECURITY_REVIEW_LIMITS,
  SECURITY_REVIEW_SCOPES,
  SECURITY_REVIEW_SEVERITIES,
  SECURITY_REVIEW_TRUST,
} from "./constants.js";

function resultError(message, details = null, code = E_SECURITY_REVIEW_RESULT_INVALID) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function limitError(message, details = null) {
  return resultError(message, details, E_SECURITY_REVIEW_OUTPUT_LIMIT);
}

function text(label, value, maxLength, { optional = false } = {}) {
  try {
    return normalizePortableText(value, { label, maxLength, optional });
  } catch {
    throw resultError(`${label} is invalid.`);
  }
}

function consumeSnapshotBudget(value, label, state, depth) {
  if (depth > SECURITY_REVIEW_LIMITS.maxSnapshotDepth) {
    throw limitError(`${label} exceeds the maximum result nesting depth.`);
  }
  state.nodes += 1;
  if (state.nodes > SECURITY_REVIEW_LIMITS.maxSnapshotNodes) {
    throw limitError("Security review result exceeds its maximum snapshot node count.");
  }
  if (typeof value === "string") {
    state.chars += value.length;
    if (state.chars > SECURITY_REVIEW_LIMITS.maxSnapshotChars) {
      throw limitError("Security review result exceeds its maximum snapshot character count.");
    }
  }
}

function strictSnapshotArray(value, label, seen, state, depth) {
  seen.add(value);
  try {
    const output = [];
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.prototype.hasOwnProperty.call(value, index)) throw resultError(`${label} contains a sparse array.`);
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || descriptor.get || descriptor.set) throw resultError(`${label}[${index}] is an accessor.`);
      output.push(strictSnapshot(value[index], `${label}[${index}]`, seen, state, depth + 1));
    }
    return output;
  } finally {
    seen.delete(value);
  }
}

function strictSnapshotObject(value, label, seen, state, depth) {
  const prototype = Object.getPrototypeOf(value);
  if (value instanceof Date || value instanceof Map || value instanceof Set || value instanceof Promise
    || (prototype !== Object.prototype && prototype !== null)) {
    throw resultError(`${label} contains a non-plain object.`);
  }
  seen.add(value);
  try {
    const output = {};
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") throw resultError(`${label} contains a symbol key.`);
      if (key === "toJSON") throw resultError(`${label} contains a custom toJSON method.`);
      state.chars += key.length;
      if (state.chars > SECURITY_REVIEW_LIMITS.maxSnapshotChars) {
        throw limitError("Security review result exceeds its maximum snapshot character count.");
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || descriptor.get || descriptor.set) throw resultError(`${label}.${key} is an accessor.`);
      output[key] = strictSnapshot(value[key], `${label}.${key}`, seen, state, depth + 1);
    }
    return output;
  } finally {
    seen.delete(value);
  }
}

function strictSnapshot(value, label = "security review result", seen = new Set(), state = { nodes: 0, chars: 0 }, depth = 0) {
  consumeSnapshotBudget(value, label, state, depth);
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw resultError(`${label} contains a non-finite number.`);
    return value;
  }
  if (typeof value !== "object") throw resultError(`${label} contains an unsupported value.`);
  if (seen.has(value)) throw resultError(`${label} contains a circular reference.`);
  return Array.isArray(value)
    ? strictSnapshotArray(value, label, seen, state, depth)
    : strictSnapshotObject(value, label, seen, state, depth);
}

function rejectUnknown(source, allowed, label) {
  for (const key of Reflect.ownKeys(source)) {
    if (typeof key !== "string" || !allowed.includes(key)) {
      throw resultError(`${label} contains an unsupported field.`, { field: typeof key === "string" ? key : String(key) });
    }
  }
}

function assertSafeText(label, value, maxLength) {
  const normalized = text(label, value, maxLength);
  if (/(?:authorization\s*:\s*bearer|cookie\s*:|(?:token|secret|password)=|-----begin|file:\/\/(?:\/|%2f)|(?:^|\/)Users\/|(?:^|\/)home\/)/i.test(normalized)) {
    throw resultError(`${label} contains sensitive or non-portable content.`);
  }
  return normalized;
}

function normalizePath(value, label) {
  const path = assertSafeText(label, value, SECURITY_REVIEW_LIMITS.maxPathChars).replaceAll("\\", "/");
  if (path.startsWith("/") || /^[a-z]:\//i.test(path) || path.startsWith("//") || /^file:/i.test(path)
    || path.split("/").includes("..") || path === "." || path.endsWith("/") || path.includes("//")) {
    throw resultError(`${label} must be a project-relative non-escaping path.`);
  }
  return path;
}

function assertFindingScope(path, scope, requestedPaths, index) {
  if (scope === "FULL" || requestedPaths.length === 0) return;
  const inScope = requestedPaths.some((root) => path === root || path.startsWith(`${root}/`));
  if (!inScope) {
    throw resultError(`findings[${index}].path is outside the requested ${scope.toLowerCase()} scope.`, {
      path,
      requestedPaths,
    });
  }
}

function normalizeFinding(raw, index, scope, requestedPaths) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw resultError(`findings[${index}] is invalid.`);
  rejectUnknown(raw, ["id", "category", "severity", "title", "summary", "path", "line", "ruleId", "confidence"], `findings[${index}]`);
  const finding = {
    id: assertSafeText(`findings[${index}].id`, raw.id, SECURITY_REVIEW_LIMITS.maxFindingIdChars),
    category: assertSafeText(`findings[${index}].category`, raw.category, SECURITY_REVIEW_LIMITS.maxCategoryChars),
    severity: assertSafeText(`findings[${index}].severity`, raw.severity, SECURITY_REVIEW_LIMITS.maxSeverityChars),
    title: assertSafeText(`findings[${index}].title`, raw.title, SECURITY_REVIEW_LIMITS.maxTitleChars),
    summary: assertSafeText(`findings[${index}].summary`, raw.summary, SECURITY_REVIEW_LIMITS.maxSummaryChars),
  };
  if (!SECURITY_REVIEW_CATEGORIES.includes(finding.category)) throw resultError(`findings[${index}].category is unsupported.`);
  if (!SECURITY_REVIEW_SEVERITIES.includes(finding.severity)) throw resultError(`findings[${index}].severity is unsupported.`);
  if (raw.path !== undefined) {
    finding.path = normalizePath(raw.path, `findings[${index}].path`);
    assertFindingScope(finding.path, scope, requestedPaths, index);
  }
  if (raw.line !== undefined) {
    if (!Number.isInteger(raw.line) || raw.line < 1 || raw.line > 10_000_000) throw resultError(`findings[${index}].line is invalid.`);
    finding.line = raw.line;
  }
  if (raw.ruleId !== undefined) finding.ruleId = assertSafeText(`findings[${index}].ruleId`, raw.ruleId, SECURITY_REVIEW_LIMITS.maxRuleIdChars);
  if (raw.confidence !== undefined) {
    finding.confidence = assertSafeText(`findings[${index}].confidence`, raw.confidence, SECURITY_REVIEW_LIMITS.maxConfidenceChars);
    if (!SECURITY_REVIEW_CONFIDENCE.includes(finding.confidence)) throw resultError(`findings[${index}].confidence is unsupported.`);
  }
  return deepFreeze(finding);
}

function normalizeDiagnostics(raw) {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > SECURITY_REVIEW_LIMITS.maxDiagnostics) throw limitError("diagnostics exceeds its limit.");
  return raw.map((entry, index) => assertSafeText(`diagnostics[${index}]`, entry, SECURITY_REVIEW_LIMITS.maxDiagnosticChars));
}

function deriveSummary(findings) {
  const bySeverity = Object.fromEntries(SECURITY_REVIEW_SEVERITIES.map((severity) => [severity, 0]));
  const byCategory = Object.fromEntries(SECURITY_REVIEW_CATEGORIES.map((category) => [category, 0]));
  for (const finding of findings) {
    bySeverity[finding.severity] += 1;
    byCategory[finding.category] += 1;
  }
  return deepFreeze({ total: findings.length, bySeverity: deepFreeze(bySeverity), byCategory: deepFreeze(byCategory) });
}

function normalizeSummary(raw, expected) {
  if (raw === undefined) return expected;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw resultError("summary is invalid.");
  rejectUnknown(raw, ["total", "bySeverity", "byCategory"], "summary");
  if (JSON.stringify(raw) !== JSON.stringify(expected)) throw resultError("summary does not match normalized findings.");
  return expected;
}

function normalizeRequestedPaths(requestedPaths) {
  if (!Array.isArray(requestedPaths)) throw resultError("requestedPaths must be an array.");
  const normalized = requestedPaths.map((path, index) => normalizePath(path, `requestedPaths[${index}]`));
  if (new Set(normalized).size !== normalized.length) throw resultError("requestedPaths must not contain duplicates.");
  return normalized;
}

export function normalizeSecurityReviewResult(raw, {
  provider, taskId, reviewId, scope, requestedPaths = [],
} = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw resultError("security review result must be an object.");
  if (!SECURITY_REVIEW_SCOPES.includes(scope)) throw resultError("scope is unsupported.");
  const normalizedRequestedPaths = normalizeRequestedPaths(requestedPaths);
  if (scope === "SELECTED" && normalizedRequestedPaths.length === 0) {
    throw resultError("SELECTED scope requires requestedPaths.");
  }
  const snapshot = strictSnapshot(raw);
  for (const field of SECURITY_REVIEW_BLOCKED_RESULT_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(snapshot, field)) throw resultError("security review result contains a reserved authority field.", { field });
  }
  rejectUnknown(snapshot, ["findings", "diagnostics", "durationMs", "summary"], "security review result");
  if (!Array.isArray(snapshot.findings)) throw resultError("findings must be an array.");
  if (snapshot.findings.length > SECURITY_REVIEW_LIMITS.maxFindings) throw limitError("Too many findings.", { count: snapshot.findings.length });
  const findings = snapshot.findings.map((finding, index) => normalizeFinding(finding, index, scope, normalizedRequestedPaths));
  const ids = findings.map((finding) => finding.id);
  if (new Set(ids).size !== ids.length) throw resultError("findings must not contain duplicate IDs.");
  const summary = deriveSummary(findings);
  normalizeSummary(snapshot.summary, summary);
  let durationMs;
  if (snapshot.durationMs !== undefined) {
    if (!Number.isInteger(snapshot.durationMs) || snapshot.durationMs < 0 || snapshot.durationMs > SECURITY_REVIEW_LIMITS.maxDurationMs) {
      throw resultError("durationMs is invalid.");
    }
    durationMs = snapshot.durationMs;
  }
  const result = {
    taskId: assertSafeText("taskId", taskId, SECURITY_REVIEW_LIMITS.maxTaskIdChars),
    reviewId: assertSafeText("reviewId", reviewId, SECURITY_REVIEW_LIMITS.maxReviewIdChars),
    scope,
    requestedPaths: Object.freeze(normalizedRequestedPaths),
    provider: deepFreeze({ id: provider.id, ...(provider.version === undefined ? {} : { version: provider.version }) }),
    findings: Object.freeze(findings),
    summary,
    diagnostics: Object.freeze(normalizeDiagnostics(snapshot.diagnostics)),
    ...(durationMs === undefined ? {} : { durationMs }),
    ...SECURITY_REVIEW_TRUST,
  };
  const serialized = JSON.stringify(result);
  if (serialized.length > SECURITY_REVIEW_LIMITS.maxResultChars) throw limitError("Security review result exceeds its size limit.", { chars: serialized.length });
  return deepFreeze(result);
}
