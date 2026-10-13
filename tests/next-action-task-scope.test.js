import { deleteFixtureArtifact } from "./helpers/native-storage-fixture.js";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { runComplete } from "../src/commands/complete.js";
import { runPreflight } from "../src/commands/preflight.js";
import { prepareCompletion, recordCheck } from "../src/core/completion-artifacts.js";
import { createContract, contractFingerprint, writeContract } from "../src/core/contract.js";
import { appendProtocolEvent } from "../src/core/events.js";
import { getNextAction, NEXT_ACTIONS } from "../src/core/next-action.js";
import { advanceWorkState } from "../src/core/phase.js";
import { evaluateRoute } from "../src/core/router.js";
import { persistRoute } from "../src/core/route-artifact.js";
import { createTaskDescriptor, writeTaskDescriptor } from "../src/core/task-descriptor.js";
import { taskArtifactPath } from "../src/core/task-paths.js";
import { getPackageRoot } from "../src/core/templates.js";
import { createWorkState, writeWorkState } from "../src/core/work-state.js";
import { removeTempTree } from "./helpers/rm-safe.js";

const packageRoot = getPackageRoot();

test("selected EXECUTING task reads its own continuity before entering verification", async () => {
  const { writeContinuity } = await import("../src/core/continuity.js");
  const { executeForgeLoopCommand } = await import("../src/integration.js");
  const { reconcileContinuity } = await import("../src/core/continuity-reconciliation.js");
  const taskA = "continuity-task-a";
  const taskB = "continuity-task-b";
  const expectedArtifacts = [taskArtifactPath(taskA, "continuity"), taskArtifactPath(taskA, "state")];
  await withTarget(async (target) => {
    await setupTaskTo(target, taskA, "EXECUTING", { claims: ["src/a"] });
    await setupTaskTo(target, taskB, "EXECUTING", { claims: ["src/b"] });
    await writeContinuity(target, {
      remainingWork: [{ id: "finish-a", summary: "Finish task A implementation" }],
    }, { taskId: taskA, packageRoot });

    const continuityA = await reconcileContinuity({ target, packageRoot, taskId: taskA });
    assert.equal(continuityA.classification, "FRESH");
    assert.equal(continuityA.continuity.remainingWork[0].id, "finish-a");
    const continuityB = await reconcileContinuity({ target, packageRoot, taskId: taskB });
    assert.equal(continuityB.classification, "ABSENT");

    const nextA = await getNextAction({ target, packageRoot, taskId: taskA });
    assert.equal(nextA.nextAction, NEXT_ACTIONS.CONTINUE_IMPLEMENTATION);
    assert.equal(nextA.taskId, taskA);
    assert.equal(nextA.currentPhase, "EXECUTING");
    assert.deepEqual(nextA.requiredArtifacts, expectedArtifacts);
    assert.deepEqual(nextA.reasons[0].artifacts, [taskArtifactPath(taskA, "continuity")]);

    const nextB = await getNextAction({ target, packageRoot, taskId: taskB });
    assert.equal(nextB.nextAction, NEXT_ACTIONS.ENTER_VERIFYING);
    assert.equal(nextB.taskId, taskB);
    for (const [taskId, expectedAction] of [
      [taskA, NEXT_ACTIONS.CONTINUE_IMPLEMENTATION],
      [taskB, NEXT_ACTIONS.ENTER_VERIFYING],
    ]) {
      const envelope = await executeForgeLoopCommand({
        command: "next", projectPath: target, input: { taskId },
      });
      assert.equal(envelope.ok, true, JSON.stringify(envelope.error));
      assert.equal(envelope.result.taskId, taskId);
      assert.equal(envelope.result.nextAction, expectedAction);
      if (taskId === taskA) assert.deepEqual(envelope.result.requiredArtifacts, expectedArtifacts);
    }
  });
});

async function withTarget(run) {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-next-task-scope-"));
  try {
    await run(target);
  } finally {
    await removeTempTree(target);
  }
}

