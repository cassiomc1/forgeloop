import { FAILURE_CODES } from "./protocol.js";
import {
  E_AUTHORITY_INVALID,
  E_AUTHORITY_SCOPE_MISMATCH,
  E_COMMAND_RESOLUTION_AMBIGUOUS,
  E_INSTALLATION_AUTHORITY_REQUIRED,
  E_VERIFICATION_TOOL_UNAVAILABLE,
} from "./verification-constants.js";
import {
  E_VERIFICATION_EXECUTION_INVALID,
  E_VERIFICATION_ISOLATION_UNAVAILABLE,
} from "./verification-execution.js";

export const E_REPOSITORY_INDEX_PLATFORM_UNSUPPORTED = "E_REPOSITORY_INDEX_PLATFORM_UNSUPPORTED";
export const E_REPOSITORY_INDEX_ENGINE_MISSING = "E_REPOSITORY_INDEX_ENGINE_MISSING";
export const E_REPOSITORY_INDEX_ENGINE_DOWNLOAD_FAILED = "E_REPOSITORY_INDEX_ENGINE_DOWNLOAD_FAILED";
export const E_REPOSITORY_INDEX_ENGINE_CHECKSUM_MISMATCH = "E_REPOSITORY_INDEX_ENGINE_CHECKSUM_MISMATCH";
export const E_REPOSITORY_INDEX_ENGINE_EXTRACTION_FAILED = "E_REPOSITORY_INDEX_ENGINE_EXTRACTION_FAILED";
export const E_REPOSITORY_INDEX_ENGINE_VERSION_MISMATCH = "E_REPOSITORY_INDEX_ENGINE_VERSION_MISMATCH";
export const E_REPOSITORY_INDEX_ENGINE_EXECUTION_FAILED = "E_REPOSITORY_INDEX_ENGINE_EXECUTION_FAILED";
export const E_REPOSITORY_INDEX_OUTPUT_LIMIT = "E_REPOSITORY_INDEX_OUTPUT_LIMIT";
export const E_REPOSITORY_INDEX_NOT_INITIALIZED = "E_REPOSITORY_INDEX_NOT_INITIALIZED";
export const E_REPOSITORY_INDEX_INDEXING = "E_REPOSITORY_INDEX_INDEXING";
export const E_REPOSITORY_INDEX_SERVER_START_FAILED = "E_REPOSITORY_INDEX_SERVER_START_FAILED";
export const E_REPOSITORY_INDEX_SERVER_STOP_FAILED = "E_REPOSITORY_INDEX_SERVER_STOP_FAILED";
export const E_REPOSITORY_INDEX_SERVER_UNHEALTHY = "E_REPOSITORY_INDEX_SERVER_UNHEALTHY";
export const E_REPOSITORY_INDEX_SEARCH_FAILED = "E_REPOSITORY_INDEX_SEARCH_FAILED";
export const E_REPOSITORY_INDEX_OUTPUT_INVALID = "E_REPOSITORY_INDEX_OUTPUT_INVALID";
export const E_REPOSITORY_INDEX_REBUILD_FAILED = "E_REPOSITORY_INDEX_REBUILD_FAILED";
export const E_REPOSITORY_INDEX_REQUEST_INVALID = "E_REPOSITORY_INDEX_REQUEST_INVALID";
export const E_REPOSITORY_INDEX_LOCK_UNSAFE = "E_REPOSITORY_INDEX_LOCK_UNSAFE";

export const E_TASK_REQUIRED = "E_TASK_REQUIRED";
export const E_TASK_NOT_FOUND = "E_TASK_NOT_FOUND";
export const E_TASK_ALREADY_EXISTS = "E_TASK_ALREADY_EXISTS";
export const E_TASK_COMPLETE = "E_TASK_COMPLETE";
export const E_TASK_AMBIGUOUS = "E_TASK_AMBIGUOUS";
export const E_TASK_SELECTOR_CONFLICT = "E_TASK_SELECTOR_CONFLICT";
export const E_TASK_DESCRIPTOR_INVALID = "E_TASK_DESCRIPTOR_INVALID";
export const E_TASK_KEY_MISMATCH = "E_TASK_KEY_MISMATCH";
export const E_TASK_CONTEXT_MISMATCH = "E_TASK_CONTEXT_MISMATCH";

export const E_TASK_LOCKED = "E_TASK_LOCKED";
export const E_TASK_LOCK_INVALID = "E_TASK_LOCK_INVALID";
export const E_PROJECT_CLAIMS_LOCK_INCONSISTENT = "E_PROJECT_CLAIMS_LOCK_INCONSISTENT";

export const E_TASK_SCOPE_REQUIRED = "E_TASK_SCOPE_REQUIRED";
export const E_TASK_SCOPE_CONFLICT = "E_TASK_SCOPE_CONFLICT";
export const E_TASK_SCOPE_DIRTY = "E_TASK_SCOPE_DIRTY";
export const E_TASK_SCOPE_FROZEN = "E_TASK_SCOPE_FROZEN";
export const E_TASK_CHANGE_OUTSIDE_SCOPE = "E_TASK_CHANGE_OUTSIDE_SCOPE";
export const E_TASK_CHANGE_ATTRIBUTION_UNAVAILABLE = "E_TASK_CHANGE_ATTRIBUTION_UNAVAILABLE";

export const E_WORKSPACE_IDENTITY_UNAVAILABLE = "E_WORKSPACE_IDENTITY_UNAVAILABLE";
export const E_WORKSPACE_BINDING_INVALID = "E_WORKSPACE_BINDING_INVALID";
export const E_WORKSPACE_BINDING_MISMATCH = "E_WORKSPACE_BINDING_MISMATCH";
export const E_HANDOFF_INVALID = "E_HANDOFF_INVALID";
export const E_HANDOFF_STATE_UNAVAILABLE = "E_HANDOFF_STATE_UNAVAILABLE";
export const E_HANDOFF_TAMPERED = "E_HANDOFF_TAMPERED";
export const E_HANDOFF_NOT_FOUND = "E_HANDOFF_NOT_FOUND";
export const E_RESPONSIBILITY_INVALID = "E_RESPONSIBILITY_INVALID";
export const E_RESPONSIBILITY_SCOPE_VIOLATION = "E_RESPONSIBILITY_SCOPE_VIOLATION";
export const E_RESPONSIBILITY_FROZEN_INPUT_DRIFT = "E_RESPONSIBILITY_FROZEN_INPUT_DRIFT";
export const E_RESPONSIBILITY_REQUIRED_CHECK_MISSING = "E_RESPONSIBILITY_REQUIRED_CHECK_MISSING";
export const E_VERIFICATION_SCOPE_INVALID = "E_VERIFICATION_SCOPE_INVALID";
export const E_VERIFICATION_SCOPE_STALE = "E_VERIFICATION_SCOPE_STALE";
export const E_VERIFICATION_SCOPE_UNRESOLVED = "E_VERIFICATION_SCOPE_UNRESOLVED";
export const E_REVISION_PROVIDER_UNAVAILABLE = "E_REVISION_PROVIDER_UNAVAILABLE";
export const E_REVISION_PROVIDER_AMBIGUOUS = "E_REVISION_PROVIDER_AMBIGUOUS";
export const E_REVISION_PROVIDER_INVALID = "E_REVISION_PROVIDER_INVALID";
export const E_REVISION_NOT_FOUND = "E_REVISION_NOT_FOUND";
export const E_REVISION_CONTENT_UNAVAILABLE = "E_REVISION_CONTENT_UNAVAILABLE";
export const E_ATTESTATION_DISABLED = "E_ATTESTATION_DISABLED";
export const E_ATTESTATION_GIT_REQUIRED = "E_ATTESTATION_GIT_REQUIRED";
export const E_ATTESTATION_MANIFEST_MISSING = "E_ATTESTATION_MANIFEST_MISSING";
export const E_ATTESTATION_MANIFEST_INVALID = "E_ATTESTATION_MANIFEST_INVALID";
export const E_ATTESTATION_MANIFEST_STALE = "E_ATTESTATION_MANIFEST_STALE";
export const E_ATTESTATION_CONTENT_MISMATCH = "E_ATTESTATION_CONTENT_MISMATCH";
export const E_ATTESTATION_SCOPE_MISMATCH = "E_ATTESTATION_SCOPE_MISMATCH";
export const E_ATTESTATION_COVERAGE_GAP = "E_ATTESTATION_COVERAGE_GAP";
export const E_ATTESTATION_COVERAGE_CONFLICT = "E_ATTESTATION_COVERAGE_CONFLICT";
export const E_ATTESTATION_STATEMENT_MISSING = "E_ATTESTATION_STATEMENT_MISSING";
export const E_ATTESTATION_STATEMENT_INVALID = "E_ATTESTATION_STATEMENT_INVALID";
export const E_ATTESTATION_SUBJECT_MISMATCH = "E_ATTESTATION_SUBJECT_MISMATCH";
export const E_ATTESTATION_RECEIPT_MISMATCH = "E_ATTESTATION_RECEIPT_MISMATCH";
export const E_ATTESTATION_STATE_MISMATCH = "E_ATTESTATION_STATE_MISMATCH";
export const E_ATTESTATION_ROUTE_MISMATCH = "E_ATTESTATION_ROUTE_MISMATCH";
export const E_ATTESTATION_CONTRACT_MISMATCH = "E_ATTESTATION_CONTRACT_MISMATCH";
export const E_ATTESTATION_LEDGER_MISMATCH = "E_ATTESTATION_LEDGER_MISMATCH";
export const E_ATTESTATION_UNSIGNED = "E_ATTESTATION_UNSIGNED";
export const E_ATTESTATION_SIGNATURE_INVALID = "E_ATTESTATION_SIGNATURE_INVALID";
export const E_ATTESTATION_SIGNER_UNAVAILABLE = "E_ATTESTATION_SIGNER_UNAVAILABLE";
export const E_ATTESTATION_IDENTITY_UNTRUSTED = "E_ATTESTATION_IDENTITY_UNTRUSTED";
export const E_ATTESTATION_ISSUER_UNTRUSTED = "E_ATTESTATION_ISSUER_UNTRUSTED";
export const E_ATTESTATION_TARGET_REF_INVALID = "E_ATTESTATION_TARGET_REF_INVALID";
export const E_ATTESTATION_INVALID = "E_ATTESTATION_INVALID";
export const E_ATTESTATION_CONFIGURATION_INVALID = "E_ATTESTATION_CONFIGURATION_INVALID";
export const E_CLI_INVOCATION_INVALID = "E_CLI_INVOCATION_INVALID";
export const E_EXECUTION_PROFILE_INVALID = "E_EXECUTION_PROFILE_INVALID";
export const E_EXECUTION_PROFILE_INCONSISTENT = "E_EXECUTION_PROFILE_INCONSISTENT";
export const E_EXECUTION_PROFILE_SAFETY_FLOOR_INVALID = "E_EXECUTION_PROFILE_SAFETY_FLOOR_INVALID";
export const E_USAGE_INVALID = "E_USAGE_INVALID";
export const E_USAGE_SOURCE_INVALID = "E_USAGE_SOURCE_INVALID";
export const E_EFFICIENCY_BASELINE_INVALID = "E_EFFICIENCY_BASELINE_INVALID";
export const E_STRUCTURAL_QUALITY_CONFIGURATION_INVALID = "E_STRUCTURAL_QUALITY_CONFIGURATION_INVALID";
export const E_STRUCTURAL_QUALITY_PROVIDER_INVALID = "E_STRUCTURAL_QUALITY_PROVIDER_INVALID";
export const E_STRUCTURAL_QUALITY_PROVIDER_UNAVAILABLE = "E_STRUCTURAL_QUALITY_PROVIDER_UNAVAILABLE";
export const E_STRUCTURAL_QUALITY_PROVIDER_VERSION_UNSUPPORTED = "E_STRUCTURAL_QUALITY_PROVIDER_VERSION_UNSUPPORTED";
export const E_STRUCTURAL_QUALITY_PROVIDER_PROTOCOL_INVALID = "E_STRUCTURAL_QUALITY_PROVIDER_PROTOCOL_INVALID";
export const E_STRUCTURAL_QUALITY_PROVIDER_TOOL_CONTRACT_INVALID = "E_STRUCTURAL_QUALITY_PROVIDER_TOOL_CONTRACT_INVALID";
export const E_STRUCTURAL_QUALITY_SCAN_FAILED = "E_STRUCTURAL_QUALITY_SCAN_FAILED";
export const E_STRUCTURAL_QUALITY_TIMEOUT = "E_STRUCTURAL_QUALITY_TIMEOUT";
export const E_STRUCTURAL_QUALITY_OUTPUT_LIMIT = "E_STRUCTURAL_QUALITY_OUTPUT_LIMIT";
export const E_STRUCTURAL_QUALITY_BASELINE_MISSING = "E_STRUCTURAL_QUALITY_BASELINE_MISSING";
export const E_STRUCTURAL_QUALITY_BASELINE_EXISTS = "E_STRUCTURAL_QUALITY_BASELINE_EXISTS";
export const E_STRUCTURAL_QUALITY_BASELINE_PHASE_INVALID = "E_STRUCTURAL_QUALITY_BASELINE_PHASE_INVALID";
export const E_STRUCTURAL_QUALITY_BASELINE_BINDING_MISMATCH = "E_STRUCTURAL_QUALITY_BASELINE_BINDING_MISMATCH";
export const E_STRUCTURAL_QUALITY_EVALUATION_INCOMPARABLE = "E_STRUCTURAL_QUALITY_EVALUATION_INCOMPARABLE";
export const E_STRUCTURAL_QUALITY_MEASUREMENT_MODEL_MISMATCH = "E_STRUCTURAL_QUALITY_MEASUREMENT_MODEL_MISMATCH";
export const E_STRUCTURAL_QUALITY_EVIDENCE_STALE = "E_STRUCTURAL_QUALITY_EVIDENCE_STALE";
export const E_STRUCTURAL_QUALITY_SOURCE_DRIFT = "E_STRUCTURAL_QUALITY_SOURCE_DRIFT";
export const E_STRUCTURAL_QUALITY_SOURCE_FINGERPRINT_UNAVAILABLE = "E_STRUCTURAL_QUALITY_SOURCE_FINGERPRINT_UNAVAILABLE";
export const E_STRUCTURAL_QUALITY_OBSERVATION_EPOCH_STALE = "E_STRUCTURAL_QUALITY_OBSERVATION_EPOCH_STALE";
export const E_STRUCTURAL_QUALITY_PROJECTION_INCOMPLETE = "E_STRUCTURAL_QUALITY_PROJECTION_INCOMPLETE";
export const E_STRUCTURAL_QUALITY_REGRESSION = "E_STRUCTURAL_QUALITY_REGRESSION";

