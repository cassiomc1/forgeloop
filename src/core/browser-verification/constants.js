import {
  E_BROWSER_VERIFICATION_REQUEST_INVALID,
} from "../error-codes.js";

/**
 * Browser verification contract constants.
 *
 * Browser verification is an integration-only observation: bounded request
 * (origins, steps, assertions), untrusted provider output normalized under
 * strict budgets, constant trust fields, no clock reading, no network in
 * core.  Providers are host-injected through runtime context.
 */

export const BROWSER_VERIFICATION_LIMITS = Object.freeze({
  maxVerificationIdChars: 128,
  maxRequirementChars: 2000,
  maxAllowedOrigins: 8,
  maxSteps: 64,
  maxAssertions: 64,
  maxStepIdChars: 128,
  maxAssertionIdChars: 128,
  maxUrlChars: 2048,
  maxViewportWidth: 4096,
  maxViewportHeight: 4096,
  maxLocatorChars: 512,
  maxInputChars: 4096,
  maxAttributeChars: 128,
  maxExpectedChars: 4096,
  maxActualChars: 8192,
  maxSnapshotChars: 131072,
  maxDiagnosticChars: 4000,
  maxDiagnostics: 32,
  maxArtifacts: 16,
  maxArtifactRefChars: 1024,
  maxResultChars: 524288,
  maxNavigations: 128,
  maxSnapshots: 16,
  maxArtifactBytes: 50_000_000,
  defaultTimeoutMs: 30_000,
  maxTimeoutMs: 120_000,
});

export const BROWSER_VERIFICATION_STEP_KINDS = Object.freeze([
  "NAVIGATE",
  "CLICK",
  "FILL",
  "PRESS",
  "WAIT_FOR",
]);

export const BROWSER_VERIFICATION_ASSERTION_KINDS = Object.freeze([
  "VISIBLE",
  "HIDDEN",
  "TEXT_CONTAINS",
  "TEXT_EQUALS",
  "VALUE_EQUALS",
  "ATTRIBUTE_EQUALS",
  "URL_IS",
  "URL_PREFIX",
  "TITLE_EQUALS",
]);

export const BROWSER_VERIFICATION_ASSERTION_STATUSES = Object.freeze([
  "PASS",
  "FAIL",
  "BLOCKED",
]);

export const BROWSER_VERIFICATION_RESULT_STATUSES = Object.freeze([
  "PASS",
  "FAIL",
  "BLOCKED",
]);

export const BROWSER_VERIFICATION_LOCATOR_KINDS = Object.freeze([
  "ROLE",
  "LABEL",
  "TEXT",
  "CSS",
]);

export const BROWSER_VERIFICATION_WAIT_CONDITIONS = Object.freeze([
  "VISIBLE",
  "HIDDEN",
  "TEXT_CONTAINS",
  "URL_IS",
  "URL_PREFIX",
]);

export const BROWSER_VERIFICATION_CAPTURE_POLICIES = Object.freeze([
  "NEVER",
  "ON_FAILURE",
  "ALWAYS",
]);

export const BROWSER_VERIFICATION_TRUST = Object.freeze({
  authority: "OBSERVATION",
  evidenceAuthority: "NONE",
  actionability: "NON_EXECUTABLE",
  trustRole: "NON_EVIDENCE_BROWSER_VERIFICATION",
  persisted: false,
  lifecycleAuthority: false,
  completionAuthority: false,
  evidenceRequiresForgeLoopValidation: true,
});

export const BROWSER_VERIFICATION_RESULT_FIELDS = Object.freeze([
  "status", "assertions", "finalUrl", "navigations", "diagnostics", "snapshots", "artifacts",
]);

export const BROWSER_VERIFICATION_BLOCKED_RESULT_FIELDS = Object.freeze([
  "complete", "completed", "nextAction", "releaseClaims", "mutationAllowed", "taskPhase",
  "lifecycleState", "receipt", "evidence", "evidenceKind", "provenance", "authority",
  "lifecycleAuthority", "completionAuthority", "evidenceAuthority", "requiredForCompletion",
]);

function verificationError(message, details) {
  const error = new Error(message);
  error.code = E_BROWSER_VERIFICATION_REQUEST_INVALID;
  error.details = details ?? null;
  return error;
}

/**
 * Normalize explicit timeout input.  Valid finite values pass through;
 * oversized finite values clamp to max; missing/invalid values fall back
 * to default.  Non-finite values fail closed.
 */
export function normalizeBrowserVerificationRequestOptions(input) {
  const source = input ?? {};
  const candidate = source.timeoutMs;
  if (candidate === undefined || candidate === null) {
    return Object.freeze({ timeoutMs: BROWSER_VERIFICATION_LIMITS.defaultTimeoutMs });
  }
  if (typeof candidate !== "number" || !Number.isFinite(candidate)) {
    throw verificationError("Browser verification timeoutMs must be a finite number.", {
      timeoutMs: candidate,
    });
  }
  if (!Number.isInteger(candidate) || candidate <= 0) {
    throw verificationError("Browser verification timeoutMs must be a positive integer.", {
      timeoutMs: candidate,
    });
  }
  if (candidate > BROWSER_VERIFICATION_LIMITS.maxTimeoutMs) {
    return Object.freeze({ timeoutMs: BROWSER_VERIFICATION_LIMITS.maxTimeoutMs });
  }
  return Object.freeze({ timeoutMs: candidate });
}