/**
 * Boots a task through the lifecycle using only task-scoped artifacts under
 * .forgeloop/task-state/<taskKey>/.
 * - toPhase "PLANNED": contract + route + state, no preflight.
 * - preflight: true: also run preflight (task-scoped artifact + ledger event).
 * - toPhase "EXECUTING"/"VERIFYING": full chronology to the requested phase.
 */
async function setupTaskTo(target, taskId, toPhase, { preflight = false, claims = [] } = {}) {
  const descriptor = createTaskDescriptor({ taskId, writeClaims: claims });
  await writeTaskDescriptor(target, descriptor, packageRoot);

  const contract = createContract({
    taskId,
    objective: "Exercise task-scoped next-action resolution",
    deliverables: ["src"],
    constraints: ["offline"],
    risks: [],
    verification: ["tests", "build"],
    successCriteria: ["tests", "build"],
    stopConditions: ["stop"],
    unresolvedDecisions: [],
    sourceRefs: [],
  });
  const contractHash = contractFingerprint(contract);
  await writeContract(target, contract, packageRoot, { taskId });

  const route = evaluateRoute({ workType: "code", surfaces: ["config"], platforms: [] });
  const persistedRoute = await persistRoute(target, route, packageRoot, {
    taskId,
    contractFingerprint: contractHash,
  });

  const state = createWorkState({
    taskId,
    contractFingerprint: contractHash,
    routeFingerprint: persistedRoute.fingerprint,
    repositoryFingerprint: { branch: null, head: null },
    phase: "PLANNED",
    selectedGuides: [...persistedRoute.value.guides],
    requiredGates: [],
    satisfiedGates: [],
    completedSteps: ["planning"],
    pendingSteps: ["execute"],
    requiredArtifacts: [],
    checks: [],
    failures: [],
    blockers: [],
    verificationEvidence: [],
  });
  await writeWorkState(target, state, { packageRoot, taskId });

  await appendProtocolEvent(target, { taskId, event: "CONTRACT_VALIDATED" }, packageRoot, { taskId });
  await appendProtocolEvent(target, { taskId, event: "ROUTE_VALIDATED" }, packageRoot, { taskId });

  if (preflight || toPhase !== "PLANNED") {
    const preflightResult = await runPreflight({ target, packageRoot, taskId });
    assert.equal(preflightResult.status, "READY");
  }
  if (toPhase === "PLANNED") return;

  await advanceWorkState(target, "EXECUTING", { packageRoot, taskId });
  if (toPhase === "EXECUTING") return;
  await advanceWorkState(target, "VERIFYING", { packageRoot, taskId });
  await prepareCompletion({ target, packageRoot, taskId });
}

test("NEXT-TASK-1: PLANNED next-action for an explicitly selected task uses only that task's artifacts", async () => {
  await withTarget(async (target) => {
    // Task A is fully ready at PLANNED (task-scoped preflight persisted).
    await setupTaskTo(target, "task-a", "PLANNED", { preflight: true });

    // Task B is PLANNED with its PREFLIGHT_READY ledger event but without the
    // task-scoped preflight artifact.
    await setupTaskTo(target, "task-b", "PLANNED", { preflight: true });
    await deleteFixtureArtifact(target, taskArtifactPath("task-b", "preflight"));

    const nextB = await getNextAction({ target, packageRoot, taskId: "task-b" });
    assert.equal(nextB.nextAction, NEXT_ACTIONS.RUN_PREFLIGHT);
    // The required artifacts must be task B's namespaced artifacts, never the
    // legacy singleton paths.
    assert.ok(nextB.requiredArtifacts.includes(taskArtifactPath("task-b", "preflight")));
    assert.equal(nextB.requiredArtifacts.some((artifact) => artifact === ".forgeloop/preflight.json"), false);
    assert.equal(nextB.requiredArtifacts.some((artifact) => artifact === ".forgeloop/current-contract.json"), false);

    // Task A (preflight persisted) still resolves to START_EXECUTION from its
    // own namespaced state.
    const nextA = await getNextAction({ target, packageRoot, taskId: "task-a" });
    assert.equal(nextA.nextAction, NEXT_ACTIONS.START_EXECUTION);
  });
});

