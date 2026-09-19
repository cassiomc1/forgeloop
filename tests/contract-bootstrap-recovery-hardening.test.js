import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
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
  isExactDuplicateContractChronologyError,
} from "../src/core/contract-bootstrap-recovery.js";
import { appendProtocolEvent, validateEventLedger, readEvents } from "../src/core/events.js";
import { getNextAction, NEXT_ACTIONS } from "../src/core/next-action.js";
import { evaluateRoute } from "../src/core/router.js";
import { createTaskDescriptor, writeTaskDescriptor } from "../src/core/task-descriptor.js";
import { taskArtifactPath } from "../src/core/task-paths.js";
import { getPackageRoot } from "../src/core/templates.js";
import { withTaskTransaction } from "../src/core/transaction.js";
import {
  createWorkState, readWorkState, writeWorkState,
} from "../src/core/work-state.js";
import { writeJsonArtifact } from "../src/core/artifacts.js";
import { resolveTaskClaimState } from "../src/core/task-claim-state.js";
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
  await appendTransaction(target, tid, "route", "ROUTE_VALIDATED", undefined, route.fingerprint);
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

test("ROUTE_VALIDATED exists but route artifact missing → contract-create reconstructs as CONTRACT_READY", async () => {
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
    const result = await runContractCreate({ target, packageRoot, taskId: "no-route-task", preset: "feature" });
    assert.equal(result.idempotent, true);
    assert.equal(result.reconstructed, true);
    assert.equal(result.phase, "CONTRACT_READY", "without route artifact, reconstruct as CONTRACT_READY");
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
  const { target } = await repairedFixture();
  try {
    const ledger = await validateEventLedger(target, packageRoot, { taskId });
    assert.equal(ledger.valid, true, "repaired ledger should be valid");
    assert.ok(ledger.events.some((e) => e.event === CONTRACT_BOOTSTRAP_REPAIR_EVENT),
      "repair marker should be present");
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

// ── Locks (Step 8) ──────────────────────────────────────────────────

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
