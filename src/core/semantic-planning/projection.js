import { FAILURE_CLASSES, DIAGNOSIS_STRATEGIES, REVIEW_FOCUSES } from "./constants.js";

function strings(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim()) : [];
}

function text(input) {
  return [input?.message, input?.error, input?.failure, input?.objective, ...(input?.paths ?? []), ...(input?.risks ?? [])]
    .filter((value) => typeof value === "string").join(" ").toLowerCase();
}

function unique(values) { return [...new Set(values)]; }

function validateRecommendation(recommendation, allowed, label) {
  if (recommendation === undefined || recommendation === null) return null;
  const values = typeof recommendation === "string" ? [recommendation]
    : recommendation && typeof recommendation === "object" && !Array.isArray(recommendation)
      ? Object.entries(recommendation).filter(([, value]) => value === true).map(([key]) => key)
      : strings(recommendation);
  const unknown = values.filter((value) => !allowed.includes(value));
  if (unknown.length > 0) {
    const error = new Error(`${label} contains unknown semantic values: ${unknown.join(", ")}`);
    error.code = "E_DECISION_RESULT_INVALID";
    throw error;
  }
  return unique(values);
}

export function projectFailureTriage({ input = {}, semanticRecommendation = null } = {}) {
  const candidate = semanticRecommendation?.failureClass ?? semanticRecommendation;
  const value = validateRecommendation(candidate, FAILURE_CLASSES, "failure recommendation");
  const inferred = /timeout|timed out/.test(text(input)) ? "timeout"
    : /network|dns|connection|environment/.test(text(input)) ? "network/environment"
      : /ownership|protocol|ledger|phase/.test(text(input)) ? "ownership/protocol mismatch"
        : "unknown";
  return {
    decisionKind: "FAILURE_TRIAGE",
    questionSetId: "failure-v1",
    candidates: [...FAILURE_CLASSES],
    ranked: unique([...(value ?? []), inferred]),
    semanticRequired: true,
    unknownEscalates: !value,
    authority: "SEMANTIC_DECISION",
    evidenceAuthority: "NONE",
  };
}

export function projectDiagnosisPriority({ input = {}, semanticRecommendation = null } = {}) {
  const candidate = semanticRecommendation?.priority ?? semanticRecommendation;
  const value = validateRecommendation(candidate, DIAGNOSIS_STRATEGIES, "diagnosis recommendation");
  const inferred = /race|concurr|lock/.test(text(input)) ? "inspect concurrency path"
    : /state|ledger|phase|fingerprint/.test(text(input)) ? "inspect state transition"
      : /depend|package|module/.test(text(input)) ? "inspect dependency behavior"
        : "run narrower experiment";
  return {
    decisionKind: "DIAGNOSIS_PRIORITY",
    questionSetId: "diagnosis-v1",
    candidates: [...DIAGNOSIS_STRATEGIES],
    ranked: unique([...(value ?? []), inferred]),
    previouslyFailed: strings(input.previouslyFailed),
    semanticRequired: true,
    unknownEscalates: !value,
    authority: "SEMANTIC_DECISION",
    evidenceAuthority: "NONE",
  };
}

export function projectReviewPlan({ input = {}, semanticRecommendation = null } = {}) {
  const candidate = semanticRecommendation?.reviewFocus ?? semanticRecommendation;
  const value = validateRecommendation(candidate, REVIEW_FOCUSES, "review recommendation");
  const body = text(input);
  const mandatory = ["needs_full_diff_context"];
  if (/security|secret|credential|auth|permission/.test(body)) mandatory.push("needs_security_review");
  if (/api|public|compatib/.test(body)) mandatory.push("needs_api_compatibility_review");
  if (/race|concurr|lock/.test(body)) mandatory.push("needs_concurrency_review");
  if (/package|release|dependency/.test(body)) mandatory.push("needs_package_review", "needs_dependency_review");
  if (/doc|readme|guide/.test(body)) mandatory.push("needs_docs_review");
  if (/migration|schema|database/.test(body)) mandatory.push("needs_migration_review");
  if (/performance|timeout|latency/.test(body)) mandatory.push("needs_performance_review");
  if (input.fullDiff === true || body.includes("full diff")) mandatory.push("needs_full_diff_context");
  const ranked = unique([...mandatory, ...(value ?? [])]);
  if (ranked.length === 0) ranked.push("needs_full_diff_context");
  if (input.primaryModel === true || input.ambiguity === true) ranked.push("needs_primary_model");
  return {
    decisionKind: "REVIEW_PLAN",
    questionSetId: "review-v1",
    mandatory: unique(mandatory),
    ranked: unique(ranked),
    semanticRequired: true,
    unknownEscalates: !value,
    authority: "SEMANTIC_DECISION",
    evidenceAuthority: "NONE",
  };
}
