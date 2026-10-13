import { resolveTaskContext, TASK_SELECTION_MODES } from "../core/task-context.js";
import { readTaskDescriptor } from "../core/task-descriptor.js";
import { classifyLockStaleness, readLockInfo } from "../core/task-lock.js";
import { taskDirectory, taskArtifactPath } from "../core/task-paths.js";
import { readWorkState } from "../core/work-state.js";
import { readContract } from "../core/contract.js";
import { fileExists, ensureWithin } from "../core/filesystem.js";
import { E_TASK_NOT_FOUND } from "../core/error-codes.js";
import { resolveTaskClaimState } from "../core/task-claim-state.js";
import { readPersistedRoute } from "../core/route-artifact.js";
import { projectExecutionProfile } from "../core/execution-profile.js";
import { withEventLedgerAudit } from "../core/events.js";
import { needsExistingProjectScope, withExistingProjectScope } from "../storage/existing-project-scope.js";
import { getOperationalStore, operationalArtifactExists } from "../storage/operational-context.js";

function taskError(code, message, artifacts = []) {
  const error = new Error(message);
  error.code = code;
  error.artifacts = artifacts;
  return error;
}

export async function runTaskShow(options = {}) {
  const { target, packageRoot, taskId } = options;
  if (await needsExistingProjectScope(target)) {
    return withExistingProjectScope(target, () => runTaskShow(options), { readOnly: true });
  }
  const context = await resolveTaskContext(target, { taskId, packageRoot, explicitRequired: true, selectionMode: TASK_SELECTION_MODES.READ });
  if (getOperationalStore(target)) {
    return withEventLedgerAudit(target, packageRoot, { taskId: context.taskId }, () => projectTaskShow(options, context));
  }
  return projectTaskShow(options, context);
}

async function projectTaskShow({ target, packageRoot, compact = false }, context) {
  const effectiveTaskId = context.taskId;

  let descriptor = null;
  try {
    const descArtifact = await readTaskDescriptor(target, effectiveTaskId, packageRoot);
    descriptor = descArtifact.value;
  } catch (error) {
    if (error.code === "ARTIFACT_MISSING") {
      throw taskError(E_TASK_NOT_FOUND, `Task descriptor not found for task: ${effectiveTaskId}`);
    }
    throw error;
  }

  const state = await readWorkState(target, { packageRoot, taskId: effectiveTaskId });
  const claimProjection = await resolveTaskClaimState(target, {
    taskId: effectiveTaskId,
    packageRoot,
    descriptor,
    state,
  });
  const recovery = claimProjection.recovery;
  let contract = null;
  try {
    const contractArtifact = await readContract(target, packageRoot, { taskId: effectiveTaskId });
    contract = contractArtifact.value;
  } catch {
    // contract may not be present
  }

  const lockInfo = await readLockInfo(target, effectiveTaskId);
  const artifacts = {};
  for (const name of ["contract", "route", "state", "preflight", "receipt", "continuity", "events", "recovery"]) {
    const rel = taskArtifactPath(effectiveTaskId, name);
    artifacts[name] = {
      path: rel,
      exists: operationalArtifactExists(target, rel) ?? await fileExists(ensureWithin(target, rel)),
    };
  }

  const result = {
    taskId: effectiveTaskId,
    taskKey: context.taskKey,
    directory: taskDirectory(effectiveTaskId),
    phase: state?.phase ?? "UNINITIALIZED",
    ...claimProjection,
    recovery,
    lock: lockInfo ? { ...lockInfo, classification: classifyLockStaleness(lockInfo) } : null,
    contract: contract ? { title: contract.title ?? null, taskType: contract.taskType ?? null } : null,
    artifacts,
    createdAt: descriptor.createdAt,
    updatedAt: descriptor.updatedAt,
  };
  if (!compact) return result;
  let profile = null;
  try {
    const route = await readPersistedRoute(target, packageRoot, { taskId: effectiveTaskId });
    profile = projectExecutionProfile(route.value);
  } catch {
    // Legacy routes remain readable without adaptive profile metadata.
  }
  return {
    taskId: result.taskId,
    phase: result.phase,
    profile,
    claimState: result.claimState,
    mutationAllowed: result.mutationAllowed,
    recoveryStatus: result.recoveryStatus,
    lock: result.lock?.classification?.status ?? null,
    artifacts: Object.fromEntries(Object.entries(result.artifacts).map(([name, artifact]) => [name, artifact.exists])),
    errors: [...new Set([
      ...(result.reasonCodes ?? []),
      ...(result.errors ?? []).flatMap((error) => [error.code, error.causeCode]).filter(Boolean),
      ...(result.ownershipErrors ?? []).flatMap((error) => [error.code, error.causeCode]).filter(Boolean),
    ])],
  };
}

export function formatTaskShowResult(result) {
  const claims = result.writeClaims.length === 0 ? "none" : result.writeClaims.join(", ");
  const lockStatus = result.lock
    ? `${result.lock.classification.status}: locked by PID ${result.lock.pid ?? "unknown"} since ${result.lock.acquiredAt ?? "unknown"}`
    : "unlocked";
  const lines = [
    `Task: ${result.taskId}`,
    `Key: ${result.taskKey}`,
    `Directory: ${result.directory}`,
    `Phase: ${result.phase}`,
    `Write Claims: ${claims}`,
    `Claim State: ${result.claimState}`,
    `Mutation Allowed: ${result.mutationAllowed ? "yes" : "no"}`,
    ...(result.recovery
      ? [`Recovery: ${result.recovery.recoveryId} at ${result.recovery.recoveredAt}`]
      : []),
    `Lock: ${lockStatus}`,
    `Created: ${result.createdAt}`,
    `Updated: ${result.updatedAt}`,
  ];
  return `${lines.join("\n")}\n`;
}

export function formatCompactTaskShowResult(result) {
  return `${JSON.stringify(result)}\n`;
}
