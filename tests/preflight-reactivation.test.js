import { deleteFixtureArtifact } from "./helpers/native-storage-fixture.js";
import { withProjectStorage } from "../src/storage/project-boundary.js";
import { removeTempTree } from "./helpers/rm-safe.js";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { runPreflight } from "../src/commands/preflight.js";
import { createContract, contractFingerprint, writeContract } from "../src/core/contract.js";
import { appendProtocolEvent, validateEventLedger } from "../src/core/events.js";
import { advanceWorkState } from "../src/core/phase.js";
import { evaluateRoute } from "../src/core/router.js";
import { persistRoute } from "../src/core/route-artifact.js";
import { getPackageRoot } from "../src/core/templates.js";
import { createWorkState, writeWorkState, readWorkState } from "../src/core/work-state.js";
import { createTaskDescriptor, writeTaskDescriptor } from "../src/core/task-descriptor.js";

const packageRoot = getPackageRoot();


async function withTarget(run) {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-preflight-reactivation-"));
  try {
    await run(target);
  } finally {
    await removeTempTree(target);
  }
}

function buildContract(taskId, objective) {
  return createContract({
    taskId,
    objective,
    deliverables: ["package.json"],
    constraints: [],
    risks: [],
    verification: [{ id: "checks", text: "objective checks pass", type: "VERIFICATION" }],
    successCriteria: ["objective is present"],
    stopConditions: [],
    unresolvedDecisions: [],
    sourceRefs: [],
  });
}

async function setupTaskThroughReady(target, { taskId = "reactivation-task", objective = "Original objective." } = {}) {
  const contract = buildContract(taskId, objective);
  const contractHash = contractFingerprint(contract);
  await writeTaskDescriptor(target, createTaskDescriptor({ taskId, writeClaims: ["package.json"] }), packageRoot);
  await writeContract(target, contract, packageRoot, { taskId });
  const route = evaluateRoute({ workType: "documentation", surfaces: ["documentation"], platforms: [] });
  const persistedRoute = await persistRoute(target, route, packageRoot, { contractFingerprint: contractHash, taskId });
  await writeWorkState(target, createWorkState({
    taskId,
    contractFingerprint: contractHash,
    routeFingerprint: persistedRoute.fingerprint,
    repositoryFingerprint: { branch: null, head: null },
    phase: "ROUTED",
    selectedGuides: route.guides,
    requiredGates: [],
    satisfiedGates: [],
    completedSteps: ["contract", "route"],
    pendingSteps: ["planning", "implementation", "verification"],
    checks: [],
    failures: [],
    blockers: [],
    verificationEvidence: [],
  }), { packageRoot, taskId });

  const preflight = await runPreflight({ target, packageRoot, taskId });
  assert.equal(preflight.status, "READY");

  const ledger = await validateEventLedger(target, packageRoot, { taskId });
  assert.equal(ledger.valid, true);
  return { taskId, contractHash };
}

test("preflight returns READY with fresh details after a BLOCKED outcome superseded the original READY", async () => {
  await withTarget(async (target) => {
    const { taskId } = await setupTaskThroughReady(target);

    // The contract evolves intentionally and the routing artifact is regenerated.
    const revised = buildContract(taskId, "Revised objective after scope clarification.");
    const revisedHash = contractFingerprint(revised);
    await writeContract(target, revised, packageRoot, { taskId });
    const route = evaluateRoute({ workType: "documentation", surfaces: ["documentation"], platforms: [] });
    const revisedRoute = await persistRoute(target, route, packageRoot, { contractFingerprint: revisedHash, taskId });

    // A preflight cycle ran while the gate was unsatisfied and recorded BLOCKED;
    // the stale-bound checkpoint was cleared through the sanctioned maintenance
    // surface so the next preflight recreates it against the revised contract.
    await appendProtocolEvent(target, {
      taskId,
      event: "PREFLIGHT_BLOCKED",
      fingerprint: revisedHash,
      details: {
        requiredGates: ["threat-boundary"],
        satisfiedGates: [],
        routingFingerprint: revisedRoute.fingerprint,
      },
    }, packageRoot, { taskId });
    const { runClearState } = await import("../src/commands/clear-state.js");
    await runClearState({ target, taskId, packageRoot });

    // The gate is satisfied; preflight must be able to return READY again.
    const preflight = await runPreflight({ target, packageRoot, taskId });
    assert.equal(preflight.status, "READY");

    const state = await readWorkState(target, { packageRoot, taskId });
    assert.equal(state.contractFingerprint, revisedHash);

    const ledger = await validateEventLedger(target, packageRoot, { taskId });
    assert.equal(ledger.valid, true);
    const readyEvents = ledger.events.filter((event) => event.event === "PREFLIGHT_READY" && event.taskId === taskId);
    assert.equal(readyEvents.length, 2);
    assert.equal(readyEvents[1].fingerprint, revisedHash);

    // Re-running preflight after re-readiness stays READY and appends nothing new.
    const refreshed = await runPreflight({ target, packageRoot, taskId });
    assert.equal(refreshed.status, "READY");
    const ledgerAfterRefresh = await validateEventLedger(target, packageRoot, { taskId });
    assert.equal(ledgerAfterRefresh.events.filter((event) => event.event === "PREFLIGHT_READY" && event.taskId === taskId).length, 2);
  });
});

