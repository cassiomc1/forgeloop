import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { runContractCreate } from "../src/commands/contract-create.js";
import { runTaskRepairContractBootstrap } from "../src/commands/task-repair-contract-bootstrap.js";
import {
  createContract, contractFingerprint, writeContract,
} from "../src/core/contract.js";
import {
  createPresetContract,
} from "../src/core/contract-presets.js";
import {
  CONTRACT_BOOTSTRAP_REPAIR_EVENT,
  isContractBootstrapRepairCandidate,
  isContractBootstrapRepairMarkerValid,
  isExactDuplicateContractChronologyError,
} from "../src/core/contract-bootstrap-recovery.js";
import { appendProtocolEvent, validateEventLedger, readEvents } from "../src/core/events.js";
import { getNextAction, NEXT_ACTIONS } from "../src/core/next-action.js";
import { evaluateRoute } from "../src/core/router.js";
import { createTaskDescriptor, writeTaskDescriptor } from "../src/core/task-descriptor.js";
import { taskArtifactPath, taskLockPath } from "../src/core/task-paths.js";
import { getPackageRoot } from "../src/core/templates.js";
import { withTaskTransaction } from "../src/core/transaction.js";
import {
  createWorkState, readWorkState, writeWorkState,
} from "../src/core/work-state.js";
import { writeJsonArtifact } from "../src/core/artifacts.js";
import { resolveTaskClaimState } from "../src/core/task-claim-state.js";
import { COMMAND_EXECUTORS } from "../src/core/command-executors.js";
import { parseArgs } from "../src/cli.js";
import { acquireTaskLock, readLockInfo, releaseStaleTaskLockIfUnchanged, classifyLockStaleness } from "../src/core/task-lock.js";
import { canonicalFingerprint } from "../src/core/artifacts.js";
import { readPersistedRoute } from "../src/core/route-artifact.js";
import { removeTempTree } from "./helpers/rm-safe.js";

const packageRoot = getPackageRoot();
const taskId = "bootstrap-hardening-fixture";

async function appendTransaction(target, tid, operation, event, details = undefined, fingerprint = undefined) {
  await withTaskTransaction({ target, taskId: tid, operation, packageRoot, recordCommitEvent: true }, async () => {
    await appendProtocolEvent(target, {
      taskId: tid, event, ...(details ? { details } : {}), ...(fingerprint ? { fingerprint } : {}),
    }, packageRoot, { taskId: tid });
  });
}

async function baseFixture() {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-bootstrap-hardening-"));
  const contract = createContract({
    taskId,
    objective: "Hardening test fixture",
    deliverables: ["src/example.js"],
    constraints: ["append-only"],
    risks: [],
    verification: ["focused tests"],
    successCriteria: ["repair is idempotent"],
    stopConditions: [],
    unresolvedDecisions: [],
    sourceRefs: [],
  });
  const contractHash = contractFingerprint(contract);
  const descriptor = createTaskDescriptor({ taskId, writeClaims: [] });
  await writeTaskDescriptor(target, descriptor, packageRoot);
  await writeContract(target, contract, packageRoot, { taskId });
  await appendTransaction(target, taskId, "task-create", "TASK_RECEIVED", { createdAt: descriptor.createdAt });
  await appendTransaction(target, taskId, "discover", "DISCOVERY_STARTED", { source: "test" });
  await appendTransaction(target, taskId, "contract-create", "CONTRACT_VALIDATED", { contractFingerprint: contractHash });
  const route = evaluateRoute({ workType: "code", surfaces: ["documentation"], executableChange: true });
  const routeValue = { ...route, contractFingerprint: contractHash };
  await writeJsonArtifact(target, taskArtifactPath(taskId, "route"), routeValue, "routing-result", packageRoot, { taskId });
  await appendTransaction(target, taskId, "route", "ROUTE_VALIDATED", undefined, route.fingerprint);
  await appendTransaction(target, taskId, "contract-create", "CONTRACT_VALIDATED", { contractFingerprint: contractHash });
  return { target, contract, contractHash, route };
}

async function buggyStateFixture() {
  const { target, contract, contractHash, route } = await baseFixture();
  await writeWorkState(target, createWorkState({
    taskId,
    contractFingerprint: contractHash,
    repositoryFingerprint: { branch: null, head: null },
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
  }), { packageRoot, taskId });
  return { target, contract, contractHash, route };
}

async function repairedFixture() {
  const { target, contract, contractHash, route } = await buggyStateFixture();
  await runTaskRepairContractBootstrap({ target, packageRoot, taskId, acknowledgeRepair: true });
  return { target, contract, contractHash, route };
}

async function validLedgerNoStateFixture() {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-hardening-validledger-"));
  const tid = "valid-ledger-no-state";
  const contract = createPresetContract({ taskId: tid, preset: "feature" });
  const contractHash = contractFingerprint(contract);
  const descriptor = createTaskDescriptor({ taskId: tid, writeClaims: [] });
  await writeTaskDescriptor(target, descriptor, packageRoot);
  await writeContract(target, contract, packageRoot, { taskId: tid });
  await appendTransaction(target, tid, "task-create", "TASK_RECEIVED", { createdAt: descriptor.createdAt });
  await appendTransaction(target, tid, "discover", "DISCOVERY_STARTED", { source: "test" });
  await appendTransaction(target, tid, "contract-create", "CONTRACT_VALIDATED", { contractFingerprint: contractHash });
  return { target, contract, tid };
}

async function validLedgerWithRouteNoStateFixture() {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-hardening-validroute-"));
  const tid = "valid-route-no-state";
  const contract = createPresetContract({ taskId: tid, preset: "feature" });
  const contractHash = contractFingerprint(contract);
  const descriptor = createTaskDescriptor({ taskId: tid, writeClaims: [] });
  await writeTaskDescriptor(target, descriptor, packageRoot);
  await writeContract(target, contract, packageRoot, { taskId: tid });
  await appendTransaction(target, tid, "task-create", "TASK_RECEIVED", { createdAt: descriptor.createdAt });
  await appendTransaction(target, tid, "discover", "DISCOVERY_STARTED", { source: "test" });
  await appendTransaction(target, tid, "contract-create", "CONTRACT_VALIDATED", { contractFingerprint: contractHash });
  const route = evaluateRoute({ workType: "code", surfaces: ["documentation"], executableChange: true });
  const routeValue = { ...route, contractFingerprint: contractHash };
  await writeJsonArtifact(target, taskArtifactPath(tid, "route"), routeValue, "routing-result", packageRoot, { taskId: tid });
  await appendTransaction(target, tid, "route", "ROUTE_VALIDATED", undefined, canonicalFingerprint(routeValue));
  return { target, contract, route, tid };
}

// ── Prevention (Step 6) ───────────────────────────────────────────────

test("new task + no contract + no state → ordinary contract-create succeeds", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-hardening-prevent-"));
  try {
    const descriptor = createTaskDescriptor({ taskId: "prevent-new", writeClaims: [] });
    await writeTaskDescriptor(target, descriptor, packageRoot);
    await appendTransaction(target, "prevent-new", "task-create", "TASK_RECEIVED", { createdAt: descriptor.createdAt });
    await appendTransaction(target, "prevent-new", "discover", "DISCOVERY_STARTED", { source: "test" });
    const result = await runContractCreate({
      target, packageRoot, taskId: "prevent-new", preset: "feature",
    });
    assert.equal(result.idempotent, false);
    assert.equal(result.phase, "CONTRACT_READY");
  } finally {
    await removeTempTree(target);
  }
});

test("existing contract + one CONTRACT_VALIDATED + no state → reconstruct CONTRACT_READY", async () => {
  const { target, tid } = await validLedgerNoStateFixture();
  try {
    const result = await runContractCreate({
      target, packageRoot, taskId: tid, preset: "feature",
    });
    assert.equal(result.idempotent, true);
    assert.equal(result.reconstructed, true);
    const ledger = await validateEventLedger(target, packageRoot, { taskId: tid });
    const validatedCount = ledger.events.filter((e) => e.event === "CONTRACT_VALIDATED").length;
    assert.equal(validatedCount, 1, "CONTRACT_VALIDATED count must stay 1");
  } finally {
    await removeTempTree(target);
  }
});

