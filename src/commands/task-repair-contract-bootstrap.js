import { canonicalFingerprint } from "../core/artifacts.js";
import { readContract } from "../core/contract.js";
import { appendProtocolEvent, validateEventLedger } from "../core/events.js";
import { readPersistedRoute } from "../core/route-artifact.js";
import { currentRepositoryFingerprint } from "../core/repository.js";
import { resolveTaskContext } from "../core/task-context.js";
import { taskArtifactPath } from "../core/task-paths.js";
import { withProjectClaimsLock, readLockInfo, classifyLockStaleness, releaseStaleTaskLockIfUnchanged } from "../core/task-lock.js";
import { withTaskTransaction } from "../core/transaction.js";
import { createWorkState, mutateWorkState, readWorkState } from "../core/work-state.js";
import { resolveTaskClaimState } from "../core/task-claim-state.js";
import {
  CONTRACT_BOOTSTRAP_REPAIR_AUTHORITY,
  CONTRACT_BOOTSTRAP_REPAIR_DEFECT,
  CONTRACT_BOOTSTRAP_REPAIR_EVENT,
  CONTRACT_BOOTSTRAP_REPAIR_VERSION,
  assertContractBootstrapRepairDetails,
  contractBootstrapRepairId,
  isContractBootstrapRepairCandidate,
  resolveEffectiveContractBootstrapRepairAnchor,
} from "../core/contract-bootstrap-recovery.js";
import {
  E_CONTRACT_BOOTSTRAP_REPAIR_AUTHORIZATION_REQUIRED,
  E_CONTRACT_BOOTSTRAP_REPAIR_INVALID,
  E_CONTRACT_BOOTSTRAP_REPAIR_UNSAFE,
  E_TASK_LOCKED,
} from "../core/error-codes.js";

function repairError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  return error;
}

async function readRouteIfProven(target, packageRoot, taskId, events, contractFingerprint) {
  const routePath = taskArtifactPath(taskId, "route");
  const hasRouteValidated = events.some((event) => event.event === "ROUTE_VALIDATED");
  if (!hasRouteValidated) return null;
  try {
    const route = await readPersistedRoute(target, packageRoot, { taskId });
    if (route.value.contractFingerprint !== contractFingerprint) {
      throw repairError(E_CONTRACT_BOOTSTRAP_REPAIR_UNSAFE, "Persisted route does not bind to the canonical contract fingerprint");
    }
    return route;
  } catch (error) {
    if (error.code === "ARTIFACT_MISSING") {
      throw repairError(E_CONTRACT_BOOTSTRAP_REPAIR_UNSAFE, "ROUTE_VALIDATED history requires a persisted route artifact", { artifacts: [routePath] });
    }
    if (error.code === E_CONTRACT_BOOTSTRAP_REPAIR_UNSAFE) throw error;
    throw repairError(E_CONTRACT_BOOTSTRAP_REPAIR_UNSAFE, `Persisted route cannot be proven safe: ${error.message}`, { artifacts: [routePath] });
  }
}

function stateForRepair(state, { taskId, contractFingerprint, route, repository }) {
  const routed = Boolean(route);
  const phase = routed ? "ROUTED" : "CONTRACT_READY";
  const steps = routed
    ? { completedSteps: ["contract", "route"], pendingSteps: ["planning", "implementation", "verification"] }
    : { completedSteps: ["contract"], pendingSteps: ["route", "planning", "implementation", "verification"] };
  const base = state ? {
    ...state,
    taskId,
    contractFingerprint,
    ...(routed ? { routeFingerprint: route.fingerprint } : { routeFingerprint: undefined }),
    repositoryFingerprint: repository,
    phase,
    selectedGuides: routed ? [...route.value.guides] : [],
    completedSteps: steps.completedSteps,
    pendingSteps: steps.pendingSteps,
    revision: (state.revision ?? 0) + 1,
    lastUpdated: new Date().toISOString(),
    ...(state.phase !== phase ? { previousPhase: state.phase } : {}),
  } : createWorkState({
    taskId,
    contractFingerprint,
    ...(routed ? { routeFingerprint: route.fingerprint } : {}),
    repositoryFingerprint: repository,
    phase,
    selectedGuides: routed ? [...route.value.guides] : [],
    requiredGates: [],
    satisfiedGates: [],
    completedSteps: steps.completedSteps,
    pendingSteps: steps.pendingSteps,
    requiredArtifacts: [],
    checks: [],
    failures: [],
    blockers: [],
    verificationEvidence: [],
    revision: 0,
  });
  if (base.routeFingerprint === undefined) delete base.routeFingerprint;
  return createWorkState(base);
}

