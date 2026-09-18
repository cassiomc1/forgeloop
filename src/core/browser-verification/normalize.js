import {
  E_BROWSER_VERIFICATION_OUTPUT_LIMIT,
  E_BROWSER_VERIFICATION_RESULT_INVALID,
} from "../error-codes.js";
import {
  assertPortableContextSafe,
  deepFreeze,
  normalizePortableText,
} from "../portable-context.js";
import {
  BROWSER_VERIFICATION_ASSERTION_STATUSES,
  BROWSER_VERIFICATION_LIMITS,
  BROWSER_VERIFICATION_RESULT_STATUSES,
  BROWSER_VERIFICATION_TRUST,
} from "./constants.js";

const AUTHORITY_FIELDS = [
  "authority",
  "evidenceAuthority",
  "actionability",
  "trustRole",
  "persisted",
  "lifecycleAuthority",
  "completionAuthority",
  "evidenceRequiresForgeLoopValidation",
];

function resultError(message, details) {
  const error = new Error(message);
  error.code = E_BROWSER_VERIFICATION_RESULT_INVALID;
  error.details = details ?? null;
  return error;
}

function limitError(message, details) {
  const error = new Error(message);
  error.code = E_BROWSER_VERIFICATION_OUTPUT_LIMIT;
  error.details = details ?? null;
  return error;
}

function toPortable(label, value, maxLength, { optional = false } = {}) {
  try {
    return normalizePortableText(value, { label, maxLength, optional });
  } catch (error) {
    throw resultError(`${label} is invalid: ${error.message}`, { [label]: value });
  }
}

function rejectAuthorityOverrides(raw) {
  for (const field of AUTHORITY_FIELDS) {
    if (raw[field] !== undefined) {
      throw resultError(`browser verification result must not set ${field}.`, { [field]: raw[field] });
    }
  }
}

function normalizeAssertion(raw, index, expectedAssertion) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw resultError(`assertions[${index}] must be an object.`, { assertion: raw });
  }
  rejectAuthorityOverrides(raw);
  const id = toPortable(
    `assertions[${index}].id`,
    raw.id,
    BROWSER_VERIFICATION_LIMITS.maxAssertionIdChars,
  );
  if (expectedAssertion && id !== expectedAssertion.id) {
    throw resultError(`assertions[${index}].id does not match the requested assertion.`, {
      id,
      expectedId: expectedAssertion.id,
    });
  }
  if (expectedAssertion && raw.kind !== expectedAssertion.kind) {
    throw resultError(`assertions[${index}].kind does not match the requested assertion.`, {
      kind: raw.kind,
      expectedKind: expectedAssertion.kind,
    });
  }
  if (!BROWSER_VERIFICATION_ASSERTION_STATUSES.includes(raw.status)) {
    throw resultError(`assertions[${index}].status must be a supported assertion status.`, {
      status: raw.status,
    });
  }
  const normalized = { id, status: raw.status };
  if (raw.actual !== undefined && raw.actual !== null) {
    normalized.actual = toPortable(
      `assertions[${index}].actual`,
      raw.actual,
      BROWSER_VERIFICATION_LIMITS.maxActualChars,
    );
  }
  if (raw.snapshot !== undefined && raw.snapshot !== null) {
    normalized.snapshot = toPortable(
      `assertions[${index}].snapshot`,
      raw.snapshot,
      BROWSER_VERIFICATION_LIMITS.maxSnapshotChars,
    );
  }
  if (raw.message !== undefined && raw.message !== null) {
    normalized.message = toPortable(
      `assertions[${index}].message`,
      raw.message,
      BROWSER_VERIFICATION_LIMITS.maxDiagnosticChars,
    );
  }
  return deepFreeze(normalized);
}

function deriveStatus(assertions) {
  if (assertions.some((assertion) => assertion.status === "FAIL")) return "FAIL";
  if (assertions.some((assertion) => assertion.status === "BLOCKED")) return "BLOCKED";
  return "PASS";
}

/**
 * Normalize untrusted browser verification provider output.
 *
 * Fail-closed: invalid status, missing assertions, budget overflow,
 * authority overrides, or status inconsistent with assertions all throw
 * RESULT_INVALID (or OUTPUT_LIMIT for budget overflow).
 */
