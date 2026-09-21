import { runSemanticPlan as projectPlan } from "../core/semantic-planning/service.js";

export async function runSemanticPlan({ kind, input, semanticRecommendation } = {}) {
  return projectPlan({ kind, input, semanticRecommendation });
}

export function formatSemanticPlanResult(result) {
  return `${JSON.stringify(result, null, 2)}\n`;
}

