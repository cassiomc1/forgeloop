import { getNextAction } from "../core/next-action.js";
import { withResolvedTask } from "../core/task-command.js";
import { readPersistedRoute } from "../core/route-artifact.js";
import { projectExecutionProfile } from "../core/execution-profile.js";
import { explainNextAction } from "../core/next-explanation.js";

export async function runNext({ target, packageRoot, taskId, task, authorityContext, runtimeContext, compact = false, explain = false }) {
  return withResolvedTask(target, { taskId: taskId ?? task, packageRoot }, async (ctx) => {
    const result = await getNextAction({
      target,
      packageRoot,
      taskId: ctx?.taskId ?? null,
      authorityContext,
      runtimeContext,
    });
    const explained = explain ? { ...result, explanation: explainNextAction(result) } : result;
    if (!compact) return explained;
    const compactTaskId = ctx?.taskId ?? (result.taskId && result.taskId !== "unknown" ? result.taskId : null);
    let profile = null;
    try {
      const route = await readPersistedRoute(target, packageRoot, { taskId: compactTaskId });
      profile = projectExecutionProfile(route.value);
    } catch {
      // Legacy and incomplete tasks remain readable without a profile.
    }
    return {
      taskId: compactTaskId ?? result.taskId,
      phase: explained.currentPhase,
      profile,
      nextAction: explained.nextAction,
      command: explained.commandSpecs?.[0]?.argv ?? [],
      terminal: explained.terminal,
      errors: explained.reasonCodes ?? explained.reasons?.map((reason) => reason.code) ?? [],
      ...(explained.explanation ? { explanation: explained.explanation } : {}),
    };
  });
}

export function formatNextActionResult(result) {
  const lines = [
    `FORGELOOP NEXT: ${result.nextAction}`,
    `PHASE: ${result.currentPhase}`,
  ];
  if (result.reasons.length > 0) {
    lines.push("REASONS:");
    for (const reason of result.reasons) {
      lines.push(`- ${reason.code}: ${reason.message}`);
      if (reason.resolution?.kind === "SETTLEMENT_CRITERION" && reason.resolution.settledBy) {
        lines.push(`  SETTLED BY: ${reason.resolution.settledBy}`);
      } else if (reason.resolution?.kind === "SETTLEMENT_CRITERIA" && Array.isArray(reason.resolution.items)) {
        lines.push("  SETTLEMENT CRITERIA:");
        for (const item of reason.resolution.items) {
          lines.push(`  - ${item.decision}`);
          lines.push(`    SETTLED BY: ${item.settledBy}`);
        }
      }
    }
  }
  if (result.progress) {
    lines.push(`PROGRESS: ${result.progress.status}`);
  }
  if (result.commands.length > 0) {
    lines.push("COMMANDS (SAFE SYNOPSIS ONLY):");
    lines.push(...result.commands.map((command) => `- ${command}`));
  }
  if (result.commandSpecs.length > 0) {
    lines.push("STRUCTURED COMMAND SPECS: Available in --json output; direct-process argv data, not shell syntax.");
  }
  if (result.missingArtifacts.length > 0) {
    lines.push("MISSING ARTIFACTS:");
    lines.push(...result.missingArtifacts.map((artifact) => `- ${artifact}`));
  }
  if (result.terminal) lines.push("STATE: TERMINAL");
  if (result.explanation) {
    lines.push("EXPLANATION (BOUNDED, READ-ONLY):");
    lines.push(`- ${result.explanation.summary}`);
    for (const item of result.explanation.reasons) {
      lines.push(`- ${item.code}: ${item.requiredChange}`);
      if (item.safeArtifacts.length > 0) lines.push(`  ARTIFACTS: ${item.safeArtifacts.join(", ")}`);
    }
    lines.push(`- ACTION KIND: ${result.explanation.actionKind}`);
  }
  return `${lines.join("\n")}\n`;
}

export function formatCompactNextActionResult(result) {
  return `${JSON.stringify(result)}\n`;
}
