import { discoverTasks } from "../core/task-discovery.js";
import { WORK_PHASES } from "../core/protocol.js";

export async function runTaskList({ target, packageRoot, phase = null, active = false, limit = null, offset = 0 } = {}) {
  const tasks = await discoverTasks(target, packageRoot);
  const normalizedPhase = typeof phase === "string" && phase.trim() !== "" ? phase.trim().toUpperCase() : null;
  if (normalizedPhase && !WORK_PHASES.includes(normalizedPhase)) {
    const error = new Error(`Unknown task phase filter: ${phase}`);
    error.code = "E_TASK_PHASE_INVALID";
    throw error;
  }
  const phaseFiltered = normalizedPhase ? tasks.filter((task) => task.healthy === false || task.phase === normalizedPhase) : tasks;
  const filtered = active
    ? phaseFiltered.filter((task) => task.healthy !== false
      && task.phase !== "COMPLETE"
      && task.claimState !== "RELEASED_BY_RECOVERY")
    : phaseFiltered;
  const start = Number.isInteger(offset) && offset >= 0 ? offset : 0;
  const end = Number.isInteger(limit) && limit >= 0 ? start + limit : undefined;
  const projected = filtered.slice(start, end);
  return {
    tasks: projected.map((task) => {
      if (task.healthy === false) {
        return {
          taskId: task.taskId ?? null,
          taskKey: task.taskKey,
          directory: task.directory,
          healthy: false,
          error: task.error,
        };
      }
      return {
        taskId: task.taskId,
        taskKey: task.taskKey,
        directory: task.directory,
        healthy: true,
        phase: task.phase,
        writeClaims: task.writeClaims ?? [],
        historicalWriteClaims: task.historicalWriteClaims ?? [],
        effectiveWriteClaims: task.effectiveWriteClaims ?? [],
        claimState: task.claimState,
        recovery: task.recovery,
        mutationAllowed: task.mutationAllowed,
        ownershipValid: task.ownershipValid,
        ownershipErrors: task.ownershipErrors ?? task.errors ?? [],
        reasonCodes: task.reasonCodes ?? [],
        locked: task.locked,
        hasContinuity: task.hasContinuity,
        hasReceipt: task.hasReceipt,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
      };
    }),
    ...(normalizedPhase ? { phase: normalizedPhase } : {}),
    ...(active ? { active: true } : {}),
    offset: start,
    ...(Number.isInteger(limit) && limit >= 0 ? { limit } : {}),
    total: filtered.length,
    hasMore: end !== undefined ? end < filtered.length : false,
  };
}

export function formatTaskListResult(result) {
  if (result.tasks.length === 0) {
    return "no tasks found\n";
  }
  const lines = ["Tasks:"];
  for (const task of result.tasks) {
    if (task.healthy === false) {
      lines.push(`- ${task.taskKey} [CORRUPT]: ${task.error?.message ?? "unhealthy task namespace"}`);
    } else {
      const lockStr = task.locked ? " [LOCKED]" : "";
      const recoveryStr = task.claimState === "RELEASED_BY_RECOVERY"
        ? " [RECOVERED]"
        : task.claimState === "INCONSISTENT"
          ? " [OWNERSHIP INCONSISTENT]"
          : "";
      const claimsStr = task.writeClaims.length > 0 ? ` (claims: ${task.writeClaims.join(", ")})` : "";
      lines.push(`- ${task.taskId}: ${task.phase ?? "UNINITIALIZED"}${lockStr}${recoveryStr}${claimsStr}`);
    }
  }
  return `${lines.join("\n")}\n`;
}