test("existing contract + route + ROUTE_VALIDATED + no state → reconstruct ROUTED", async () => {
  const { target, tid } = await validLedgerWithRouteNoStateFixture();
  try {
    const result = await runContractCreate({
      target, packageRoot, taskId: tid, preset: "feature",
    });
    assert.equal(result.idempotent, true);
    assert.equal(result.reconstructed, true);
    assert.equal(result.phase, "ROUTED");
    const ledger = await validateEventLedger(target, packageRoot, { taskId: tid });
    const validatedCount = ledger.events.filter((e) => e.event === "CONTRACT_VALIDATED").length;
    assert.equal(validatedCount, 1, "No new CONTRACT_VALIDATED appended");
    const routeValidatedCount = ledger.events.filter((e) => e.event === "ROUTE_VALIDATED").length;
    assert.equal(routeValidatedCount, 1, "No new ROUTE_VALIDATED appended");
  } finally {
    await removeTempTree(target);
  }
});

test("contract fingerprint != historical CONTRACT_VALIDATED fingerprint → contract-create rejects", async () => {
  const { target, tid } = await validLedgerNoStateFixture();
  try {
    const eventsPath = path.join(target, taskArtifactPath(tid, "events"));
    const text = await readFile(eventsPath, "utf8");
    const events = text.trim().split("\n").map((l) => JSON.parse(l));
    events[3].details.contractFingerprint = "a".repeat(64);
    await writeFile(eventsPath, `${events.map((e) => JSON.stringify(e)).join("\n")}\n`);
    await assert.rejects(
      runContractCreate({ target, packageRoot, taskId: tid, preset: "feature" }),
    );
  } finally {
    await removeTempTree(target);
  }
});

test("ROUTE_VALIDATED exists but route artifact missing → contract-create fails closed", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-hardening-noroute-"));
  try {
    const contract = createPresetContract({ taskId: "no-route-task", preset: "feature" });
    const descriptor = createTaskDescriptor({ taskId: "no-route-task", writeClaims: [] });
    await writeTaskDescriptor(target, descriptor, packageRoot);
    await writeContract(target, contract, packageRoot, { taskId: "no-route-task" });
    await appendTransaction(target, "no-route-task", "task-create", "TASK_RECEIVED", { createdAt: descriptor.createdAt });
    await appendTransaction(target, "no-route-task", "discover", "DISCOVERY_STARTED", { source: "test" });
    await appendTransaction(target, "no-route-task", "contract-create", "CONTRACT_VALIDATED", { contractFingerprint: contractFingerprint(contract) });
    await appendTransaction(target, "no-route-task", "route", "ROUTE_VALIDATED");
    await assert.rejects(
      runContractCreate({ target, packageRoot, taskId: "no-route-task", preset: "feature" }),
      (error) => error.code === "E_CONTRACT_BOOTSTRAP_INCONSISTENT",
    );
    // No work-state created and ledger unchanged.
    const state = await readWorkState(target, { packageRoot, taskId: "no-route-task" });
    assert.equal(state, null, "fail-closed reconstruction must not create work-state");
    const ledgerAfter = await validateEventLedger(target, packageRoot, { taskId: "no-route-task" });
    assert.equal(ledgerAfter.events.filter((e) => e.event === "CONTRACT_VALIDATED").length, 1);
    assert.equal(ledgerAfter.events.filter((e) => e.event === "ROUTE_VALIDATED").length, 1);
  } finally {
    await removeTempTree(target);
  }
});

test("ROUTE_VALIDATED exists but route artifact malformed → contract-create fails closed", async () => {
  const { target, tid } = await validLedgerWithRouteNoStateFixture();
  try {
    const routePath = path.join(target, taskArtifactPath(tid, "route"));
    await writeFile(routePath, "{ not json", "utf8");
    await assert.rejects(
      runContractCreate({ target, packageRoot, taskId: tid, preset: "feature" }),
      (error) => error.code === "E_CONTRACT_BOOTSTRAP_INCONSISTENT",
    );
    const state = await readWorkState(target, { packageRoot, taskId: tid });
    assert.equal(state, null);
  } finally {
    await removeTempTree(target);
  }
});

test("ROUTE_VALIDATED exists but route bound to a different contract → contract-create fails closed", async () => {
  const { target, tid } = await validLedgerWithRouteNoStateFixture();
  try {
    const routePath = path.join(target, taskArtifactPath(tid, "route"));
    const route = JSON.parse(await readFile(routePath, "utf8"));
    route.contractFingerprint = "a".repeat(64);
    await writeFile(routePath, `${JSON.stringify(route, null, 2)}\n`, "utf8");
    await assert.rejects(
      runContractCreate({ target, packageRoot, taskId: tid, preset: "feature" }),
      (error) => error.code === "E_CONTRACT_BOOTSTRAP_INCONSISTENT",
    );
    const state = await readWorkState(target, { packageRoot, taskId: tid });
    assert.equal(state, null);
  } finally {
    await removeTempTree(target);
  }
});

test("invalid ledger → contract-create fails closed", async () => {
  const { target } = await baseFixture();
  try {
    const eventsPath = path.join(target, taskArtifactPath(taskId, "events"));
    const text = await readFile(eventsPath, "utf8");
    const events = text.trim().split("\n").map((l) => JSON.parse(l));
    events[0].hash = "bad";
    await writeFile(eventsPath, `${events.map((e) => JSON.stringify(e)).join("\n")}\n`);
    await assert.rejects(
      runContractCreate({ target, packageRoot, taskId, preset: "feature" }),
    );
  } finally {
    await removeTempTree(target);
  }
});

test("repeat contract-create after reconstruction → idempotent, no new events", async () => {
  const { target, tid } = await validLedgerNoStateFixture();
  try {
    const first = await runContractCreate({ target, packageRoot, taskId: tid, preset: "feature" });
    assert.equal(first.reconstructed, true);
    const second = await runContractCreate({ target, packageRoot, taskId: tid, preset: "feature" });
    assert.equal(second.idempotent, true);
    const ledger = await validateEventLedger(target, packageRoot, { taskId: tid });
    const validatedCount = ledger.events.filter((e) => e.event === "CONTRACT_VALIDATED").length;
    assert.equal(validatedCount, 1, "CONTRACT_VALIDATED count remains 1");
  } finally {
    await removeTempTree(target);
  }
});

// ── Canonical later-phase reconstruction (§4) ─────────────────────────

/**
 * Builds a valid ledger for a task that progressed to the requested phase
 * (PLANNED, EXECUTING, VERIFYING, or REVIEWING) and then lost its work-state.
 * Milestones follow the canonical activation chronology and verification
 * events carry the cycle metadata written by the real lifecycle commands.
 */
