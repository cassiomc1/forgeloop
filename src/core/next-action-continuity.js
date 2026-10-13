import { ARTIFACT_PATHS } from "./artifacts.js";
import { reconcileContinuity } from "./continuity-reconciliation.js";
import { directCommandSpec, NEXT_ACTIONS, result } from "./next-action-model.js";
import { taskArtifactPath } from "./task-paths.js";

const SINGLETON_REQUIRED_ARTIFACTS = Object.freeze([ARTIFACT_PATHS.state, ARTIFACT_PATHS.continuity]);

function reason(code, message, artifacts = SINGLETON_REQUIRED_ARTIFACTS) {
  return { code, message, artifacts };
}

function continuityArtifacts(taskId) {
  if (!taskId) {
    return {
      continuity: ARTIFACT_PATHS.continuity,
      required: SINGLETON_REQUIRED_ARTIFACTS,
    };
  }
  return {
    continuity: taskArtifactPath(taskId, "continuity"),
    required: [taskArtifactPath(taskId, "state"), taskArtifactPath(taskId, "continuity")],
  };
}

export function nextActionForContinuity({ context, continuity } = {}) {
  if (!continuity || ["ABSENT", "NOT_APPLICABLE"].includes(continuity.classification)) return null;
  const taskId = context?.taskId ?? null;
  const artifacts = continuityArtifacts(taskId);

  if (continuity.classification === "FRESH") {
    const remaining = continuity.continuity?.remainingWork ?? [];
    if (remaining.length === 0) return null;
    return result({
      ...context,
      nextAction: NEXT_ACTIONS.CONTINUE_IMPLEMENTATION,
      reasons: [reason(
        "CONTINUITY_REMAINING_WORK",
        `Execution continuity records ${remaining.length} remaining implementation item${remaining.length === 1 ? "" : "s"}.`,
        [artifacts.continuity],
      )],
      requiredArtifacts: artifacts.required,
    });
  }

  if (continuity.classification === "RECONCILIATION_REQUIRED") {
    const command = taskId
      ? `forgeloop reconcile-continuity --task ${taskId}`
      : "forgeloop reconcile-continuity";
    return result({
      ...context,
      nextAction: NEXT_ACTIONS.RESOLVE_BLOCKER,
      commands: [command],
      ...(taskId ? { commandSpecs: [directCommandSpec("reconcile-continuity", taskId)] } : {}),
      reasons: [reason(
        "E_CONTINUITY_RECONCILIATION_REQUIRED",
        "Execution continuity no longer matches canonical state or the current checkout; reconcile it before advancing verification.",
        artifacts.required,
      )],
      requiredArtifacts: artifacts.required,
    });
  }

  if (["INVALID", "INCONSISTENT"].includes(continuity.classification)) {
    const codes = continuity.reasonCodes?.length > 0
      ? continuity.reasonCodes
      : [continuity.classification === "INVALID" ? "E_CONTINUITY_INVALID" : "E_CONTINUITY_INCONSISTENT"];
    return result({
      ...context,
      nextAction: NEXT_ACTIONS.RESOLVE_BLOCKER,
      reasons: codes.map((code, index) => reason(
        code,
        continuity.reasons?.[index] ?? `Execution continuity is ${continuity.classification.toLowerCase()}.`,
        artifacts.required,
      )),
      requiredArtifacts: artifacts.required,
    });
  }

  return null;
}

export async function evaluateContinuityNextAction({ target, packageRoot, context } = {}) {
  return nextActionForContinuity({
    context,
    continuity: await reconcileContinuity({ target, packageRoot, taskId: context?.taskId ?? null }),
  });
}
