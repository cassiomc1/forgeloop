import { runSemanticPlan as projectPlan } from "../core/semantic-planning/service.js";
import { resolveRequiredSemanticDecision } from "../core/decision/resolver.js";
import { readCurrentDecisionBindings } from "../core/decision/task-bindings.js";
import { withProjectReadSnapshot } from "../storage/project-read-snapshot.js";

const PROJECTION_VALUES = Object.freeze({
  failure: Object.freeze({ implementation: "incorrect implementation", expectation: "stale expectation",
    state: "state divergence", dependency: "dependency incompatibility", environment: "network/environment" }),
  diagnosis: Object.freeze({ inspect_state: "inspect state transition", inspect_caller: "inspect caller",
    inspect_dependency: "inspect dependency behavior", narrow_experiment: "run narrower experiment" }),
});

function projectionRecommendation(kind, decision) {
  const values = PROJECTION_VALUES[kind];
  if (!values) return decision;
  const field = kind === "failure" ? "failureClass" : "priority";
  const value = decision[field];
  if (value === "unknown") return null;
  return { ...decision, [field]: Object.hasOwn(values, value) ? values[value] : value };
}

export async function runSemanticPlan(options = {}) {
  if (options.target && options.taskId) return withProjectReadSnapshot(options.target, () => projectSnapshotSemanticPlan(options));
  return projectSnapshotSemanticPlan(options);
}

async function projectSnapshotSemanticPlan({ target, packageRoot, taskId, decisionId, kind, input, semanticRecommendation }) {
  if (target && taskId) {
    const decisionKind = { failure: "FAILURE_TRIAGE", diagnosis: "DIAGNOSIS_PRIORITY", review: "REVIEW_PLAN" }[kind];
    const bindings = await readCurrentDecisionBindings(target, packageRoot, taskId);
    // Decision stateFingerprint includes semantic inputs; this reader proves the lifecycle via taskStateFingerprint.
    delete bindings.stateFingerprint;
    const decision = await resolveRequiredSemanticDecision({ target, packageRoot, taskId, decisionId, decisionKind, currentBindings: bindings });
    semanticRecommendation = projectionRecommendation(kind, decision.decision);
  }
  return projectPlan({ kind, input, semanticRecommendation });
}

export function formatSemanticPlanResult(result) {
  return `${JSON.stringify(result, null, 2)}\n`;
}
