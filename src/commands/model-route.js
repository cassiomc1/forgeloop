import { projectModelRoute } from "../core/model-router/router.js";
import { resolveRequiredSemanticDecision } from "../core/decision/resolver.js";
import { readCurrentDecisionBindings } from "../core/decision/task-bindings.js";
import { withProjectReadSnapshot } from "../storage/project-read-snapshot.js";

export async function runModelRoute(options = {}) {
  if (options.target && options.taskId) return withProjectReadSnapshot(options.target, () => projectSnapshotModelRoute(options));
  return projectSnapshotModelRoute(options);
}

async function projectSnapshotModelRoute({ target, packageRoot, taskId, decisionId, workType, surfaces, risks, platforms, behaviorChange, executableChange, generationRequired, architectureChange, ambiguity, semanticRecommendation, contract }) {
  if (target && taskId) {
    const bindings = await readCurrentDecisionBindings(target, packageRoot, taskId);
    // Decision stateFingerprint includes semantic inputs; this reader proves the lifecycle via taskStateFingerprint.
    delete bindings.stateFingerprint;
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
