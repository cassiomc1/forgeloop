import { createPresetContract } from "../core/contract-presets.js";
import {
  contractFingerprint,
  readContract,
  validateContract,
  writeContract,
} from "../core/contract.js";
import {
  appendProtocolEvent,
  validateEventLedger,
  validateStateLedgerCoherence,
} from "../core/events.js";
import { canonicalFingerprint, readJsonArtifact } from "../core/artifacts.js";
import { resolveEffectiveContractBootstrapRepairAnchor } from "../core/contract-bootstrap-recovery.js";
import {
  CONTRACT_REVISED_EVENT,
  assertContractRevisedDetails,
} from "../core/contract-revision.js";
import { resolveTaskContext, TASK_SELECTION_MODES } from "../core/task-context.js";
import { assertTaskMutationAllowed, resolveTaskClaimState } from "../core/task-claim-state.js";
import { assertWorkspaceBinding } from "../core/workspace-binding.js";
import { withTaskTransaction } from "../core/transaction.js";
import { mutateWorkState, readWorkState } from "../core/work-state.js";
import { readPersistedRoute } from "../core/route-artifact.js";
import { assertStateIdentity } from "../core/completion-relationships.js";

const REVISION_PHASES = new Set(["CONTRACT_READY", "ROUTED", "PLANNED"]);

function revisionError(message, artifacts = []) {
  const error = new Error(message);
  error.code = "E_CONTRACT_REVISION_UNSAFE";
  if (artifacts.length > 0) error.artifacts = artifacts;
  return error;
}

async function loadCandidate({ target, packageRoot, taskId, contractFile, preset, claims }) {
  if (preset) return createPresetContract({ taskId, preset, claims });
  let artifact;
  try {
    artifact = await readJsonArtifact(target, contractFile, "current-contract", packageRoot);
  } catch (error) {
    throw revisionError(`Unable to read replacement contract: ${error.message}`, error.artifacts ?? [contractFile]);
  }
  if (artifact.value.taskId !== taskId) {
    throw revisionError(
      `Replacement contract taskId "${artifact.value.taskId}" does not match requested taskId "${taskId}"`,
      [contractFile],
    );
  }
  return artifact.value;
}

function revisionStateProjection(state, contractFingerprintValue, phase) {
  const next = {
    ...state,
    contractFingerprint: contractFingerprintValue,
    phase,
    requiredGates: [],
    satisfiedGates: [],
    requiredArtifacts: [],
    checks: [],
    failures: [],
    blockers: [],
    verificationEvidence: [],
    completedSteps: phase === "CONTRACT_READY" ? ["contract"] : ["contract", "route"],
    pendingSteps: phase === "CONTRACT_READY"
      ? ["route", "planning", "implementation", "verification"]
      : ["planning", "implementation", "verification"],
  };
  delete next.evidenceCoverage;
  delete next.lastCompletionAttempt;
  delete next.diagnosedHypothesis;
  // The revision event carries the explicit PLANNED -> ROUTED rewind proof.
  // Do not feed the old lifecycle transition marker back into createWorkState:
  // the global transition table must remain forward-only.
  delete next.previousPhase;
  return next;
}

async function inspectRevisionEligibility({ target, packageRoot, taskId, context }) {
  const state = await readWorkState(target, { packageRoot, taskId });
  const contract = await readContract(target, packageRoot, { taskId });
  if (!state) throw revisionError("Contract revision requires a current work-state checkpoint");
  if (state.taskId !== taskId) throw revisionError("Work-state task identity does not match the selected task");
  if (!REVISION_PHASES.has(state.phase)) {
    throw revisionError(`Contract revision is unavailable in phase ${state.phase}`);
  }
  if (state.contractFingerprint !== contract.fingerprint) {
    throw revisionError("Current work-state is not bound to the current contract artifact");
  }
  const ledger = await validateEventLedger(target, packageRoot, { taskId });
  if (!ledger.valid) throw revisionError("Contract revision requires a valid event ledger", ledger.errors);
  if (ledger.events.some((event) => event.event === "EXECUTION_STARTED")) {
    throw revisionError("Contract revision is unavailable after execution has started");
  }
  const coherenceErrors = validateStateLedgerCoherence(state, ledger.events);
  if (coherenceErrors.length > 0) {
    throw revisionError("Contract revision cannot repair an inconsistent task", coherenceErrors);
  }
  const repairAnchor = resolveEffectiveContractBootstrapRepairAnchor(ledger.events);
  if (repairAnchor) {
    throw revisionError("Contract revision is unavailable for tasks with a contract-bootstrap repair or migration anchor");
  }
  const ownership = await resolveTaskClaimState(target, { taskId, packageRoot });
  if (!ownership.ownershipValid || !ownership.mutationAllowed) {
    throw revisionError("Contract revision cannot bypass invalid task ownership", ownership.ownershipErrors);
  }
  if (!context?.descriptor || context.descriptor.taskId !== taskId) {
    throw revisionError("A valid task descriptor is required for contract revision");
  }
  return { state, contract, ledger, ownership };
}