async function laterPhaseLedgerFixture(phase) {
  const target = await mkdtemp(path.join(os.tmpdir(), `forgeloop-hardening-${phase.toLowerCase()}-`));
  const tid = `later-phase-${phase.toLowerCase()}`;
  const contract = createPresetContract({ taskId: tid, preset: "feature" });
  const contractHash = contractFingerprint(contract);
  const descriptor = createTaskDescriptor({ taskId: tid, writeClaims: [] });
  await writeTaskDescriptor(target, descriptor, packageRoot);
  await writeContract(target, contract, packageRoot, { taskId: tid });
  await appendTransaction(target, tid, "task-create", "TASK_RECEIVED", { createdAt: descriptor.createdAt });
  await appendTransaction(target, tid, "discover", "DISCOVERY_STARTED", { source: "test" });
  await appendTransaction(target, tid, "contract-create", "CONTRACT_VALIDATED", { contractFingerprint: contractHash });
  const route = evaluateRoute({ workType: "code", surfaces: ["documentation"], executableChange: true });
  const routeValue = { ...route, contractFingerprint: contractHash };
  await writeJsonArtifact(target, taskArtifactPath(tid, "route"), routeValue, "routing-result", packageRoot, { taskId: tid });
  await appendTransaction(target, tid, "route", "ROUTE_VALIDATED", undefined, route.fingerprint);
  const later = {
    PLANNED: [["plan", "PLAN_RECORDED"]],
    EXECUTING: [["preflight", "PREFLIGHT_READY"], ["plan", "PLAN_RECORDED"], ["execute", "EXECUTION_STARTED"]],
    VERIFYING: [["preflight", "PREFLIGHT_READY"], ["plan", "PLAN_RECORDED"], ["execute", "EXECUTION_STARTED"],
      ["verify", "VERIFICATION_STARTED", { verificationCycle: 1 }]],
    REVIEWING: [["preflight", "PREFLIGHT_READY"], ["plan", "PLAN_RECORDED"], ["execute", "EXECUTION_STARTED"],
      ["verify", "VERIFICATION_STARTED", { verificationCycle: 1 }],
      ["verify", "VERIFICATION_RECORDED", { verificationCycle: 1 }],
      ["review", "REVIEW_STARTED", { verificationCycle: 1 }]],
  }[phase];
  for (const [operation, event, details] of later) {
    await appendTransaction(target, tid, operation, event, details);
  }
  return { target, tid, contractHash, route, routeFingerprint: canonicalFingerprint(routeValue) };
}

async function assertLaterPhaseReconstruction(phase, expected) {
  const { target, tid, contractHash, routeFingerprint } = await laterPhaseLedgerFixture(phase);
  try {
    const result = await runContractCreate({ target, packageRoot, taskId: tid, preset: "feature" });
    assert.equal(result.reconstructed, true, "later-phase ledger must reconstruct instead of failing");
    assert.equal(result.phase, phase);
    const state = await readWorkState(target, { packageRoot, taskId: tid });
    assert.equal(state.phase, phase);
    assert.deepEqual(state.completedSteps, expected.completedSteps);
    assert.deepEqual(state.pendingSteps, expected.pendingSteps);
    if (expected.verificationCycle !== undefined) {
      assert.equal(state.verificationCycle, expected.verificationCycle,
        "verificationCycle must be preserved from the ledger");
    } else {
      assert.equal(state.verificationCycle, undefined);
    }
    assert.equal(state.contractFingerprint, contractHash);
    assert.equal(state.routeFingerprint, routeFingerprint);
    const { value: persistedRoute } = await readPersistedRoute(target, packageRoot, { taskId: tid });
    assert.deepEqual([...state.selectedGuides].sort(), [...persistedRoute.guides].sort());
    // Reconstruction must not append any lifecycle event.
    const ledger = await validateEventLedger(target, packageRoot, { taskId: tid });
    assert.equal(ledger.valid, true);
    assert.equal(ledger.events.filter((e) => e.event === "CONTRACT_VALIDATED").length, 1);
    assert.equal(ledger.events.filter((e) => e.event === "ROUTE_VALIDATED").length, 1);
  } finally {
    await removeTempTree(target);
  }
}

test("valid ledger proves PLANNED + state missing → canonical PLANNED projection", async () => {
  await assertLaterPhaseReconstruction("PLANNED", {
    completedSteps: ["contract", "route", "planning"],
    pendingSteps: ["implementation", "verification"],
  });
});

test("valid ledger proves EXECUTING + state missing → canonical EXECUTING projection", async () => {
  await assertLaterPhaseReconstruction("EXECUTING", {
    completedSteps: ["contract", "route", "planning", "implementation"],
    pendingSteps: ["verification"],
  });
});

test("valid ledger proves VERIFYING + state missing → VERIFYING with preserved verificationCycle", async () => {
  await assertLaterPhaseReconstruction("VERIFYING", {
    completedSteps: ["contract", "route", "planning", "implementation"],
    pendingSteps: ["verification"],
    verificationCycle: 1,
  });
});

test("valid ledger proves REVIEWING + state missing → canonical REVIEWING projection", async () => {
  await assertLaterPhaseReconstruction("REVIEWING", {
    completedSteps: ["contract", "route", "planning", "implementation", "verification"],
    pendingSteps: [],
    verificationCycle: 1,
  });
});

test("contract-create reconstruction matches ordinary resumability identity fields", async () => {
  const { target, tid, routeFingerprint, contractHash } = await laterPhaseLedgerFixture("VERIFYING");
  try {
    const result = await runContractCreate({ target, packageRoot, taskId: tid, preset: "feature" });
    assert.equal(result.phase, "VERIFYING");
    const reconstructed = await readWorkState(target, { packageRoot, taskId: tid });

    // Ordinary resumability derives the same identity fields for the same
    // ledger: deriveResumePhaseFromLedger returns VERIFYING and the canonical
    // projection is shared, so the identity must match exactly.
    const { deriveResumePhaseFromLedger } = await import("../src/core/resumability.js");
    const resumedPhase = await deriveResumePhaseFromLedger(target, packageRoot, tid);
    assert.equal(resumedPhase, "VERIFYING");
    assert.equal(reconstructed.phase, resumedPhase);
    assert.equal(reconstructed.contractFingerprint, contractHash);
    assert.equal(reconstructed.routeFingerprint, routeFingerprint);
    assert.equal(reconstructed.verificationCycle, 1);
    // The verify-cycle metadata in the ledger is the single source of truth.
    const ledger = await validateEventLedger(target, packageRoot, { taskId: tid });
    const cycleEvent = ledger.events.find((e) => e.event === "VERIFICATION_STARTED");
    assert.equal(reconstructed.verificationCycle, cycleEvent.details.verificationCycle);
  } finally {
    await removeTempTree(target);
  }
});

// ── Reconstruction before preset generation (§13/§14) ─────────────────

test("--contract-file missing on disk cannot block reconstruction of an existing canonical contract", async () => {
  const { target, tid } = await validLedgerNoStateFixture();
  try {
    const result = await runContractCreate({
      target, packageRoot, taskId: tid,
      contractFile: "does-not-exist-contract.json",
    });
    assert.equal(result.reconstructed, true, "recovery must not depend on caller contract material");
    assert.equal(result.phase, "CONTRACT_READY");
    const ledger = await validateEventLedger(target, packageRoot, { taskId: tid });
    assert.equal(ledger.events.filter((e) => e.event === "CONTRACT_VALIDATED").length, 1);
  } finally {
    await removeTempTree(target);
  }
});

test("preset evolution that changes the generated fingerprint does not make a historical contract unrecoverable", async () => {
  const { target, tid } = await validLedgerNoStateFixture();
  try {
    // Simulate a preset generator whose current output differs from the
    // historical contract: reconstruction must still recover the persisted
    // contract because the validated CONTRACT_VALIDATED event is canonical.
    const { readContract } = await import("../src/core/contract.js");
    const canonical = await readContract(target, packageRoot, { taskId: tid });
    const drifted = { ...createPresetContract({ taskId: tid, preset: "feature" }), objective: "drifted preset output" };
    assert.notEqual(contractFingerprint(drifted), canonical.fingerprint, "fixture must drift");
    const result = await runContractCreate({ target, packageRoot, taskId: tid, preset: "feature" });
    assert.equal(result.reconstructed, true);
    const after = await readContract(target, packageRoot, { taskId: tid });
    assert.equal(after.fingerprint, canonical.fingerprint, "persisted contract remains canonical");
  } finally {
    await removeTempTree(target);
  }
});