test("preflight derives the PLANNED resume phase from a recorded PLAN_RECORDED milestone", async () => {
  await withTarget(async (target) => {
    const { taskId } = await setupTaskThroughReady(target);
    await appendProtocolEvent(target, { taskId, event: "PLAN_RECORDED" }, packageRoot, { taskId });

    const { taskDirectory } = await import("../src/core/task-paths.js");
    await deleteFixtureArtifact(target, path.join(taskDirectory(taskId), "work-state.json"));

    const preflight = await runPreflight({ target, packageRoot, taskId });
    assert.equal(preflight.status, "READY");

    const restored = await readWorkState(target, { packageRoot, taskId });
    assert.equal(restored.phase, "PLANNED");

    // Advancing from the restored checkpoint appends EXECUTION_STARTED exactly once.
    await advanceWorkState(target, "EXECUTING", { packageRoot, taskId });
    const ledger = await validateEventLedger(target, packageRoot, { taskId });
    assert.equal(ledger.valid, true);
    assert.equal(ledger.events.filter((event) => event.event === "EXECUTION_STARTED" && event.taskId === taskId).length, 1);
  });
});

test("execution prerequisites bind to the latest PREFLIGHT_READY after re-readiness", async () => {
  await withTarget(async (target) => {
    const { taskId } = await setupTaskThroughReady(target);
    await appendProtocolEvent(target, { taskId, event: "PLAN_RECORDED" }, packageRoot, { taskId });

    // Contract evolves; a preflight cycle records BLOCKED before the gate is satisfied.
    const revised = buildContract(taskId, "Revised objective for execution-prerequisites binding.");
    const revisedHash = contractFingerprint(revised);
    await writeContract(target, revised, packageRoot, { taskId });
    const route = evaluateRoute({ workType: "documentation", surfaces: ["documentation"], platforms: [] });
    const revisedRoute = await persistRoute(target, route, packageRoot, { contractFingerprint: revisedHash, taskId });
    await appendProtocolEvent(target, {
      taskId,
      event: "PREFLIGHT_BLOCKED",
      fingerprint: revisedHash,
      details: {
        requiredGates: ["threat-boundary"],
        satisfiedGates: [],
        routingFingerprint: revisedRoute.fingerprint,
      },
    }, packageRoot, { taskId });
    const { taskDirectory } = await import("../src/core/task-paths.js");
    await deleteFixtureArtifact(target, path.join(taskDirectory(taskId), "work-state.json"));

    const preflight = await runPreflight({ target, packageRoot, taskId });
    assert.equal(preflight.status, "READY");

    // Entering EXECUTING must validate against the latest READY event.
    const state = await advanceWorkState(target, "EXECUTING", { packageRoot, taskId });
    assert.equal(state.phase, "EXECUTING");
    const ledger = await validateEventLedger(target, packageRoot, { taskId });
    assert.equal(ledger.valid, true);
  });
});

