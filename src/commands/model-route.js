import { projectModelRoute } from "../core/model-router/router.js";
import { resolveRequiredSemanticDecision } from "../core/decision/resolver.js";
import { readCurrentDecisionBindings } from "../core/decision/task-bindings.js";

export async function runModelRoute({ target, packageRoot, taskId, decisionId, workType, surfaces, risks, platforms, behaviorChange, executableChange, generationRequired, architectureChange, ambiguity, semanticRecommendation, contract } = {}) {
  if (target && taskId) {
    const bindings = await readCurrentDecisionBindings(target, packageRoot, taskId);
    const decision = await resolveRequiredSemanticDecision({
      target, packageRoot, taskId, decisionId, decisionKind: "MODEL_ROUTE", currentBindings: bindings,
    });
    semanticRecommendation = decision.decision;
  }
  return projectModelRoute({
    input: {
      workType,
      surfaces,
      risks,
      platforms,
      behaviorChange,
      executableChange,
      generationRequired,
      architectureChange,
      ambiguity,
      contract,
    },
    semanticRecommendation,
  });
}

export function formatModelRouteResult(result) {
  return `${JSON.stringify(result, null, 2)}\n`;
}
