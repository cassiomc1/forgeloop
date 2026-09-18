import { readFile } from "node:fs/promises";

import { createPresetContract } from "../core/contract-presets.js";
import { contractFingerprint, readContract, validateContract, writeContract } from "../core/contract.js";
import { appendProtocolEvent, readEvents, validateEventLedger } from "../core/events.js";
import { isContractBootstrapRepairCandidate } from "../core/contract-bootstrap-recovery.js";
import { currentRepositoryFingerprint } from "../core/repository.js";
import { createWorkState, initializeWorkState, readWorkState } from "../core/work-state.js";
import { ensureWithin, fileExists } from "../core/filesystem.js";
import { withTaskMutation } from "../core/task-command.js";

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
        const error = new Error(candidate
          ? "The exact contract bootstrap defect requires task-repair-contract-bootstrap"
          : "Existing contract checkpoint has an invalid event ledger");
        error.code = candidate ? "E_CONTRACT_BOOTSTRAP_REPAIR_AVAILABLE" : "E_CONTRACT_BOOTSTRAP_INCONSISTENT";
        error.next = candidate ? `forgeloop task-repair-contract-bootstrap --task ${ctx.taskId} --acknowledge-repair --json` : undefined;
        throw error;
      }
      if (existingState.contractFingerprint !== existingContract.fingerprint
        || !existingLedger.events.some((event) => event.event === "CONTRACT_VALIDATED"
          && event.details?.contractFingerprint === existingContract.fingerprint)) {
        const error = new Error("Existing contract checkpoint is not bound to its validated contract event");
        error.code = "E_CONTRACT_BOOTSTRAP_INCONSISTENT";
        throw error;
      }
      return { taskId: ctx.taskId, phase: existingState.phase, idempotent: true, contractFingerprint: existingContract.fingerprint };
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
      pendingSteps: ["route"],
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