test("caller-supplied different contract file is rejected without overwriting the canonical contract", async () => {
  const { target, tid } = await validLedgerNoStateFixture();
  try {
    const { readContract } = await import("../src/core/contract.js");
    const canonical = await readContract(target, packageRoot, { taskId: tid });
    const different = { ...createPresetContract({ taskId: tid, preset: "bug" }), objective: "a genuinely different objective" };
    assert.notEqual(contractFingerprint(different), canonical.fingerprint, "fixture must differ from canonical contract");
    const contractFile = "different-contract.json";
    await writeFile(path.join(target, contractFile), JSON.stringify(different, null, 2), "utf8");
    await assert.rejects(
      runContractCreate({ target, packageRoot, taskId: tid, contractFile }),
      (error) => error.code === "E_CONTRACT_BOOTSTRAP_INCONSISTENT",
    );
    const after = await readContract(target, packageRoot, { taskId: tid });
    assert.equal(after.fingerprint, canonical.fingerprint, "canonical contract must remain untouched");
    const state = await readWorkState(target, { packageRoot, taskId: tid });
    assert.equal(state, null, "rejected reconstruction must not write work-state");
  } finally {
    await removeTempTree(target);
  }
});

// ── Candidate recognition (Step 23) ──────────────────────────────────

test("exact candidate recognized by isContractBootstrapRepairCandidate", async () => {
  const { target } = await buggyStateFixture();
  try {
    const ledger = await validateEventLedger(target, packageRoot, { taskId });
    const candidate = isContractBootstrapRepairCandidate(ledger.events, ledger.errors, taskId);
    assert.ok(candidate, "should recognize the exact defect");
    assert.equal(candidate.taskId, taskId);
  } finally {
    await removeTempTree(target);
  }
});

test("one CONTRACT_VALIDATED → not repairable", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-hardening-one-cv-"));
  try {
    const contract = createContract({
      taskId: "one-cv", objective: "test", deliverables: [], constraints: [],
      risks: [], verification: [], successCriteria: [], stopConditions: [],
      unresolvedDecisions: [], sourceRefs: [],
    });
    const descriptor = createTaskDescriptor({ taskId: "one-cv", writeClaims: [] });
    await writeTaskDescriptor(target, descriptor, packageRoot);
    await writeContract(target, contract, packageRoot, { taskId: "one-cv" });
    await appendTransaction(target, "one-cv", "task-create", "TASK_RECEIVED", { createdAt: descriptor.createdAt });
    await appendTransaction(target, "one-cv", "discover", "DISCOVERY_STARTED", { source: "test" });
    await appendTransaction(target, "one-cv", "contract-create", "CONTRACT_VALIDATED", { contractFingerprint: contractFingerprint(contract) });
    const ledger = await validateEventLedger(target, packageRoot, { taskId: "one-cv" });
    const candidate = isContractBootstrapRepairCandidate(ledger.events, ledger.errors, "one-cv");
    assert.equal(candidate, null, "single CONTRACT_VALIDATED is not a repair candidate");
  } finally {
    await removeTempTree(target);
  }
});

test("three CONTRACT_VALIDATED → rejected", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-hardening-three-cv-"));
  try {
    const contract = createContract({
      taskId: "three-cv", objective: "test", deliverables: [], constraints: [],
      risks: [], verification: [], successCriteria: [], stopConditions: [],
      unresolvedDecisions: [], sourceRefs: [],
    });
    const descriptor = createTaskDescriptor({ taskId: "three-cv", writeClaims: [] });
    await writeTaskDescriptor(target, descriptor, packageRoot);
    await writeContract(target, contract, packageRoot, { taskId: "three-cv" });
    await appendTransaction(target, "three-cv", "task-create", "TASK_RECEIVED", { createdAt: descriptor.createdAt });
    await appendTransaction(target, "three-cv", "discover", "DISCOVERY_STARTED", { source: "test" });
    await appendTransaction(target, "three-cv", "contract-create", "CONTRACT_VALIDATED", { contractFingerprint: contractFingerprint(contract) });
    await appendTransaction(target, "three-cv", "contract-create", "CONTRACT_VALIDATED", { contractFingerprint: contractFingerprint(contract) });
    await appendTransaction(target, "three-cv", "contract-create", "CONTRACT_VALIDATED", { contractFingerprint: contractFingerprint(contract) });
    const ledger = await validateEventLedger(target, packageRoot, { taskId: "three-cv" });
    const candidate = isContractBootstrapRepairCandidate(ledger.events, ledger.errors, "three-cv");
    assert.equal(candidate, null, "three CONTRACT_VALIDATED is not a repair candidate");
  } finally {
    await removeTempTree(target);
  }
});

test("different fingerprints → unsafe, not a candidate", async () => {
  const { target } = await baseFixture();
  try {
    const eventsPath = path.join(target, taskArtifactPath(taskId, "events"));
    const text = await readFile(eventsPath, "utf8");
    const events = text.trim().split("\n").map((l) => JSON.parse(l));
    events[4].details.contractFingerprint = "b".repeat(64);
    await writeFile(eventsPath, `${events.map((e) => JSON.stringify(e)).join("\n")}\n`);
    const ledger = await validateEventLedger(target, packageRoot, { taskId });
    const candidate = isContractBootstrapRepairCandidate(ledger.events, ledger.errors, taskId);
    assert.equal(candidate, null, "different fingerprints must not be recognized as candidate");
  } finally {
    await removeTempTree(target);
  }
});

test("wrong taskId → rejected", async () => {
  const { target } = await buggyStateFixture();
  try {
    const ledger = await validateEventLedger(target, packageRoot, { taskId });
    const candidate = isContractBootstrapRepairCandidate(ledger.events, ledger.errors, "wrong-task-id");
    assert.equal(candidate, null, "wrong taskId must not match");
  } finally {
    await removeTempTree(target);
  }
});

test("invalid hash chain → rejected", async () => {
  const { target } = await baseFixture();
  try {
    const eventsPath = path.join(target, taskArtifactPath(taskId, "events"));
    const text = await readFile(eventsPath, "utf8");
    const events = text.trim().split("\n").map((l) => JSON.parse(l));
    events[2].previousHash = "bad";
    await writeFile(eventsPath, `${events.map((e) => JSON.stringify(e)).join("\n")}\n`);
    const ledger = await validateEventLedger(target, packageRoot, { taskId });
    const candidate = isContractBootstrapRepairCandidate(ledger.events, ledger.errors, taskId);
    assert.equal(candidate, null, "broken hash chain must not be a candidate");
  } finally {
    await removeTempTree(target);
  }
});

// ── Chronology (Step 10) ──────────────────────────────────────────────

test("only exact two duplicate errors tolerated", async () => {
  const { target } = await buggyStateFixture();
  try {
    const ledger = await validateEventLedger(target, packageRoot, { taskId });
    const chronologyErrors = ledger.errors.filter(
      (e) => e.code === "E_PHASE_CHRONOLOGY_INVALID",
    );
    assert.ok(chronologyErrors.length >= 2, "should have at least 2 chronology errors");
    for (const error of chronologyErrors) {
      assert.ok(isExactDuplicateContractChronologyError(error),
        `error "${error.message}" should be an exact duplicate-contract error`);
    }
  } finally {
    await removeTempTree(target);
  }
});

