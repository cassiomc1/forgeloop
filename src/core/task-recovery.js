import { PROTOCOL_VERSION } from "./protocol.js";
import { LEGACY_RECOVERY_MIGRATION_EVENT } from "./task-recovery-migration.js";
import { readJsonArtifact, writeJsonArtifact } from "./artifacts.js";
import {
  E_TASK_RECOVERY_AUTHORITY_INVALID,
} from "./error-codes.js";
import { taskArtifactPath } from "./task-paths.js";
import { getTaskTransaction } from "./transaction.js";
import { classifyRecoveryHistory } from "./recovery-history.js";

export const TASK_RECOVERY_SCHEMA_VERSION = 1;
export const TASK_RECOVERY_EVENT_TYPES = Object.freeze(new Set([
  "TASK_RECOVERY_RECORDED",
  "OPERATOR_RECOVERY_RECORDED",
  "TASK_ABANDONED",
  LEGACY_RECOVERY_MIGRATION_EVENT,
]));

export function createTaskRecovery({
  taskId,
  recoveredAt,
  recoveryId,
  recoveryEventSeq,
  classificationAtRecovery,
  reasonCodes,
  releasedClaims,
  previousPhase,
  previousRevision,
  repositoryFingerprint,
  authority,
}) {
  const recovery = {
    schemaVersion: TASK_RECOVERY_SCHEMA_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    taskId,
    status: "RECOVERED",
    recoveredAt,
    recoveryId,
    recoveryEventSeq,
    classificationAtRecovery,
    reasonCodes: [...reasonCodes],
    releasedClaims: [...releasedClaims],
    previousPhase,
    previousRevision,
    repositoryFingerprint: { ...repositoryFingerprint },
    authority: { ...authority },
  };
  assertTaskRecoveryAuthority(recovery);
  return recovery;
}

export function assertTaskRecoveryAuthority(recovery) {
  const authority = recovery?.authority;
  const validCaller = authority?.kind === "CALLER_ACKNOWLEDGED" && authority.grantRef === undefined;
  const validHost = authority?.kind === "HOST_ATTESTED"
    && typeof authority.grantRef === "string"
    && authority.grantRef.trim() !== "";
  if (validCaller || validHost) return recovery;
  const error = new Error(
    "Recovery authority must be caller acknowledgement or host attestation with a trusted grant reference",
  );
  error.code = E_TASK_RECOVERY_AUTHORITY_INVALID;
  throw error;
}

export async function readTaskRecovery(target, { taskId, packageRoot } = {}) {
  try {
    const artifact = await readJsonArtifact(target, taskArtifactPath(taskId, "recovery"), "task-recovery", packageRoot);
    assertTaskRecoveryAuthority(artifact.value);
    return artifact;
  } catch (error) {
    if (error.code === "ARTIFACT_MISSING") return null;
    throw error;
  }
}

export function writeTaskRecovery(target, recovery, packageRoot) {
  assertTaskRecoveryAuthority(recovery);
  return writeJsonArtifact(
    target,
    taskArtifactPath(recovery.taskId, "recovery"),
    recovery,
    "task-recovery",
    packageRoot,
    { taskId: recovery.taskId, operation: "write-task-recovery" },
  );
}

export async function clearTaskRecovery(target, { taskId } = {}) {
  const transaction = (await getTaskTransaction(target));
  if (!transaction) {
    throw new Error("clearTaskRecovery requires an active task transaction");
  }
  await transaction.stageDelete(taskArtifactPath(taskId, "recovery"));
}

export function isTaskRecovered(recovery) {
  return recovery?.status === "RECOVERED";
}

export async function assertTaskNotRecovered(target, { taskId, packageRoot } = {}) {
  const { assertTaskMutationAllowed } = await import("./task-claim-state.js");
  return assertTaskMutationAllowed(target, { taskId, packageRoot });
}

