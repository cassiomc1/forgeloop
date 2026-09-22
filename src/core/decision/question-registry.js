import { canonicalFingerprint } from "../artifacts.js";
import { DECISION_QUESTION_SETS } from "./constants.js";
import { DECISION_ERROR_CODES, decisionError } from "./errors.js";

function freezeQuestionSet(definition) {
  return Object.freeze({
    ...definition,
    questions: Object.freeze({ ...definition.questions }),
    fingerprint: canonicalFingerprint(definition.questions),
  });
}

const QUESTION_SET_DEFINITIONS = Object.freeze({
  "contract-v1": Object.freeze({
    id: "contract-v1", version: 1, decisionKind: "CONTRACT_APPLICABILITY",
    questions: Object.freeze({ applicable: { type: "noul", criteria: { yes: "Contract applies to the requested work", no: "Contract scope is not applicable" } } }),
  }),
  "route-v1": Object.freeze({
    id: "route-v1", version: 1, decisionKind: "ROUTE",
    questions: Object.freeze({ relevant_guides: { type: "choice", criteria: { clean: "General engineering hygiene", test: "Testing context", security: "Security context", unknown: "Insufficient information" } } }),
  }),
  "intake-v1": Object.freeze({
    id: "intake-v1", version: 1, decisionKind: "INTAKE",
    questions: Object.freeze({
      work_type: { type: "choice", criteria: { documentation: "Documentation or prose change", code: "Executable code change", security: "Security-sensitive change", unknown: "Insufficient information" } },
      backend: { type: "noul", criteria: { yes: "Backend is affected", no: "Backend is not affected" } },
      frontend: { type: "noul", criteria: { yes: "Frontend is affected", no: "Frontend is not affected" } },
      authentication: { type: "noul", criteria: { yes: "Authentication is affected", no: "Authentication is not affected" } },
      authorization: { type: "noul", criteria: { yes: "Authorization is affected", no: "Authorization is not affected" } },
      security: { type: "noul", criteria: { yes: "Security is materially relevant", no: "Security is not materially relevant" } },
      database: { type: "noul", criteria: { yes: "Database behavior is affected", no: "Database behavior is not affected" } },
      network: { type: "noul", criteria: { yes: "Network behavior is affected", no: "Network behavior is not affected" } },
      public_api: { type: "noul", criteria: { yes: "A public API is affected", no: "No public API is affected" } },
      behavior_change: { type: "noul", criteria: { yes: "Behavior changes", no: "Behavior does not change" } },
      executable_change: { type: "noul", criteria: { yes: "Executable content changes", no: "Executable content does not change" } },
      dependency_change: { type: "noul", criteria: { yes: "Dependencies change", no: "Dependencies do not change" } },
      migration: { type: "noul", criteria: { yes: "A migration is involved", no: "No migration is involved" } },
      publication: { type: "noul", criteria: { yes: "Publication is involved", no: "Publication is not involved" } },
      documentation: { type: "noul", criteria: { yes: "Documentation is materially relevant", no: "Documentation is not materially relevant" } },
      package: { type: "noul", criteria: { yes: "Package behavior is affected", no: "Package behavior is not affected" } },
      ci: { type: "noul", criteria: { yes: "CI behavior is affected", no: "CI behavior is not affected" } },
      performance: { type: "noul", criteria: { yes: "Performance is materially relevant", no: "Performance is not materially relevant" } },
      accessibility: { type: "noul", criteria: { yes: "Accessibility is materially relevant", no: "Accessibility is not materially relevant" } },
      compatibility: { type: "noul", criteria: { yes: "Compatibility is materially relevant", no: "Compatibility is not materially relevant" } },
      data_sensitivity: { type: "noul", criteria: { yes: "Sensitive data is involved", no: "Sensitive data is not involved" } },
      operational_risk: { type: "noul", criteria: { yes: "Operational risk is elevated", no: "Operational risk is not elevated" } },
    }),
  }),
  "context-v1": Object.freeze({
    id: "context-v1", version: 1, decisionKind: "CONTEXT_PLAN",
    questions: Object.freeze({
      need_task_history: { type: "noul", criteria: { yes: "Task history is needed", no: "Task history is not needed" } },
      need_relevant_artifacts: { type: "noul", criteria: { yes: "Relevant artifacts are needed", no: "Relevant artifacts are not needed" } },
      need_dependency_context: { type: "noul", criteria: { yes: "Dependency context is needed", no: "Dependency context is not needed" } },
      need_security_context: { type: "noul", criteria: { yes: "Security context is needed", no: "Security context is not needed" } },
      need_review_context: { type: "noul", criteria: { yes: "Review context is needed", no: "Review context is not needed" } },
      need_verification_context: { type: "noul", criteria: { yes: "Verification context is needed", no: "Verification context is not needed" } },
      need_advisory_context: { type: "noul", criteria: { yes: "Advisory context is needed", no: "Advisory context is not needed" } },
      need_repository_snippets: { type: "noul", criteria: { yes: "Repository snippets are needed", no: "Repository snippets are not needed" } },
      need_external_docs: { type: "noul", criteria: { yes: "External documentation is needed", no: "External documentation is not needed" } },
    }),
  }),
  "model-route-v1": Object.freeze({
    id: "model-route-v1", version: 1, decisionKind: "MODEL_ROUTE",
    questions: Object.freeze({ generation_required: { type: "noul", criteria: { yes: "Generation is required", no: "A deterministic or semantic-only decision is sufficient" } }, reasoning_depth: { type: "choice", criteria: { NONE: "No generation or deep reasoning", FAST: "Small bounded reasoning", STANDARD: "Cross-file reasoning", PRIMARY: "Architecture or high ambiguity reasoning" } } }),
  }),
  "failure-v1": Object.freeze({
    id: "failure-v1", version: 1, decisionKind: "FAILURE_TRIAGE",
    questions: Object.freeze({ failure_class: { type: "choice", criteria: { implementation: "Incorrect implementation", expectation: "Stale expectation", state: "State divergence", dependency: "Dependency incompatibility", environment: "Network or environment issue", unknown: "Insufficient information" } } }),
  }),
  "diagnosis-v1": Object.freeze({
    id: "diagnosis-v1", version: 1, decisionKind: "DIAGNOSIS_PRIORITY",
    questions: Object.freeze({ priority: { type: "choice", criteria: { inspect_state: "Inspect state transition", inspect_caller: "Inspect caller", inspect_dependency: "Inspect dependency behavior", narrow_experiment: "Run a narrower experiment", unknown: "Insufficient information" } } }),
  }),
  "review-v1": Object.freeze({
    id: "review-v1", version: 1, decisionKind: "REVIEW_PLAN",
    questions: Object.freeze({
      needs_security_review: { type: "noul", criteria: { yes: "Security review is needed", no: "Security review is not needed" } },
      needs_api_compatibility_review: { type: "noul", criteria: { yes: "API compatibility review is needed", no: "API compatibility review is not needed" } },
      needs_concurrency_review: { type: "noul", criteria: { yes: "Concurrency review is needed", no: "Concurrency review is not needed" } },
      needs_package_review: { type: "noul", criteria: { yes: "Package review is needed", no: "Package review is not needed" } },
      needs_docs_review: { type: "noul", criteria: { yes: "Documentation review is needed", no: "Documentation review is not needed" } },
      needs_migration_review: { type: "noul", criteria: { yes: "Migration review is needed", no: "Migration review is not needed" } },
      needs_performance_review: { type: "noul", criteria: { yes: "Performance review is needed", no: "Performance review is not needed" } },
      needs_dependency_review: { type: "noul", criteria: { yes: "Dependency review is needed", no: "Dependency review is not needed" } },
      needs_full_diff_context: { type: "noul", criteria: { yes: "Full diff context is needed", no: "Full diff context is not needed" } },
      needs_primary_model: { type: "noul", criteria: { yes: "Primary model reasoning is needed", no: "Primary model reasoning is not needed" } },
    }),
  }),
  "test-utility-v1": Object.freeze({
    id: "test-utility-v1", version: 1, decisionKind: "TEST_UTILITY",
    questions: Object.freeze({
      validates_required_behavior: { type: "noul", criteria: { yes: "Test validates required behavior", no: "Test does not validate required behavior" } },
      guards_public_contract: { type: "noul", criteria: { yes: "Test guards a public contract", no: "Test does not guard a public contract" } },
      guards_security_boundary: { type: "noul", criteria: { yes: "Test guards a security boundary", no: "Test does not guard a security boundary" } },
      guards_failure_mode: { type: "noul", criteria: { yes: "Test guards a failure mode", no: "Test does not guard a failure mode" } },
      guards_regression_prone_behavior: { type: "noul", criteria: { yes: "Test guards regression-prone behavior", no: "Test does not guard regression-prone behavior" } },
      has_unique_semantic_intent: { type: "noul", criteria: { yes: "Test has unique semantic intent", no: "Test has overlapping semantic intent" } },
      semantic_duplicate: { type: "noul", criteria: { yes: "Test is a semantic duplicate", no: "Test is not a semantic duplicate" } },
      likely_obsolete: { type: "noul", criteria: { yes: "Test is likely obsolete", no: "Test is not likely obsolete" } },
      likely_flaky_low_signal: { type: "noul", criteria: { yes: "Test is likely flaky and low signal", no: "Test is not likely flaky and low signal" } },
      expensive_relative_to_signal: { type: "noul", criteria: { yes: "Test is expensive relative to signal", no: "Test is not expensive relative to signal" } },
      documentation_value: { type: "noul", criteria: { yes: "Test has documentation value", no: "Test lacks documentation value" } },
      integration_value: { type: "noul", criteria: { yes: "Test has integration value", no: "Test lacks integration value" } },
      platform_specific_value: { type: "noul", criteria: { yes: "Test has platform-specific value", no: "Test lacks platform-specific value" } },
      protocol_invariant: { type: "noul", criteria: { yes: "Test protects a protocol invariant", no: "Test does not protect a protocol invariant" } },
      requires_system_two_review: { type: "noul", criteria: { yes: "Test requires System Two review", no: "Test does not require System Two review" } },
    }),
  }),
  "task-overlap-v1": Object.freeze({
    id: "task-overlap-v1", version: 1, decisionKind: "TASK_OVERLAP",
    questions: Object.freeze({ relationship: { type: "choice", criteria: { SAME_PROBLEM: "Same problem", RELATED: "Related problem", INDEPENDENT: "Independent problem", UNKNOWN: "Insufficient information" } } }),
  }),
  "test-prune-v1": Object.freeze({
    id: "test-prune-v1", version: 1, decisionKind: "TEST_PRUNE",
    questions: Object.freeze({ redundancy: { type: "choice", criteria: { DISTINCT_BEHAVIOR: "Distinct behavior", PARTIALLY_OVERLAPPING: "Partially overlapping", SEMANTIC_DUPLICATE: "Semantic duplicate", UNKNOWN: "Insufficient information" } } }),
  }),
});