export const E_ADVISORY_CONTEXT_PROVIDER_INVALID = "E_ADVISORY_CONTEXT_PROVIDER_INVALID";
export const E_ADVISORY_CONTEXT_PROVIDER_UNAVAILABLE = "E_ADVISORY_CONTEXT_PROVIDER_UNAVAILABLE";
export const E_ADVISORY_CONTEXT_QUERY_INVALID = "E_ADVISORY_CONTEXT_QUERY_INVALID";
export const E_ADVISORY_CONTEXT_REQUEST_INVALID = "E_ADVISORY_CONTEXT_REQUEST_INVALID";
export const E_ADVISORY_CONTEXT_RESULT_INVALID = "E_ADVISORY_CONTEXT_RESULT_INVALID";
export const E_ADVISORY_CONTEXT_TIMEOUT = "E_ADVISORY_CONTEXT_TIMEOUT";
export const E_ADVISORY_CONTEXT_OUTPUT_LIMIT = "E_ADVISORY_CONTEXT_OUTPUT_LIMIT";
export const E_PORTABLE_CONTEXT_INVALID = "E_PORTABLE_CONTEXT_INVALID";
export const E_HANDOFF_ACCEPTANCE_UNBOUND = "E_HANDOFF_ACCEPTANCE_UNBOUND";
export const E_HANDOFF_STALE = "E_HANDOFF_STALE";
export const E_HANDOFF_ALREADY_ACCEPTED = "E_HANDOFF_ALREADY_ACCEPTED";
export const E_HANDOFF_ACCEPTANCE_INCONSISTENT = "E_HANDOFF_ACCEPTANCE_INCONSISTENT";

const STRUCTURAL_QUALITY_ERROR_METADATA = Object.freeze(Object.fromEntries([
  [E_STRUCTURAL_QUALITY_CONFIGURATION_INVALID, "Correct structuralQuality mode, provider ID, budgets, floors, or optimization limits in .forgeloop/config.json."],
  [E_STRUCTURAL_QUALITY_PROVIDER_INVALID, "Use a provider implementing id, detect(input), and scan(input) with the documented normalized boundary."],
  [E_STRUCTURAL_QUALITY_PROVIDER_UNAVAILABLE, "Install or expose the requested provider outside ForgeLoop, or use observe mode and record the limitation; ForgeLoop never auto-installs it."],
  [E_STRUCTURAL_QUALITY_PROVIDER_VERSION_UNSUPPORTED, "Use a verified Sentrux version (0.5.5, 0.5.6, or 0.5.7), or select a compatible provider through trusted runtime context."],
  [E_STRUCTURAL_QUALITY_PROVIDER_PROTOCOL_INVALID, "Repair the provider MCP handshake or response shape; malformed external data cannot become evidence."],
  [E_STRUCTURAL_QUALITY_PROVIDER_TOOL_CONTRACT_INVALID, "Ensure the provider exposes the required scan and health tool argument schemas."],
  [E_STRUCTURAL_QUALITY_SCAN_FAILED, "Inspect the provider failure and rerun quality-baseline or quality-verify after the external analyzer is healthy."],
  [E_STRUCTURAL_QUALITY_TIMEOUT, "Use a responsive provider or a bounded timeout within the supported limit; never promote a timed-out scan."],
  [E_STRUCTURAL_QUALITY_OUTPUT_LIMIT, "Reduce provider output or diagnostics; the 2 MiB combined process-output limit is fail-closed."],
  [E_STRUCTURAL_QUALITY_BASELINE_MISSING, "Run forgeloop quality-baseline --task <id> after PLANNED and before EXECUTING."],
  [E_STRUCTURAL_QUALITY_BASELINE_EXISTS, "Use the existing immutable baseline or request --replace while the task is still before EXECUTING."],
  [E_STRUCTURAL_QUALITY_BASELINE_PHASE_INVALID, "Baseline replacement is forbidden after EXECUTING; repair the current task against its original baseline."],
  [E_STRUCTURAL_QUALITY_BASELINE_BINDING_MISMATCH, "Reconcile contract, route, policy, scope, provider, or rules drift before using the baseline."],
  [E_STRUCTURAL_QUALITY_EVALUATION_INCOMPARABLE, "Restore the baseline provider/version/rules/policy/scope bindings and rerun quality-verify."],
  [E_STRUCTURAL_QUALITY_MEASUREMENT_MODEL_MISMATCH, "Use a compatible measurement model and provider across baseline and evaluation observations."],
  [E_STRUCTURAL_QUALITY_EVIDENCE_STALE, "Rerun quality-verify in the active verification cycle and refresh completion through the canonical receipt pipeline."],
  [E_STRUCTURAL_QUALITY_SOURCE_DRIFT, "Ensure the worktree is not mutated during provider observation and rerun quality-baseline or quality-verify."],
  [E_STRUCTURAL_QUALITY_SOURCE_FINGERPRINT_UNAVAILABLE, "Repair unreadable or unsafe source material before structural-quality evidence can be trusted."],
  [E_STRUCTURAL_QUALITY_OBSERVATION_EPOCH_STALE, "Rerun quality-verify under the active task epoch without concurrent state mutations."],
  [E_STRUCTURAL_QUALITY_PROJECTION_INCOMPLETE, "Rerun quality-verify to reconcile and project the canonical check from the existing evaluation artifact."],
  [E_STRUCTURAL_QUALITY_REGRESSION, "Use the bottleneck and root-cause deltas to record an evidence-backed diagnosis, correct within scope, and verify a new cycle."],
].map(([code, safeResolution]) => [code, Object.freeze({
  code,
  category: "structural-quality",
  classification: "PUBLIC_STABLE",
  meaning: "Structural-quality evidence did not satisfy its provider, artifact, comparison, or lifecycle boundary.",
  safeResolution,
})])));

const EXTENSION_PUBLIC_ERROR_CODES = Object.freeze(Object.fromEntries([
  E_WORKSPACE_IDENTITY_UNAVAILABLE,
  E_WORKSPACE_BINDING_INVALID,
  E_WORKSPACE_BINDING_MISMATCH,
  E_HANDOFF_INVALID,
  E_HANDOFF_STATE_UNAVAILABLE,
  E_HANDOFF_TAMPERED,
  E_HANDOFF_NOT_FOUND,
  E_RESPONSIBILITY_INVALID,
  E_RESPONSIBILITY_SCOPE_VIOLATION,
  E_RESPONSIBILITY_FROZEN_INPUT_DRIFT,
  E_RESPONSIBILITY_REQUIRED_CHECK_MISSING,
  E_VERIFICATION_SCOPE_INVALID,
  E_VERIFICATION_SCOPE_STALE,
  E_VERIFICATION_SCOPE_UNRESOLVED,
  E_REVISION_PROVIDER_UNAVAILABLE,
  E_REVISION_PROVIDER_AMBIGUOUS,
  E_REVISION_PROVIDER_INVALID,
  E_REVISION_NOT_FOUND,
  E_REVISION_CONTENT_UNAVAILABLE,
  E_ATTESTATION_DISABLED,
  E_ATTESTATION_GIT_REQUIRED,
  E_ATTESTATION_MANIFEST_MISSING,
  E_ATTESTATION_MANIFEST_INVALID,
  E_ATTESTATION_MANIFEST_STALE,
  E_ATTESTATION_CONTENT_MISMATCH,
  E_ATTESTATION_SCOPE_MISMATCH,
  E_ATTESTATION_COVERAGE_GAP,
  E_ATTESTATION_COVERAGE_CONFLICT,
  E_ATTESTATION_STATEMENT_MISSING,
  E_ATTESTATION_STATEMENT_INVALID,
  E_ATTESTATION_SUBJECT_MISMATCH,
  E_ATTESTATION_RECEIPT_MISMATCH,
  E_ATTESTATION_STATE_MISMATCH,
  E_ATTESTATION_ROUTE_MISMATCH,
  E_ATTESTATION_CONTRACT_MISMATCH,
  E_ATTESTATION_LEDGER_MISMATCH,
  E_ATTESTATION_UNSIGNED,
  E_ATTESTATION_SIGNATURE_INVALID,
  E_ATTESTATION_SIGNER_UNAVAILABLE,
  E_ATTESTATION_IDENTITY_UNTRUSTED,
  E_ATTESTATION_ISSUER_UNTRUSTED,
  E_ATTESTATION_TARGET_REF_INVALID,
  E_ATTESTATION_INVALID,
  E_ATTESTATION_CONFIGURATION_INVALID,
  E_CLI_INVOCATION_INVALID,
  E_EXECUTION_PROFILE_INVALID,
  E_EXECUTION_PROFILE_INCONSISTENT,
  E_EXECUTION_PROFILE_SAFETY_FLOOR_INVALID,
  E_USAGE_INVALID,
  E_USAGE_SOURCE_INVALID,
  E_EFFICIENCY_BASELINE_INVALID,
].map((code) => [code, Object.freeze({
  code,
  category: code.slice(2).split("_")[0].toLowerCase(),
  classification: "PUBLIC_STABLE",
  meaning: "A ForgeLoop boundary, artifact, provider, or attestation validation condition was not satisfied.",
  safeResolution: "Inspect the structured command result, correct the named boundary or artifact, then retry the canonical command.",
})])));