async function assertPreRevisionRouteIdentity({ target, packageRoot, taskId, state, contract }) {
  if (state.phase === "CONTRACT_READY") return;
  try {
    const route = await readPersistedRoute(target, packageRoot, { taskId });
    assertStateIdentity({ contract, route, state });
  } catch (error) {
    throw revisionError(
      `Contract revision requires a valid current route: ${error.message}`,
      error.artifacts ?? [],
    );
  }
}

async function reviseLocked({ target, packageRoot, taskId, context, contractFile, preset, transaction }) {
  await assertTaskMutationAllowed(target, { taskId, packageRoot });
  await assertWorkspaceBinding(target, { taskId, packageRoot, operation: "contract-revise" });
  const inspected = await inspectRevisionEligibility({ target, packageRoot, taskId, context });
  const candidate = await loadCandidate({
    target,
    packageRoot,
    taskId,
    contractFile,
    preset,
    claims: context.descriptor.writeClaims,
  });
  await validateContract(candidate, packageRoot);
  const nextFingerprint = contractFingerprint(candidate);
  if (nextFingerprint === inspected.contract.fingerprint) {
    return {
      taskId,
      revised: false,
      alreadyCurrent: true,
      phase: inspected.state.phase,
      contractFingerprint: inspected.contract.fingerprint,
      revision: inspected.state.revision,
    };
  }

  await assertPreRevisionRouteIdentity({
    target,
    packageRoot,
    taskId,
    state: inspected.state,
    contract: inspected.contract,
  });

  const before = inspected.state;
  const nextPhase = before.phase === "PLANNED" ? "ROUTED" : before.phase;
  const previousRouteFingerprint = before.routeFingerprint ?? null;
  const projected = revisionStateProjection(before, nextFingerprint, nextPhase);
  await writeContract(target, candidate, packageRoot, { taskId, operation: "contract-revise" });
  const next = await mutateWorkState(target, {
    expectedRevision: before.revision,
    packageRoot,
    taskId,
  }, () => projected);
  const details = {
    previousContractFingerprint: inspected.contract.fingerprint,
    contractFingerprint: nextFingerprint,
    previousPhase: before.phase,
    phase: next.phase,
    previousStateRevision: before.revision,
    revisedStateRevision: next.revision,
    previousStateFingerprint: canonicalFingerprint(before),
    revisedStateFingerprint: canonicalFingerprint(next),
    previousRouteFingerprint,
  };
  assertContractRevisedDetails(details);
  const event = await appendProtocolEvent(target, {
    taskId,
    event: CONTRACT_REVISED_EVENT,
    details,
  }, packageRoot, { taskId });
  const commit = await appendProtocolEvent(target, {
    taskId,
    event: "TRANSACTION_COMMITTED",
    details: { transactionId: transaction.transactionId, operation: "contract-revise" },
  }, packageRoot, { taskId });
  return {
    taskId,
    revised: true,
    alreadyCurrent: false,
    phase: next.phase,
    previousContractFingerprint: inspected.contract.fingerprint,
    contractFingerprint: nextFingerprint,
    previousPhase: before.phase,
    revision: next.revision,
    eventSeq: event.seq,
    transactionCommitSeq: commit.seq,
  };
}

export async function runContractRevise({ target, packageRoot, taskId, contractFile = null, preset = null } = {}) {
  if (!taskId) throw revisionError("contract-revise requires --task");
  if ((!contractFile && !preset) || (contractFile && preset)) {
    throw revisionError("contract-revise requires exactly one of --contract-file or --preset");
  }
  const context = await resolveTaskContext(target, {
    taskId,
    packageRoot,
    explicitRequired: true,
    selectionMode: TASK_SELECTION_MODES.MUTATION,
  });
  return withTaskTransaction({
    target,
    taskId: context.taskId,
    packageRoot,
    operation: "contract-revise",
    recordCommitEvent: false,
  }, async (transaction) => reviseLocked({
    target,
    packageRoot,
    taskId: context.taskId,
    context,
    contractFile,
    preset,
    transaction,
  }));
}

export function formatContractReviseResult(result) {
  return `${JSON.stringify(result, null, 2)}\n`;
}
