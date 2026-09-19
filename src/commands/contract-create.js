import { readFile } from "node:fs/promises";

import { createPresetContract } from "../core/contract-presets.js";
import { contractFingerprint, readContract, validateContract, writeContract } from "../core/contract.js";
import { appendProtocolEvent, readEvents, validateEventLedger } from "../core/events.js";
import { isContractBootstrapRepairCandidate } from "../core/contract-bootstrap-recovery.js";
import { currentRepositoryFingerprint } from "../core/repository.js";
import { createWorkState, initializeWorkState, readWorkState } from "../core/work-state.js";
import { ensureWithin, fileExists } from "../core/filesystem.js";
import { withTaskMutation } from "../core/task-command.js";
import { readPersistedRoute } from "../core/route-artifact.js";
import {
  buildResumableWorkStateFields,
  deriveResumePhaseFromLedger,
} from "../core/resumability.js";
import { taskArtifactPath } from "../core/task-paths.js";

function bootstrapInconsistent(message, candidate = false) {
  const error = new Error(message);
  error.code = candidate ? "E_CONTRACT_BOOTSTRAP_REPAIR_AVAILABLE" : "E_CONTRACT_BOOTSTRAP_INCONSISTENT";
  return error;
}

/**
 * Resolves the reconstruction projection for a task with a validated ledger
 * whose work-state checkpoint is missing.
 *
 * Ownership rule: the existing canonical contract plus the validated
 * CONTRACT_VALIDATED event are authoritative. Caller-supplied --preset or
 * --contract-file material is only used to prove fingerprint equivalence; the
 * preset generator never redefines historical truth. Reconstruction is
 * recovery, not contract creation.
 *
 * Fail-closed rule: the ledger proves which lifecycle milestones happened.
 * A ROUTE_VALIDATED event with a missing, malformed, or differently-bound
 * route artifact cannot be downgraded to CONTRACT_READY; that would regress
 * the lifecycle and allow a later route command to append a duplicate
 * ROUTE_VALIDATED milestone.
 */
async function loadReconstructionEvidence(target, packageRoot, taskId) {
  const ledger = await validateEventLedger(target, packageRoot, { taskId });
  if (!ledger.valid) {
    const candidate = isContractBootstrapRepairCandidate(ledger.events, ledger.errors, taskId);
    const error = bootstrapInconsistent(
      candidate
        ? "The exact contract bootstrap defect requires task-repair-contract-bootstrap"
        : "Existing contract has an inconsistent ledger; cannot overwrite",
      !!candidate,
    );
    error.next = candidate
      ? `forgeloop task-repair-contract-bootstrap --task ${taskId} --acknowledge-repair --json`
      : undefined;
    throw error;
  }
  const contract = await readContract(target, packageRoot, { taskId });
  if (!ledger.events.some((event) => event.event === "CONTRACT_VALIDATED"
    && event.details?.contractFingerprint === contract.fingerprint)) {
    throw bootstrapInconsistent("Existing contract is not bound to a valid CONTRACT_VALIDATED event");
  }

  const routeValidated = ledger.events.some((event) => event.event === "ROUTE_VALIDATED");
  const route = await readPersistedRoute(target, packageRoot, { taskId }).catch((error) => ({
    __reconstructionError: error,
  }));
  if (routeValidated) {
    if (route?.__reconstructionError || !route?.fingerprint) {
      throw bootstrapInconsistent(
        "Ledger contains ROUTE_VALIDATED but the route artifact is missing or malformed; reconstruction must not downgrade the lifecycle",
      );
    }
    if (route.value?.contractFingerprint !== undefined
      && route.value.contractFingerprint !== contract.fingerprint) {
      throw bootstrapInconsistent(
        "Persisted route artifact is bound to a different contract than the validated contract",
      );
    }
  }
  const scopedEvents = ledger.events.filter((event) => event.taskId === taskId);
  const resumedPhase = routeValidated
    ? (await deriveResumePhaseFromLedger(target, packageRoot, taskId) ?? "ROUTED")
    : "CONTRACT_READY";
  const projection = buildResumableWorkStateFields({ events: scopedEvents, resumedPhase });
  return { ledger, contract, route: routeValidated ? route : null, projection };
}

async function reconstructFromExistingContract(target, packageRoot, taskId, requestedFingerprint = null) {
  const { contract, route, projection } = await loadReconstructionEvidence(target, packageRoot, taskId);
  if (requestedFingerprint !== null && requestedFingerprint !== contract.fingerprint) {
    throw bootstrapInconsistent("A different contract already exists for this task; contract-create is not contract-revise");
  }
  const repositoryFingerprint = await currentRepositoryFingerprint(target);
  const reconstructedState = createWorkState({
    taskId,
    contractFingerprint: contract.fingerprint,
    ...(route ? { routeFingerprint: route.fingerprint } : {}),
    repositoryFingerprint,
    phase: projection.phase,
    selectedGuides: route ? [...route.value.guides] : [],
    requiredGates: [],
    satisfiedGates: [],
    completedSteps: projection.completedSteps,
    pendingSteps: projection.pendingSteps,
    ...(projection.verificationCycle !== undefined ? { verificationCycle: projection.verificationCycle } : {}),
    requiredArtifacts: [],
    checks: [],
    failures: [],
    blockers: [],
    verificationEvidence: [],
  });
  await initializeWorkState(target, reconstructedState, { packageRoot, taskId });
  return {
    taskId,
    phase: projection.phase,
    idempotent: true,
    contractFingerprint: contract.fingerprint,
    reconstructed: true,
  };
}

