import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { removeTempTree } from "./helpers/rm-safe.js";
import { ARTIFACT_PATHS } from "../src/core/artifacts.js";
import { createContract, contractFingerprint, writeContract } from "../src/core/contract.js";
import { validateEventLedger } from "../src/core/events.js";
import { createGate } from "./helpers/gates.js";
import { persistGate } from "../src/core/gate-artifact.js";
import { getNextAction, NEXT_ACTIONS } from "../src/core/next-action.js";
import { evaluateRoute } from "../src/core/router.js";
import { persistRoute } from "../src/core/route-artifact.js";
import { getPackageRoot } from "../src/core/templates.js";
import { advanceWorkState } from "../src/core/phase.js";
import { clearWorkState, readWorkState } from "../src/core/work-state.js";
import { runPreflight } from "../src/commands/preflight.js";
import { evaluateAudit } from "../src/core/audit.js";
import { runValidateProtocol } from "../src/commands/validate-protocol.js";

const packageRoot = getPackageRoot();

async function withTarget(run) {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-resumable-"));
  try {
    await run(target);
  } finally {
    await removeTempTree(target);
  }
}

async function prepareTarget(target, { threatBoundary = true } = {}) {
  const contract = createContract({
    taskId: "resumable-001",
    objective: "Exercise resumable protocol activation",
    deliverables: ["protocol"],
    constraints: ["offline"],
    risks: [],
    verification: ["node --test"],
    successCriteria: ["resume without rediscovery"],
    stopConditions: ["missing evidence"],
    unresolvedDecisions: [],
    sourceRefs: [],
  });
  await writeContract(target, contract, packageRoot);
  await persistRoute(
    target,
    evaluateRoute({ workType: "complete-website", surfaces: ["ui"], platforms: ["web"] }),
    packageRoot,
    { contractFingerprint: contractFingerprint(contract) },
  );
  for (const gate of ["design", "quality", ...(threatBoundary ? ["threat-boundary"] : [])]) {
    await persistGate(target, createGate({
      taskId: contract.taskId,
      gate,
      status: "satisfied",
      requiredBy: ["resumable-test"],
      artifacts: [],
      decisions: [],
      unknowns: [],
      approvedAssumptions: [],
      evidence: [],
    }), packageRoot);
  }
  return contract;
}

test("READY preflight durably creates a resumable checkpoint and complete activation chronology", async () => {
  await withTarget(async (target) => {
    const contract = await prepareTarget(target);
    const result = await runPreflight({ target, packageRoot });
    const state = await readWorkState(target, packageRoot);
    const ledger = await validateEventLedger(target, packageRoot);

    assert.equal(result.status, "READY");
    assert.equal(state.taskId, contract.taskId);
    assert.equal(state.contractFingerprint, result.fingerprints.contract);
    assert.deepEqual(
      ledger.events.map((event) => event.event),
      [
        "TASK_RECEIVED",
        "CONTRACT_VALIDATED",
        "ROUTE_VALIDATED",
        "GATE_SATISFIED",
        "GATE_SATISFIED",
        "GATE_SATISFIED",
        "PREFLIGHT_READY",
      ],
    );
    assert.equal(ledger.valid, true);
    assert.notEqual((await getNextAction({ target, packageRoot })).nextAction, NEXT_ACTIONS.DISCOVER);
  });
});

test("rebuilt VERIFYING checkpoints preserve the verification cycle recorded by the ledger", async () => {
  await withTarget(async (target) => {
    await prepareTarget(target);
    assert.equal((await runPreflight({ target, packageRoot })).status, "READY");
    await advanceWorkState(target, "PLANNED", { packageRoot });
    await advanceWorkState(target, "EXECUTING", { packageRoot });
    await advanceWorkState(target, "VERIFYING", { packageRoot });

    const active = await readWorkState(target, packageRoot);
    assert.equal(active.phase, "VERIFYING");
    assert.equal(active.verificationCycle, 1);

    await clearWorkState(target);
    const restoredPreflight = await runPreflight({ target, packageRoot });
    const restored = await readWorkState(target, packageRoot);

    assert.equal(restoredPreflight.status, "READY");
    assert.equal(restored.phase, "VERIFYING");
    assert.equal(restored.verificationCycle, 1);
  });
});

