import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { runTaskRepairContractBootstrap } from "../src/commands/task-repair-contract-bootstrap.js";
import { createContract, contractFingerprint, writeContract } from "../src/core/contract.js";
import { appendProtocolEvent, validateEventLedger } from "../src/core/events.js";
import { getNextAction, NEXT_ACTIONS } from "../src/core/next-action.js";
import { evaluateRoute } from "../src/core/router.js";
import { createTaskDescriptor, writeTaskDescriptor } from "../src/core/task-descriptor.js";
import { taskArtifactPath } from "../src/core/task-paths.js";
import { getPackageRoot } from "../src/core/templates.js";
import { withTaskTransaction } from "../src/core/transaction.js";
import { createWorkState, writeWorkState } from "../src/core/work-state.js";
import { writeJsonArtifact } from "../src/core/artifacts.js";
import { removeTempTree } from "./helpers/rm-safe.js";

const packageRoot = getPackageRoot();
const taskId = "contract-bootstrap-fixture";

async function appendTransaction(target, operation, event, details = undefined, fingerprint = undefined) {
  await withTaskTransaction({ target, taskId, operation, packageRoot, recordCommitEvent: true }, async () => {
    await appendProtocolEvent(target, { taskId, event, ...(details ? { details } : {}), ...(fingerprint ? { fingerprint } : {}) }, packageRoot, { taskId });
  });
}

async function fixture() {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-contract-bootstrap-"));
  const contract = createContract({
    taskId,
    objective: "Repair a deterministic bootstrap ledger fixture",
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
  await appendTransaction(target, "task-create", "TASK_RECEIVED", { createdAt: descriptor.createdAt });
  await appendTransaction(target, "discover", "DISCOVERY_STARTED", { source: "test" });
  await appendTransaction(target, "contract-create", "CONTRACT_VALIDATED", { contractFingerprint: contractHash });
  const route = evaluateRoute({ workType: "code", surfaces: ["documentation"], executableChange: true });
  const routeValue = { ...route, contractFingerprint: contractHash };
  await writeJsonArtifact(target, taskArtifactPath(taskId, "route"), routeValue, "routing-result", packageRoot, { taskId });
  await appendTransaction(target, "route", "ROUTE_VALIDATED", undefined, route.fingerprint);
  await appendTransaction(target, "contract-create", "CONTRACT_VALIDATED", { contractFingerprint: contractHash });
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
  return { target, route };
}

test("next exposes and the official command repairs the exact bootstrap defect", async () => {
  const { target } = await fixture();
  try {
    const before = await validateEventLedger(target, packageRoot, { taskId });
    assert.equal(before.valid, false);
    const next = await getNextAction({ target, packageRoot, taskId });
    assert.equal(next.nextAction, NEXT_ACTIONS.REPAIR_CONTRACT_BOOTSTRAP);
    assert.match(next.commands[0], /--acknowledge-repair/);

    const repaired = await runTaskRepairContractBootstrap({ target, packageRoot, taskId, acknowledgeRepair: true });
    assert.equal(repaired.repaired, true);
    assert.equal(repaired.phase, "ROUTED");
    const after = await validateEventLedger(target, packageRoot, { taskId });
    assert.equal(after.valid, true);
    assert.equal(after.events.at(-2).event, "CONTRACT_BOOTSTRAP_REPAIR_RECORDED");
    assert.equal(after.events.at(-1).details.operation, "task-repair-contract-bootstrap");
  } finally {
    await removeTempTree(target);
  }
});

test("repair is idempotent and marker tampering fails closed", async () => {
  const { target } = await fixture();
  try {
    const first = await runTaskRepairContractBootstrap({ target, packageRoot, taskId, acknowledgeRepair: true });
    const eventsPath = path.join(target, taskArtifactPath(taskId, "events"));
    const statePath = path.join(target, taskArtifactPath(taskId, "state"));
    const eventText = await readFile(eventsPath, "utf8");
    const stateText = await readFile(statePath, "utf8");
    const second = await runTaskRepairContractBootstrap({ target, packageRoot, taskId, acknowledgeRepair: true });
    assert.equal(second.alreadyRepaired, true);
    assert.equal(await readFile(eventsPath, "utf8"), eventText);
    assert.equal(await readFile(statePath, "utf8"), stateText);
    assert.equal(second.repairId, first.repairId);

    const events = eventText.trim().split("\n").map((line) => JSON.parse(line));
    events.at(-2).details.repairId = `repair-${"0".repeat(64)}`;
    await writeFile(eventsPath, `${events.map((event) => JSON.stringify(event)).join("\n")}\n`);
    const tampered = await validateEventLedger(target, packageRoot, { taskId });
    assert.equal(tampered.valid, false);
    await assert.rejects(
      runTaskRepairContractBootstrap({ target, packageRoot, taskId, acknowledgeRepair: true }),
      (error) => error.code === "E_CONTRACT_BOOTSTRAP_REPAIR_INVALID",
    );
  } finally {
    await removeTempTree(target);
  }
});
