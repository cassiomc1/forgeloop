import { E_SECURITY_REVIEW_REQUEST_INVALID } from "../error-codes.js";

export const SECURITY_REVIEW_LIMITS = Object.freeze({
  maxProjectPathChars: 4096,
  maxTaskIdChars: 128,
  maxReviewIdChars: 128,
  maxRequirementChars: 2000,
  maxRequirements: 64,
  maxPaths: 128,
  maxPathChars: 512,
  maxCategories: 32,
  maxCategoryChars: 64,
  maxRevisionChars: 256,
  maxFindings: 256,
  maxFindingIdChars: 128,
  maxSeverityChars: 16,
  maxTitleChars: 512,
  maxSummaryChars: 4096,
  maxRuleIdChars: 128,
  maxConfidenceChars: 16,
  maxDiagnosticChars: 4000,
  maxDiagnostics: 64,
  maxResultChars: 524288,
  maxDurationMs: 86_400_000,
  defaultTimeoutMs: 30_000,
  maxTimeoutMs: 120_000,
});

export const SECURITY_REVIEW_SCOPES = Object.freeze(["FULL", "CHANGED", "SELECTED"]);
export const SECURITY_REVIEW_SEVERITIES = Object.freeze(["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"]);
export const SECURITY_REVIEW_CONFIDENCE = Object.freeze(["LOW", "MEDIUM", "HIGH"]);
export const SECURITY_REVIEW_CATEGORIES = Object.freeze([
  "DEPENDENCY", "SECRETS", "INJECTION", "AUTHENTICATION", "AUTHORIZATION",
  "CRYPTOGRAPHY", "CONFIGURATION", "NETWORK", "FILESYSTEM", "SUPPLY_CHAIN",
  "UNSAFE_EXECUTION", "OTHER",
]);

export const SECURITY_REVIEW_TRUST = Object.freeze({
  authority: "OBSERVATION",
  evidenceAuthority: "NONE",
  actionability: "NON_EXECUTABLE",
  trustRole: "NON_EVIDENCE_SECURITY_REVIEW",
  persisted: false,
  lifecycleAuthority: false,
  completionAuthority: false,
  evidenceRequiresForgeLoopValidation: true,
});

export const SECURITY_REVIEW_BLOCKED_RESULT_FIELDS = Object.freeze([
  "complete", "completed", "nextAction", "releaseClaims", "mutationAllowed", "taskPhase",
  "lifecycleState", "receipt", "evidence", "evidenceStatus", "check", "gate", "satisfied",
  "ownership", "writeClaims", "event", "events", "transaction", "installation", "command",
  "commandArgv", "executable", "shell", "environment", "credentials", "secrets",
]);

export function securityReviewRequestError(message, details = null) {
  const error = new Error(message);
  error.code = E_SECURITY_REVIEW_REQUEST_INVALID;
  error.details = details;
  return error;
}