export function effectiveTaskClaims({
  validatedClaimState = null,
  historicalWriteClaims = null,
  writeClaims = [],
} = {}) {
  const historical = historicalWriteClaims ?? writeClaims;
  // Only VALIDATED canonical ownership may release claims. A bare
  // `phase === "COMPLETE"` never proves completion ownership.
  const validatedRelease = validatedClaimState?.valid === true
    && ["RELEASED_BY_COMPLETION", "RELEASED_BY_RECOVERY"].includes(validatedClaimState.claimState);
  return validatedRelease ? [] : [...historical];
}

export function taskClaimProjection({
  validatedClaimState = null,
  historicalWriteClaims: suppliedHistoricalClaims = null,
  writeClaims = [],
} = {}) {
  const historicalWriteClaims = [...(suppliedHistoricalClaims ?? writeClaims)];
  const effectiveWriteClaims = effectiveTaskClaims({
    validatedClaimState,
    historicalWriteClaims,
  });
  const claimState = validatedClaimState?.valid === true
    ? validatedClaimState.claimState
    : "ACTIVE";
  return {
    writeClaims: effectiveWriteClaims,
    historicalWriteClaims,
    effectiveWriteClaims,
    claimState,
    mutationAllowed: claimState === "ACTIVE",
  };
}

function sameList(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function recoveryConsistencyError(message) {
  return { code: "E_TASK_RECOVERY_INCONSISTENT", message };
}

export function validateTaskRecoveryConsistency({
  taskId,
  recovery = null,
  events = [],
  historicalWriteClaims = null,
  recoveryHistory = null,
} = {}) {
  const history = recoveryHistory ?? classifyRecoveryHistory(events);
  const errors = [...history.errors];

  if (!recovery) {
    if (history.valid && history.activeRecovery) {
      errors.push(recoveryConsistencyError(
        `Recovery event ${history.activeRecovery.recoveryId} has neither an active recovery artifact nor a resume event`,
      ));
    }
    return errors;
  }
  if (!history.activeRecovery || history.activeRecovery.recoveryId !== recovery.recoveryId) {
    errors.push(recoveryConsistencyError(
      `Recovery artifact ${recovery.recoveryId ?? "unknown"} does not match the active recovery history`,
    ));
  }
  if (recovery.taskId !== taskId) {
    errors.push(recoveryConsistencyError(`Recovery artifact belongs to ${recovery.taskId}, not ${taskId}`));
  }
  const event = events.find((candidate) => candidate.seq === recovery.recoveryEventSeq);
  if (!event || !TASK_RECOVERY_EVENT_TYPES.has(event.event)) {
    errors.push(recoveryConsistencyError(
      `Recovery artifact references missing recovery event seq ${recovery.recoveryEventSeq}`,
    ));
    return errors;
  }

  const comparisons = [
    [event.taskId === recovery.taskId, "taskId"],
    [event.at === recovery.recoveredAt, "recoveredAt"],
    [event.details?.recoveryId === recovery.recoveryId, "recoveryId"],
    [event.details?.classification === recovery.classificationAtRecovery, "classificationAtRecovery"],
    [sameList(event.details?.reasonCodes, recovery.reasonCodes), "reasonCodes"],
    [sameList(event.details?.releasedClaims, recovery.releasedClaims), "releasedClaims"],
    [event.details?.previousPhase === recovery.previousPhase, "previousPhase"],
    [event.details?.previousRevision === recovery.previousRevision, "previousRevision"],
    [event.details?.currentBranch === recovery.repositoryFingerprint?.branch, "repositoryFingerprint.branch"],
    [event.details?.currentHead === recovery.repositoryFingerprint?.head, "repositoryFingerprint.head"],
    [event.details?.authorityKind === recovery.authority?.kind, "authority.kind"],
  ];
  for (const [matches, field] of comparisons) {
    if (!matches) errors.push(recoveryConsistencyError(`Recovery artifact and ledger disagree on ${field}`));
  }
  if (historicalWriteClaims && !sameList(historicalWriteClaims, recovery.releasedClaims)) {
    errors.push(recoveryConsistencyError("Recovery releasedClaims do not match the task descriptor's historical claims"));
  }
  return errors;
}
