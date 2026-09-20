import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runAdvance } from "../src/commands/advance.js";
import { runContractCreate } from "../src/commands/contract-create.js";
import { runContractRevise } from "../src/commands/contract-revise.js";
import { runDiscover } from "../src/commands/discover.js";
import { runGateRecord } from "../src/commands/gate-record.js";
import { runPreflight } from "../src/commands/preflight.js";
import { runRoute } from "../src/commands/route.js";
import { runTaskCreate } from "../src/commands/task-create.js";
import { readEvents, validateEventLedger } from "../src/core/events.js";
import { getNextAction, NEXT_ACTIONS } from "../src/core/next-action.js";
import { getPackageRoot } from "../src/core/templates.js";
import { readWorkState } from "../src/core/work-state.js";

const packageRoot = getPackageRoot();
const ROUTE = Object.freeze({
  workType: "backend",
  surfaces: ["api"],
  risks: ["untrusted-input"],
  platforms: ["server"],
  behaviorChange: true,
  executableChange: true,
});

async function withTarget(run) {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-gate-record-"));
  try {
    await writeFile(path.join(target, "THREAT_MODEL.md"), "gate evidence\n");
    await run(target);
  } finally {
    await rm(target, { recursive: true, force: true });
  }
}

async function setupTask(target, taskId) {
  await runTaskCreate({ target, packageRoot, taskId, preset: "feature", claims: ["THREAT_MODEL.md"] });
  await runDiscover({ target, packageRoot, taskId });
  await runContractCreate({ target, packageRoot, taskId, preset: "feature" });
  await runRoute({ target, packageRoot, taskId, ...ROUTE });
}

async function satisfySecurityGate(target, taskId) {
  await runGateRecord({
    target,
    packageRoot,
    taskId,
    gate: "threat-boundary",
    status: "satisfied",
    artifacts: ["THREAT_MODEL.md"],
    decisions: ["Threat boundary reviewed for this task"],
  });
}

test("gate-record writes current-epoch provenance and a transaction witness", async () => {
  await withTarget(async (target) => {
    const taskId = "gate-current-epoch";
    await setupTask(target, taskId);
    await satisfySecurityGate(target, taskId);

    const events = await readEvents(target, packageRoot, { taskId });
    const gate = events.findLast((event) => event.event === "GATE_SATISFIED");
    const commit = events[events.indexOf(gate) + 1];
    assert.ok(gate);
    assert.equal(gate.details.gate, "threat-boundary");
    assert.equal(commit.event, "TRANSACTION_COMMITTED");
    assert.equal(commit.details.operation, "gate-record");
    assert.equal(commit.taskId, taskId);
    assert.equal(commit.seq, gate.seq + 1);
    assert.equal(commit.previousHash, gate.hash);
    assert.equal((await validateEventLedger(target, packageRoot, { taskId })).valid, true);

    await satisfySecurityGate(target, taskId);
    const repeated = await readEvents(target, packageRoot, { taskId });
    assert.equal(repeated.filter((event) => event.event === "GATE_SATISFIED").length, 1);
  });
});

test("old gate evidence cannot cross a contract revision epoch", async () => {
  await withTarget(async (target) => {
    const taskId = "gate-old-epoch";
    await setupTask(target, taskId);
    await satisfySecurityGate(target, taskId);
    assert.equal((await runPreflight({ target, packageRoot, taskId })).status, "READY");
    await runAdvance({ target, packageRoot, taskId, to: "PLANNED" });

    await runContractRevise({ target, packageRoot, taskId, preset: "bug" });
    await runRoute({ target, packageRoot, taskId, ...ROUTE });
    const blocked = await runPreflight({ target, packageRoot, taskId });
    assert.equal(blocked.status, "BLOCKED");
    assert.ok(blocked.errors.some((error) => error.code === "E_GATE_UNVERIFIED"));
    assert.equal(blocked.satisfiedGates.includes("threat-boundary"), false);
    assert.equal((await getNextAction({ target, packageRoot, taskId })).nextAction, NEXT_ACTIONS.SATISFY_GATES);
    await assert.rejects(
      runAdvance({ target, packageRoot, taskId, to: "EXECUTING" }),
      (error) => ["E_PHASE_GATE_MISSING", "E_PHASE_PREFLIGHT_REQUIRED", "E_PHASE_INVALID", "E_PHASE_CHRONOLOGY_INVALID"].includes(error.code),
    );
  });
});

test("revised tasks can re-satisfy a gate and complete the planned execution handoff", async () => {
  await withTarget(async (target) => {
    const taskId = "gate-revision-recovery";
    await setupTask(target, taskId);
    await satisfySecurityGate(target, taskId);
    assert.equal((await runPreflight({ target, packageRoot, taskId })).status, "READY");
    await runAdvance({ target, packageRoot, taskId, to: "PLANNED" });

    await runContractRevise({ target, packageRoot, taskId, preset: "bug" });
    await runRoute({ target, packageRoot, taskId, ...ROUTE });
    assert.equal((await getNextAction({ target, packageRoot, taskId })).nextAction, NEXT_ACTIONS.SATISFY_GATES);

    await satisfySecurityGate(target, taskId);
    const events = await readEvents(target, packageRoot, { taskId });
    const revisions = events.filter((event) => event.event === "CONTRACT_REVISED");
    const gates = events.filter((event) => event.event === "GATE_SATISFIED");
    const revision = revisions.at(-1);
    const oldGate = gates.at(-2);
    const newGate = gates.at(-1);
    const gateCommit = events[events.indexOf(newGate) + 1];
    assert.ok(newGate.seq > revision.seq);
    assert.ok(oldGate.seq < revision.seq);
    assert.equal(gateCommit.details.operation, "gate-record");

    assert.equal((await runPreflight({ target, packageRoot, taskId })).status, "READY");
    await runAdvance({ target, packageRoot, taskId, to: "PLANNED" });
    const planned = await readWorkState(target, { packageRoot, taskId });
    const planEvents = (await readEvents(target, packageRoot, { taskId }))
      .filter((event) => event.event === "PLAN_RECORDED");
    assert.ok(planEvents.some((event) => event.seq > revision.seq));
    assert.equal(planned.phase, "PLANNED");
    assert.equal((await getNextAction({ target, packageRoot, taskId })).nextAction, NEXT_ACTIONS.START_EXECUTION);
    await runAdvance({ target, packageRoot, taskId, to: "EXECUTING" });
    assert.equal((await readWorkState(target, { packageRoot, taskId })).phase, "EXECUTING");
  });
});
