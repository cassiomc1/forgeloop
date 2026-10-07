import { withProjectReadSnapshot } from "../storage/project-read-snapshot.js";
import { readAndClassifyWorkState } from "../core/work-state.js";
import { inspectSchemaHealth } from "../core/schema-validation.js";
import { reconcileContinuity } from "../core/continuity-reconciliation.js";
import { withResolvedTask } from "../core/task-command.js";
import { findTaskById } from "../core/task-discovery.js";

export async function runStatus(options = {}) {
  return withProjectReadSnapshot(options.target, () => runSelectedStatus(options));
}

async function runSelectedStatus({ target, packageRoot, contractFile = null, taskId, task } = {}) {
  return withResolvedTask(target, { taskId: taskId ?? task, packageRoot }, async (ctx) => {
    const effectiveTaskId = ctx?.taskId ?? null;
    const state = await readAndClassifyWorkState({ target, packageRoot, contractFile, taskId: effectiveTaskId });
    const [protocol, continuity] = await Promise.all([
      inspectSchemaHealth(target),
      reconcileContinuity({ target, packageRoot, taskId: effectiveTaskId }),
    ]);
    const taskInfo = effectiveTaskId ? await findTaskById(target, effectiveTaskId, packageRoot) : null;
    return {
      ...state,
      taskId: effectiveTaskId,
      taskKey: ctx?.taskKey ?? null,
      recovery: taskInfo?.recovery ?? null,
      claimState: taskInfo?.claimState ?? null,
      historicalWriteClaims: taskInfo?.historicalWriteClaims ?? [],
      effectiveWriteClaims: taskInfo?.effectiveWriteClaims ?? [],
      mutationAllowed: taskInfo?.mutationAllowed ?? true,
      ownershipValid: taskInfo?.ownershipValid ?? true,
      ownershipErrors: taskInfo?.ownershipErrors ?? taskInfo?.errors ?? [],
      reasonCodes: taskInfo?.reasonCodes ?? [],
      protocol,
      continuity,
      evidence: [...(state.evidence ?? []), ...(protocol.evidence ?? [])],
    };
  });
}

export function formatStatusResult(result) {
  const lines = [
    `State: ${result.path}`,
    `Status: ${result.status}`,
    `Phase: ${result.phase ?? "none"}`,
    `Completed: ${result.completed.join(", ") || "none"}`,
    `Pending: ${result.pending.join(", ") || "none"}`,
  ];
  if (result.reasons.length > 0) lines.push(`Reasons: ${result.reasons.join(", ")}`);
  if (result.recovery) {
    lines.push(`Recovery: ${result.recovery.status} (${result.recovery.recoveryId})`);
  }
  if (result.claimState) {
    lines.push(`Claim state: ${result.claimState}`);
    lines.push(`Mutation allowed: ${result.mutationAllowed ? "yes" : "no"}`);
  }
  if (result.warnings?.length > 0) lines.push(`Warnings: ${result.warnings.join(", ")}`);
  if (result.contractComparison) lines.push(`Contract: ${result.contractComparison}`);
  if (result.artifactComparison) lines.push(`Artifacts: ${result.artifactComparison}`);
  if (result.protocol) lines.push(`Schemas: ${result.protocol.status}`);
  if (result.continuity) {
    const continuity = result.continuity.continuity;
    lines.push(`Continuity: ${result.continuity.classification}`);
    lines.push(`Continuity focus: ${continuity?.currentFocus?.id ?? "none"}`);
    lines.push(`Continuity remaining: ${continuity?.remainingWork?.length ?? 0}`);
    lines.push(`Continuity known issues: ${continuity?.knownIssues?.length ?? 0}`);
    lines.push(`Continuity authority: ${result.continuity.authority ?? "OPERATIONAL_CONTEXT_ONLY"}`);
  }
  if (result.error) lines.push(`Error: ${result.error}`);
  return `${lines.join("\n")}\n`;
}
