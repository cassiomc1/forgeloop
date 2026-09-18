import {
  E_BROWSER_VERIFICATION_ORIGIN_DENIED,
  E_BROWSER_VERIFICATION_OUTPUT_LIMIT,
  E_BROWSER_VERIFICATION_RESULT_INVALID,
} from "../error-codes.js";
import { deepFreeze, normalizePortableText } from "../portable-context.js";
import {
  BROWSER_VERIFICATION_ASSERTION_STATUSES,
  BROWSER_VERIFICATION_BLOCKED_RESULT_FIELDS,
  BROWSER_VERIFICATION_LIMITS,
  BROWSER_VERIFICATION_RESULT_FIELDS,
  BROWSER_VERIFICATION_TRUST,
} from "./constants.js";

function resultError(message, details = null, code = E_BROWSER_VERIFICATION_RESULT_INVALID) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function limitError(message, details) {
  return resultError(message, details, E_BROWSER_VERIFICATION_OUTPUT_LIMIT);
}

function portable(label, value, maxLength, optional = false) {
  try {
    return normalizePortableText(value, { label, maxLength, optional });
  } catch {
    throw resultError(`${label} is invalid.`);
  }
}

function assertSafeObservationText(label, value) {
  if (/(?:authorization\s*:\s*bearer|cookie\s*:|(?:token|secret|password)=|-----begin|file:\/\/|(?:^|\/)Users\/|(?:^|\/)home\/)/i.test(value)) {
    throw resultError(`${label} contains sensitive or non-portable content.`);
  }
  return value;
}

function strictSnapshot(value, label = "browser verification result", seen = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw resultError(`${label} contains a non-finite number.`);
    return value;
  }
  if (typeof value !== "object") throw resultError(`${label} contains an unsupported value.`);
  if (seen.has(value)) throw resultError(`${label} contains a circular reference.`);
  if (Array.isArray(value)) {
    seen.add(value);
    try {
      const output = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(value, index)) throw resultError(`${label} contains a sparse array.`);
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || descriptor.get || descriptor.set) throw resultError(`${label}[${index}] is an accessor.`);
        output.push(strictSnapshot(value[index], `${label}[${index}]`, seen));
      }
      return output;
    } finally {
      seen.delete(value);
    }
  }
  if (value instanceof Date || value instanceof Map || value instanceof Set || value instanceof Promise
    || Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    throw resultError(`${label} contains a non-plain object.`);
  }
  seen.add(value);
  try {
    const output = {};
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") throw resultError(`${label} contains a symbol key.`);
      if (key === "toJSON") throw resultError(`${label} contains a custom toJSON method.`);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || descriptor.get || descriptor.set) throw resultError(`${label}.${key} is an accessor.`);
      output[key] = strictSnapshot(value[key], `${label}.${key}`, seen);
    }
    return output;
  } finally {
    seen.delete(value);
  }
}

function rejectAuthorityFields(raw) {
  for (const field of BROWSER_VERIFICATION_BLOCKED_RESULT_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(raw, field)) {
      throw resultError("browser verification result contains a reserved authority field.", { field });
    }
  }
}

function rejectUnknownNestedFields(value, allowed, label) {
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowed.includes(key)) {
      throw resultError(`${label} contains an unsupported field.`, { field: typeof key === "string" ? key : String(key) });
    }
  }
}

function snapshotInput(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw resultError("browser verification result must be an object.");
  for (const key of Reflect.ownKeys(raw)) {
    if (typeof key !== "string") throw resultError("browser verification result contains a symbol key.");
    const descriptor = Object.getOwnPropertyDescriptor(raw, key);
    if (!descriptor || descriptor.get || descriptor.set) throw resultError("browser verification result contains an accessor.", { field: key });
  }
  rejectAuthorityFields(raw);
  return strictSnapshot(raw);
}

function inspectResultShape(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw resultError("browser verification result must be an object.");
  for (const key of Reflect.ownKeys(raw)) {
    if (typeof key !== "string") throw resultError("browser verification result contains a symbol key.");
    const descriptor = Object.getOwnPropertyDescriptor(raw, key);
    if (!descriptor || descriptor.get || descriptor.set) throw resultError("browser verification result contains an accessor.");
  }
  rejectAuthorityFields(raw);
}