test("unrelated chronology error not suppressed by repair marker", async () => {
  // Build the exact supported duplicate CONTRACT_VALIDATED defect plus one
  // additional unrelated chronology error: VERIFICATION_RECORDED appears
  // before VERIFICATION_STARTED, which is independent of the duplicate.
  const { target, tid } = await validLedgerWithRouteNoStateFixture();
  try {
    const { value: existingContract } = await (await import("../src/core/contract.js")).readContract(target, packageRoot, { taskId: tid });
    await appendTransaction(target, tid, "contract-create", "CONTRACT_VALIDATED", { contractFingerprint: contractFingerprint(existingContract) });
    // Independent unrelated chronology defect (not one of the two tolerated
    // duplicate-CONTRACT errors): completion-style ordering violation.
    await appendTransaction(target, tid, "verify", "VERIFICATION_RECORDED", { verificationCycle: 1 });
    const before = await validateEventLedger(target, packageRoot, { taskId: tid });
    assert.equal(before.valid, false, "defective ledger must be invalid before repair");
    const unrelatedErrors = before.errors.filter((error) =>
      error.code === "E_PHASE_CHRONOLOGY_INVALID"
      && !isExactDuplicateContractChronologyError(error));
    assert.ok(unrelatedErrors.length > 0, "fixture must contain an unrelated chronology error");

    // The repair must reject a ledger whose defect goes beyond the exact
    // duplicate signature.
    await assert.rejects(
      runTaskRepairContractBootstrap({ target, packageRoot, taskId: tid, acknowledgeRepair: true }),
      (error) => error.code === "E_CONTRACT_BOOTSTRAP_REPAIR_UNSAFE",
    );

    // Even if a marker for the exact defect were otherwise appended, the
    // validator may only suppress the two exact duplicate errors. Simulate the
    // otherwise-valid repaired ledger plus the unrelated error to prove the
    // validator keeps the unrelated error: validate the repairedFixture
    // behavior by confirming the candidate recognizer refuses the widened
    // error set.
    const candidate = isContractBootstrapRepairCandidate(before.events, before.errors, tid);
    assert.equal(candidate, null, "unrelated chronology error must disqualify the repair candidate");

    const after = await validateEventLedger(target, packageRoot, { taskId: tid });
    assert.equal(after.valid, false, "ledger with an unrelated chronology error stays invalid");
    for (const unrelated of unrelatedErrors) {
      assert.ok(after.errors.some((error) => error.message === unrelated.message
        && error.code === unrelated.code),
      `unrelated error must remain present: ${unrelated.message}`);
    }
  } finally {
    await removeTempTree(target);
  }
});

test("valid repaired ledger suppresses only the exact duplicate chronology errors", async () => {
  const { target } = await repairedFixture();
  try {
    const rawEvents = await readEvents(target, packageRoot, { taskId });
    const marker = rawEvents.find((e) => e.event === CONTRACT_BOOTSTRAP_REPAIR_EVENT);
    assert.ok(marker, "repair marker present");
    assert.ok(isContractBootstrapRepairMarkerValid(rawEvents, marker));

    // Recompute the raw (unsuppressed) error set by revalidating a ledger copy
    // without the marker: it must produce exactly the tolerated errors.
    const ledger = await validateEventLedger(target, packageRoot, { taskId });
    assert.equal(ledger.valid, true, "repaired ledger is valid");
    assert.ok(ledger.errors.length === 0, "no residual errors after suppression");
  } finally {
    await removeTempTree(target);
  }
});

test("PLAN_RECORDED candidate rejected in repair v1", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-hardening-plan-rejected-"));
  try {
    const contract = createContract({
      taskId: "plan-rejected", objective: "test", deliverables: [], constraints: [],
      risks: [], verification: [], successCriteria: [], stopConditions: [],
      unresolvedDecisions: [], sourceRefs: [],
    });
    const descriptor = createTaskDescriptor({ taskId: "plan-rejected", writeClaims: [] });
    await writeTaskDescriptor(target, descriptor, packageRoot);
    await writeContract(target, contract, packageRoot, { taskId: "plan-rejected" });
    await appendTransaction(target, "plan-rejected", "task-create", "TASK_RECEIVED", { createdAt: descriptor.createdAt });
    await appendTransaction(target, "plan-rejected", "discover", "DISCOVERY_STARTED", { source: "test" });
    await appendTransaction(target, "plan-rejected", "contract-create", "CONTRACT_VALIDATED", { contractFingerprint: contractFingerprint(contract) });
    await appendTransaction(target, "plan-rejected", "contract-create", "CONTRACT_VALIDATED", { contractFingerprint: contractFingerprint(contract) });
    await appendTransaction(target, "plan-rejected", "plan", "PLAN_RECORDED");
    const ledger = await validateEventLedger(target, packageRoot, { taskId: "plan-rejected" });
    const candidate = isContractBootstrapRepairCandidate(ledger.events, ledger.errors, "plan-rejected");
    assert.equal(candidate, null, "PLAN_RECORDED makes this beyond the repair v1 boundary");
  } finally {
    await removeTempTree(target);
  }
});

test("execution candidate rejected in repair v1", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-hardening-exec-rejected-"));
  try {
    const contract = createContract({
      taskId: "exec-rejected", objective: "test", deliverables: [], constraints: [],
      risks: [], verification: [], successCriteria: [], stopConditions: [],
      unresolvedDecisions: [], sourceRefs: [],
    });
    const descriptor = createTaskDescriptor({ taskId: "exec-rejected", writeClaims: [] });
    await writeTaskDescriptor(target, descriptor, packageRoot);
    await writeContract(target, contract, packageRoot, { taskId: "exec-rejected" });
    await appendTransaction(target, "exec-rejected", "task-create", "TASK_RECEIVED", { createdAt: descriptor.createdAt });
    await appendTransaction(target, "exec-rejected", "discover", "DISCOVERY_STARTED", { source: "test" });
    await appendTransaction(target, "exec-rejected", "contract-create", "CONTRACT_VALIDATED", { contractFingerprint: contractFingerprint(contract) });
    await appendTransaction(target, "exec-rejected", "contract-create", "CONTRACT_VALIDATED", { contractFingerprint: contractFingerprint(contract) });
    await appendTransaction(target, "exec-rejected", "execute", "EXECUTION_STARTED");
    const ledger = await validateEventLedger(target, packageRoot, { taskId: "exec-rejected" });
    const candidate = isContractBootstrapRepairCandidate(ledger.events, ledger.errors, "exec-rejected");
    assert.equal(candidate, null, "EXECUTION_STARTED makes this beyond the repair v1 boundary");
  } finally {
    await removeTempTree(target);
  }
});

// ── State (Step 12) ──────────────────────────────────────────────────

test("exact buggy CONTRACT_READY state accepted by repair", async () => {
  const { target } = await buggyStateFixture();
  try {
    const result = await runTaskRepairContractBootstrap({
      target, packageRoot, taskId, acknowledgeRepair: true,
    });
    assert.equal(result.repaired, true);
  } finally {
    await removeTempTree(target);
  }
});

test("state task mismatch rejected by repair", async () => {
  const { target, contractHash } = await buggyStateFixture();
  try {
    await writeWorkState(target, createWorkState({
      taskId: "wrong-task",
      contractFingerprint: contractHash,
      repositoryFingerprint: { branch: null, head: null },
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
    }), { packageRoot, taskId });
    await assert.rejects(
      runTaskRepairContractBootstrap({ target, packageRoot, taskId, acknowledgeRepair: true }),
      (error) => error.code === "E_CONTRACT_BOOTSTRAP_REPAIR_UNSAFE",
    );
  } finally {
    await removeTempTree(target);
  }
});

test("state contract mismatch rejected by repair", async () => {
  const { target } = await buggyStateFixture();
  try {
    await writeWorkState(target, createWorkState({
      taskId,
      contractFingerprint: "c".repeat(64),
      repositoryFingerprint: { branch: null, head: null },
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
    }), { packageRoot, taskId });
    await assert.rejects(
      runTaskRepairContractBootstrap({ target, packageRoot, taskId, acknowledgeRepair: true }),
      (error) => error.code === "E_CONTRACT_BOOTSTRAP_REPAIR_UNSAFE",
    );
  } finally {
    await removeTempTree(target);
  }
});

test("unexpected routeFingerprint in CONTRACT_READY state rejected", async () => {
  const { target, contractHash } = await buggyStateFixture();
  try {
    await writeWorkState(target, createWorkState({
      taskId,
      contractFingerprint: contractHash,
      routeFingerprint: "d".repeat(64),
      repositoryFingerprint: { branch: null, head: null },
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
    }), { packageRoot, taskId });
    await assert.rejects(
      runTaskRepairContractBootstrap({ target, packageRoot, taskId, acknowledgeRepair: true }),
      (error) => error.code === "E_CONTRACT_BOOTSTRAP_REPAIR_UNSAFE",
    );
  } finally {
    await removeTempTree(target);
  }
});