export const E_TASK_LAYOUT_LEGACY = "E_TASK_LAYOUT_LEGACY";
export const E_TASK_MIGRATION_INVALID = "E_TASK_MIGRATION_INVALID";
export const E_TASK_RECOVERY_UNSAFE = "E_TASK_RECOVERY_UNSAFE";
export const E_TASK_RECOVERY_INCONSISTENT = "E_TASK_RECOVERY_INCONSISTENT";
export const E_LEGACY_RECOVERY_MIGRATION_INVALID = "E_LEGACY_RECOVERY_MIGRATION_INVALID";
export const E_COMPLETION_OWNERSHIP_UNPROVEN = "E_COMPLETION_OWNERSHIP_UNPROVEN";
export const E_TASK_CLAIM_OWNERSHIP_INCONSISTENT = "E_TASK_CLAIM_OWNERSHIP_INCONSISTENT";
export const E_TASK_RECOVERY_AUTHORIZATION_REQUIRED = "E_TASK_RECOVERY_AUTHORIZATION_REQUIRED";
export const E_TASK_RECOVERY_AUTHORITY_INVALID = "E_TASK_RECOVERY_AUTHORITY_INVALID";
export const E_TASK_RECOVERED = "E_TASK_RECOVERED";
export const E_TASK_NOT_RECOVERED = "E_TASK_NOT_RECOVERED";
export const E_TASK_RECOVERY_OFFICIAL_PATH_AVAILABLE = "E_TASK_RECOVERY_OFFICIAL_PATH_AVAILABLE";
export const E_TASK_ALREADY_RECOVERED = "E_TASK_ALREADY_RECOVERED";
export const E_TASK_MIGRATION_IDENTITY_MISMATCH = "E_TASK_MIGRATION_IDENTITY_MISMATCH";
export const E_PROTOCOL_MIGRATION_TARGET_UNSUPPORTED = "E_PROTOCOL_MIGRATION_TARGET_UNSUPPORTED";

export const E_DIAGNOSIS_REQUIRED = "E_DIAGNOSIS_REQUIRED";
export const E_DIAGNOSIS_INVALID = "E_DIAGNOSIS_INVALID";
export const E_DIAGNOSIS_EVIDENCE_INVALID = "E_DIAGNOSIS_EVIDENCE_INVALID";
export const E_DIAGNOSIS_CYCLE_MISMATCH = "E_DIAGNOSIS_CYCLE_MISMATCH";
export const E_DIAGNOSIS_NO_NEW_INFORMATION = "E_DIAGNOSIS_NO_NEW_INFORMATION";
export const E_PROGRESS_STALLED = "E_PROGRESS_STALLED";
export const E_DIAGNOSTIC_CASE_INVALID = "E_DIAGNOSTIC_CASE_INVALID";
export const E_DIAGNOSTIC_CASE_CYCLE_MISMATCH = "E_DIAGNOSTIC_CASE_CYCLE_MISMATCH";
export const E_DIAGNOSTIC_CASE_EVIDENCE_INVALID = "E_DIAGNOSTIC_CASE_EVIDENCE_INVALID";
export const E_OBSERVATION_INVALID = "E_OBSERVATION_INVALID";
export const E_CONTRIBUTOR_INVALID = "E_CONTRIBUTOR_INVALID";
export const E_CONTRIBUTOR_REFERENCE_INVALID = "E_CONTRIBUTOR_REFERENCE_INVALID";
export const E_HYPOTHESIS_INVALID = "E_HYPOTHESIS_INVALID";
export const E_HYPOTHESIS_SETTLEMENT_MISSING = "E_HYPOTHESIS_SETTLEMENT_MISSING";
export const E_HYPOTHESIS_DISPOSITION_INVALID = "E_HYPOTHESIS_DISPOSITION_INVALID";
export const E_HYPOTHESIS_DISPOSITION_EVIDENCE_INVALID = "E_HYPOTHESIS_DISPOSITION_EVIDENCE_INVALID";
export const E_INTERVENTION_INVALID = "E_INTERVENTION_INVALID";
export const E_INTERVENTION_HYPOTHESIS_MISSING = "E_INTERVENTION_HYPOTHESIS_MISSING";
export const E_INTERVENTION_REFERENCE_INVALID = "E_INTERVENTION_REFERENCE_INVALID";
export const E_FAILURE_SIGNATURE_INVALID = "E_FAILURE_SIGNATURE_INVALID";
export const E_NO_INFORMATION_GAIN = "E_NO_INFORMATION_GAIN";
export const E_STRATEGY_OSCILLATION = "E_STRATEGY_OSCILLATION";
export const E_DECISION_CRITERION_INVALID = "E_DECISION_CRITERION_INVALID";
export const E_DECISION_NOT_UNRESOLVED = "E_DECISION_NOT_UNRESOLVED";

export const E_RECONCILE_NOT_STALE = "E_RECONCILE_NOT_STALE";
export const E_RECONCILE_PHASE_INVALID = "E_RECONCILE_PHASE_INVALID";
export const E_RECONCILE_UNSUPPORTED_DRIFT = "E_RECONCILE_UNSUPPORTED_DRIFT";
export const E_RECONCILE_LEDGER_INVALID = "E_RECONCILE_LEDGER_INVALID";
export const E_RECONCILE_REQUIREMENT_UNKNOWN = "E_RECONCILE_REQUIREMENT_UNKNOWN";
export const E_RECONCILE_EVIDENCE_FAILED = "E_RECONCILE_EVIDENCE_FAILED";
export const E_REPOSITORY_CHANGED = "E_REPOSITORY_CHANGED";
export const E_STATE_REVALIDATION_REQUIRED = "E_STATE_REVALIDATION_REQUIRED";

export const E_ACTION_INVALID = "E_ACTION_INVALID";
export const E_ACTION_NOT_FOUND = "E_ACTION_NOT_FOUND";
export const E_ACTION_STATE_MISMATCH = "E_ACTION_STATE_MISMATCH";
export const E_ACTION_IDEMPOTENCY_REQUIRED = "E_ACTION_IDEMPOTENCY_REQUIRED";
export const E_ACTION_IDEMPOTENCY_CONFLICT = "E_ACTION_IDEMPOTENCY_CONFLICT";
export const E_ACTION_CAPABILITY_UNKNOWN = "E_ACTION_CAPABILITY_UNKNOWN";
export const E_ACTION_CAPABILITY_DENIED = "E_ACTION_CAPABILITY_DENIED";
export const E_ACTION_AUTHORITY_REQUIRED = "E_ACTION_AUTHORITY_REQUIRED";
export const E_ACTION_APPROVAL_REQUIRED = "E_ACTION_APPROVAL_REQUIRED";
export const E_ACTION_APPROVAL_NOT_REQUIRED = "E_ACTION_APPROVAL_NOT_REQUIRED";
export const E_ACTION_COMMIT_UNKNOWN = "E_ACTION_COMMIT_UNKNOWN";
export const E_ACTION_RECONCILIATION_REQUIRED = "E_ACTION_RECONCILIATION_REQUIRED";
export const E_ACTION_EVIDENCE_INVALID = "E_ACTION_EVIDENCE_INVALID";
export const E_ACTION_AUTHORIZATION_INVALID = "E_ACTION_AUTHORIZATION_INVALID";
export const E_ACTION_VERIFICATION_REQUIRED = "E_ACTION_VERIFICATION_REQUIRED";
export const E_ACTION_VERIFICATION_INVALID = "E_ACTION_VERIFICATION_INVALID";
export const E_ACTION_POLICY_DRIFT = "E_ACTION_POLICY_DRIFT";
export const E_ACTION_POLICY_LOCK_REQUIRED = "E_ACTION_POLICY_LOCK_REQUIRED";
export const E_ACTION_RECONCILIATION_AUTHORITY_REQUIRED =
  "E_ACTION_RECONCILIATION_AUTHORITY_REQUIRED";
export const E_ACTION_RECONCILIATION_EVIDENCE_INVALID =
  "E_ACTION_RECONCILIATION_EVIDENCE_INVALID";
export const E_APPROVAL_INVALID = "E_APPROVAL_INVALID";
export const E_APPROVAL_STALE = "E_APPROVAL_STALE";
export const E_APPROVAL_ALREADY_RESOLVED = "E_APPROVAL_ALREADY_RESOLVED";
export const E_TRAJECTORY_SCENARIO_INVALID = "E_TRAJECTORY_SCENARIO_INVALID";
export const E_TRAJECTORY_REFERENCE_REQUIRED = "E_TRAJECTORY_REFERENCE_REQUIRED";

const ADVISORY_CONTEXT_AND_HANDOFF_ERROR_METADATA = Object.freeze(Object.fromEntries([
  [E_ADVISORY_CONTEXT_PROVIDER_INVALID, Object.freeze({
    code: E_ADVISORY_CONTEXT_PROVIDER_INVALID,
    category: "advisory-context",
    classification: "PUBLIC_STABLE",
    meaning: "Advisory context provider configuration or interface implementation is invalid.",
    safeResolution: "Use a provider implementing id, recall(input) with bounded query parameters; advisory context is optional.",
  })],
  [E_ADVISORY_CONTEXT_PROVIDER_UNAVAILABLE, Object.freeze({
    code: E_ADVISORY_CONTEXT_PROVIDER_UNAVAILABLE,
    category: "advisory-context",
    classification: "PUBLIC_STABLE",
    meaning: "Requested advisory context provider is not registered in runtime context.",
    safeResolution: "Register the provider in runtime context before recall, or proceed without advisory context; provider failure never blocks canonical lifecycle.",
  })],
  [E_ADVISORY_CONTEXT_QUERY_INVALID, Object.freeze({
    code: E_ADVISORY_CONTEXT_QUERY_INVALID,
    category: "advisory-context",
    classification: "PUBLIC_STABLE",
    meaning: "Advisory context query failed portable-context validation or exceeded budget.",
    safeResolution: "Provide a bounded query free of control characters and secret-like values.",
  })],
  [E_ADVISORY_CONTEXT_REQUEST_INVALID, Object.freeze({
    code: E_ADVISORY_CONTEXT_REQUEST_INVALID,
    category: "advisory-context",
    classification: "PUBLIC_STABLE",
    meaning: "Advisory context recall budgets are not finite integer values within the supported request contract.",
    safeResolution: "Provide finite integer limit, maxItemChars, maxTotalChars, and timeoutMs values; oversized valid values are clamped to documented maxima.",
  })],
  [E_ADVISORY_CONTEXT_RESULT_INVALID, Object.freeze({
    code: E_ADVISORY_CONTEXT_RESULT_INVALID,
    category: "advisory-context",
    classification: "PUBLIC_STABLE",
    meaning: "Advisory context provider returned an invalid result structure.",
    safeResolution: "Ensure provider returns items with string summary and optional title, sourceRef, observedAt, confidence.",
  })],
  [E_ADVISORY_CONTEXT_TIMEOUT, Object.freeze({
    code: E_ADVISORY_CONTEXT_TIMEOUT,
    category: "advisory-context",
    classification: "PUBLIC_STABLE",
    meaning: "Advisory context recall exceeded its execution timeout.",
    safeResolution: "Use a responsive provider or increase timeout within limits; advisory context is optional.",
  })],
  [E_ADVISORY_CONTEXT_OUTPUT_LIMIT, Object.freeze({
    code: E_ADVISORY_CONTEXT_OUTPUT_LIMIT,
    category: "advisory-context",
    classification: "PUBLIC_STABLE",
    meaning: "Advisory context output exceeded the configured character or item limit.",
    safeResolution: "Reduce query scope, limit items, or truncate oversized summaries at the provider.",
  })],
  [E_PORTABLE_CONTEXT_INVALID, Object.freeze({
    code: E_PORTABLE_CONTEXT_INVALID,
    category: "portable-context",
    classification: "PUBLIC_STABLE",
    meaning: "Text or object failed portable-context safety, character, or secret limits.",
    safeResolution: "Ensure text is bounded, contains no control characters, and contains no secret-like values.",
  })],
  [E_HANDOFF_ACCEPTANCE_UNBOUND, Object.freeze({
    code: E_HANDOFF_ACCEPTANCE_UNBOUND,
    category: "handoff",
    classification: "PUBLIC_STABLE",
    meaning: "Handoff snapshot lacks required workStateFingerprint binding.",
    safeResolution: "Create a fresh handoff from the current ForgeLoop version before accepting it.",
  })],
  [E_HANDOFF_STALE, Object.freeze({
    code: E_HANDOFF_STALE,
    category: "handoff",
    classification: "PUBLIC_STABLE",
    meaning: "Handoff snapshot has drifted from the current canonical task state or repository.",
    safeResolution: "Create a new fresh handoff from the current task state instead of accepting a stale snapshot.",
  })],
  [E_HANDOFF_ALREADY_ACCEPTED, Object.freeze({
    code: E_HANDOFF_ALREADY_ACCEPTED,
    category: "handoff",
    classification: "PUBLIC_STABLE",
    meaning: "Handoff was already accepted by a different consumer.",
    safeResolution: "Create a new handoff for the new consumer; do not manually edit acceptance events.",
  })],
  [E_HANDOFF_ACCEPTANCE_INCONSISTENT, Object.freeze({
    code: E_HANDOFF_ACCEPTANCE_INCONSISTENT,
    category: "handoff",
    classification: "PUBLIC_STABLE",
    meaning: "Handoff acceptance disagrees with task event ledger history.",
    safeResolution: "Verify ledger integrity and require a preceding valid HANDOFF_CREATED event.",
  })],
]));