export function getQuestionSet(id) {
  const definition = QUESTION_SET_DEFINITIONS[id];
  if (!definition || !DECISION_QUESTION_SETS[id]) throw decisionError(DECISION_ERROR_CODES.QUESTION_SET_UNKNOWN, `Unknown semantic decision question set: ${id}`);
  return freezeQuestionSet(definition);
}

export function buildDynamicQuestionSet({ id, version = 1, decisionKind, questions, candidateIds = [], metadata = {} } = {}) {
  if (typeof id !== "string" || !id || !Number.isInteger(version) || version < 1
    || typeof decisionKind !== "string" || !questions || typeof questions !== "object"
    || Array.isArray(questions)) {
    throw decisionError(DECISION_ERROR_CODES.REQUEST_INVALID, "Dynamic semantic question set is invalid.");
  }
  const names = Object.keys(questions);
  if (names.length === 0 || names.length > 128 || names.some((name) => !/^[a-z][a-z0-9_]{0,95}$/.test(name))) {
    throw decisionError(DECISION_ERROR_CODES.REQUEST_INVALID, "Dynamic semantic question set has invalid bounded questions.");
  }
  return freezeQuestionSet({ id, version, decisionKind, questions, candidateIds: [...candidateIds].slice(0, 64), metadata });
}