test("preflight still refuses a READY refresh whose details differ without an intervening BLOCKED outcome", async () => {
  await withTarget(async (target) => {
    const { taskId } = await setupTaskThroughReady(target);

    const revised = buildContract(taskId, "Revised objective without a blocked preflight cycle.");
    await writeContract(target, revised, packageRoot, { taskId });
    const route = evaluateRoute({ workType: "documentation", surfaces: ["documentation"], platforms: [] });
    await persistRoute(target, route, packageRoot, { contractFingerprint: contractFingerprint(revised), taskId });

    await assert.rejects(
      () => runPreflight({ target, packageRoot, taskId }),
      (error) => error.code === "E_PHASE_CHRONOLOGY_INVALID"
        || error.code === "E_CONTRACT_STALE"
        || error.code === "E_ROUTE_STALE",
    );
  });
});

test("a PREFLIGHT_READY refresh after execution milestones keeps the ledger valid", async () => {
  await withTarget(async (target) => {
    const { taskId } = await setupTaskThroughReady(target);
    await appendProtocolEvent(target, { taskId, event: "PLAN_RECORDED" }, packageRoot, { taskId });
    await appendProtocolEvent(target, { taskId, event: "EXECUTION_STARTED" }, packageRoot, { taskId });
    await appendProtocolEvent(target, {
      taskId,
      event: "VERIFICATION_STARTED",
      details: { verificationCycle: 1 },
    }, packageRoot, { taskId });

    // Contract evolution records a BLOCKED preflight cycle; once resolved the
    // lifecycle may return to READY even though execution already started.
    const contract = buildContract(taskId, "Revised objective after mid-lifecycle policy refresh.");
    const revisedHash = contractFingerprint(contract);
    await writeContract(target, contract, packageRoot, { taskId });
    const route = evaluateRoute({ workType: "documentation", surfaces: ["documentation"], platforms: [] });
    const revisedRoute = await persistRoute(target, route, packageRoot, { contractFingerprint: revisedHash, taskId });
    await appendProtocolEvent(target, {
      taskId,
      event: "PREFLIGHT_BLOCKED",
      fingerprint: revisedHash,
      details: {
        requiredGates: ["threat-boundary"],
        satisfiedGates: [],
        routingFingerprint: revisedRoute.fingerprint,
      },
    }, packageRoot, { taskId });
    const { taskDirectory } = await import("../src/core/task-paths.js");
    await deleteFixtureArtifact(target, path.join(taskDirectory(taskId), "work-state.json"));

    const preflight = await runPreflight({ target, packageRoot, taskId });
    assert.equal(preflight.status, "READY");

    const ledger = await validateEventLedger(target, packageRoot, { taskId });
    assert.equal(ledger.valid, true, JSON.stringify(ledger.errors ?? []));
    const readyEvents = ledger.events.filter((event) => event.event === "PREFLIGHT_READY" && event.taskId === taskId);
    assert.equal(readyEvents.length, 2);
  });
});

test("public routing and next guidance recover a pre-execution blocked checkpoint", async () => {
  await withTarget(async (target) => withProjectStorage(target, async () => {
    const { executeForgeLoopCommand } = await import("../src/integration.js");
    const taskId = "public-reactivation";
    await writeTaskDescriptor(target, createTaskDescriptor({ taskId, writeClaims: ["package.json"] }), packageRoot);
    await writeContract(target, buildContract(taskId, "Document a security boundary."), packageRoot, { taskId });
    const invoke = (command, input = {}) => executeForgeLoopCommand({ command, projectPath: target, input: { taskId, ...input } });
    const routed = await invoke("route", { workType: "documentation", surfaces: ["documentation"], risks: ["secrets"] });
    assert.equal(routed.ok, true, JSON.stringify(routed));
    const blocked = await invoke("preflight");
    assert.equal(blocked.result?.status, "BLOCKED", JSON.stringify(blocked));
    await writeContract(target, buildContract(taskId, "Clarify existing usage documentation."), packageRoot, { taskId });
    const revised = await invoke("route", { workType: "documentation", surfaces: ["documentation"] });
    assert.equal(revised.ok, true, JSON.stringify(revised));
    const next = await invoke("next");
    assert.deepEqual(next.result.commandSpecs.map(spec => spec.commandId).sort(), ["clear-state", "preflight"]);
    const cleared = await invoke("clear-state");
    assert.equal(cleared.ok, true, JSON.stringify(cleared));
    const ready = await invoke("preflight");
    assert.equal(ready.result?.status, "READY", JSON.stringify(ready));
  }));
});
