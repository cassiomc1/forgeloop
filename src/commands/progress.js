import { evaluateProgress, PROGRESS_STATUS } from "../core/progress.js";
import { withEventLedgerAudit } from "../core/events.js";
import { readWorkState } from "../core/work-state.js";
import { resolveTaskContext, TASK_SELECTION_MODES } from "../core/task-context.js";

export { evaluateProgress };

export async function runProgress({ target, packageRoot, taskId, task }) {
  const resolved = await resolveTaskContext(target, {
    packageRoot,
    taskId: taskId ?? task,
    selectionMode: TASK_SELECTION_MODES.READ,
  });
  const activeTaskId = resolved.taskId;

  return withEventLedgerAudit(target, packageRoot, { taskId: activeTaskId }, async ledger => {
    if (!ledger.valid) {
      const first = ledger.errors[0] ?? { code: "E_LEDGER_INVALID", message: "Progress requires a valid event ledger" };
      throw Object.assign(new Error(first.message), { code: first.code });
    }
    const state = await readWorkState(target, { packageRoot, taskId: activeTaskId });
    const events = ledger.events;

    const progress = evaluateProgress({ state, events });
    return {
      taskId: activeTaskId ?? state?.taskId ?? "unknown",
      phase: state?.phase ?? "UNKNOWN",
      verificationCycle: state?.verificationCycle ?? 1,
      ...progress,
    };
  });
}

export function formatProgressResult(result) {
  const lines = [
    `FORGELOOP PROGRESS: ${result.status}`,
    `PHASE: ${result.phase}`,
    `CYCLE: ${result.verificationCycle}`,
  ];

  if (result.signals && result.signals.length > 0) {
    lines.push("SIGNALS:");
    for (const signal of result.signals) {
      lines.push(`- ${signal.code}: ${signal.message}`);
    }
  } else {
    lines.push("SIGNALS: none");
  }

  let recommended = "NONE";
  if (result.status === PROGRESS_STATUS.STALLED) {
    recommended = "CHANGE_STRATEGY";
  } else if (result.status === PROGRESS_STATUS.WATCH) {
    recommended = "REVIEW_CHECKS";
  } else {
    recommended = "ADVANCE";
  }
  lines.push(`RECOMMENDED: ${recommended}`);

  return lines.join("\n") + "\n";
}
