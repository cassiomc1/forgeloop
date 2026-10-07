import { withProjectReadSnapshot } from "../storage/project-read-snapshot.js";
import { canonicalFingerprint } from "../core/artifacts.js";
import { readContract } from "../core/contract.js";
import {
  appendProtocolEvent,
  validateEventLedger,
  validateStateLedgerCoherence,
} from "../core/events.js";
import { readPersistedRoute } from "../core/route-artifact.js";
import { currentRepositoryFingerprint } from "../core/repository.js";
import { resolveTaskContext } from "../core/task-context.js";
import { taskArtifactPath } from "../core/task-paths.js";
import { assertTaskMutationAllowed } from "../core/task-claim-state.js";
import { getTaskTransaction, withTaskTransaction } from "../core/transaction.js";
import {
  CHECKPOINT_REVALIDATED_EVENT,
  assertCheckpointRevalidatedDetails,
  assertRepositoryFingerprint,
} from "../core/checkpoint-revalidation.js";
import { resolveTaskClaimState } from "../core/task-claim-state.js";
import { sameCanonicalGuideList, resolveEffectiveContractBootstrapRepairAnchor } from "../core/contract-bootstrap-recovery.js";
import {
  classifyLoadedWorkState,
  createWorkState,
  mutateWorkState,
  readWorkState,
} from "../core/work-state.js";

function revalidationError(message, details = {}) {
  const error = new Error(message);
  error.code = "E_CHECKPOINT_REVALIDATION_UNSAFE";
  Object.assign(error, details);
  return error;
}

function sameRepositoryFingerprint(left, right) {
  return left?.branch === right?.branch && left?.head === right?.head;
}

function assertRouteIdentity(state, contract, route) {
  if (!route || route.value?.contractFingerprint !== contract.fingerprint
    || state.routeFingerprint !== route.fingerprint
    || !sameCanonicalGuideList(state.selectedGuides, route.value.guides)) {
    throw revalidationError("ROUTED checkpoint route identity cannot be proven safe", {
      artifacts: [taskArtifactPath(state.taskId, "state"), taskArtifactPath(state.taskId, "route")],
    });
  }
}

async function inspectEligibility(target, packageRoot, taskId) {
  return withProjectReadSnapshot(target, () => inspectSelectedEligibility(target, packageRoot, taskId));
}

async function inspectSelectedEligibility(target, packageRoot, taskId) {
  const state = await readWorkState(target, { packageRoot, taskId });
  if (!state) throw revalidationError("A persisted work-state checkpoint is required");
  if (state.phase !== "ROUTED") throw revalidationError(`Checkpoint revalidation supports phase ROUTED, found ${state.phase}`);

  const ledger = await validateEventLedger(target, packageRoot, { taskId });
  if (!ledger.valid) throw revalidationError("Checkpoint revalidation requires a structurally valid event ledger", { errors: ledger.errors });
  if (ledger.events.some((event) => event.event === "EXECUTION_STARTED")) {
    throw revalidationError("Checkpoint revalidation is unavailable after execution has started");
  }
  const coherenceErrors = validateStateLedgerCoherence(state, ledger.events);
  if (coherenceErrors.length > 0) throw revalidationError("Checkpoint revalidation requires coherent state and ledger", { errors: coherenceErrors });
  const ownership = await resolveTaskClaimState(target, { taskId, packageRoot });
  if (!ownership.ownershipValid || !ownership.mutationAllowed) {
    throw revalidationError("Checkpoint revalidation cannot bypass invalid task ownership", { errors: ownership.ownershipErrors });
  }
  const contract = await readContract(target, packageRoot, { taskId });
  if (state.contractFingerprint !== contract.fingerprint) {
    throw revalidationError("Checkpoint contract identity changed; use the contract revision path");
  }
  const route = await readPersistedRoute(target, packageRoot, { taskId });
  assertRouteIdentity(state, contract, route);

  const freshness = await classifyLoadedWorkState({
    target,
    state,
    contractFile: taskArtifactPath(taskId, "contract"),
  });
  const repository = freshness.repository;
  assertRepositoryFingerprint(repository, "current repository fingerprint", { requireHead: true });
  const reasons = [...new Set(freshness.reasons)].sort();
  if (reasons.length === 0) {
    return { state, contract, route, ledger, repository, freshness, alreadyFresh: true };
  }
  if (reasons.length !== 1 || reasons[0] !== "REPOSITORY_CHANGED") {
    throw revalidationError(`Checkpoint freshness is not repository-only: ${reasons.join(", ")}`);
  }
  const repairAnchor = resolveEffectiveContractBootstrapRepairAnchor(ledger.events);
  if (repairAnchor && (repairAnchor.details.contractFingerprint !== contract.fingerprint
    || repairAnchor.details.routeFingerprint !== route.fingerprint)) {
    throw revalidationError("Repaired checkpoint identity does not match the current contract and route");
  }
  return { state, contract, route, ledger, repository, freshness, repairAnchor, alreadyFresh: false };
}