const REPOSITORY_INDEX_ERROR_METADATA = Object.freeze(Object.fromEntries([
  [E_REPOSITORY_INDEX_PLATFORM_UNSUPPORTED, [
    "The current operating-system and architecture pair has no pinned tgrep release asset.",
    "Use a supported platform or add a separately reviewed manifest asset; do not substitute a PATH executable.",
  ]],
  [E_REPOSITORY_INDEX_ENGINE_MISSING, [
    "The managed tgrep executable is absent, unreadable, or has not been provisioned.",
    "Run forgeloop index-setup or preload the exact manifest archive with --asset.",
  ]],
  [E_REPOSITORY_INDEX_ENGINE_DOWNLOAD_FAILED, [
    "The pinned tgrep release asset could not be downloaded or read.",
    "Retry with network access or preload the exact manifest archive; never bypass provisioning verification.",
  ]],
  [E_REPOSITORY_INDEX_ENGINE_CHECKSUM_MISMATCH, [
    "The tgrep archive or executable bytes do not match the pinned manifest SHA-256 digest.",
    "Obtain the exact manifest asset and retry; do not install a checksum mismatch.",
  ]],
  [E_REPOSITORY_INDEX_ENGINE_EXTRACTION_FAILED, [
    "The tgrep archive is malformed, unsafe, or could not be extracted to a temporary directory.",
    "Use the exact supported archive and retry; unsafe paths and links are rejected.",
  ]],
  [E_REPOSITORY_INDEX_ENGINE_VERSION_MISMATCH, [
    "The executable reports a version different from the ForgeLoop-pinned tgrep version.",
    "Provision the manifest-pinned tgrep release and retry; do not use an unpinned binary.",
  ]],
  [E_REPOSITORY_INDEX_ENGINE_EXECUTION_FAILED, [
    "A managed tgrep process could not be launched, completed, or stayed within its execution boundary.",
    "Inspect the structured error and index status, then retry with the verified managed engine.",
  ]],
  [E_REPOSITORY_INDEX_OUTPUT_LIMIT, [
    "Managed tgrep output exceeded ForgeLoop's bounded process-output limit.",
    "Narrow the search or resource policy and retry; oversized output is never promoted to a result.",
  ]],
  [E_REPOSITORY_INDEX_NOT_INITIALIZED, [
    "The repository index has no complete derived index available for the requested operation.",
    "Run forgeloop index-setup or forgeloop index-rebuild for the selected repository.",
  ]],
  [E_REPOSITORY_INDEX_INDEXING, [
    "The repository index is still being built or reconciled and is not ready for the requested operation.",
    "Wait for index-status to report READY, or use index-rebuild if the operation remains stuck.",
  ]],
  [E_REPOSITORY_INDEX_SERVER_START_FAILED, [
    "The ForgeLoop-owned tgrep watcher could not be started or did not become healthy.",
    "Run index-status, inspect the structured reason, and retry index-start or index-rebuild.",
  ]],
  [E_REPOSITORY_INDEX_SERVER_STOP_FAILED, [
    "The ForgeLoop-owned tgrep watcher could not be stopped or its ownership could not be proven.",
    "Use index-status and retry the canonical stop operation; never terminate processes by name or PID alone.",
  ]],
  [E_REPOSITORY_INDEX_SERVER_UNHEALTHY, [
    "Repository Index server, metadata, process identity, or index readiness validation failed.",
    "Run index-status, then use index-rebuild after resolving the reported boundary.",
  ]],
  [E_REPOSITORY_INDEX_SEARCH_FAILED, [
    "The native tgrep search failed with an execution or provider error; no-match is not an error.",
    "Inspect index-status and retry the query or rebuild the derived index; ForgeLoop does not fall back silently.",
  ]],
  [E_REPOSITORY_INDEX_OUTPUT_INVALID, [
    "Native tgrep output did not match the bounded provider-neutral JSON contract.",
    "Treat the result as unusable, inspect the engine, and rebuild or provision the pinned release.",
  ]],
  [E_REPOSITORY_INDEX_REBUILD_FAILED, [
    "The derived repository index could not be rebuilt successfully.",
    "Inspect the structured failure, resource policy, and repository paths, then retry index-rebuild.",
  ]],
  [E_REPOSITORY_INDEX_REQUEST_INVALID, [
    "Repository Index command input is outside the bounded provider-neutral request contract.",
    "Correct the pattern, path filters, context, or lifecycle options and retry the canonical command.",
  ]],
  [E_REPOSITORY_INDEX_LOCK_UNSAFE, [
    "A Repository Index operation lock is malformed, conflicting, or cannot be safely acquired.",
    "Wait for a concurrent operation to finish and retry; use status or rebuild for a persistent lock failure.",
  ]],
].map(([code, [meaning, safeResolution]]) => [code, Object.freeze({
  code,
  category: "repository-index",
  classification: "PUBLIC_STABLE",
  meaning,
  safeResolution,
})])));

/**
 * Public, stable ForgeLoop error and reason codes documented for users and harnesses.
 */
