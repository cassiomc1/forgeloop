import { runSemanticPlan as projectPlan } from "../core/semantic-planning/service.js";
import { resolveRequiredSemanticDecision } from "../core/decision/resolver.js";
import { readCurrentDecisionBindings } from "../core/decision/task-bindings.js";

export async function runSemanticPlan({ target, packageRoot, taskId, decisionId, kind, input, semanticRecommendation } = {}) {
  if (target && taskId) {
    const decisionKind = { failure: "FAILURE_TRIAGE", diagnosis: "DIAGNOSIS_PRIORITY", review: "REVIEW_PLAN" }[kind];
    const bindings = await readCurrentDecisionBindings(target, packageRoot, taskId);
    const decision = await resolveRequiredSemanticDecision({ target, packageRoot, taskId, decisionId, decisionKind, currentBindings: bindings });
    semanticRecommendation = decision.decision;
  }
  return projectPlan({ kind, input, semanticRecommendation });
}

export function formatSemanticPlanResult(result) {
  return `${JSON.stringify(result, null, 2)}\n`;
}