function resultFor(taskId, state, repository, event = null, transaction = null, alreadyFresh = false) {
  return {
    taskId,
    revalidated: !alreadyFresh,
    alreadyFresh,
    phase: state.phase,
    previousRevision: event ? event.details.previousStateRevision : state.revision,
    revalidatedRevision: event ? event.details.revalidatedStateRevision : state.revision,
    previousRepositoryFingerprint: event?.details.previousRepositoryFingerprint ?? repository,
    repositoryFingerprint: event?.details.repositoryFingerprint ?? repository,
    eventSeq: event?.seq ?? null,
    transactionCommitSeq: transaction?.seq ?? null,
  };
}

async function revalidateLocked(target, packageRoot, taskId, transaction) {
  const ownership = await resolveTaskClaimState(target, { taskId, packageRoot });
  if (!ownership.ownershipValid || !ownership.mutationAllowed) {
    throw revalidationError("Checkpoint revalidation cannot bypass invalid task ownership", { errors: ownership.ownershipErrors });
  }
  await assertTaskMutationAllowed(target, { taskId, packageRoot });
  const inspected = await inspectEligibility(target, packageRoot, taskId);
  if (inspected.alreadyFresh) return resultFor(taskId, inspected.state, inspected.repository, null, null, true);

  const before = inspected.state;
  const previousStateFingerprint = canonicalFingerprint(before);
  const previousRepositoryFingerprint = structuredClone(before.repositoryFingerprint);
  const repository = await currentRepositoryFingerprint(target);
  assertRepositoryFingerprint(repository, "current repository fingerprint", { requireHead: true });
  if (!sameRepositoryFingerprint(repository, inspected.repository)) {
    throw revalidationError("Repository identity changed during checkpoint revalidation");
  }
  const next = await mutateWorkState(target, {
    expectedRevision: before.revision,
    packageRoot,
    taskId,
  }, (current) => createWorkState({
    ...current,
    repositoryFingerprint: repository,
    lastUpdated: new Date().toISOString(),
  }));
  const details = {
    phase: next.phase,
    previousRepositoryFingerprint,
    repositoryFingerprint: structuredClone(repository),
    contractFingerprint: next.contractFingerprint,
    routeFingerprint: next.routeFingerprint,
    previousStateRevision: before.revision,
    revalidatedStateRevision: next.revision,
    previousStateFingerprint,
    revalidatedStateFingerprint: canonicalFingerprint(next),
  };
  assertCheckpointRevalidatedDetails(details);
  const event = await appendProtocolEvent(target, {
    taskId,
    event: CHECKPOINT_REVALIDATED_EVENT,
    details,
  }, packageRoot, { taskId });
  const commitEvent = await appendProtocolEvent(target, {
    taskId,
    event: "TRANSACTION_COMMITTED",
    details: { transactionId: transaction.transactionId, operation: "checkpoint-revalidate" },
  }, packageRoot, { taskId });
  return resultFor(taskId, next, repository, event, commitEvent, false);
}

export async function runCheckpointRevalidate({ target, packageRoot, taskId } = {}) {
  const context = await resolveTaskContext(target, { taskId, packageRoot, explicitRequired: true });
  const effectiveTaskId = context.taskId;
  const initial = await inspectEligibility(target, packageRoot, effectiveTaskId);
  if (initial.alreadyFresh) return resultFor(effectiveTaskId, initial.state, initial.repository, null, null, true);
  const nested = Boolean(await getTaskTransaction(target));
  try {
    return await withTaskTransaction({
      target,
      taskId: effectiveTaskId,
      operation: "checkpoint-revalidate",
      packageRoot,
      recordCommitEvent: false,
    }, async (transaction) => revalidateLocked(target, packageRoot, effectiveTaskId, transaction));
  } catch (error) {
    if (nested || error?.code !== "E_STATE_REVISION_CONFLICT") throw error;
    // A competing writer may have completed this exact revalidation. Recheck
    // all eligibility and history after our preparation rolled back; never
    // replay mutation or convert an unrelated conflict into success.
    const current = await inspectEligibility(target, packageRoot, effectiveTaskId);
    if (!current.alreadyFresh) throw error;
    return resultFor(effectiveTaskId, current.state, current.repository, null, null, true);
  }
}

export function formatCheckpointRevalidateResult(result) {
  return `${JSON.stringify(result, null, 2)}\n`;
}
