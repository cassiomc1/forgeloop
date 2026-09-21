export const FAILURE_CLASSES = Object.freeze([
  "incorrect implementation", "stale expectation", "race condition", "state divergence",
  "dependency incompatibility", "configuration defect", "fixture defect", "timeout",
  "network/environment", "serialization mismatch", "ownership/protocol mismatch", "unknown",
]);

export const DIAGNOSIS_STRATEGIES = Object.freeze([
  "inspect caller", "inspect callee", "inspect state transition", "inspect dependency behavior",
  "inspect config", "inspect concurrency path", "inspect fixture", "inspect package boundary",
  "run narrower experiment", "run independent checker", "inspect historical regression",
]);

export const REVIEW_FOCUSES = Object.freeze([
  "needs_security_review", "needs_api_compatibility_review", "needs_concurrency_review",
  "needs_package_review", "needs_docs_review", "needs_migration_review",
  "needs_performance_review", "needs_dependency_review", "needs_full_diff_context",
  "needs_primary_model",
]);