function assertStateCompatible(state, taskId, contractFingerprint, route) {
  if (!state) return;
  if (state.taskId !== taskId || state.contractFingerprint !== contractFingerprint) {
    throw repairError(E_CONTRACT_BOOTSTRAP_REPAIR_UNSAFE, "Existing work-state is bound to a different task or contract");
  }
  if (!["CONTRACT_READY", "ROUTED"].includes(state.phase)) {
    throw repairError(E_CONTRACT_BOOTSTRAP_REPAIR_UNSAFE, `Existing work-state phase ${state.phase} is beyond the repair boundary`);
  }
  if (route && state.routeFingerprint !== undefined && state.routeFingerprint !== route.fingerprint) {
    throw repairError(E_CONTRACT_BOOTSTRAP_REPAIR_UNSAFE, "Existing work-state route fingerprint conflicts with the proven route");
  }
  if (!route && state.routeFingerprint !== undefined) {
    throw repairError(E_CONTRACT_BOOTSTRAP_REPAIR_UNSAFE, "Existing work-state claims a route that cannot be proven from the artifacts");
  }
  if (state.phase === "CONTRACT_READY") {
    if (state.routeFingerprint !== undefined) {
      throw repairError(E_CONTRACT_BOOTSTRAP_REPAIR_UNSAFE, "CONTRACT_READY work-state must not claim a route");
    }
    if (Array.isArray(state.selectedGuides) && state.selectedGuides.length > 0) {
      throw repairError(E_CONTRACT_BOOTSTRAP_REPAIR_UNSAFE, "CONTRACT_READY work-state must not have selected guides");
    }
    if (Array.isArray(state.requiredGates) && state.requiredGates.length > 0) {
      throw repairError(E_CONTRACT_BOOTSTRAP_REPAIR_UNSAFE, "CONTRACT_READY work-state must not have required gates");
    }
    if (Array.isArray(state.satisfiedGates) && state.satisfiedGates.length > 0) {
      throw repairError(E_CONTRACT_BOOTSTRAP_REPAIR_UNSAFE, "CONTRACT_READY work-state must not have satisfied gates");
    }
  }
}

function markerResult(taskId, marker, state, alreadyRepaired) {
  return {
    taskId,
    repaired: alreadyRepaired ? false : true,
    alreadyRepaired,
    repairId: marker.details.repairId,
    phase: state.phase,
    reconstructedPhase: marker.details.reconstructedPhase,
    markerEventSeq: marker.seq,
  };
}

async function verifyExistingRepair(target, packageRoot, taskId, ledger) {
  const anchor = resolveEffectiveContractBootstrapRepairAnchor(ledger.events);
  if (!anchor || !ledger.valid) {
    throw repairError(E_CONTRACT_BOOTSTRAP_REPAIR_INVALID, "Existing contract bootstrap repair marker is invalid or the repaired ledger is no longer strict");
  }
  const contract = await readContract(target, packageRoot, { taskId });
  if (contract.fingerprint !== anchor.details.contractFingerprint) {
    throw repairError(E_CONTRACT_BOOTSTRAP_REPAIR_INVALID, "Contract fingerprint no longer matches the repair marker");
  }
  const state = await readWorkState(target, { packageRoot, taskId });
  const ownership = await resolveTaskClaimState(target, { taskId, packageRoot });
  if (!ownership.ownershipValid) {
    throw repairError(E_CONTRACT_BOOTSTRAP_REPAIR_INVALID, "Current task state no longer satisfies the repaired-task invariants", {
      errors: ownership.errors,
    });
  }
  return markerResult(taskId, { ...anchor.sourceMarker, details: anchor.details }, state, true);
}