export async function runContractCreate({ target, packageRoot, taskId, task, contractFile = null, preset = null } = {}) {
  if (!preset && !contractFile) throw new Error("contract-create requires --preset or --contract-file");
  if (preset && contractFile) throw new Error("contract-create accepts either --preset or --contract-file, not both");

  return withTaskMutation(target, { taskId: taskId ?? task, packageRoot }, "contract-create", async (ctx) => {
    const events = await readEvents(target, packageRoot, { taskId: ctx.taskId });
    if (!events.some((event) => event.event === "DISCOVERY_STARTED")) {
      const error = new Error("Contract creation requires completed discovery");
      error.code = "E_DISCOVERY_REQUIRED";
      throw error;
    }
    const existingState = await readWorkState(target, { packageRoot, taskId: ctx.taskId });
    if (existingState) {
      if (existingState.phase !== "CONTRACT_READY") throw new Error("Contract already exists beyond the contract-ready phase");
      const existingContract = await readContract(target, packageRoot, { taskId: ctx.taskId });
      const existingLedger = await validateEventLedger(target, packageRoot, { taskId: ctx.taskId });
      if (!existingLedger.valid) {
        const candidate = isContractBootstrapRepairCandidate(existingLedger.events, existingLedger.errors, ctx.taskId);
        const error = bootstrapInconsistent(
          candidate
            ? "The exact contract bootstrap defect requires task-repair-contract-bootstrap"
            : "Existing contract checkpoint has an invalid event ledger",
          !!candidate,
        );
        error.next = candidate ? `forgeloop task-repair-contract-bootstrap --task ${ctx.taskId} --acknowledge-repair --json` : undefined;
        throw error;
      }
      if (existingState.contractFingerprint !== existingContract.fingerprint
        || !existingLedger.events.some((event) => event.event === "CONTRACT_VALIDATED"
          && event.details?.contractFingerprint === existingContract.fingerprint)) {
        throw bootstrapInconsistent("Existing contract checkpoint is not bound to its validated contract event");
      }
      return { taskId: ctx.taskId, phase: existingState.phase, idempotent: true, contractFingerprint: existingContract.fingerprint };
    }

    // Reconstruction precedes preset generation: when the task already has a
    // canonical contract, recover from it without generating a replacement
    // candidate first. The requested preset/file contract is only compared by
    // fingerprint to prove idempotent equivalence; it never redefines the
    // canonical historical contract.
    const existingContractPath = taskArtifactPath(ctx.taskId, "contract");
    if (await fileExists(ensureWithin(target, existingContractPath)).catch(() => false)) {
      const existingContract = await readContract(target, packageRoot, { taskId: ctx.taskId });
      const existingLedger = await validateEventLedger(target, packageRoot, { taskId: ctx.taskId });
      const validatedContractEvents = existingLedger.events.filter(
        (event) => event.event === "CONTRACT_VALIDATED",
      );

      // task-create persists the proposed contract before contract-create has
      // validated it. That artifact is not yet canonical history, so preserve
      // ordinary first-time contract creation when no CONTRACT_VALIDATED event
      // exists. Once validation history exists, reconstruction must be
      // authoritative and fail closed on any binding mismatch.
      if (validatedContractEvents.length > 0) {
        if (!validatedContractEvents.some(
          (event) => event.details?.contractFingerprint === existingContract.fingerprint,
        )) {
          throw bootstrapInconsistent("Existing contract is not bound to a valid CONTRACT_VALIDATED event");
        }

        let requestedFingerprint = null;
        if (contractFile) {
          const source = ensureWithin(target, contractFile);
          if (await fileExists(source).catch(() => false)) {
            try {
              const candidate = { ...JSON.parse(await readFile(source, "utf8")), taskId: ctx.taskId };
              await validateContract(candidate, packageRoot);
              requestedFingerprint = contractFingerprint(candidate);
            } catch {
              requestedFingerprint = undefined;
            }
          }
        }
        // A preset selector is not historical contract authority. If the
        // caller supplied a replacement file, compare it; otherwise recover
        // the persisted contract independently of current preset generation.
        return reconstructFromExistingContract(
          target,
          packageRoot,
          ctx.taskId,
          requestedFingerprint ?? null,
        );
      }
    }

    let contract;
    if (preset) {
      contract = createPresetContract({ taskId: ctx.taskId, preset, claims: ctx.descriptor.writeClaims });
    } else {
      const source = ensureWithin(target, contractFile);
      if (!(await fileExists(source))) throw new Error(`Specified contract file not found: ${contractFile}`);
      contract = JSON.parse(await readFile(source, "utf8"));
      contract = { ...contract, taskId: ctx.taskId };
    }
    await validateContract(contract, packageRoot);
    const fingerprint = contractFingerprint(contract);

    await writeContract(target, contract, packageRoot, { taskId: ctx.taskId });
    const repositoryFingerprint = await currentRepositoryFingerprint(target);
    await initializeWorkState(target, createWorkState({
      taskId: ctx.taskId,
      contractFingerprint: fingerprint,
      repositoryFingerprint,
      phase: "CONTRACT_READY",
      selectedGuides: [],
      requiredGates: [],
      satisfiedGates: [],
      completedSteps: ["contract"],
      pendingSteps: ["route", "planning", "implementation", "verification"],
      requiredArtifacts: [],
      checks: [],
      failures: [],
      blockers: [],
      verificationEvidence: [],
    }), { packageRoot, taskId: ctx.taskId });
    await appendProtocolEvent(target, {
      taskId: ctx.taskId,
      event: "CONTRACT_VALIDATED",
      details: { contractFingerprint: fingerprint },
    }, packageRoot, { taskId: ctx.taskId });
    return { taskId: ctx.taskId, phase: "CONTRACT_READY", idempotent: false, contractFingerprint: fingerprint };
  });
}

export function formatContractCreateResult(result) {
  return `phase: ${result.phase}\n${result.idempotent ? "idempotent: true\n" : ""}`;
}