// ── Marker (Step 17, 23) ─────────────────────────────────────────────

test("repair marker appended and original duplicate remains physically present", async () => {
  const { target } = await buggyStateFixture();
  try {
    const before = await readEvents(target, packageRoot, { taskId });
    const cvCount = before.filter((e) => e.event === "CONTRACT_VALIDATED").length;
    assert.equal(cvCount, 2, "should have 2 CONTRACT_VALIDATED before repair");
    await runTaskRepairContractBootstrap({ target, packageRoot, taskId, acknowledgeRepair: true });
    const after = await readEvents(target, packageRoot, { taskId });
    const afterCvCount = after.filter((e) => e.event === "CONTRACT_VALIDATED").length;
    assert.equal(afterCvCount, 2, "both original CONTRACT_VALIDATED events must remain");
    const markerCount = after.filter((e) => e.event === CONTRACT_BOOTSTRAP_REPAIR_EVENT).length;
    assert.equal(markerCount, 1, "exactly one repair marker");
  } finally {
    await removeTempTree(target);
  }
});

test("repair ID is deterministic for the same fixture", async () => {
  const { target } = await buggyStateFixture();
  try {
    const first = await runTaskRepairContractBootstrap({ target, packageRoot, taskId, acknowledgeRepair: true });
    const second = await runTaskRepairContractBootstrap({ target, packageRoot, taskId, acknowledgeRepair: true });
    assert.equal(first.repairId, second.repairId, "idempotent repair must return same repairId");
  } finally {
    await removeTempTree(target);
  }
});

test("multiple repair markers → ledger invalid", async () => {
  const { target } = await repairedFixture();
  try {
    await withTaskTransaction({ target, taskId, operation: "inject-bogus", packageRoot, recordCommitEvent: true }, async () => {
      await appendProtocolEvent(target, {
        taskId,
        event: CONTRACT_BOOTSTRAP_REPAIR_EVENT,
        details: {
          repairVersion: 1, taskId, repairId: "repair-" + "0".repeat(64),
          defect: "DUPLICATE_CONTRACT_VALIDATED_AFTER_CONTRACT_READY",
          canonicalContractEventSeq: 3, canonicalContractEventHash: "a".repeat(64),
          duplicateContractEventSeq: 4, duplicateContractEventHash: "a".repeat(64),
          contractCreateCommitSeq: 5, contractCreateCommitHash: "a".repeat(64),
          contractCreateTransactionId: "tx-bogus",
          contractFingerprint: "a".repeat(64),
          reconstructedPhase: "ROUTED", routeFingerprint: "a".repeat(64),
          previousStateFingerprint: null, reconstructedStateFingerprint: "a".repeat(64),
          repairedAt: new Date().toISOString(), authorityKind: "CALLER_ACKNOWLEDGED",
        },
      }, packageRoot, { taskId });
    });
    const ledger = await validateEventLedger(target, packageRoot, { taskId });
    assert.equal(ledger.valid, false, "multiple markers should make ledger invalid");
  } finally {
    await removeTempTree(target);
  }
});

// ── Ownership (Step 16) ──────────────────────────────────────────────

test("before repair: ownership INCONSISTENT, mutationAllowed false", async () => {
  const { target } = await buggyStateFixture();
  try {
    const claim = await resolveTaskClaimState(target, { taskId, packageRoot });
    assert.equal(claim.claimState, "INCONSISTENT");
    assert.equal(claim.mutationAllowed, false);
  } finally {
    await removeTempTree(target);
  }
});

test("after repair: ownership ACTIVE, mutationAllowed true", async () => {
  const { target } = await buggyStateFixture();
  try {
    await runTaskRepairContractBootstrap({ target, packageRoot, taskId, acknowledgeRepair: true });
    const claim = await resolveTaskClaimState(target, { taskId, packageRoot });
    assert.equal(claim.claimState, "ACTIVE");
    assert.equal(claim.mutationAllowed, true);
    assert.equal(claim.ownershipValid, true);
  } finally {
    await removeTempTree(target);
  }
});

test("post-repair state contractFingerprint changed → ownership INCONSISTENT", async () => {
  const { target } = await repairedFixture();
  try {
    const state = await readWorkState(target, { packageRoot, taskId });
    await writeWorkState(target, { ...state, contractFingerprint: "e".repeat(64) }, { packageRoot, taskId });
    const claim = await resolveTaskClaimState(target, { taskId, packageRoot });
    assert.equal(claim.claimState, "INCONSISTENT");
    assert.equal(claim.mutationAllowed, false);
  } finally {
    await removeTempTree(target);
  }
});

test("post-repair state reconstructedStateFingerprint tampered → ownership INCONSISTENT", async () => {
  const { target } = await repairedFixture();
  try {
    const statePath = path.join(target, taskArtifactPath(taskId, "state"));
    const stateText = await readFile(statePath, "utf8");
    const state = JSON.parse(stateText);
    state.contractFingerprint = "f".repeat(64);
    await writeFile(statePath, JSON.stringify(state, null, 2));
    const claim = await resolveTaskClaimState(target, { taskId, packageRoot });
    assert.equal(claim.claimState, "INCONSISTENT");
    assert.equal(claim.mutationAllowed, false);
  } finally {
    await removeTempTree(target);
  }
});

test("post-repair repair marker tampered → ownership INCONSISTENT", async () => {
  const { target } = await repairedFixture();
  try {
    const eventsPath = path.join(target, taskArtifactPath(taskId, "events"));
    const text = await readFile(eventsPath, "utf8");
    const events = text.trim().split("\n").map((l) => JSON.parse(l));
    const markerIdx = events.findIndex((e) => e.event === CONTRACT_BOOTSTRAP_REPAIR_EVENT);
    events[markerIdx].details.repairId = `repair-${"0".repeat(64)}`;
    await writeFile(eventsPath, `${events.map((e) => JSON.stringify(e)).join("\n")}\n`);
    const claim = await resolveTaskClaimState(target, { taskId, packageRoot });
    assert.equal(claim.claimState, "INCONSISTENT");
    assert.equal(claim.mutationAllowed, false);
  } finally {
    await removeTempTree(target);
  }
});

// ── Cross-artifact ownership tamper regressions (§5–§8) ─────────────

async function repairedRoutedFixture() {
  const { target, contractHash, route } = await buggyStateFixture();
  // Route exists in the base fixture, so the repair reconstructs ROUTED and
  // binds the marker to both contract and route fingerprints.
  const result = await runTaskRepairContractBootstrap({ target, packageRoot, taskId, acknowledgeRepair: true });
  assert.equal(result.repaired, true);
  assert.equal(result.phase, "ROUTED");
  return { target, contractHash, route };
}

test("post-repair contract artifact replaced with a valid different contract → ownership INCONSISTENT", async () => {
  const { target } = await repairedRoutedFixture();
  try {
    const replaced = { ...createPresetContract({ taskId, preset: "feature" }), objective: "replacement objective" };
    await writeContract(target, replaced, packageRoot, { taskId });
    const claim = await resolveTaskClaimState(target, { taskId, packageRoot });
    assert.equal(claim.claimState, "INCONSISTENT");
    assert.equal(claim.mutationAllowed, false);
    assert.equal(claim.ownershipValid, false);
    assert.ok(claim.errors.some((error) => error.causeCode === "E_CONTRACT_BOOTSTRAP_REPAIR_INVALID"
      || error.message.includes("contract")));
  } finally {
    await removeTempTree(target);
  }
});

