export const DECISION_ENGINE_ID = "typesafe-jev";
export const PINNED_JEV_MODEL = "jev-1.13.0";
export const DECISION_POLICY_VERSION = 1;
export const DECISION_AUTHORITY = "SEMANTIC_DECISION";
export const DECISION_EVIDENCE_AUTHORITY = "NONE";

export const DECISION_KINDS = Object.freeze([
  "INTAKE",
  "CONTRACT_APPLICABILITY",
  "ROUTE",
  "CONTEXT_PLAN",
  "MODEL_ROUTE",
  "FAILURE_TRIAGE",
  "DIAGNOSIS_PRIORITY",
  "REVIEW_PLAN",
  "TASK_OVERLAP",
  "TEST_UTILITY",
  "TEST_PRUNE",
]);

export const DECISION_STATUS = Object.freeze(["RECORDED", "SUPERSEDED"]);

export const DECISION_DEFAULT_POLICY = Object.freeze({
  required: true,
  provider: DECISION_ENGINE_ID,
  model: PINNED_JEV_MODEL,
  policyVersion: DECISION_POLICY_VERSION,
  requestTimeoutMs: 8_000,
  maxRetries: 1,
  cache: true,
});

export const DECISION_LIMITS = Object.freeze({
  maxStateBytes: 48_000,
  maxStringChars: 8_000,
  maxItems: 128,
  maxDepth: 8,
  maxCandidates: 64,
});

export const DECISION_QUESTION_SETS = Object.freeze({
  "intake-v1": Object.freeze({ id: "intake-v1", version: 1, decisionKind: "INTAKE" }),
  "contract-v1": Object.freeze({ id: "contract-v1", version: 1, decisionKind: "CONTRACT_APPLICABILITY" }),
  "route-v1": Object.freeze({ id: "route-v1", version: 1, decisionKind: "ROUTE" }),
  "context-v1": Object.freeze({ id: "context-v1", version: 1, decisionKind: "CONTEXT_PLAN" }),
  "model-route-v1": Object.freeze({ id: "model-route-v1", version: 1, decisionKind: "MODEL_ROUTE" }),
  "failure-v1": Object.freeze({ id: "failure-v1", version: 1, decisionKind: "FAILURE_TRIAGE" }),
  "diagnosis-v1": Object.freeze({ id: "diagnosis-v1", version: 1, decisionKind: "DIAGNOSIS_PRIORITY" }),
  "review-v1": Object.freeze({ id: "review-v1", version: 1, decisionKind: "REVIEW_PLAN" }),
  "task-overlap-v1": Object.freeze({ id: "task-overlap-v1", version: 1, decisionKind: "TASK_OVERLAP" }),
  "test-utility-v1": Object.freeze({ id: "test-utility-v1", version: 1, decisionKind: "TEST_UTILITY" }),
  "test-prune-v1": Object.freeze({ id: "test-prune-v1", version: 1, decisionKind: "TEST_PRUNE" }),
});

export const SEMANTIC_DECISION_RECORDED_EVENT = "SEMANTIC_DECISION_RECORDED";
export const SEMANTIC_DECISION_SUPERSEDED_EVENT = "SEMANTIC_DECISION_SUPERSEDED";
