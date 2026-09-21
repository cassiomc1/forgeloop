import { projectModelRoute } from "../core/model-router/router.js";

export async function runModelRoute({ workType, surfaces, risks, platforms, behaviorChange, executableChange, generationRequired, architectureChange, ambiguity, semanticRecommendation, contract } = {}) {
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