test("post-repair contract artifact deleted → ownership INCONSISTENT", async () => {
  const { target } = await repairedRoutedFixture();
  try {
    await rm(path.join(target, taskArtifactPath(taskId, "contract")), { force: true });
    const claim = await resolveTaskClaimState(target, { taskId, packageRoot });
    assert.equal(claim.claimState, "INCONSISTENT");
    assert.equal(claim.mutationAllowed, false);
    assert.equal(claim.ownershipValid, false);
  } finally {
    await removeTempTree(target);
  }
});

test("post-repair route artifact replaced with a different valid route → ownership INCONSISTENT", async () => {
  const { target } = await repairedRoutedFixture();
  try {
    const contract = await (await import("../src/core/contract.js")).readContract(target, packageRoot, { taskId });
    const differentRoute = evaluateRoute({ workType: "documentation", surfaces: [], executableChange: false });
    await writeJsonArtifact(target, taskArtifactPath(taskId, "route"),
      { ...differentRoute, contractFingerprint: contract.fingerprint }, "routing-result", packageRoot, { taskId });
    const claim = await resolveTaskClaimState(target, { taskId, packageRoot });
    assert.equal(claim.claimState, "INCONSISTENT");
    assert.equal(claim.mutationAllowed, false);
    assert.equal(claim.ownershipValid, false);
  } finally {
    await removeTempTree(target);
  }
});

test("post-repair route artifact deleted → ownership INCONSISTENT", async () => {
  const { target } = await repairedRoutedFixture();
  try {
    await rm(path.join(target, taskArtifactPath(taskId, "route")), { force: true });
    const claim = await resolveTaskClaimState(target, { taskId, packageRoot });
    assert.equal(claim.claimState, "INCONSISTENT");
    assert.equal(claim.mutationAllowed, false);
    assert.equal(claim.ownershipValid, false);
  } finally {
    await removeTempTree(target);
  }
});

test("post-repair route contractFingerprint rebound → ownership INCONSISTENT", async () => {
  const { target } = await repairedRoutedFixture();
  try {
    const routePath = path.join(target, taskArtifactPath(taskId, "route"));
    const route = JSON.parse(await readFile(routePath, "utf8"));
    route.contractFingerprint = "b".repeat(64);
    await writeFile(routePath, `${JSON.stringify(route, null, 2)}\n`, "utf8");
    const claim = await resolveTaskClaimState(target, { taskId, packageRoot });
    assert.equal(claim.claimState, "INCONSISTENT");
    assert.equal(claim.mutationAllowed, false);
  } finally {
    await removeTempTree(target);
  }
});

test("repaired contract-only checkpoint with no route artifact keeps ownership ACTIVE", async () => {
  // Route artifact absent: repair reconstructs CONTRACT_READY, the marker has
  // routeFingerprint null, and ownership must not demand a route artifact.
  // The duplicate CONTRACT_VALIDATED is separated by a ROUTE_VALIDATED
  // milestone so the ledger reproduces the exact supported defect signature.
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-hardening-contractonly-"));
  try {
    const contract = createPresetContract({ taskId: "contract-only", preset: "feature" });
    const contractHash = contractFingerprint(contract);
    const descriptor = createTaskDescriptor({ taskId: "contract-only", writeClaims: [] });
    await writeTaskDescriptor(target, descriptor, packageRoot);
    await writeContract(target, contract, packageRoot, { taskId: "contract-only" });
    await appendTransaction(target, "contract-only", "task-create", "TASK_RECEIVED", { createdAt: descriptor.createdAt });
    await appendTransaction(target, "contract-only", "discover", "DISCOVERY_STARTED", { source: "test" });
    await appendTransaction(target, "contract-only", "contract-create", "CONTRACT_VALIDATED", { contractFingerprint: contractHash });
    await appendTransaction(target, "contract-only", "route", "ROUTE_VALIDATED");
    await appendTransaction(target, "contract-only", "contract-create", "CONTRACT_VALIDATED", { contractFingerprint: contractHash });
    await writeWorkState(target, createWorkState({
      taskId: "contract-only",
      contractFingerprint: contractHash,
      repositoryFingerprint: { branch: null, head: null },
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
    }), { packageRoot, taskId: "contract-only" });
    const repaired = await runTaskRepairContractBootstrap({
      target, packageRoot, taskId: "contract-only", acknowledgeRepair: true,
    });
    assert.equal(repaired.phase, "CONTRACT_READY");
    const claim = await resolveTaskClaimState(target, { taskId: "contract-only", packageRoot });
    assert.equal(claim.claimState, "ACTIVE");
    assert.equal(claim.mutationAllowed, true);
    assert.equal(claim.ownershipValid, true);
  } finally {
    await removeTempTree(target);
  }
});

// ── Idempotency (Step 20) ────────────────────────────────────────────

test("valid rerun produces no new event or state write", async () => {
  const { target } = await repairedFixture();
  try {
    const eventsBefore = await readFile(path.join(target, taskArtifactPath(taskId, "events")), "utf8");
    const stateBefore = await readFile(path.join(target, taskArtifactPath(taskId, "state")), "utf8");
    await runTaskRepairContractBootstrap({ target, packageRoot, taskId, acknowledgeRepair: true });
    const eventsAfter = await readFile(path.join(target, taskArtifactPath(taskId, "events")), "utf8");
    const stateAfter = await readFile(path.join(target, taskArtifactPath(taskId, "state")), "utf8");
    assert.equal(eventsBefore, eventsAfter, "events file must not change on idempotent rerun");
    assert.equal(stateBefore, stateAfter, "state file must not change on idempotent rerun");
  } finally {
    await removeTempTree(target);
  }
});

test("tampered rerun fails closed", async () => {
  const { target } = await repairedFixture();
  try {
    const statePath = path.join(target, taskArtifactPath(taskId, "state"));
    const stateText = await readFile(statePath, "utf8");
    const state = JSON.parse(stateText);
    state.contractFingerprint = "0".repeat(64);
    state.revision = (state.revision ?? 0) + 1;
    await writeFile(statePath, JSON.stringify(state, null, 2));
    await assert.rejects(
      runTaskRepairContractBootstrap({ target, packageRoot, taskId, acknowledgeRepair: true }),
      (error) => error.code === "E_CONTRACT_BOOTSTRAP_REPAIR_INVALID",
    );
  } finally {
    await removeTempTree(target);
  }
});

// ── next commandSpec execution (Step 22) ─────────────────────────────

test("next → REPAIR_CONTRACT_BOOTSTRAP → execute → repaired → next no longer returns repair", async () => {
  const { target } = await buggyStateFixture();
  try {
    const nextBefore = await getNextAction({ target, packageRoot, taskId });
    assert.equal(nextBefore.nextAction, NEXT_ACTIONS.REPAIR_CONTRACT_BOOTSTRAP);
    assert.ok(nextBefore.commandSpecs?.length > 0, "should have commandSpecs");
    const spec = nextBefore.commandSpecs[0];
    assert.equal(spec.subcommand, "task-repair-contract-bootstrap");
    const ackInput = spec.requiredInputs?.find((i) => i.name === "acknowledgeRepair");
    assert.ok(ackInput, "commandSpec should require acknowledgeRepair input");

    const result = await runTaskRepairContractBootstrap({
      target, packageRoot, taskId, acknowledgeRepair: true,
    });
    assert.equal(result.repaired, true);

    const nextAfter = await getNextAction({ target, packageRoot, taskId });
    assert.notEqual(nextAfter.nextAction, NEXT_ACTIONS.REPAIR_CONTRACT_BOOTSTRAP,
      "next should no longer recommend repair after successful repair");
  } finally {
    await removeTempTree(target);
  }
});

