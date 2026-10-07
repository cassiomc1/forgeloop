import { randomUUID } from "node:crypto";

import { resolveTaskContext } from "../core/task-context.js";
import { inspectTaskConflictState } from "../core/task-conflict-inspection.js";
import { appendProtocolEvent } from "../core/events.js";
import { withTaskTransaction } from "../core/transaction.js";
import { currentRepositoryFingerprint } from "../core/repository.js";
import { withProjectClaimsLock } from "../core/task-lock.js";
import { readTaskDescriptor } from "../core/task-descriptor.js";
import { createTaskRecovery, writeTaskRecovery } from "../core/task-recovery.js";
import { resolveTaskClaimState } from "../core/task-claim-state.js";
import {
  E_TASK_ABANDON_AUTHORIZATION_REQUIRED,
  E_TASK_ABANDON_INCONSISTENT,
  E_TASK_ABANDON_INVALID_STATE,
  E_TASK_ABANDON_UNSAFE,
  E_TASK_ALREADY_ABANDONED,
} from "../core/error-codes.js";

const ABANDONMENT_REASON_CODES = Object.freeze(["CALLER_ABANDONED"]);

function abandonError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  return error;
}

function sameList(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function snapshot(inspection) {
  return {
    phase: inspection.evidence.phase,
    revision: inspection.evidence.workStateRevision,
    ledgerLastSeq: inspection.evidence.ledgerLastSeq,
    claimState: inspection.evidence.claimState,
    effectiveWriteClaims: [...inspection.evidence.effectiveWriteClaims],
  };
}

function assertSnapshotUnchanged(before, after, taskId) {
  const unchanged = before.phase === after.phase
    && before.revision === after.revision
    && before.ledgerLastSeq === after.ledgerLastSeq
    && before.claimState === after.claimState
    && sameList(before.effectiveWriteClaims, after.effectiveWriteClaims);
  if (!unchanged) {
    throw abandonError(
      E_TASK_ABANDON_UNSAFE,
      `Task ${taskId} changed during abandonment precondition validation`,
      { before, after },
    );
  }
}

async function assertAbandonableOwnership(target, taskId, packageRoot) {
  const projection = await resolveTaskClaimState(target, { taskId, packageRoot });
  if (projection.phase === "COMPLETE" || projection.claimState === "RELEASED_BY_COMPLETION") {
    throw abandonError(E_TASK_ABANDON_INVALID_STATE, `Task ${taskId} is COMPLETE and cannot be abandoned`);
  }
  if (!projection.valid || !projection.ownershipValid) {
    throw abandonError(
      E_TASK_ABANDON_INCONSISTENT,
      `Task ${taskId} claim ownership is inconsistent; abandonment is blocked`,
      { reasonCodes: projection.reasonCodes, ownershipErrors: projection.ownershipErrors },
    );
  }
  if (projection.claimState === "RELEASED_BY_RECOVERY") {
    throw abandonError(
      E_TASK_ALREADY_ABANDONED,
      `Task ${taskId} is already abandoned/recovered`,
      { recovery: projection.recovery },
    );
  }
  if (projection.claimState !== "ACTIVE" || projection.mutationAllowed !== true) {
    throw abandonError(E_TASK_ABANDON_INVALID_STATE, `Task ${taskId} is not an active mutable task`);
  }
  return projection;
}

function assertInspectionAbandonable(taskId, inspection) {
  if (!inspection.evidence.healthy || !inspection.evidence.ledgerValid || !inspection.evidence.ownershipValid) {
    throw abandonError(
      E_TASK_ABANDON_INCONSISTENT,
      `Task ${taskId} cannot be abandoned because canonical ownership or ledger validation failed`,
      { reasonCodes: inspection.reasonCodes, ledgerErrors: inspection.evidence.ledgerErrors },
    );
  }
  if (!inspection.evidence.phase || inspection.evidence.phase === "COMPLETE") {
    throw abandonError(E_TASK_ABANDON_INVALID_STATE, `Task ${taskId} is not eligible for abandonment`);
  }
  if (inspection.evidence.claimState !== "ACTIVE" || inspection.evidence.mutationAllowed !== true) {
    throw abandonError(E_TASK_ABANDON_INVALID_STATE, `Task ${taskId} is not an active mutable task`);
  }
}

export async function runTaskAbandon({
  target,
  packageRoot,
  taskId,
  acknowledgeAbandonment = false,
} = {}) {
  if (typeof taskId !== "string" || taskId.trim() === "") {
    throw abandonError(E_TASK_ABANDON_INVALID_STATE, "task-abandon requires an explicit --task ID");
  }
  if (!acknowledgeAbandonment) {
    throw abandonError(
      E_TASK_ABANDON_AUTHORIZATION_REQUIRED,
      "task-abandon requires explicit caller acknowledgement: re-run with --acknowledge-abandonment",
    );
  }

  let context;
  try {
    context = await resolveTaskContext(target, { taskId, packageRoot, explicitRequired: true });
  } catch (error) {
    throw abandonError(
      E_TASK_ABANDON_INCONSISTENT,
      `Task ${taskId} cannot be abandoned because its canonical identity is unreadable`,
      { causeCode: error.code, causeMessage: error.message },
    );
  }
  const effectiveTaskId = context.taskId;
  await assertAbandonableOwnership(target, effectiveTaskId, packageRoot);

  return withProjectClaimsLock(target, "task-abandon", async () => {
    await assertAbandonableOwnership(target, effectiveTaskId, packageRoot);
    const inspectionBeforeLock = await inspectTaskConflictState(target, {
      taskId: effectiveTaskId,
      packageRoot,
    });
    assertInspectionAbandonable(effectiveTaskId, inspectionBeforeLock);
    const before = snapshot(inspectionBeforeLock);

    return withTaskTransaction({
      target,
      taskId: effectiveTaskId,
      operation: "task-abandon",
      packageRoot,
      recordCommitEvent: true,
    }, async (transaction) => {
      const descriptor = await readTaskDescriptor(target, context.taskKey, packageRoot);
      if (descriptor.value.taskId !== effectiveTaskId || descriptor.value.taskKey !== context.taskKey) {
        throw abandonError(E_TASK_ABANDON_UNSAFE, `Task ${effectiveTaskId} identity changed during abandonment`);
      }

      await assertAbandonableOwnership(target, effectiveTaskId, packageRoot);
      const inspection = await inspectTaskConflictState(target, {
        taskId: effectiveTaskId,
        packageRoot,
        ignoredLockId: transaction.lock?.lockId ?? null,
      });
      assertInspectionAbandonable(effectiveTaskId, inspection);
      assertSnapshotUnchanged(before, snapshot(inspection), effectiveTaskId);

      const repository = await currentRepositoryFingerprint(target);
      const recoveryId = `recovery-${randomUUID()}`;
      const abandonedAt = new Date().toISOString();
      const releasedClaims = [...inspection.evidence.effectiveWriteClaims];
      const details = {
        recoveryId,
        classification: "ABANDONED",
        reasonCodes: [...ABANDONMENT_REASON_CODES],
        previousPhase: inspection.evidence.phase,
        previousRevision: inspection.evidence.workStateRevision,
        previousHead: inspection.evidence.repositoryHead,
        previousBranch: inspection.evidence.repositoryBranch,
        currentHead: repository.head,
        currentBranch: repository.branch,
        releasedClaims,
        authorityKind: "CALLER_ACKNOWLEDGED",
      };

      const abandonmentEvent = await appendProtocolEvent(target, {
        taskId: effectiveTaskId,
        event: "TASK_ABANDONED",
        at: abandonedAt,
        details,
      }, packageRoot, { taskId: effectiveTaskId });

      await writeTaskRecovery(target, createTaskRecovery({
        taskId: effectiveTaskId,
        recoveredAt: abandonedAt,
        recoveryId,
        recoveryEventSeq: abandonmentEvent.seq,
        classificationAtRecovery: "ABANDONED",
        reasonCodes: ABANDONMENT_REASON_CODES,
        releasedClaims,
        previousPhase: inspection.evidence.phase,
        previousRevision: inspection.evidence.workStateRevision,
        repositoryFingerprint: repository,
        authority: { kind: "CALLER_ACKNOWLEDGED" },
      }), packageRoot);

      return {
        taskId: effectiveTaskId,
        taskKey: context.taskKey,
        abandoned: true,
        recovered: true,
        recoveryId,
        classification: "ABANDONED",
        reasonCodes: [...ABANDONMENT_REASON_CODES],
        phase: inspection.evidence.phase,
        claimsReleased: true,
        releasedClaims,
        effectiveWriteClaims: [],
        claimState: "RELEASED_BY_RECOVERY",
        mutationAllowed: false,
        authority: { kind: "CALLER_ACKNOWLEDGED" },
        message: `Task ${effectiveTaskId} explicitly abandoned by caller acknowledgement; write claims released without completion claim`,
      };
    });
  });
}

export function formatTaskAbandonResult(result) {
  const claims = result.releasedClaims.length === 0 ? "none" : result.releasedClaims.join(", ");
  return `${result.message}\nclassification: ${result.classification}\nphase: ${result.phase} (unchanged)\nreleased claims: ${claims}\n`;
}