export const PUBLIC_ERROR_CODES = Object.freeze({
  ...EXTENSION_PUBLIC_ERROR_CODES,
  ...STRUCTURAL_QUALITY_ERROR_METADATA,
  ...ADVISORY_CONTEXT_AND_HANDOFF_ERROR_METADATA,
  ...REPOSITORY_INDEX_ERROR_METADATA,
  E_PREFLIGHT_NOT_READY: Object.freeze({
    code: "E_PREFLIGHT_NOT_READY",
    category: "preflight",
    classification: "PUBLIC_STABLE",
    meaning: "Preflight gates or contract validations are incomplete.",
    safeResolution: "Satisfy required gates and check preflight output.",
  }),
  E_CONTRACT_STALE: Object.freeze({
    code: "E_CONTRACT_STALE",
    category: "freshness",
    classification: "PUBLIC_STABLE",
    meaning: "Contract modified after downstream artifacts were generated.",
    safeResolution: "Re-run forgeloop route and forgeloop preflight.",
  }),
  E_ROUTE_STALE: Object.freeze({
    code: "E_ROUTE_STALE",
    category: "freshness",
    classification: "PUBLIC_STABLE",
    meaning: "Routing result does not match the active contract fingerprint.",
    safeResolution: "Re-run forgeloop route.",
  }),
  E_GATE_STALE: Object.freeze({
    code: "E_GATE_STALE",
    category: "freshness",
    classification: "PUBLIC_STABLE",
    meaning: "Referenced gate artifact changed after approval.",
    safeResolution: "Update artifact SHA-256 in gate file.",
  }),
  E_VERIFICATION_TOOL_UNAVAILABLE: Object.freeze({
    code: "E_VERIFICATION_TOOL_UNAVAILABLE",
    category: "capability",
    classification: "PUBLIC_STABLE",
    meaning: "Required verification executable is missing in environment.",
    safeResolution: "Use local equivalent, obtain host authority, or record NOT_VERIFIED.",
  }),
  E_VERIFICATION_ISOLATION_UNAVAILABLE: Object.freeze({
    code: "E_VERIFICATION_ISOLATION_UNAVAILABLE",
    category: "verification-isolation",
    classification: "PUBLIC_STABLE",
    meaning: "Verification cannot run because the required disposable or system isolation boundary is unavailable.",
    safeResolution: "Use a trusted ForgeLoop execution adapter with the required isolation mode; never run the check in the live project.",
  }),
  E_VERIFICATION_EXECUTION_INVALID: Object.freeze({
    code: "E_VERIFICATION_EXECUTION_INVALID",
    category: "verification-isolation",
    classification: "PUBLIC_STABLE",
    meaning: "The trusted verification execution adapter returned incomplete or invalid execution metadata.",
    safeResolution: "Repair the adapter contract and rerun verification; do not promote incomplete execution evidence.",
  }),
  E_INSTALLATION_AUTHORITY_REQUIRED: Object.freeze({
    code: "E_INSTALLATION_AUTHORITY_REQUIRED",
    category: "authority",
    classification: "PUBLIC_STABLE",
    meaning: "Attempted software installation without host authority grant.",
    safeResolution: "Use local non-installing binaries or request host authority grant.",
  }),
  E_AUTHORITY_INVALID: Object.freeze({
    code: "E_AUTHORITY_INVALID",
    category: "authority",
    classification: "PUBLIC_STABLE",
    meaning: "Authority grant file is malformed or expired.",
    safeResolution: "Obtain a valid authority grant from host operator.",
  }),
  E_AUTHORITY_SCOPE_MISMATCH: Object.freeze({
    code: "E_AUTHORITY_SCOPE_MISMATCH",
    category: "authority",
    classification: "PUBLIC_STABLE",
    meaning: "Authority grant does not cover the requested package.",
    safeResolution: "Request updated authority scope.",
  }),
  E_AUTHORITY_UNTRUSTED_SOURCE: Object.freeze({
    code: "E_AUTHORITY_UNTRUSTED_SOURCE",
    category: "authority",
    classification: "PUBLIC_STABLE",
    meaning: "Authority file placed inside untrusted project tree.",
    safeResolution: "Place authority file in host-managed trusted location.",
  }),
  E_EXECUTION_REF_INVALID: Object.freeze({
    code: "E_EXECUTION_REF_INVALID",
    category: "provenance",
    classification: "PUBLIC_STABLE",
    meaning: "Referenced execution ID does not exist.",
    safeResolution: "Re-run check via forgeloop run-check.",
  }),
  E_CHECK_INVALID: Object.freeze({
    code: "E_CHECK_INVALID",
    category: "verification",
    classification: "PUBLIC_STABLE",
    meaning: "Check structure or required parameters are invalid.",
    safeResolution: "Provide valid check ID, requirement, and parameters.",
  }),
  E_RECEIPT_STATE_MISMATCH: Object.freeze({
    code: "E_RECEIPT_STATE_MISMATCH",
    category: "verification",
    classification: "PUBLIC_STABLE",
    meaning: "Receipt does not match current state cycle or work state.",
    safeResolution: "Run forgeloop prepare-completion --json.",
  }),
  E_CONTINUITY_RECONCILIATION_REQUIRED: Object.freeze({
    code: "E_CONTINUITY_RECONCILIATION_REQUIRED",
    category: "continuity",
    classification: "PUBLIC_STABLE",
    meaning: "Continuity context has drifted from work state.",
    safeResolution: "Run forgeloop reconcile-continuity --json.",
  }),
  E_TASK_AMBIGUOUS: Object.freeze({
    code: "E_TASK_AMBIGUOUS",
    category: "task-resolution",
    classification: "PUBLIC_STABLE",
    meaning: "Multiple tasks exist in the project but no task selector was provided.",
    safeResolution: "Select a task explicitly using --task <id> or FORGELOOP_TASK=<id>.",
  }),
  E_TASK_COMPLETE: Object.freeze({
    code: "E_TASK_COMPLETE",
    category: "task-resolution",
    classification: "PUBLIC_STABLE",
    meaning: "A validator-backed COMPLETE task is terminal and cannot be mutated.",
    safeResolution: "Create or select a non-terminal task for further work; do not modify terminal task state.",
  }),
  E_TASK_LOCKED: Object.freeze({
    code: "E_TASK_LOCKED",
    category: "concurrency",
    classification: "PUBLIC_STABLE",
    meaning: "Task mutation is currently locked by another concurrent process or run-check.",
    safeResolution: "Wait for the active mutation to complete or inspect the lock with forgeloop task-show.",
  }),
  E_PROJECT_CLAIMS_LOCK_INCONSISTENT: Object.freeze({
    code: "E_PROJECT_CLAIMS_LOCK_INCONSISTENT",
    category: "concurrency",
    classification: "PUBLIC_STABLE",
    meaning: "The project-wide claim reservation lock has unknown, corrupt, or concurrently changed ownership metadata.",
    safeResolution: "Inspect .forgeloop/.claims.lock and retry only after its lease and owner identity can be validated; never force-delete unknown ownership.",
  }),
  E_TASK_SCOPE_CONFLICT: Object.freeze({
    code: "E_TASK_SCOPE_CONFLICT",
    category: "scope",
    classification: "PUBLIC_STABLE",
    meaning: "Task write claims overlap with another non-complete task in the same checkout.",
    safeResolution: "Inspect the conflicting task classification reported in error.conflicts, then reconcile or recover it through its reported official recovery commands before retrying task creation.",
  }),
  E_TASK_RECOVERY_UNSAFE: Object.freeze({
    code: "E_TASK_RECOVERY_UNSAFE",
    category: "recovery",
    classification: "PUBLIC_STABLE",
    meaning: "Claim-release recovery was refused because the conflicting task is active, inconsistent, already complete, or holds a live lease.",
    safeResolution: "Resolve the reported classification first; live leases must expire or be released by their owner before recovery.",
  }),
  E_TASK_RECOVERY_INCONSISTENT: Object.freeze({
    code: "E_TASK_RECOVERY_INCONSISTENT",
    category: "recovery",
    classification: "PUBLIC_STABLE",
    meaning: "Claim-release recovery was refused because the task state, recovery artifact, lock, or event ledger is inconsistent.",
    safeResolution: "Repair the underlying artifact through its dedicated recovery surface; do not force-complete an unreadable task.",
  }),
  E_LEGACY_RECOVERY_MIGRATION_INVALID: Object.freeze({
    code: "E_LEGACY_RECOVERY_MIGRATION_INVALID",
    category: "recovery",
    classification: "PUBLIC_STABLE",
    meaning: "The legacy recovery-event repair was refused because the ledger does not match the exact known legacy defect signature, has incompatible later activity, holds a live lock, or is otherwise ambiguous.",
    safeResolution: "Inspect the structured plan/errors; ambiguous or tampered ledgers stay INCONSISTENT and are never migrated.",
  }),
  E_COMPLETION_OWNERSHIP_UNPROVEN: Object.freeze({
    code: "E_COMPLETION_OWNERSHIP_UNPROVEN",
    category: "recovery",
    classification: "PUBLIC_STABLE",
    meaning: "Work-state claims COMPLETE but the canonical lifecycle/ledger completion proof is missing or invalid, so historical claims stay reserved.",
    safeResolution: "Restore the canonical completion event and a valid ledger, or re-run the official completion pipeline; phase=COMPLETE alone never releases claims.",
  }),
  E_TASK_CLAIM_OWNERSHIP_INCONSISTENT: Object.freeze({
    code: "E_TASK_CLAIM_OWNERSHIP_INCONSISTENT",
    category: "recovery",
    classification: "PUBLIC_STABLE",
    meaning: "ForgeLoop cannot prove whether a task still owns its historical write claims.",
    safeResolution: "Repair and validate the task descriptor, recovery artifact, and complete event ledger before acquiring overlapping claims or mutating the task.",
  }),
  E_TASK_RECOVERY_AUTHORIZATION_REQUIRED: Object.freeze({
    code: "E_TASK_RECOVERY_AUTHORIZATION_REQUIRED",
    category: "recovery",
    classification: "PUBLIC_STABLE",
    meaning: "task-recover requires explicit caller acknowledgement; this is not host-attested authority.",
    safeResolution: "Re-run with --acknowledge-recovery only when evidence shows the task is STALE or ABANDONED; --operator-authorized remains a deprecated alias.",
  }),
  E_TASK_RECOVERY_AUTHORITY_INVALID: Object.freeze({
    code: "E_TASK_RECOVERY_AUTHORITY_INVALID",
    category: "authority",
    classification: "PUBLIC_STABLE",
    meaning: "Recovery authority metadata is invalid or claims host attestation without a host-owned grant reference.",
    safeResolution: "Use caller acknowledgement, or provide a host-attested recovery grant through a trusted host integration.",
  }),
  E_TASK_RECOVERED: Object.freeze({
    code: "E_TASK_RECOVERED",
    category: "recovery",
    classification: "PUBLIC_STABLE",
    meaning: "The task released its write claims through recovery and ordinary mutation is suspended.",
    safeResolution: "Run forgeloop task-resume --task <id> to reacquire the released claims before mutating the task.",
  }),
  E_TASK_NOT_RECOVERED: Object.freeze({
    code: "E_TASK_NOT_RECOVERED",
    category: "recovery",
    classification: "PUBLIC_STABLE",
    meaning: "task-resume was requested for a task without active recovered state.",
    safeResolution: "Inspect the task with forgeloop task-show; task-resume is only valid while recovery.json is active.",
  }),
  E_TASK_RECOVERY_OFFICIAL_PATH_AVAILABLE: Object.freeze({
    code: "E_TASK_RECOVERY_OFFICIAL_PATH_AVAILABLE",
    category: "recovery",
    classification: "PUBLIC_STABLE",
    meaning: "Claim-release recovery was refused because canonical lifecycle reconciliation is available.",
    safeResolution: "Use forgeloop reconcile-closure and the normal verification/completion pipeline instead of task-recover.",
  }),
  E_TASK_ALREADY_RECOVERED: Object.freeze({
    code: "E_TASK_ALREADY_RECOVERED",
    category: "recovery",
    classification: "PUBLIC_STABLE",
    meaning: "The task already has active durable recovered state.",
    safeResolution: "Inspect the existing recovery metadata; use task-resume to reacquire claims or leave the task recovered.",
  }),
  E_TASK_SCOPE_DIRTY: Object.freeze({
    code: "E_TASK_SCOPE_DIRTY",
    category: "scope",
    classification: "PUBLIC_STABLE",
    meaning: "Claimed paths contain pre-existing uncommitted changes.",
    safeResolution: "Commit or stash changes in claimed paths before defining or adopting the scope.",
  }),
  E_TASK_CHANGE_OUTSIDE_SCOPE: Object.freeze({
    code: "E_TASK_CHANGE_OUTSIDE_SCOPE",
    category: "scope",
    classification: "PUBLIC_STABLE",
    meaning: "Modified paths in repository exceed the declared task write claims.",
    safeResolution: "Update write claims with forgeloop task-scope or revert out-of-scope modifications.",
  }),
  E_RECONCILE_NOT_STALE: Object.freeze({
    code: "E_RECONCILE_NOT_STALE",
    category: "lifecycle",
    classification: "PUBLIC_STABLE",
    meaning: "reconcile-closure was invoked for a work-state checkpoint that is already fresh.",
    safeResolution: "No reconciliation is required; continue the normal lifecycle.",
  }),
  E_RECONCILE_PHASE_INVALID: Object.freeze({
    code: "E_RECONCILE_PHASE_INVALID",
    category: "lifecycle",
    classification: "PUBLIC_STABLE",
    meaning: "reconcile-closure was invoked for a task that is not EXECUTING or VERIFYING.",
    safeResolution: "reconcile-closure supports EXECUTING or VERIFYING tasks whose objective is already satisfied.",
  }),
  E_RECONCILE_UNSUPPORTED_DRIFT: Object.freeze({
    code: "E_RECONCILE_UNSUPPORTED_DRIFT",
    category: "freshness",
    classification: "PUBLIC_STABLE",
    meaning: "Work-state drift includes kinds other than REPOSITORY_CHANGED (contract or required-artifact drift).",
    safeResolution: "Resolve contract or artifact drift through their dedicated recovery surfaces; reconcile-closure only refreshes repository fingerprint drift.",
  }),
  E_RECONCILE_LEDGER_INVALID: Object.freeze({
    code: "E_RECONCILE_LEDGER_INVALID",
    category: "integrity",
    classification: "PUBLIC_STABLE",
    meaning: "The append-only event ledger is not valid, so reconciliation cannot be recorded.",
    safeResolution: "Inspect the ledger errors and repair before reconciling.",
  }),
  E_RECONCILE_REQUIREMENT_UNKNOWN: Object.freeze({
    code: "E_RECONCILE_REQUIREMENT_UNKNOWN",
    category: "verification",
    classification: "PUBLIC_STABLE",
    meaning: "The supplied check id and requirement text do not exactly match a contract verification item of type VERIFICATION.",
    safeResolution: "Supply the exact id and requirement text of an existing contract verification item.",
  }),
  E_RECONCILE_EVIDENCE_FAILED: Object.freeze({
    code: "E_RECONCILE_EVIDENCE_FAILED",
    category: "verification",
    classification: "PUBLIC_STABLE",
    meaning: "The executed objective-satisfaction evidence command did not pass.",
    safeResolution: "Inspect the execution artifact; reconciliation is refused until evidence passes in the current repository.",
  }),
  E_REPOSITORY_CHANGED: Object.freeze({
    code: "E_REPOSITORY_CHANGED",
    category: "freshness",
    classification: "PUBLIC_STABLE",
    meaning: "The repository fingerprint (branch or HEAD) moved after the work-state checkpoint was recorded.",
    safeResolution: "If the task objective is already satisfied in the current repository, run forgeloop reconcile-closure; otherwise resume from a checkpoint that matches the current repository.",
  }),
  E_STATE_REVALIDATION_REQUIRED: Object.freeze({
    code: "E_STATE_REVALIDATION_REQUIRED",
    category: "freshness",
    classification: "PUBLIC_STABLE",
    meaning: "The work-state checkpoint must be revalidated before the lifecycle can continue.",
    safeResolution: "Run forgeloop reconcile-closure for externally satisfied EXECUTING tasks, or inspect the freshness reasons for other drift.",
  }),
  E_DIAGNOSIS_REQUIRED: Object.freeze({
    code: "E_DIAGNOSIS_REQUIRED",
    category: "diagnosis",
    classification: "PUBLIC_STABLE",
    meaning: "Current correction cycle has no append-only diagnosis record.",
    safeResolution: "Run forgeloop record-diagnosis with current failed evidence before correcting.",
  }),
  E_DIAGNOSIS_INVALID: Object.freeze({
    code: "E_DIAGNOSIS_INVALID",
    category: "diagnosis",
    classification: "PUBLIC_STABLE",
    meaning: "Diagnosis record details or parameters are malformed.",
    safeResolution: "Provide valid failureClass, hypothesis, evidenceRefs, settledBy, and nextSafeAction.",
  }),
  E_DIAGNOSIS_EVIDENCE_INVALID: Object.freeze({
    code: "E_DIAGNOSIS_EVIDENCE_INVALID",
    category: "diagnosis",
    classification: "PUBLIC_STABLE",
    meaning: "Referenced diagnosis evidence is missing or has no failed checks in the current cycle.",
    safeResolution: "Reference at least one failed or blocked check ID from the active verification cycle.",
  }),
  E_DIAGNOSIS_CYCLE_MISMATCH: Object.freeze({
    code: "E_DIAGNOSIS_CYCLE_MISMATCH",
    category: "diagnosis",
    classification: "PUBLIC_STABLE",
    meaning: "Diagnosis verification cycle does not match the active work state verification cycle.",
    safeResolution: "Record diagnosis for the current active verification cycle.",
  }),
  E_DIAGNOSIS_NO_NEW_INFORMATION: Object.freeze({
    code: "E_DIAGNOSIS_NO_NEW_INFORMATION",
    category: "diagnosis",
    classification: "PUBLIC_STABLE",
    meaning: "The proposed retry repeats the previous hypothesis with the same evidence.",
    safeResolution: "Change the hypothesis, collect independent evidence, or change strategy.",
  }),
  E_PROGRESS_STALLED: Object.freeze({
    code: "E_PROGRESS_STALLED",
    category: "progress",
    classification: "PUBLIC_STABLE",
    meaning: "Persisted correction history shows no new diagnostic information.",
    safeResolution: "Use an independent check, revisit assumptions, or record a materially different diagnosis.",
  }),
  E_DIAGNOSTIC_CASE_INVALID: Object.freeze({
    code: "E_DIAGNOSTIC_CASE_INVALID",
    category: "diagnosis",
    classification: "PUBLIC_STABLE",
    meaning: "Structured diagnostic case details or parameters are malformed.",
    safeResolution: "Provide valid observations, contributors, hypotheses with settlement criteria, and nextSafeAction.",
  }),
  E_DIAGNOSTIC_CASE_CYCLE_MISMATCH: Object.freeze({
    code: "E_DIAGNOSTIC_CASE_CYCLE_MISMATCH",
    category: "diagnosis",
    classification: "PUBLIC_STABLE",
    meaning: "Diagnostic case verification cycle does not match the active work state verification cycle.",
    safeResolution: "Record the diagnostic case for the current active verification cycle.",
  }),
  E_DIAGNOSTIC_CASE_EVIDENCE_INVALID: Object.freeze({
    code: "E_DIAGNOSTIC_CASE_EVIDENCE_INVALID",
    category: "diagnosis",
    classification: "PUBLIC_STABLE",
    meaning: "A diagnostic case evidence reference does not match any check from the active verification cycle.",
    safeResolution: "Reference check IDs recorded during the active verification cycle.",
  }),
  E_HYPOTHESIS_SETTLEMENT_MISSING: Object.freeze({
    code: "E_HYPOTHESIS_SETTLEMENT_MISSING",
    category: "diagnosis",
    classification: "PUBLIC_STABLE",
    meaning: "An open hypothesis lacks a falsifiable settlement condition.",
    safeResolution: "Provide a structured settledBy predicate, check status, or observation binding.",
  }),
  E_HYPOTHESIS_DISPOSITION_INVALID: Object.freeze({
    code: "E_HYPOTHESIS_DISPOSITION_INVALID",
    category: "diagnosis",
    classification: "PUBLIC_STABLE",
    meaning: "Hypothesis disposition is malformed or references an unknown hypothesis or disallowed transition.",
    safeResolution: "Record a disposition for a known hypothesis using an allowed status transition.",
  }),
  E_HYPOTHESIS_DISPOSITION_EVIDENCE_INVALID: Object.freeze({
    code: "E_HYPOTHESIS_DISPOSITION_EVIDENCE_INVALID",
    category: "diagnosis",
    classification: "PUBLIC_STABLE",
    meaning: "Hypothesis disposition evidence references do not resolve to checks of the active cycle.",
    safeResolution: "Reference at least one check ID recorded in the active verification cycle.",
  }),
  E_INTERVENTION_INVALID: Object.freeze({
    code: "E_INTERVENTION_INVALID",
    category: "diagnosis",
    classification: "PUBLIC_STABLE",
    meaning: "Intervention record is malformed.",
    safeResolution: "Provide id, kind, statement, and at least one bound hypothesisRef.",
  }),
  E_INTERVENTION_HYPOTHESIS_MISSING: Object.freeze({
    code: "E_INTERVENTION_HYPOTHESIS_MISSING",
    category: "diagnosis",
    classification: "PUBLIC_STABLE",
    meaning: "Intervention does not bind to any hypothesis.",
    safeResolution: "Bind the intervention to at least one recorded hypothesis.",
  }),
  E_INTERVENTION_REFERENCE_INVALID: Object.freeze({
    code: "E_INTERVENTION_REFERENCE_INVALID",
    category: "diagnosis",
    classification: "PUBLIC_STABLE",
    meaning: "Intervention references an unknown hypothesis.",
    safeResolution: "Record the diagnostic case containing the hypothesis before recording the intervention.",
  }),
  E_STRATEGY_OSCILLATION: Object.freeze({
    code: "E_STRATEGY_OSCILLATION",
    category: "progress",
    classification: "PUBLIC_STABLE",
    meaning: "Correction history oscillates between previously exhausted strategies without new information.",
    safeResolution: "Gather a genuinely new observation or test a materially different falsifiable hypothesis.",
  }),
  E_TRACE_SNAPSHOT_INCONSISTENT: Object.freeze({
    code: "E_TRACE_SNAPSHOT_INCONSISTENT",
    category: "diagnosis",
    classification: "PUBLIC_STABLE",
    meaning: "Task artifacts changed while the execution trace was being read.",
    safeResolution: "Rerun the read-only projection to obtain a consistent view.",
  }),
  E_DECISION_CRITERION_INVALID: Object.freeze({
    code: "E_DECISION_CRITERION_INVALID",
    category: "contract",
    classification: "PUBLIC_STABLE",
    meaning: "Decision settlement criterion details or parameters are malformed.",
    safeResolution: "Provide non-empty decision text and settledBy criterion.",
  }),
  E_DECISION_NOT_UNRESOLVED: Object.freeze({
    code: "E_DECISION_NOT_UNRESOLVED",
    category: "contract",
    classification: "PUBLIC_STABLE",
    meaning: "A settlement criterion referenced a decision not present in current unresolvedDecisions.",
    safeResolution: "Use the exact current unresolved decision text or update the contract first.",
  }),
  E_CHECK_INERT: Object.freeze({
    code: "E_CHECK_INERT",
    category: "policy",
    classification: "PUBLIC_STABLE",
    meaning: "An enabled check has no effective scope or target files.",
    safeResolution: "Provide an applicable target scope, configure matching files, or mark the rule unsupported.",
  }),
  E_CHECK_MUTATION_NOT_DETECTED: Object.freeze({
    code: "E_CHECK_MUTATION_NOT_DETECTED",
    category: "policy",
    classification: "PUBLIC_STABLE",
    meaning: "A blocking rule checker failed to detect an intentional mutation fixture.",
    safeResolution: "Fix checker logic to properly identify target violations.",
  }),
  E_POLICY_DRIFT: Object.freeze({
    code: "E_POLICY_DRIFT",
    category: "policy",
    classification: "PUBLIC_STABLE",
    meaning: "Active policy lock does not match the policy snapshot captured at task activation.",
    safeResolution: "Re-verify affected checks or restore original policy.",
  }),
  E_POLICY_WEAKENING: Object.freeze({
    code: "E_POLICY_WEAKENING",
    category: "policy",
    classification: "PUBLIC_STABLE",
    meaning: "Policy rules were weakened during task execution without explicit authority.",
    safeResolution: "Restore the original policy configuration.",
  }),
  E_POLICY_LOCK_INVALID: Object.freeze({
    code: "E_POLICY_LOCK_INVALID",
    category: "policy",
    classification: "PUBLIC_STABLE",
    meaning: "Policy lockfile is missing, malformed, or corrupt.",
    safeResolution: "Run forgeloop policy-status or regenerate policy.lock.",
  }),
  E_NEW_POLICY_VIOLATION: Object.freeze({
    code: "E_NEW_POLICY_VIOLATION",
    category: "policy",
    classification: "PUBLIC_STABLE",
    meaning: "New executable policy violation detected that is not present in brownfield baseline.",
    safeResolution: "Fix the violation before completing the task.",
  }),
  E_BASELINE_EXPANSION: Object.freeze({
    code: "E_BASELINE_EXPANSION",
    category: "policy",
    classification: "PUBLIC_STABLE",
    meaning: "Attempted unauthorized addition of new violations to brownfield baseline.",
    safeResolution: "Resolve new violations rather than expanding the baseline.",
  }),
  E_POLICY_PROOF_STALE: Object.freeze({
    code: "E_POLICY_PROOF_STALE",
    category: "policy",
    classification: "PUBLIC_STABLE",
    meaning: "Mutation verification proof is stale due to checker or fixture modifications.",
    safeResolution: "Re-run forgeloop rule-verify to refresh mutation proof.",
  }),
  E_CHECK_MUTATION_EXECUTION_ERROR: Object.freeze({
    code: "E_CHECK_MUTATION_EXECUTION_ERROR",
    category: "policy",
    classification: "PUBLIC_STABLE",
    meaning: "A policy checker threw an unhandled exception while evaluating its mutation fixture.",
    safeResolution: "Repair the checker execution path and rerun rule verification.",
  }),
  E_POLICY_EVALUATION_FAILED: Object.freeze({
    code: "E_POLICY_EVALUATION_FAILED",
    category: "policy",
    classification: "PUBLIC_STABLE",
    meaning: "Policy evaluation threw an unexpected error during execution.",
    safeResolution: "Inspect policy configuration and checker adapters for unhandled errors.",
  }),
  E_POLICY_INVALID: Object.freeze({
    code: "E_POLICY_INVALID",
    category: "policy",
    classification: "PUBLIC_STABLE",
    meaning: "Policy artifact is malformed, corrupt, or schema-invalid.",
    safeResolution: "Validate and repair rules.json, baseline.json, or discovery.json against schema.",
  }),
  E_POLICY_SNAPSHOT_WRITE_FAILED: Object.freeze({
    code: "E_POLICY_SNAPSHOT_WRITE_FAILED",
    category: "policy",
    classification: "PUBLIC_STABLE",
    meaning: "Failed to persist task policy snapshot during preflight.",
    safeResolution: "Ensure the target task directory is writable and repair filesystem permissions.",
  }),
  E_POLICY_LOCK_MISMATCH: Object.freeze({
    code: "E_POLICY_LOCK_MISMATCH",
    category: "policy",
    classification: "PUBLIC_STABLE",
    meaning: "Persisted policy lock digest does not match current effective policy state.",
    safeResolution: "Re-evaluate effective rules and update policy.lock or restore modified rules.",
  }),
  E_POLICY_DRIFT_UNKNOWN: Object.freeze({
    code: "E_POLICY_DRIFT_UNKNOWN",
    category: "policy",
    classification: "PUBLIC_STABLE",
    meaning: "Task policy drift was detected but baseline snapshot details are unavailable.",
    safeResolution: "Re-verify the task under the current policy state.",
  }),
  E_BASELINE_RECORD_DURING_ACTIVE_TASK: Object.freeze({
    code: "E_BASELINE_RECORD_DURING_ACTIVE_TASK",
    category: "policy",
    classification: "PUBLIC_STABLE",
    meaning: "Cannot re-record baseline during an active task with policy snapshot.",
    safeResolution: "Resolve new violations or use monotonic baseline --update.",
  }),
  E_POLICY_INITIALIZATION_FAILED: Object.freeze({
    code: "E_POLICY_INITIALIZATION_FAILED",
    category: "policy",
    classification: "PUBLIC_STABLE",
    meaning: "Executable policy bootstrap could not complete during initialization.",
    safeResolution: "Repair the reported filesystem/schema error and rerun `forgeloop init`. Initialization is restartable while no committed manifest exists.",
  }),
  E_INIT_KIT_CONFLICT: Object.freeze({
    code: "E_INIT_KIT_CONFLICT",
    category: "project-maintenance",
    classification: "PUBLIC_STABLE",
    meaning: "A canonical ForgeLoop kit destination already exists with content that does not match the shipped canonical template.",
    safeResolution: "Inspect the conflicting `.forgeloop/kit/...` file. If it is stale or partial ForgeLoop output, remove or restore it and rerun `forgeloop init`. Do not overwrite unknown content automatically.",
  }),
  E_ACTION_INVALID: Object.freeze({
    code: "E_ACTION_INVALID",
    category: "durable-action",
    classification: "PUBLIC_STABLE",
    meaning: "Durable action artifact or parameters are malformed or schema-invalid.",
    safeResolution: "Correct the action fields reported by the structured error, then retry through forgeloop action-propose or run-action.",
  }),
  E_ACTION_NOT_FOUND: Object.freeze({
    code: "E_ACTION_NOT_FOUND",
    category: "durable-action",
    classification: "PUBLIC_STABLE",
    meaning: "Referenced durable action ID does not exist for the task.",
    safeResolution: "List actions with forgeloop action-show or propose the action first.",
  }),
  E_ACTION_STATE_MISMATCH: Object.freeze({
    code: "E_ACTION_STATE_MISMATCH",
    category: "durable-action",
    classification: "PUBLIC_STABLE",
    meaning: "Requested durable action transition is not part of the canonical state machine.",
    safeResolution: "Inspect current action state with forgeloop action-show and use a legal transition; never edit action artifacts by hand.",
  }),
  E_ACTION_IDEMPOTENCY_REQUIRED: Object.freeze({
    code: "E_ACTION_IDEMPOTENCY_REQUIRED",
    category: "durable-action",
    classification: "PUBLIC_STABLE",
    meaning: "Side-effecting action class requires an idempotency key.",
    safeResolution: "Supply a stable --idempotency-key that identifies the logical external action.",
  }),
  E_ACTION_IDEMPOTENCY_CONFLICT: Object.freeze({
    code: "E_ACTION_IDEMPOTENCY_CONFLICT",
    category: "durable-action",
    classification: "PUBLIC_STABLE",
    meaning: "The idempotency key already binds to a different canonical action fingerprint in this task.",
    safeResolution: "Use a new idempotency key with a new actionId, or reuse the existing logical action unchanged; never relabel an executed effect.",
  }),
  E_ACTION_CAPABILITY_UNKNOWN: Object.freeze({
    code: "E_ACTION_CAPABILITY_UNKNOWN",
    category: "capability-policy",
    classification: "PUBLIC_STABLE",
    meaning: "Action capability is not part of the canonical capability vocabulary.",
    safeResolution: "Use a documented capability from forgeloop protocol-info; unknown capabilities fail closed.",
  }),
  E_ACTION_CAPABILITY_DENIED: Object.freeze({
    code: "E_ACTION_CAPABILITY_DENIED",
    category: "capability-policy",
    classification: "PUBLIC_STABLE",
    meaning: "Capability policy denies this capability.",
    safeResolution: "Obtain an operator policy change outside the task, or do not perform the action.",
  }),
  E_ACTION_AUTHORITY_REQUIRED: Object.freeze({
    code: "E_ACTION_AUTHORITY_REQUIRED",
    category: "authority",
    classification: "PUBLIC_STABLE",
    meaning: "Policy requires host-attested authority that was not supplied through a host trust boundary.",
    safeResolution: "Perform the action through a host integration that supplies trusted authority context; standalone CLI cannot mint it.",
  }),
  E_ACTION_APPROVAL_REQUIRED: Object.freeze({
    code: "E_ACTION_APPROVAL_REQUIRED",
    category: "durable-approval",
    classification: "PUBLIC_STABLE",
    meaning: "Policy requires a current fingerprint-bound approval before this action may proceed.",
    safeResolution: "Request approval with forgeloop approval-request and resolve it via forgeloop approval-resolve, then rerun the action.",
  }),
  E_ACTION_APPROVAL_NOT_REQUIRED: Object.freeze({
    code: "E_ACTION_APPROVAL_NOT_REQUIRED",
    category: "durable-approval",
    classification: "PUBLIC_STABLE",
    meaning: "The current capability policy allows the action without an approval artifact.",
    safeResolution: "Do not create an approval; authorize the action through the current policy path.",
  }),
  E_ACTION_COMMIT_UNKNOWN: Object.freeze({
    code: "E_ACTION_COMMIT_UNKNOWN",
    category: "durable-action",
    classification: "PUBLIC_STABLE",
    meaning: "External commit state of a started action cannot be proven.",
    safeResolution: "Do not retry; reconcile the observed external state with forgeloop action-reconcile.",
  }),
  E_ACTION_RECONCILIATION_REQUIRED: Object.freeze({
    code: "E_ACTION_RECONCILIATION_REQUIRED",
    category: "durable-action",
    classification: "PUBLIC_STABLE",
    meaning: "An action is COMMIT_UNKNOWN and blocks progress until explicitly reconciled.",
    safeResolution: "Observe the external system and run forgeloop action-reconcile --outcome COMMITTED|NOT_COMMITTED|UNKNOWN with evidence references.",
  }),
  E_ACTION_EVIDENCE_INVALID: Object.freeze({
    code: "E_ACTION_EVIDENCE_INVALID",
    category: "durable-action",
    classification: "PUBLIC_STABLE",
    meaning: "Evidence supplied for verification or reconciliation is missing, malformed, or unbounded.",
    safeResolution: "Supply bounded evidence references appropriate to the action type; do not paste raw external output into the ledger.",
  }),
  E_ACTION_AUTHORIZATION_INVALID: Object.freeze({
    code: "E_ACTION_AUTHORIZATION_INVALID",
    category: "durable-action",
    classification: "PUBLIC_STABLE",
    meaning: "Action authorization evidence is missing, incomplete, or was not produced by the canonical authorization service.",
    safeResolution: "Authorize the action through forgeloop run-action or a trusted embedding host; caller surfaces can never mint AUTHORIZED.",
  }),
  E_ACTION_VERIFICATION_REQUIRED: Object.freeze({
    code: "E_ACTION_VERIFICATION_REQUIRED",
    category: "durable-action",
    classification: "PUBLIC_STABLE",
    meaning: "The action cannot reach VERIFIED through this surface; canonical independent postcondition evidence is required.",
    safeResolution: "Run an independent verification check, then record it with forgeloop action-verify; exit code 0 alone is not verification.",
  }),
  E_ACTION_VERIFICATION_INVALID: Object.freeze({
    code: "E_ACTION_VERIFICATION_INVALID",
    category: "durable-action",
    classification: "PUBLIC_STABLE",
    meaning: "Verification evidence does not resolve to a canonical passed ForgeLoop artifact bound to this task and action.",
    safeResolution: "Supply a canonical execution or check reference produced by run-check for this task; arbitrary strings fail closed.",
  }),
  E_ACTION_POLICY_DRIFT: Object.freeze({
    code: "E_ACTION_POLICY_DRIFT",
    category: "capability-policy",
    classification: "PUBLIC_STABLE",
    meaning: "The current capability policy does not match the policy lock or task policy snapshot binding this task.",
    safeResolution: "Restore the policy epoch recorded at task activation or create a new valid lock and snapshot before side effects.",
  }),
  E_ACTION_POLICY_LOCK_REQUIRED: Object.freeze({
    code: "E_ACTION_POLICY_LOCK_REQUIRED",
    category: "capability-policy",
    classification: "PUBLIC_STABLE",
    meaning: "A capability policy is present but no valid policy lock exists to bind authorization identity.",
    safeResolution: "Record a valid policy lock (forgeloop baseline or policy-discover --write) before authorizing durable actions.",
  }),
  E_ACTION_RECONCILIATION_AUTHORITY_REQUIRED: Object.freeze({
    code: "E_ACTION_RECONCILIATION_AUTHORITY_REQUIRED",
    category: "durable-action",
    classification: "PUBLIC_STABLE",
    meaning: "Settling COMMIT_UNKNOWN external state requires trusted host attestation that was not supplied out-of-band.",
    safeResolution: "Reconcile through a trusted embedding host boundary; actor-supplied observations may only record UNKNOWN.",
  }),
  E_ACTION_RECONCILIATION_EVIDENCE_INVALID: Object.freeze({
    code: "E_ACTION_RECONCILIATION_EVIDENCE_INVALID",
    category: "durable-action",
    classification: "PUBLIC_STABLE",
    meaning: "Settling reconciliation requires at least one bounded evidence reference binding the observation to the action.",
    safeResolution: "Supply bounded external-state evidence references alongside trusted authority before settling ambiguity.",
  }),
  E_APPROVAL_INVALID: Object.freeze({
    code: "E_APPROVAL_INVALID",
    category: "durable-approval",
    classification: "PUBLIC_STABLE",
    meaning: "Approval artifact is malformed or does not bind the required fingerprint tuple.",
    safeResolution: "Request a new approval with forgeloop approval-request; never hand-edit approval artifacts.",
  }),
  E_APPROVAL_STALE: Object.freeze({
    code: "E_APPROVAL_STALE",
    category: "durable-approval",
    classification: "PUBLIC_STABLE",
    meaning: "Approval no longer matches the current action fingerprint, contract fingerprint, task revision, or capability.",
    safeResolution: "Request and resolve a fresh approval against the current action revision.",
  }),
  E_APPROVAL_ALREADY_RESOLVED: Object.freeze({
    code: "E_APPROVAL_ALREADY_RESOLVED",
    category: "durable-approval",
    classification: "PUBLIC_STABLE",
    meaning: "Approval is one-time resolvable and has already been approved or rejected.",
    safeResolution: "Request a new approval if another decision is required.",
  }),
  E_TRAJECTORY_SCENARIO_INVALID: Object.freeze({
    code: "E_TRAJECTORY_SCENARIO_INVALID",
    category: "trajectory-evaluation",
    classification: "PUBLIC_STABLE",
    meaning: "Trajectory scenario file is missing required fields or schema-invalid.",
    safeResolution: "Correct the scenario JSON against schemas/trajectory-scenario.schema.json.",
  }),
  E_TRAJECTORY_REFERENCE_REQUIRED: Object.freeze({
    code: "E_TRAJECTORY_REFERENCE_REQUIRED",
    category: "trajectory-evaluation",
    classification: "PUBLIC_STABLE",
    meaning: "Comparative efficiency requires a reference scenario with positive comparableSteps.",
    safeResolution: "Provide --scenario with reference.comparableSteps, or omit efficiency from the result.",
  }),
});