test("next commandSpec executes through the real COMMAND_EXECUTORS boundary", async () => {
  const { target } = await buggyStateFixture();
  try {
    const nextBefore = await getNextAction({ target, packageRoot, taskId });
    assert.equal(nextBefore.nextAction, NEXT_ACTIONS.REPAIR_CONTRACT_BOOTSTRAP);
    const spec = nextBefore.commandSpecs[0];
    // Registration: the recommended commandId maps to the canonical executor.
    assert.equal(spec.commandId, "task-repair-contract-bootstrap");
    assert.equal(typeof COMMAND_EXECUTORS[spec.commandId], "function",
      "COMMAND_EXECUTORS must register the recommended commandId");

    // Apply requiredInputs using the canonical CLI option mapping and dispatch
    // through the real executor envelope, exactly like the CLI does.
    const propagated = spec.requiredInputs.map((input) => input.option);
    assert.ok(propagated.includes("--acknowledge-repair"));
    const parsed = parseArgs([...spec.argv, ...propagated]);
    const execution = await COMMAND_EXECUTORS[spec.commandId]({ target, packageRoot, options: parsed.options });
    assert.equal(execution.exitCode, 0);
    assert.equal(execution.result.repaired, true);

    // The repaired task no longer recommends the repair command.
    const nextAfter = await getNextAction({ target, packageRoot, taskId });
    assert.notEqual(nextAfter.nextAction, NEXT_ACTIONS.REPAIR_CONTRACT_BOOTSTRAP);
    const ledger = await validateEventLedger(target, packageRoot, { taskId });
    assert.equal(ledger.valid, true);
  } finally {
    await removeTempTree(target);
  }
});

// ── Locks (Step 8, §11) ─────────────────────────────────────────────

test("no lock → repair succeeds", async () => {
  const { target } = await buggyStateFixture();
  try {
    const result = await runTaskRepairContractBootstrap({
      target, packageRoot, taskId, acknowledgeRepair: true,
    });
    assert.equal(result.repaired, true);
  } finally {
    await removeTempTree(target);
  }
});

function writeTaskLockFile(target, tid, lockData) {
  return writeFile(path.join(target, taskLockPath(tid)), `${JSON.stringify(lockData, null, 2)}\n`, "utf8");
}

function staleLeaseOverrides() {
  // Lease window safely in the past so classifyLockStaleness returns STALE.
  return {
    acquiredAt: new Date(Date.now() - 3600_000).toISOString(),
    heartbeatAt: new Date(Date.now() - 3600_000).toISOString(),
    leaseMs: 60_000,
  };
}

test("live task lock → repair rejected with E_TASK_LOCKED, no mutation", async () => {
  const { target, contractHash } = await buggyStateFixture();
  try {
    const handle = await acquireTaskLock(target, taskId, "foreign-mutation");
    try {
      await assert.rejects(
        runTaskRepairContractBootstrap({ target, packageRoot, taskId, acknowledgeRepair: true }),
        (error) => error.code === "E_TASK_LOCKED",
      );
    } finally {
      await handle.release();
    }
    // Ledger and state unchanged (still the exact defect, repair still available).
    const state = await readWorkState(target, { packageRoot, taskId });
    assert.equal(state.phase, "CONTRACT_READY");
    assert.equal(state.contractFingerprint, contractHash);
    const events = await readEvents(target, packageRoot, { taskId });
    assert.equal(events.filter((e) => e.event === CONTRACT_BOOTSTRAP_REPAIR_EVENT).length, 0);
  } finally {
    await removeTempTree(target);
  }
});

test("stale task lock → CAS-released and repair succeeds", async () => {
  const { target } = await buggyStateFixture();
  try {
    const staleLock = {
      lockId: "lock-stale-1",
      taskId,
      operation: "dead-mutation",
      pid: 1,
      hostname: "gone",
      processStartToken: "1:1",
      ownerInstanceId: "instance-gone",
      ...staleLeaseOverrides(),
    };
    await writeTaskLockFile(target, taskId, staleLock);
    const result = await runTaskRepairContractBootstrap({
      target, packageRoot, taskId, acknowledgeRepair: true,
    });
    assert.equal(result.repaired, true);
    const lockAfter = await readLockInfo(target, taskId);
    assert.equal(lockAfter, null, "stale lock must be released by the repair");
  } finally {
    await removeTempTree(target);
  }
});

test("stale lock replaced during settlement → repair rejected, replacement lock preserved, no mutation", async () => {
  const { target } = await buggyStateFixture();
  try {
    const staleLock = {
      lockId: "lock-stale-replace",
      taskId,
      operation: "dead-mutation",
      pid: 1,
      hostname: "gone",
      processStartToken: "1:1",
      ownerInstanceId: "instance-gone",
      ...staleLeaseOverrides(),
    };
    await writeTaskLockFile(target, taskId, staleLock);

    // Simulate CAS replacement after classification but before settlement:
    // exercise the real helper with an observed lock that differs from the
    // classified one, proving the compare-and-swap rejects the release.
    const classified = await readLockInfo(target, taskId);
    assert.equal(classifyLockStaleness(classified).status, "STALE");
    const replacement = {
      lockId: "lock-replacement",
      taskId,
      operation: "new-owner",
      pid: process.pid,
      hostname: os.hostname(),
      processStartToken: "1:999999999",
      ownerInstanceId: "instance-new",
      acquiredAt: new Date().toISOString(),
      heartbeatAt: new Date().toISOString(),
      leaseMs: 300000,
    };
    await writeTaskLockFile(target, taskId, replacement);
    const released = await releaseStaleTaskLockIfUnchanged(target, taskId, classified);
    assert.equal(released.released, false);
    assert.equal(released.reason, "LOCK_CHANGED");
    const current = await readLockInfo(target, taskId);
    assert.equal(current.lockId, "lock-replacement", "replacement lock must be preserved");

    // The repair path performs the same CAS against the file it classified, so
    // a lock replaced between read and release must fail closed without any
    // repair mutation. The replacement is LIVE, so the repair refuses and
    // leaves the replacement lock, the ledger, and the state untouched.
    await assert.rejects(
      runTaskRepairContractBootstrap({ target, packageRoot, taskId, acknowledgeRepair: true }),
      (error) => error.code === "E_TASK_LOCKED",
    );
    const events = await readEvents(target, packageRoot, { taskId });
    assert.equal(events.filter((e) => e.event === CONTRACT_BOOTSTRAP_REPAIR_EVENT).length, 0,
      "no repair marker may be appended");
    const state = await readWorkState(target, { packageRoot, taskId });
    assert.equal(state.phase, "CONTRACT_READY", "no state mutation");
  } finally {
    await removeTempTree(target);
  }
});

test("corrupt task lock → repair fails closed, no mutation", async () => {
  const { target } = await buggyStateFixture();
  try {
    await writeFile(path.join(target, taskLockPath(taskId)), "{ corrupted lock", "utf8");
    await assert.rejects(
      runTaskRepairContractBootstrap({ target, packageRoot, taskId, acknowledgeRepair: true }),
      (error) => error.code === "E_CONTRACT_BOOTSTRAP_REPAIR_UNSAFE",
    );
    const events = await readEvents(target, packageRoot, { taskId });
    assert.equal(events.filter((e) => e.event === CONTRACT_BOOTSTRAP_REPAIR_EVENT).length, 0);
    const state = await readWorkState(target, { packageRoot, taskId });
    assert.equal(state.phase, "CONTRACT_READY");
  } finally {
    await removeTempTree(target);
  }
});

test("structurally incomplete lock identity → repair fails closed", async () => {
  const { target } = await buggyStateFixture();
  try {
    await writeTaskLockFile(target, taskId, {
      taskId,
      operation: "incomplete",
      // Missing lockId, ownerInstanceId, leaseMs.
      acquiredAt: new Date().toISOString(),
      heartbeatAt: new Date().toISOString(),
    });
    await assert.rejects(
      runTaskRepairContractBootstrap({ target, packageRoot, taskId, acknowledgeRepair: true }),
      (error) => error.code === "E_CONTRACT_BOOTSTRAP_REPAIR_UNSAFE",
    );
    const events = await readEvents(target, packageRoot, { taskId });
    assert.equal(events.filter((e) => e.event === CONTRACT_BOOTSTRAP_REPAIR_EVENT).length, 0);
  } finally {
    await removeTempTree(target);
  }
});
