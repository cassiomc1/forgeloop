import { runComplete as evaluateAndComplete } from "../core/completion.js";
import { withTaskMutation } from "../core/task-command.js";
import { isRecoverableCompletionEvidenceCode } from "../core/completion-recovery.js";

export async function runComplete(options = {}) {
  const target = options.target;
  const packageRoot = options.packageRoot;
  const taskId = options.taskId ?? options.task ?? null;
  const rejected = new Error("Completion validation rejected");
  let rejectedResult;
  try {
    return await withTaskMutation(target, { taskId, packageRoot }, "complete", async (ctx) => {
      const result = await evaluateAndComplete({ ...options, taskId: ctx?.taskId ?? null });
      const recordsEvidenceRecovery = options.persist !== false && result.errors.length > 0
        && result.errors.every(error => isRecoverableCompletionEvidenceCode(error.code));
      if (result.status === "REJECTED" && !recordsEvidenceRecovery) {
        rejectedResult = result;
        throw rejected;
      }
      return result;
    });
  } catch (error) {
    // Return the domain rejection only after its transaction has rolled back.
    if (error === rejected) return rejectedResult;
    throw error;
  }
}

export function formatCompleteResult(result) {
  const lines = [`FORGELOOP COMPLETE: ${result.status}`];
  if (result.status === "VALID") {
    lines.push(`TASK: ${result.taskStatus}`);
    lines.push(`VERIFICATION: ${result.verificationStatus}`);
    lines.push(`PUBLICATION: ${result.publicationStatus}`);
    lines.push(`PRODUCTION_READINESS: ${result.productionReadiness}`);
  }
  for (const error of result.errors) {
    lines.push(`${error.code}: ${error.message}`);
    if (error.next) lines.push(`NEXT: ${error.next}`);
  }
  return `${lines.join("\n")}\n`;
}
