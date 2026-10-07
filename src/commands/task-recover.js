import { randomUUID } from "node:crypto";

import { resolveTaskContext } from "../core/task-context.js";
import { inspectTaskConflictState } from "../core/task-conflict-inspection.js";
import { appendProtocolEvent } from "../core/events.js";
import { getTaskTransaction, withTaskTransaction } from "../core/transaction.js";
import { currentRepositoryFingerprint } from "../core/repository.js";
import {
  readLockInfo,
  releaseStaleTaskLockIfUnchanged,
  withProjectClaimsLock,
} from "../core/task-lock.js";
import {
  E_TASK_RECOVERY_AUTHORIZATION_REQUIRED,
  E_TASK_RECOVERY_INCONSISTENT,
  E_TASK_RECOVERY_OFFICIAL_PATH_AVAILABLE,
  E_TASK_RECOVERY_UNSAFE,
  E_TASK_ALREADY_RECOVERED,
} from "../core/error-codes.js";
import { readTaskDescriptor } from "../core/task-descriptor.js";
import {
  createTaskRecovery,
  writeTaskRecovery,
} from "../core/task-recovery.js";
import { resolveTaskClaimState } from "../core/task-claim-state.js";

export const TASK_RECOVERY_ALLOWED_CLASSIFICATIONS = Object.freeze(new Set([
  "STALE",
  "ABANDONED",
]));

function recoveryError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function alreadyRecoveredError(taskId, recovery) {
  const error = recoveryError(E_TASK_ALREADY_RECOVERED, `Task ${taskId} is already RECOVERED`);
  error.recovery = recovery;
  return error;
}

async function assertConsistentRecoverableOwnership(target, taskId, packageRoot) {
  const projection = await resolveTaskClaimState(target, { taskId, packageRoot });
  if (!projection.valid) {
    const error = recoveryError(
      E_TASK_RECOVERY_INCONSISTENT,
      `Task ${taskId} claim ownership is inconsistent; repair recovery state before task-recover`,
    );
    error.reasonCodes = projection.reasonCodes;
    error.recoveryErrors = projection.ownershipErrors;
    throw error;
  }
  if (projection.claimState === "RELEASED_BY_RECOVERY") {
    throw alreadyRecoveredError(taskId, projection.recovery);
  }
  return projection;
}

function assertRecoveryAllowed(taskId, inspection) {
  if (inspection.classification === "RECOVERABLE") {
    throw recoveryError(
      E_TASK_RECOVERY_OFFICIAL_PATH_AVAILABLE,
      `Task ${taskId} is RECOVERABLE through canonical reconciliation; claim-release recovery is refused`,
    );
  }
  if (inspection.classification === "INCONSISTENT") {
    throw recoveryError(
      E_TASK_RECOVERY_INCONSISTENT,
      `Task ${taskId} state is INCONSISTENT (${inspection.reasonCodes.join(", ")}); repair the underlying artifact first`,
    );
  }
  if (!TASK_RECOVERY_ALLOWED_CLASSIFICATIONS.has(inspection.classification)) {
    throw recoveryError(
      E_TASK_RECOVERY_UNSAFE,
      `Task ${taskId} is ${inspection.classification} (${inspection.reasonCodes.join(", ")}); only STALE or ABANDONED tasks may release claims`,
    );
  }
}