export function buildContextQuestionSet(candidates = []) {
  const bounded = candidates.slice(0, 64);
  const questions = Object.fromEntries(bounded.map((candidate, index) => [
    `candidate_${index}_relevant`, {
      type: "noul",
      criteria: { yes: `Candidate ${candidate.id} is relevant to the bounded task context`, no: `Candidate ${candidate.id} is not relevant to the bounded task context` },
    },
  ]));
  return buildDynamicQuestionSet({
    id: "context-candidates-v1", decisionKind: "CONTEXT_PLAN", questions,
    candidateIds: bounded.map((candidate) => candidate.id),
    metadata: { candidateQuestionPrefix: "candidate_", relevanceSuffix: "_relevant" },
  });
}

export function buildRouteQuestionSet(guides = []) {
  const bounded = guides.slice(0, 64);
  const questions = Object.fromEntries(bounded.map((guide, index) => [
    `guide_${index}_relevant`, {
      type: "noul",
      criteria: { yes: `Guide ${guide} is relevant to the bounded route`, no: `Guide ${guide} is not relevant to the bounded route` },
    },
  ]));
  return buildDynamicQuestionSet({
    id: "route-candidates-v1", decisionKind: "ROUTE", questions,
    candidateIds: bounded,
    metadata: { candidateQuestionPrefix: "guide_", relevanceSuffix: "_relevant" },
  });
}

export function buildTestUtilityQuestionSet(tests = []) {
  const dimensions = ["unique_semantic_intent", "semantic_duplicate", "likely_obsolete", "likely_flaky_low_signal", "expensive_relative_to_signal", "documentation_value", "integration_value", "guards_regression_prone_behavior", "requires_system_two_review"];
  const bounded = tests.slice(0, 16);
  const questions = {};
  for (let index = 0; index < bounded.length; index += 1) {
    for (const dimension of dimensions) questions[`test_${index}_${dimension}`] = {
      type: "noul", criteria: { yes: `${dimension} applies to test ${bounded[index].testId}`, no: `${dimension} does not apply to test ${bounded[index].testId}` },
    };
  }
  return buildDynamicQuestionSet({
    id: "test-utility-candidates-v1", decisionKind: "TEST_UTILITY", questions,
    candidateIds: bounded.map((test) => test.testId),
    metadata: { dimensions, candidateQuestionPrefix: "test_", testCount: bounded.length },
  });
}

export function listQuestionSets() {
  return Object.values(DECISION_QUESTION_SETS).map((entry) => getQuestionSet(entry.id));
}