function assertOrigin(value, label, allowedOrigins) {
  if (typeof value !== "string" || value.length > BROWSER_VERIFICATION_LIMITS.maxUrlChars) {
    throw resultError(`${label} is invalid.`);
  }
  let url;
  try { url = new URL(value); } catch { throw resultError(`${label} is invalid.`); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw resultError(`${label} is invalid.`);
  }
  const origin = `${url.protocol}//${url.hostname.toLowerCase()}${url.port ? `:${url.port}` : ""}`;
  if (!allowedOrigins.includes(origin)) {
    throw resultError(`${label} origin is not allowed.`, { label }, E_BROWSER_VERIFICATION_ORIGIN_DENIED);
  }
  return value;
}

function normalizeAssertions(rawAssertions, expected) {
  if (!Array.isArray(rawAssertions) || rawAssertions.length !== expected.length) {
    throw resultError("browser verification result assertions must match the requested assertion set.");
  }
  const ids = new Set();
  return rawAssertions.map((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw resultError(`assertions[${index}] is invalid.`);
    rejectUnknownNestedFields(raw, ["id", "kind", "status", "actual", "message"], `assertions[${index}]`);
    const expectedAssertion = expected[index];
    const id = portable(`assertions[${index}].id`, raw.id, BROWSER_VERIFICATION_LIMITS.maxAssertionIdChars);
    if (id !== expectedAssertion.id || raw.kind !== expectedAssertion.kind || ids.has(id)) {
      throw resultError("browser verification result assertions do not match the requested assertion set.");
    }
    ids.add(id);
    if (!BROWSER_VERIFICATION_ASSERTION_STATUSES.includes(raw.status)) throw resultError(`assertions[${index}].status is invalid.`);
    const output = { id, kind: raw.kind, status: raw.status };
    if (raw.actual !== undefined) output.actual = assertSafeObservationText(`assertions[${index}].actual`, portable(`assertions[${index}].actual`, raw.actual, BROWSER_VERIFICATION_LIMITS.maxActualChars));
    if (raw.message !== undefined) output.message = assertSafeObservationText(`assertions[${index}].message`, portable(`assertions[${index}].message`, raw.message, BROWSER_VERIFICATION_LIMITS.maxDiagnosticChars));
    return deepFreeze(output);
  });
}

function deriveStatus(assertions) {
  if (assertions.some(({ status }) => status === "FAIL")) return "FAIL";
  if (assertions.some(({ status }) => status === "BLOCKED")) return "BLOCKED";
  return "PASS";
}

function normalizeArtifacts(raw) {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw resultError("artifacts must be an array.");
  if (raw.length > BROWSER_VERIFICATION_LIMITS.maxArtifacts) throw limitError("Too many artifacts.", { count: raw.length });
  return raw.map((artifact, index) => {
    if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) throw resultError(`artifacts[${index}] is invalid.`);
    rejectUnknownNestedFields(artifact, ["kind", "mimeType", "byteLength", "sha256", "ref"], `artifacts[${index}]`);
    const ref = artifact.ref;
    const isWindowsDrivePath = /^[a-z]:[\\/]/i.test(ref);
    const isUncPath = /^(?:\\\\|\/\/)/.test(ref);
    const isFileUrl = /^file:/i.test(ref);
    if (artifact.kind !== "SCREENSHOT" || !["image/png", "image/jpeg"].includes(artifact.mimeType)
      || !Number.isInteger(artifact.byteLength) || artifact.byteLength <= 0 || artifact.byteLength > BROWSER_VERIFICATION_LIMITS.maxArtifactBytes
      || typeof artifact.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(artifact.sha256)
      || typeof artifact.ref !== "string" || artifact.ref.length > BROWSER_VERIFICATION_LIMITS.maxArtifactRefChars
       || artifact.ref.startsWith("/") || isWindowsDrivePath || isUncPath || isFileUrl
      || /^(?:https?:\/\/|ftp:\/\/)/i.test(artifact.ref) && (() => {
        try { return Boolean(new URL(artifact.ref).username || new URL(artifact.ref).password); } catch { return true; }
      })()
      || /(?:token|secret|password|authorization|cookie)=/i.test(artifact.ref)) {
      throw resultError(`artifacts[${index}] is invalid.`);
    }
    return deepFreeze({ ...artifact });
  });
}

function assertResultSize(value) {
  const serialized = JSON.stringify(value);
  if (serialized.length > BROWSER_VERIFICATION_LIMITS.maxResultChars) {
    throw limitError("Browser verification result exceeds its size limit.", {
      chars: serialized.length,
    });
  }
}