test("rebuilt REVIEWING checkpoints restore the review phase instead of regressing to VERIFYING", async () => {
  await withTarget(async (target) => {
    await prepareTarget(target);
    assert.equal((await runPreflight({ target, packageRoot })).status, "READY");
    await advanceWorkState(target, "PLANNED", { packageRoot });
    await advanceWorkState(target, "EXECUTING", { packageRoot });
    await advanceWorkState(target, "VERIFYING", { packageRoot });
    await advanceWorkState(target, "REVIEWING", { packageRoot });

    await clearWorkState(target);
    const restoredPreflight = await runPreflight({ target, packageRoot });
    const restored = await readWorkState(target, packageRoot);

    assert.equal(restoredPreflight.status, "READY");
    assert.equal(restored.phase, "REVIEWING");
    assert.equal(restored.verificationCycle, 1);

    const ledger = await validateEventLedger(target, packageRoot);
    assert.equal(ledger.valid, true, JSON.stringify(ledger.errors ?? []));
    const { validateStateLedgerCoherence } = await import("../src/core/events.js");
    assert.deepEqual(validateStateLedgerCoherence(restored, ledger.events), []);
  });
});

test("next reports a dedicated blocker when a persisted READY preflight loses its checkpoint", async () => {
  await withTarget(async (target) => {
    await prepareTarget(target);
    assert.equal((await runPreflight({ target, packageRoot })).status, "READY");
    await rm(path.join(target, ARTIFACT_PATHS.state), { force: true });

    const next = await getNextAction({ target, packageRoot });

    assert.equal(next.nextAction, NEXT_ACTIONS.RESOLVE_BLOCKER);
    assert.ok(next.reasonCodes.includes("E_STATE_MISSING_AFTER_PREFLIGHT_READY"));
    assert.ok(next.missingArtifacts.includes(ARTIFACT_PATHS.state));

    const audit = await evaluateAudit({ target, packageRoot });
    assert.ok(audit.errors.some((error) => error.code === "E_STATE_MISSING_AFTER_PREFLIGHT_READY"));
    const protocol = await runValidateProtocol({
      target,
      packageRoot,
      routeFile: ARTIFACT_PATHS.route,
      stateFile: ARTIFACT_PATHS.state,
      receiptFile: ARTIFACT_PATHS.receipt,
    });
    assert.equal(protocol.status, "INVALID");
    assert.ok(protocol.errors.some((error) => error.code === "E_STATE_MISSING_AFTER_PREFLIGHT_READY"));
  });
});

test("BLOCKED to READY recovery appends only recovery events and preserves the hash chain", async () => {
  await withTarget(async (target) => {
    const contract = await prepareTarget(target, { threatBoundary: false });
    const blocked = await runPreflight({ target, packageRoot });
    assert.equal(blocked.status, "BLOCKED");

    const blockedLedger = await validateEventLedger(target, packageRoot);
    assert.equal(blockedLedger.valid, true);
    assert.ok(blockedLedger.events.some((event) => event.event === "PREFLIGHT_BLOCKED"));

    await persistGate(target, createGate({
      taskId: contract.taskId,
      gate: "threat-boundary",
      status: "satisfied",
      requiredBy: ["resumable-test"],
      artifacts: [],
      decisions: [],
      unknowns: [],
      approvedAssumptions: [],
      evidence: [],
    }), packageRoot);
    const ready = await runPreflight({ target, packageRoot });
    const ledger = await validateEventLedger(target, packageRoot);
    const names = ledger.events.map((event) => event.event);

    assert.equal(ready.status, "READY");
    assert.equal(ledger.valid, true);
    assert.equal(names.filter((event) => event === "PREFLIGHT_BLOCKED").length, 1);
    assert.equal(names.at(-1), "PREFLIGHT_READY");
    assert.equal(names.filter((event) => event === "GATE_SATISFIED").length, 3);
    for (let index = 1; index < ledger.events.length; index += 1) {
      assert.equal(ledger.events[index].previousHash, ledger.events[index - 1].hash);
    }
    assert.equal((await getNextAction({ target, packageRoot })).nextAction, NEXT_ACTIONS.PLAN);
    assert.ok(await readFile(path.join(target, ARTIFACT_PATHS.preflight), "utf8"));
  });
});