export function normalizeBrowserVerificationResult(raw, { provider, verificationId, expectedAssertions } = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw resultError("browser verification result must be an object.", { result: raw });
  }
  rejectAuthorityOverrides(raw);

  let serialized = "";
  try {
    serialized = JSON.stringify(raw) ?? "";
  } catch {
    throw resultError("browser verification result must be JSON-serializable.", {});
  }
  if (serialized.length > BROWSER_VERIFICATION_LIMITS.maxResultChars) {
    throw limitError(
      `browser verification result exceeds the ${BROWSER_VERIFICATION_LIMITS.maxResultChars}-character limit.`,
      { chars: serialized.length },
    );
  }

  if (!BROWSER_VERIFICATION_RESULT_STATUSES.includes(raw.status)) {
    throw resultError("browser verification result status must be a supported result status.", {
      status: raw.status,
    });
  }
  if (!Array.isArray(raw.assertions) || raw.assertions.length === 0) {
    throw resultError("browser verification result assertions must be a non-empty array.", {
      assertions: raw.assertions,
    });
  }
  if (raw.assertions.length > BROWSER_VERIFICATION_LIMITS.maxAssertions) {
    throw limitError(
      `browser verification result exceeds the ${BROWSER_VERIFICATION_LIMITS.maxAssertions}-assertion limit.`,
      { count: raw.assertions.length },
    );
  }
  const expected = Array.isArray(expectedAssertions) ? expectedAssertions : null;
  if (expected && raw.assertions.length !== expected.length) {
    throw resultError("browser verification result assertions must match the requested assertion set.", {
      expected: expected.length,
      actual: raw.assertions.length,
    });
  }
  const assertions = raw.assertions.map((assertion, index) =>
    normalizeAssertion(assertion, index, expected?.[index]),
  );
  const ids = assertions.map((assertion) => assertion.id);
  if (new Set(ids).size !== ids.length) {
    throw resultError("browser verification result assertions must not contain duplicate ids.", {});
  }

  const derived = deriveStatus(assertions);
  if (raw.status !== derived) {
    throw resultError(
      `browser verification result status ${raw.status} is inconsistent with assertions (${derived}).`,
      { status: raw.status, derived },
    );
  }

  let diagnostics = [];
  if (raw.diagnostics !== undefined && raw.diagnostics !== null) {
    if (!Array.isArray(raw.diagnostics)) {
      throw resultError("browser verification result diagnostics must be an array.", {
        diagnostics: raw.diagnostics,
      });
    }
    if (raw.diagnostics.length > BROWSER_VERIFICATION_LIMITS.maxDiagnostics) {
      throw limitError(
        `browser verification result exceeds the ${BROWSER_VERIFICATION_LIMITS.maxDiagnostics}-diagnostic limit.`,
        { count: raw.diagnostics.length },
      );
    }
    diagnostics = raw.diagnostics.map((entry, index) =>
      toPortable(
        `diagnostics[${index}]`,
        entry,
        BROWSER_VERIFICATION_LIMITS.maxDiagnosticChars,
      ),
    );
  }

  let artifacts = [];
  if (raw.artifacts !== undefined && raw.artifacts !== null) {
    if (!Array.isArray(raw.artifacts)) {
      throw resultError("browser verification result artifacts must be an array.", {
        artifacts: raw.artifacts,
      });
    }
    if (raw.artifacts.length > BROWSER_VERIFICATION_LIMITS.maxArtifacts) {
      throw limitError(
        `browser verification result exceeds the ${BROWSER_VERIFICATION_LIMITS.maxArtifacts}-artifact limit.`,
        { count: raw.artifacts.length },
      );
    }
    artifacts = raw.artifacts.map((entry, index) =>
      toPortable(
        `artifacts[${index}]`,
        entry,
        BROWSER_VERIFICATION_LIMITS.maxArtifactRefChars,
      ),
    );
  }

  const providerId =
    typeof provider === "string"
      ? provider
      : provider?.id;
  if (typeof providerId !== "string" || providerId.trim() === "") {
    throw resultError("browser verification result provider id is required.", { provider });
  }
  const providerVersion =
    typeof provider === "object" && provider !== null && typeof provider.version === "string"
      ? provider.version
      : null;
  const normalizedVerificationId =
    verificationId === undefined || verificationId === null
      ? toPortable("verificationId", raw.verificationId, BROWSER_VERIFICATION_LIMITS.maxVerificationIdChars)
      : toPortable("verificationId", verificationId, BROWSER_VERIFICATION_LIMITS.maxVerificationIdChars);

  const normalized = {
    verificationId: normalizedVerificationId,
    provider: deepFreeze(
      providerVersion === null ? { id: providerId } : { id: providerId, version: providerVersion },
    ),
    status: raw.status,
    assertions: Object.freeze([...assertions]),
    diagnostics: Object.freeze([...diagnostics]),
    artifacts: Object.freeze([...artifacts]),
    authority: BROWSER_VERIFICATION_TRUST.authority,
    evidenceAuthority: BROWSER_VERIFICATION_TRUST.evidenceAuthority,
    actionability: BROWSER_VERIFICATION_TRUST.actionability,
    trustRole: BROWSER_VERIFICATION_TRUST.trustRole,
    persisted: BROWSER_VERIFICATION_TRUST.persisted,
    lifecycleAuthority: BROWSER_VERIFICATION_TRUST.lifecycleAuthority,
    completionAuthority: BROWSER_VERIFICATION_TRUST.completionAuthority,
    evidenceRequiresForgeLoopValidation:
      BROWSER_VERIFICATION_TRUST.evidenceRequiresForgeLoopValidation,
  };
  try {
    assertPortableContextSafe(normalized, { label: "browser verification result" });
  } catch (error) {
    throw resultError(`browser verification result failed safety verification: ${error.message}`, {
      cause: error.message,
    });
  }
  return deepFreeze(normalized);
}