export function normalizeBrowserVerificationResult(raw, {
  provider, verificationId, taskId, requirement, target, expectedAssertions, allowedOrigins = [],
} = {}) {
  inspectResultShape(raw);
  const snapshot = snapshotInput(raw);
  if (!snapshot || Array.isArray(snapshot)) throw resultError("browser verification result must be an object.");
  for (const field of Object.keys(snapshot)) {
    if (!BROWSER_VERIFICATION_RESULT_FIELDS.includes(field)) throw resultError("browser verification result contains an unsupported field.", { field });
  }
  const expected = Array.isArray(expectedAssertions) ? expectedAssertions : [];
  const assertions = normalizeAssertions(snapshot.assertions, expected);
  if (snapshot.status !== undefined && snapshot.status !== deriveStatus(assertions)) throw resultError("Provider status does not match derived status.");
  const normalized = {
    taskId: portable("taskId", taskId, BROWSER_VERIFICATION_LIMITS.maxVerificationIdChars),
    verificationId: portable("verificationId", verificationId, BROWSER_VERIFICATION_LIMITS.maxVerificationIdChars),
    requirement: portable("requirement", requirement, BROWSER_VERIFICATION_LIMITS.maxRequirementChars),
    target: portable("target", target, BROWSER_VERIFICATION_LIMITS.maxUrlChars),
    provider: { id: provider?.id ?? provider },
    status: deriveStatus(assertions),
    assertions: Object.freeze(assertions),
    diagnostics: Object.freeze((() => {
      if (snapshot.diagnostics === undefined) return [];
      if (!Array.isArray(snapshot.diagnostics)) throw resultError("diagnostics must be an array.");
      if (snapshot.diagnostics.length > BROWSER_VERIFICATION_LIMITS.maxDiagnostics) throw limitError("Too many diagnostics.", { count: snapshot.diagnostics.length });
      return snapshot.diagnostics.map((value, index) => assertSafeObservationText(`diagnostics[${index}]`, portable(`diagnostics[${index}]`, value, BROWSER_VERIFICATION_LIMITS.maxDiagnosticChars)));
    })()),
    snapshots: Object.freeze((() => {
      if (snapshot.snapshots === undefined) return [];
      if (!Array.isArray(snapshot.snapshots)) throw resultError("snapshots must be an array.");
      if (snapshot.snapshots.length > BROWSER_VERIFICATION_LIMITS.maxSnapshots) throw limitError("Too many snapshots.", { count: snapshot.snapshots.length });
      return snapshot.snapshots.map((value, index) => {
       if (!value || typeof value !== "object" || Array.isArray(value)) throw resultError(`snapshots[${index}] is invalid.`);
       rejectUnknownNestedFields(value, ["kind", "text"], `snapshots[${index}]`);
       if (value.kind !== "ACCESSIBILITY") throw resultError(`snapshots[${index}] is invalid.`);
      return deepFreeze({ kind: "ACCESSIBILITY", text: assertSafeObservationText(`snapshots[${index}].text`, portable(`snapshots[${index}].text`, value.text, BROWSER_VERIFICATION_LIMITS.maxSnapshotChars)) });
      });
    })()),
    artifacts: Object.freeze(normalizeArtifacts(snapshot.artifacts)),
    ...BROWSER_VERIFICATION_TRUST,
  };
  if (snapshot.finalUrl !== undefined) normalized.finalUrl = assertOrigin(snapshot.finalUrl, "finalUrl", allowedOrigins);
  else throw resultError("finalUrl is required when browser execution occurs.");
  if (snapshot.navigations !== undefined) {
    if (!Array.isArray(snapshot.navigations)) throw resultError("navigations must be an array.");
    if (snapshot.navigations.length > BROWSER_VERIFICATION_LIMITS.maxNavigations) throw limitError("Too many navigations.", { count: snapshot.navigations.length });
    normalized.navigations = Object.freeze(snapshot.navigations.map((navigation, index) => {
       if (!navigation || typeof navigation !== "object" || Array.isArray(navigation)) throw resultError(`navigations[${index}] is invalid.`);
       rejectUnknownNestedFields(navigation, ["url", "kind"], `navigations[${index}]`);
       if (!navigation || !["NAVIGATE", "REDIRECT"].includes(navigation.kind)) throw resultError(`navigations[${index}] is invalid.`);
      return deepFreeze({ url: assertOrigin(navigation.url, `navigations[${index}].url`, allowedOrigins), kind: navigation.kind });
  }));
  } else normalized.navigations = Object.freeze([]);
  assertResultSize(normalized);
  return deepFreeze(normalized);
}