export const E_CHECK_INERT = "E_CHECK_INERT";
export const E_CHECK_MUTATION_NOT_DETECTED = "E_CHECK_MUTATION_NOT_DETECTED";
export const E_POLICY_DRIFT = "E_POLICY_DRIFT";
export const E_POLICY_WEAKENING = "E_POLICY_WEAKENING";
export const E_POLICY_LOCK_INVALID = "E_POLICY_LOCK_INVALID";
export const E_NEW_POLICY_VIOLATION = "E_NEW_POLICY_VIOLATION";
export const E_BASELINE_EXPANSION = "E_BASELINE_EXPANSION";
export const E_POLICY_PROOF_STALE = "E_POLICY_PROOF_STALE";
export const E_CHECK_MUTATION_EXECUTION_ERROR = "E_CHECK_MUTATION_EXECUTION_ERROR";
export const E_POLICY_EVALUATION_FAILED = "E_POLICY_EVALUATION_FAILED";
export const E_POLICY_INVALID = "E_POLICY_INVALID";
export const E_POLICY_SNAPSHOT_WRITE_FAILED = "E_POLICY_SNAPSHOT_WRITE_FAILED";
export const E_POLICY_LOCK_MISMATCH = "E_POLICY_LOCK_MISMATCH";
export const E_POLICY_DRIFT_UNKNOWN = "E_POLICY_DRIFT_UNKNOWN";
export const E_BASELINE_RECORD_DURING_ACTIVE_TASK = "E_BASELINE_RECORD_DURING_ACTIVE_TASK";
export const E_POLICY_INITIALIZATION_FAILED = "E_POLICY_INITIALIZATION_FAILED";
export const E_INIT_KIT_CONFLICT = "E_INIT_KIT_CONFLICT";

