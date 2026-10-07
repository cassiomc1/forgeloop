import { withEventLedgerAudit } from "../core/events.js";
import { getOperationalStore } from "../storage/operational-context.js";
import { needsExistingProjectScope, withExistingProjectScope } from "../storage/existing-project-scope.js";
import { resolveTaskContext } from "../core/task-context.js";
import { readTaskDescriptor, writeTaskDescriptor } from "../core/task-descriptor.js";
import { normalizeWriteClaims, assertScopeClean, assertScopeNotFrozen } from "../core/task-scope.js";
import { assertNoScopeConflictsWithInspection } from "./task-create.js";
import { discoverTasks } from "../core/task-discovery.js";
import { readWorkState } from "../core/work-state.js";
import { withProjectClaimsLock, withTaskLock } from "../core/task-lock.js";
import { E_TASK_NOT_FOUND } from "../core/error-codes.js";
import {
  assertTaskNotRecovered,
} from "../core/task-recovery.js";
import { resolveTaskClaimState } from "../core/task-claim-state.js";

function taskError(code, message, artifacts = []) {
  const error = new Error(message);
  error.code = code;
  error.artifacts = artifacts;
  return error;
}

export async function runTaskScope(options = {}) {
  const { target, packageRoot, taskId, claims } = options;
  const readOnly = claims === undefined || claims === null;
  if (readOnly && await needsExistingProjectScope(target)) {
    return withExistingProjectScope(target, () => runTaskScope(options), { readOnly: true });
  }
  const context = await resolveTaskContext(target, { taskId, packageRoot, explicitRequired: true });
  if (readOnly && getOperationalStore(target)) {
    return withEventLedgerAudit(target, packageRoot, { taskId: context.taskId }, () => runResolvedTaskScope(options, context));
  }
  return runResolvedTaskScope(options, context);
}

async function runResolvedTaskScope({ target, packageRoot, claims }, context) {
  const effectiveTaskId = context.taskId;

  let descriptorArtifact;
  try {
    descriptorArtifact = await readTaskDescriptor(target, effectiveTaskId, packageRoot);
  } catch (error) {
    if (error.code === "ARTIFACT_MISSING") {
      throw taskError(E_TASK_NOT_FOUND, `Task descriptor not found for task: ${effectiveTaskId}`);
    }
    throw error;
  }

  const descriptor = descriptorArtifact.value;

  if (claims !== undefined && claims !== null) {
    return withProjectClaimsLock(target, async () => {
      return withTaskLock(target, effectiveTaskId, "task-scope", async () => {
        await assertTaskNotRecovered(target, { taskId: effectiveTaskId, packageRoot });
        const lockedDescriptor = (await readTaskDescriptor(target, effectiveTaskId, packageRoot)).value;
        const state = await readWorkState(target, { packageRoot, taskId: effectiveTaskId });
        if (state?.phase) {
          assertScopeNotFrozen(state.phase);
        }

        const normalizedClaims = normalizeWriteClaims(claims);
        const allTasks = await discoverTasks(target, packageRoot);
        await assertNoScopeConflictsWithInspection(normalizedClaims, allTasks, effectiveTaskId, { target, packageRoot });
        if (normalizedClaims.length > 0) {
          await assertScopeClean(target, normalizedClaims);
        }

        const updatedDescriptor = {
          ...lockedDescriptor,
          writeClaims: normalizedClaims,
          updatedAt: new Date().toISOString(),
        };
        await writeTaskDescriptor(target, updatedDescriptor, packageRoot);
        const claimProjection = await resolveTaskClaimState(target, {
          taskId: effectiveTaskId,
          packageRoot,
          descriptor: updatedDescriptor,
          state,
        });
        return {
          taskId: effectiveTaskId,
          taskKey: context.taskKey,
          ...claimProjection,
          updated: true,
        };
      });
    });
  }

  const state = await readWorkState(target, { packageRoot, taskId: effectiveTaskId });
  const claimProjection = await resolveTaskClaimState(target, {
    taskId: effectiveTaskId,
    packageRoot,
    descriptor,
    state,
  });
  return {
    taskId: effectiveTaskId,
    taskKey: context.taskKey,
    ...claimProjection,
    updated: false,
  };
}

export function formatTaskScopeResult(result) {
  const claims = result.writeClaims.length === 0 ? "none" : result.writeClaims.join(", ");
  const action = result.updated ? "updated scope" : "current scope";
  return `${action} for ${result.taskId}: ${claims}\n`;
}