export async function runTaskRecover({
  target,
  packageRoot,
  taskId,
  acknowledgeRecovery = false,
  operatorAuthorized = false,
} = {}) {
  const nested = Boolean(await getTaskTransaction(target));
  const context = await resolveTaskContext(target, { taskId, packageRoot, explicitRequired: true });
  const effectiveTaskId = context.taskId;

  if (!acknowledgeRecovery && !operatorAuthorized) {
    throw recoveryError(
      E_TASK_RECOVERY_AUTHORIZATION_REQUIRED,
      "task-recover requires explicit caller acknowledgement: re-run with --acknowledge-recovery",
    );
  }

  await assertConsistentRecoverableOwnership(target, effectiveTaskId, packageRoot);

  return withProjectClaimsLock(target, "task-recover", async () => {
    await assertConsistentRecoverableOwnership(target, effectiveTaskId, packageRoot);

    const inspectionBeforeLock = await inspectTaskConflictState(target, {
      taskId: effectiveTaskId,
      packageRoot,
    });
    assertRecoveryAllowed(effectiveTaskId, inspectionBeforeLock);

    if (inspectionBeforeLock.evidence.lockStatus === "STALE") {
      const expectedLock = await readLockInfo(target, effectiveTaskId);
      const released = await releaseStaleTaskLockIfUnchanged(target, effectiveTaskId, expectedLock);
      if (!released.released && released.reason !== "LOCK_MISSING") {
        throw recoveryError(
          E_TASK_RECOVERY_UNSAFE,
          `Task ${effectiveTaskId} lock changed during recovery (${released.reason}); retry after re-inspection`,
        );
      }
    }

    return withTaskTransaction({
      target,
      taskId: effectiveTaskId,
      operation: "task-recover",
      packageRoot,
      recordCommitEvent: true,
    }, async (transaction) => {
      await assertConsistentRecoverableOwnership(target, effectiveTaskId, packageRoot);

      const inspection = await inspectTaskConflictState(target, {
        taskId: effectiveTaskId,
        packageRoot,
        ignoredLockId: transaction.lock?.lockId ?? null,
      });
      assertRecoveryAllowed(effectiveTaskId, inspection);
      if (inspection.evidence.workStateRevision !== inspectionBeforeLock.evidence.workStateRevision
        || inspection.evidence.ledgerLastSeq !== inspectionBeforeLock.evidence.ledgerLastSeq
        || inspection.evidence.phase !== inspectionBeforeLock.evidence.phase) {
        throw recoveryError(
          E_TASK_RECOVERY_UNSAFE,
          `Task ${effectiveTaskId} changed during recovery precondition validation`,
        );
      }

      const descriptorArtifact = await readTaskDescriptor(target, context.taskKey, packageRoot);
      const releasedClaims = descriptorArtifact?.value?.writeClaims ?? [];
      const repository = await currentRepositoryFingerprint(target);
      const recoveryId = `recovery-${randomUUID()}`;
      const recoveredAt = new Date().toISOString();
      const recoveryEvent = await appendProtocolEvent(target, {
        taskId: effectiveTaskId,
        event: "OPERATOR_RECOVERY_RECORDED",
        at: recoveredAt,
        details: {
          recoveryId,
          classification: inspection.classification,
          reasonCodes: inspection.reasonCodes,
          previousPhase: inspection.evidence.phase,
          previousRevision: inspection.evidence.workStateRevision ?? 0,
          previousHead: inspection.evidence.repositoryHead,
          previousBranch: inspection.evidence.repositoryBranch,
          currentHead: repository.head,
          currentBranch: repository.branch,
          releasedClaims,
          authorityKind: "CALLER_ACKNOWLEDGED",
        },
      }, packageRoot, { taskId: effectiveTaskId });

      await writeTaskRecovery(target, createTaskRecovery({
        taskId: effectiveTaskId,
        recoveredAt,
        recoveryId,
        recoveryEventSeq: recoveryEvent.seq,
        classificationAtRecovery: inspection.classification,
        reasonCodes: inspection.reasonCodes,
        releasedClaims,
        previousPhase: inspection.evidence.phase,
        previousRevision: inspection.evidence.workStateRevision ?? 0,
        repositoryFingerprint: repository,
        authority: { kind: "CALLER_ACKNOWLEDGED" },
      }), packageRoot);

      return {
        taskId: effectiveTaskId,
        taskKey: context.taskKey,
        recovered: true,
        recoveryId,
        classification: inspection.classification,
        reasonCodes: inspection.reasonCodes,
        phase: inspection.evidence.phase,
        claimsReleased: true,
        releasedClaims,
        authority: { kind: "CALLER_ACKNOWLEDGED" },
        message: `Task ${effectiveTaskId} recovered by caller acknowledgement; write claims released without completion claim`,
      };
    });
  }).catch(async error => {
    if (error.code === "E_STATE_REVISION_CONFLICT" && !nested) {
      // The failed transaction has rolled back. Report a competing validated
      // recovery through the existing domain error; never replay claim release.
      await assertConsistentRecoverableOwnership(target, effectiveTaskId, packageRoot);
    }
    throw error;
  });
}

export function formatTaskRecoverResult(result) {
  return `${result.message}\nclassification: ${result.classification}\nphase: ${result.phase} (unchanged)\n`;
}
