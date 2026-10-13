import { assertCanonicalPersistence } from "../storage/operational-context.js";
import { advanceWorkState } from "../core/phase.js";
import { withTaskMutation } from "../core/task-command.js";

export { advanceWorkState };

export async function runAdvance({ target, packageRoot, to, taskId, task, authorityContext, runtimeContext, persistence = null }) {
  if (!to) throw new Error("--to is required for advance");

  assertCanonicalPersistence(persistence);

  return withTaskMutation(target, { taskId: taskId ?? task, packageRoot }, "advance", async (ctx) => {
    return advanceWorkState(target, to, {
      packageRoot,
      taskId: ctx?.taskId ?? null,
      authorityContext,
      runtimeContext,
    });
  });
}

export function formatAdvanceResult(result) {
  return `phase: ${result.phase}\nprevious: ${result.previousPhase ?? "none"}\n`;
}
