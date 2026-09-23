import { readDecisionArtifact } from "../core/decision/artifact.js";

export async function runDecisionShow({ target, packageRoot, taskId, decisionId } = {}) {
  if (typeof taskId !== "string" || !taskId || typeof decisionId !== "string" || !decisionId) {
    const error = new Error("decision-show requires --task and --decision");
    error.code = "E_DECISION_REQUEST_INVALID";
    throw error;
  }
  return (await readDecisionArtifact(target, taskId, decisionId, packageRoot)).value;
}

export function formatDecisionShowResult(result) {
  return `${JSON.stringify(result, null, 2)}\n`;
}
