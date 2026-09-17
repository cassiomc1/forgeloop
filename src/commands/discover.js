import { appendProtocolEvent, readEvents, validateEventLedger } from "../core/events.js";
import { withTaskMutation } from "../core/task-command.js";

function initialHistory(events, taskId) {
  if (events.length < 2) return false;
  return events[0]?.taskId === taskId
    && events[0]?.event === "TASK_RECEIVED"
    && events[1]?.taskId === taskId
    && events[1]?.event === "TRANSACTION_COMMITTED"
    && events[1]?.details?.operation === "task-create";
}

export async function runDiscover({ target, packageRoot, taskId, task } = {}) {
  return withTaskMutation(target, { taskId: taskId ?? task, packageRoot }, "discover", async (ctx) => {
    const events = await readEvents(target, packageRoot, { taskId: ctx.taskId });
    const ledger = await validateEventLedger(target, packageRoot, { taskId: ctx.taskId });
    if (!ledger.valid) {
      const error = new Error("Initial discovery requires a valid task event ledger");
      error.code = "E_LEDGER_INVALID";
      error.artifacts = ledger.errors.flatMap((entry) => entry.artifacts ?? []);
      throw error;
    }
    if (!initialHistory(events, ctx.taskId)) {
      const error = new Error("Initial discovery requires the canonical task-create history");
      error.code = "E_INITIAL_LIFECYCLE_INVALID";
      throw error;
    }
    const existing = events.find((event) => event.event === "DISCOVERY_STARTED");
    if (existing) return { taskId: ctx.taskId, phase: "DISCOVERING", idempotent: true, eventSeq: existing.seq };
    const event = await appendProtocolEvent(target, {
      taskId: ctx.taskId,
      event: "DISCOVERY_STARTED",
      details: { source: "canonical-discover" },
    }, packageRoot, { taskId: ctx.taskId });
    return { taskId: ctx.taskId, phase: "DISCOVERING", idempotent: false, eventSeq: event.seq };
  });
}

export function formatDiscoverResult(result) {
  return `phase: ${result.phase}\n${result.idempotent ? "idempotent: true\n" : ""}`;
}