test("NEXT-TASK-2: REVIEWING completion recovery reads the selected task's ledger only", async () => {
  await withTarget(async (target) => {
    // Task B reaches REVIEWING with one of two requirements covered and a
    // REJECTED completion attempt bound to B's own task-scoped ledger.
    await setupTaskTo(target, "task-b", "VERIFYING", { claims: ["src/b"] });
    await recordCheck({ kind: "manual-review",
      target,
      packageRoot,
      taskId: "task-b",
      id: "unit-tests",
      requirement: "tests",
      status: "passed",
      evidenceKind: "OBSERVED",
      command: "npm test",
      result: "Passed",
    });
    await advanceWorkState(target, "REVIEWING", { packageRoot, taskId: "task-b" });
    const completion = await runComplete({ target, packageRoot, taskId: "task-b" });
    assert.equal(completion.status, "REJECTED");

    // The legacy singleton ledger does not exist; recovery must be authorized
    // exclusively by task B's namespaced ledger events.
    const nextB = await getNextAction({ target, packageRoot, taskId: "task-b" });
    assert.equal(nextB.nextAction, NEXT_ACTIONS.ENTER_VERIFYING);
  });
});

test("NEXT-TASK-2: a rejection in task A's ledger never authorizes recovery for task B", async () => {
  await withTarget(async (target) => {
    // Task A is rejected once (cycle 1) and then completes on cycle 2, so its
    // ledger retains a COMPLETION_REJECTED event while A becomes COMPLETE.
    await setupTaskTo(target, "task-a", "VERIFYING", { claims: ["src/a"] });
    await recordCheck({ kind: "manual-review",
      target,
      packageRoot,
      taskId: "task-a",
      id: "unit-tests",
      requirement: "tests",
      status: "passed",
      evidenceKind: "OBSERVED",
      command: "npm test",
      result: "Passed",
    });
    await advanceWorkState(target, "REVIEWING", { packageRoot, taskId: "task-a" });
    const rejectedA = await runComplete({ target, packageRoot, taskId: "task-a" });
    assert.equal(rejectedA.status, "REJECTED");

    // Cycle 2: recover into VERIFYING, cover the missing requirement, complete.
    await advanceWorkState(target, "VERIFYING", { packageRoot, taskId: "task-a" });
    await recordCheck({ kind: "manual-review",
      target,
      packageRoot,
      taskId: "task-a",
      id: "build-check",
      requirement: "build",
      status: "passed",
      evidenceKind: "OBSERVED",
      command: "npm run build",
      result: "Built",
    });
    await advanceWorkState(target, "REVIEWING", { packageRoot, taskId: "task-a" });
    const completedA = await runComplete({ target, packageRoot, taskId: "task-a" });
    assert.equal(completedA.status, "VALID");

    // Task B is then created and reaches REVIEWING with no rejection of its
    // own; task A is COMPLETE, so B is the only non-complete task.
    await setupTaskTo(target, "task-b", "VERIFYING", { claims: ["src/b"] });
    await recordCheck({ kind: "manual-review",
      target,
      packageRoot,
      taskId: "task-b",
      id: "unit-tests",
      requirement: "tests",
      status: "passed",
      evidenceKind: "OBSERVED",
      command: "npm test",
      result: "Passed",
    });
    await advanceWorkState(target, "REVIEWING", { packageRoot, taskId: "task-b" });

    // Task B must not be authorized by task A's rejection event.
    const nextB = await getNextAction({ target, packageRoot, taskId: "task-b" });
    assert.equal(nextB.nextAction, NEXT_ACTIONS.RESOLVE_BLOCKER);
    assert.ok(
      nextB.reasons.some((reason) => reason.code === "E_EVIDENCE_REQUIRED" || reason.code === "E_COMPLETION_RECOVERY_UNAUTHORIZED"),
    );

    // Task A is terminal COMPLETE.
    const nextA = await getNextAction({ target, packageRoot, taskId: "task-a" });
    assert.equal(nextA.nextAction, NEXT_ACTIONS.NONE);
    assert.equal(nextA.terminal, true);
  });
});