export async function runTaskRepairContractBootstrap({ target, packageRoot, taskId, acknowledgeRepair } = {}) {
  if (!acknowledgeRepair) {
    throw repairError(E_CONTRACT_BOOTSTRAP_REPAIR_AUTHORIZATION_REQUIRED, "task-repair-contract-bootstrap requires fresh explicit --acknowledge-repair");
  }
  const context = await resolveTaskContext(target, { taskId, packageRoot, explicitRequired: true });
  const effectiveTaskId = context.taskId;
  const initial = await validateEventLedger(target, packageRoot, { taskId: effectiveTaskId });
  if (initial.events.some((event) => event.event === CONTRACT_BOOTSTRAP_REPAIR_EVENT)) {
    return verifyExistingRepair(target, packageRoot, effectiveTaskId, initial);
  }
  const candidate = isContractBootstrapRepairCandidate(initial.events, initial.errors, effectiveTaskId);
  if (!candidate) {
    throw repairError(E_CONTRACT_BOOTSTRAP_REPAIR_UNSAFE, "Ledger does not match the exact contract bootstrap repair signature", { errors: initial.errors });
  }

  return withProjectClaimsLock(target, "task-repair-contract-bootstrap", async () => {
    const lock = await readLockInfo(target, effectiveTaskId);
    const status = classifyLockStaleness(lock);
    if (status.status === "LIVE") throw repairError(E_TASK_LOCKED, `Task ${effectiveTaskId} has a live mutation lock`);
    if (status.status === "UNKNOWN" || status.status === "CORRUPT") {
      throw repairError(E_CONTRACT_BOOTSTRAP_REPAIR_UNSAFE, `Task ${effectiveTaskId} lock state is ${status.status}`);
    }
    if (status.status === "STALE") {
      const released = await releaseStaleTaskLockIfUnchanged(target, effectiveTaskId, lock);
      if (!released.released && released.reason !== "LOCK_MISSING") {
        throw repairError(E_CONTRACT_BOOTSTRAP_REPAIR_UNSAFE,
          `Task ${effectiveTaskId} stale lock could not be safely released: ${released.reason}`);
      }
    }
    return withTaskTransaction({
      target,
      taskId: effectiveTaskId,
      operation: "task-repair-contract-bootstrap",
      packageRoot,
      recordCommitEvent: true,
    }, async () => {
      const locked = await validateEventLedger(target, packageRoot, { taskId: effectiveTaskId });
      if (locked.events.some((event) => event.event === CONTRACT_BOOTSTRAP_REPAIR_EVENT)) {
        return verifyExistingRepair(target, packageRoot, effectiveTaskId, locked);
      }
      const lockedCandidate = isContractBootstrapRepairCandidate(locked.events, locked.errors, effectiveTaskId);
      if (!lockedCandidate
        || lockedCandidate.duplicateContractEvent.hash !== candidate.duplicateContractEvent.hash
        || lockedCandidate.duplicateContractCommit.hash !== candidate.duplicateContractCommit.hash) {
        throw repairError(E_CONTRACT_BOOTSTRAP_REPAIR_INVALID, "Ledger changed between inspection and repair lock");
      }
      const contract = await readContract(target, packageRoot, { taskId: effectiveTaskId });
      if (contract.fingerprint !== lockedCandidate.contractFingerprint) {
        throw repairError(E_CONTRACT_BOOTSTRAP_REPAIR_UNSAFE, "Current contract does not match the canonical historical contract fingerprint");
      }
      const route = await readRouteIfProven(target, packageRoot, effectiveTaskId, locked.events, contract.fingerprint);
      const state = await readWorkState(target, { packageRoot, taskId: effectiveTaskId });
      assertStateCompatible(state, effectiveTaskId, contract.fingerprint, route);
      if (!state) {
        throw repairError(E_CONTRACT_BOOTSTRAP_REPAIR_UNSAFE, "Existing work-state is required to repair the contract bootstrap defect");
      }
      const repository = await currentRepositoryFingerprint(target);
      const reconstructed = await mutateWorkState(target, {
        expectedRevision: state.revision ?? 0,
        packageRoot,
        taskId: effectiveTaskId,
      }, (current) => {
        assertStateCompatible(current, effectiveTaskId, contract.fingerprint, route);
        return stateForRepair(current, {
          taskId: effectiveTaskId,
          contractFingerprint: contract.fingerprint,
          route,
          repository,
        });
      });
      const repairedAt = new Date().toISOString();
      const details = {
        repairVersion: CONTRACT_BOOTSTRAP_REPAIR_VERSION,
        taskId: effectiveTaskId,
        defect: CONTRACT_BOOTSTRAP_REPAIR_DEFECT,
        canonicalContractEventSeq: lockedCandidate.canonicalContractEvent.seq,
        canonicalContractEventHash: lockedCandidate.canonicalContractEvent.hash,
        duplicateContractEventSeq: lockedCandidate.duplicateContractEvent.seq,
        duplicateContractEventHash: lockedCandidate.duplicateContractEvent.hash,
        contractCreateCommitSeq: lockedCandidate.duplicateContractCommit.seq,
        contractCreateCommitHash: lockedCandidate.duplicateContractCommit.hash,
        contractCreateTransactionId: lockedCandidate.duplicateContractCommit.details.transactionId,
        contractFingerprint: contract.fingerprint,
        reconstructedPhase: reconstructed.phase,
        routeFingerprint: route?.fingerprint ?? null,
        previousStateFingerprint: canonicalFingerprint(state),
        reconstructedStateFingerprint: canonicalFingerprint(reconstructed),
        reconstructedStateRevision: reconstructed.revision,
        repairedAt,
        authorityKind: CONTRACT_BOOTSTRAP_REPAIR_AUTHORITY,
      };
      details.repairId = contractBootstrapRepairId(details);
      assertContractBootstrapRepairDetails(details);
      const marker = await appendProtocolEvent(target, {
        taskId: effectiveTaskId,
        event: CONTRACT_BOOTSTRAP_REPAIR_EVENT,
        at: repairedAt,
        details,
      }, packageRoot, { taskId: effectiveTaskId });
      return markerResult(effectiveTaskId, marker, reconstructed, false);
    });
  });
}

export function formatTaskRepairContractBootstrapResult(result) {
  return `taskId: ${result.taskId}\nphase: ${result.phase}\nrepairId: ${result.repairId}\n${result.alreadyRepaired ? "alreadyRepaired: true" : "repaired: true"}\n`;
}