export const ALL_KNOWN_ERROR_CODES = Object.freeze(new Set([
  ...FAILURE_CODES,
  E_VERIFICATION_TOOL_UNAVAILABLE,
  E_VERIFICATION_ISOLATION_UNAVAILABLE,
  E_VERIFICATION_EXECUTION_INVALID,
  E_INSTALLATION_AUTHORITY_REQUIRED,
  E_COMMAND_RESOLUTION_AMBIGUOUS,
  E_AUTHORITY_INVALID,
  E_AUTHORITY_SCOPE_MISMATCH,
  "E_AUTHORITY_UNTRUSTED_SOURCE",
  "E_EXECUTION_REF_INVALID",
  "E_NATIVE_ADAPTER_STALE",
  "E_NATIVE_ADAPTER_TARGET_MISSING",
  "E_MIGRATION_INCOMPLETE",
  "E_MIGRATION_WRITE_VERIFY",
  E_TASK_REQUIRED,
  E_TASK_NOT_FOUND,
  E_TASK_ALREADY_EXISTS,
  E_TASK_COMPLETE,
  E_TASK_AMBIGUOUS,
  E_TASK_SELECTOR_CONFLICT,
  E_TASK_DESCRIPTOR_INVALID,
  E_TASK_KEY_MISMATCH,
  E_TASK_CONTEXT_MISMATCH,
  E_TASK_LOCKED,
  E_TASK_LOCK_INVALID,
  E_PROJECT_CLAIMS_LOCK_INCONSISTENT,
  E_TASK_SCOPE_REQUIRED,
  E_TASK_SCOPE_CONFLICT,
  E_TASK_SCOPE_DIRTY,
  E_TASK_SCOPE_FROZEN,
  E_TASK_CHANGE_OUTSIDE_SCOPE,
  E_WORKSPACE_IDENTITY_UNAVAILABLE,
  E_WORKSPACE_BINDING_INVALID,
  E_WORKSPACE_BINDING_MISMATCH,
  E_HANDOFF_INVALID,
  E_HANDOFF_STATE_UNAVAILABLE,
  E_HANDOFF_TAMPERED,
  E_HANDOFF_NOT_FOUND,
  E_RESPONSIBILITY_INVALID,
  E_RESPONSIBILITY_SCOPE_VIOLATION,
  E_RESPONSIBILITY_FROZEN_INPUT_DRIFT,
  E_RESPONSIBILITY_REQUIRED_CHECK_MISSING,
  E_VERIFICATION_SCOPE_INVALID,
  E_VERIFICATION_SCOPE_STALE,
  E_VERIFICATION_SCOPE_UNRESOLVED,
  E_REVISION_PROVIDER_UNAVAILABLE,
  E_REVISION_PROVIDER_AMBIGUOUS,
  E_REVISION_PROVIDER_INVALID,
  E_REVISION_NOT_FOUND,
  E_REVISION_CONTENT_UNAVAILABLE,
  E_ATTESTATION_DISABLED,
  E_ATTESTATION_GIT_REQUIRED,
  E_ATTESTATION_MANIFEST_MISSING,
  E_ATTESTATION_MANIFEST_INVALID,
  E_ATTESTATION_MANIFEST_STALE,
  E_ATTESTATION_CONTENT_MISMATCH,
  E_ATTESTATION_SCOPE_MISMATCH,
  E_ATTESTATION_COVERAGE_GAP,
  E_ATTESTATION_COVERAGE_CONFLICT,
  E_ATTESTATION_STATEMENT_MISSING,
  E_ATTESTATION_STATEMENT_INVALID,
  E_ATTESTATION_SUBJECT_MISMATCH,
  E_ATTESTATION_RECEIPT_MISMATCH,
  E_ATTESTATION_STATE_MISMATCH,
  E_ATTESTATION_ROUTE_MISMATCH,
  E_ATTESTATION_CONTRACT_MISMATCH,
  E_ATTESTATION_LEDGER_MISMATCH,
  E_ATTESTATION_UNSIGNED,
  E_ATTESTATION_SIGNATURE_INVALID,
  E_ATTESTATION_SIGNER_UNAVAILABLE,
  E_ATTESTATION_IDENTITY_UNTRUSTED,
  E_ATTESTATION_ISSUER_UNTRUSTED,
  E_ATTESTATION_TARGET_REF_INVALID,
  E_ATTESTATION_INVALID,
  E_ATTESTATION_CONFIGURATION_INVALID,
  E_CLI_INVOCATION_INVALID,
  E_EXECUTION_PROFILE_INVALID,
  E_EXECUTION_PROFILE_INCONSISTENT,
  E_EXECUTION_PROFILE_SAFETY_FLOOR_INVALID,
  E_USAGE_INVALID,
  E_USAGE_SOURCE_INVALID,
  E_EFFICIENCY_BASELINE_INVALID,
  E_STRUCTURAL_QUALITY_CONFIGURATION_INVALID,
  E_STRUCTURAL_QUALITY_PROVIDER_INVALID,
  E_STRUCTURAL_QUALITY_PROVIDER_UNAVAILABLE,
  E_STRUCTURAL_QUALITY_PROVIDER_VERSION_UNSUPPORTED,
  E_STRUCTURAL_QUALITY_PROVIDER_PROTOCOL_INVALID,
  E_STRUCTURAL_QUALITY_PROVIDER_TOOL_CONTRACT_INVALID,
  E_STRUCTURAL_QUALITY_SCAN_FAILED,
  E_STRUCTURAL_QUALITY_TIMEOUT,
  E_STRUCTURAL_QUALITY_OUTPUT_LIMIT,
  E_STRUCTURAL_QUALITY_BASELINE_MISSING,
  E_STRUCTURAL_QUALITY_BASELINE_EXISTS,
  E_STRUCTURAL_QUALITY_BASELINE_PHASE_INVALID,
  E_STRUCTURAL_QUALITY_BASELINE_BINDING_MISMATCH,
  E_STRUCTURAL_QUALITY_EVALUATION_INCOMPARABLE,
  E_STRUCTURAL_QUALITY_MEASUREMENT_MODEL_MISMATCH,
  E_STRUCTURAL_QUALITY_EVIDENCE_STALE,
  E_STRUCTURAL_QUALITY_SOURCE_DRIFT,
  E_STRUCTURAL_QUALITY_SOURCE_FINGERPRINT_UNAVAILABLE,
  E_STRUCTURAL_QUALITY_OBSERVATION_EPOCH_STALE,
  E_STRUCTURAL_QUALITY_PROJECTION_INCOMPLETE,
  E_STRUCTURAL_QUALITY_REGRESSION,
  E_RECONCILE_NOT_STALE,
  E_RECONCILE_PHASE_INVALID,
  E_RECONCILE_UNSUPPORTED_DRIFT,
  E_RECONCILE_LEDGER_INVALID,
  E_RECONCILE_REQUIREMENT_UNKNOWN,
  E_RECONCILE_EVIDENCE_FAILED,
  E_REPOSITORY_CHANGED,
  E_STATE_REVALIDATION_REQUIRED,
  E_TASK_CHANGE_ATTRIBUTION_UNAVAILABLE,
  E_TASK_LAYOUT_LEGACY,
  E_TASK_MIGRATION_INVALID,
  E_TASK_RECOVERY_UNSAFE,
  E_TASK_RECOVERY_INCONSISTENT,
  E_LEGACY_RECOVERY_MIGRATION_INVALID,
  E_COMPLETION_OWNERSHIP_UNPROVEN,
  E_TASK_CLAIM_OWNERSHIP_INCONSISTENT,
  E_TASK_RECOVERY_AUTHORIZATION_REQUIRED,
  E_TASK_RECOVERY_AUTHORITY_INVALID,
  E_TASK_RECOVERED,
  E_TASK_NOT_RECOVERED,
  E_TASK_RECOVERY_OFFICIAL_PATH_AVAILABLE,
  E_TASK_ALREADY_RECOVERED,
  E_TASK_MIGRATION_IDENTITY_MISMATCH,
  E_PROTOCOL_MIGRATION_TARGET_UNSUPPORTED,
  E_CHECK_INERT,
  E_CHECK_MUTATION_NOT_DETECTED,
  E_POLICY_DRIFT,
  E_POLICY_WEAKENING,
  E_POLICY_LOCK_INVALID,
  E_NEW_POLICY_VIOLATION,
  E_BASELINE_EXPANSION,
  E_POLICY_PROOF_STALE,
  E_CHECK_MUTATION_EXECUTION_ERROR,
  E_POLICY_EVALUATION_FAILED,
  E_POLICY_INVALID,
  E_POLICY_SNAPSHOT_WRITE_FAILED,
  E_POLICY_LOCK_MISMATCH,
  E_POLICY_DRIFT_UNKNOWN,
  E_BASELINE_RECORD_DURING_ACTIVE_TASK,
  E_POLICY_INITIALIZATION_FAILED,
  E_INIT_KIT_CONFLICT,
  E_REPOSITORY_INDEX_PLATFORM_UNSUPPORTED,
  E_REPOSITORY_INDEX_ENGINE_MISSING,
  E_REPOSITORY_INDEX_ENGINE_DOWNLOAD_FAILED,
  E_REPOSITORY_INDEX_ENGINE_CHECKSUM_MISMATCH,
  E_REPOSITORY_INDEX_ENGINE_EXTRACTION_FAILED,
  E_REPOSITORY_INDEX_ENGINE_VERSION_MISMATCH,
  E_REPOSITORY_INDEX_ENGINE_EXECUTION_FAILED,
  E_REPOSITORY_INDEX_OUTPUT_LIMIT,
  E_REPOSITORY_INDEX_NOT_INITIALIZED,
  E_REPOSITORY_INDEX_INDEXING,
  E_REPOSITORY_INDEX_SERVER_START_FAILED,
  E_REPOSITORY_INDEX_SERVER_STOP_FAILED,
  E_REPOSITORY_INDEX_SERVER_UNHEALTHY,
  E_REPOSITORY_INDEX_SEARCH_FAILED,
  E_REPOSITORY_INDEX_OUTPUT_INVALID,
  E_REPOSITORY_INDEX_REBUILD_FAILED,
  E_REPOSITORY_INDEX_REQUEST_INVALID,
  E_REPOSITORY_INDEX_LOCK_UNSAFE,
  E_ACTION_INVALID,
  E_ACTION_NOT_FOUND,
  E_ACTION_STATE_MISMATCH,
  E_ACTION_IDEMPOTENCY_REQUIRED,
  E_ACTION_IDEMPOTENCY_CONFLICT,
  E_ACTION_CAPABILITY_UNKNOWN,
  E_ACTION_CAPABILITY_DENIED,
  E_ACTION_AUTHORITY_REQUIRED,
  E_ACTION_APPROVAL_REQUIRED,
  E_ACTION_APPROVAL_NOT_REQUIRED,
  E_ACTION_COMMIT_UNKNOWN,
  E_ACTION_RECONCILIATION_REQUIRED,
  E_ACTION_EVIDENCE_INVALID,
  E_ACTION_AUTHORIZATION_INVALID,
  E_ACTION_VERIFICATION_REQUIRED,
  E_ACTION_VERIFICATION_INVALID,
  E_ACTION_POLICY_DRIFT,
  E_ACTION_POLICY_LOCK_REQUIRED,
  E_ACTION_RECONCILIATION_AUTHORITY_REQUIRED,
  E_ACTION_RECONCILIATION_EVIDENCE_INVALID,
  E_APPROVAL_INVALID,
  E_APPROVAL_STALE,
  E_APPROVAL_ALREADY_RESOLVED,
  E_TRAJECTORY_SCENARIO_INVALID,
  E_TRAJECTORY_REFERENCE_REQUIRED,
  E_DIAGNOSIS_REQUIRED,
  E_DIAGNOSIS_INVALID,
  E_DIAGNOSIS_EVIDENCE_INVALID,
  E_DIAGNOSIS_CYCLE_MISMATCH,
  E_DIAGNOSIS_NO_NEW_INFORMATION,
  E_PROGRESS_STALLED,
  E_DIAGNOSTIC_CASE_INVALID,
  E_DIAGNOSTIC_CASE_CYCLE_MISMATCH,
  E_DIAGNOSTIC_CASE_EVIDENCE_INVALID,
  E_OBSERVATION_INVALID,
  E_CONTRIBUTOR_INVALID,
  E_CONTRIBUTOR_REFERENCE_INVALID,
  E_HYPOTHESIS_INVALID,
  E_HYPOTHESIS_SETTLEMENT_MISSING,
  E_HYPOTHESIS_DISPOSITION_INVALID,
  E_HYPOTHESIS_DISPOSITION_EVIDENCE_INVALID,
  E_INTERVENTION_INVALID,
  E_INTERVENTION_HYPOTHESIS_MISSING,
  E_INTERVENTION_REFERENCE_INVALID,
  E_FAILURE_SIGNATURE_INVALID,
  E_STRATEGY_OSCILLATION,
  "E_TRACE_SNAPSHOT_INCONSISTENT",
  E_ADVISORY_CONTEXT_PROVIDER_INVALID,
  E_ADVISORY_CONTEXT_PROVIDER_UNAVAILABLE,
  E_ADVISORY_CONTEXT_QUERY_INVALID,
  E_ADVISORY_CONTEXT_REQUEST_INVALID,
  E_ADVISORY_CONTEXT_RESULT_INVALID,
  E_ADVISORY_CONTEXT_TIMEOUT,
  E_ADVISORY_CONTEXT_OUTPUT_LIMIT,
  E_PORTABLE_CONTEXT_INVALID,
  E_HANDOFF_ACCEPTANCE_UNBOUND,
  E_HANDOFF_STALE,
  E_HANDOFF_ALREADY_ACCEPTED,
  E_HANDOFF_ACCEPTANCE_INCONSISTENT,
]));

/**
 * Complete public registry.  Older callers can retain PUBLIC_ERROR_CODES while
 * documentation and compatibility handshakes enumerate every stable code.
 */
export const PUBLIC_ERROR_REGISTRY = Object.freeze(
  Object.fromEntries([...ALL_KNOWN_ERROR_CODES].sort().map((code) => [code, Object.freeze(
    PUBLIC_ERROR_CODES[code] ?? {
      code,
      category: "protocol",
      classification: "PUBLIC_STABLE",
      meaning: "A ForgeLoop protocol validation or lifecycle condition was not satisfied.",
      safeResolution: "Inspect the structured command result, correct the named artifact or prerequisite, then run forgeloop next --json.",
    },
  )])),
);
