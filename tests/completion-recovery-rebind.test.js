import { deleteFixtureArtifact } from "./helpers/native-storage-fixture.js";
import { removeTempTree } from "./helpers/rm-safe.js";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { runReconcileClosure } from "../src/core/reconcile-closure.js";
import { runPreflight } from "../src/commands/preflight.js";
import { createContract, contractFingerprint, writeContract } from "../src/core/contract.js";
import { appendProtocolEvent, readEvents, validateEventLedger } from "../src/core/events.js";
import { advanceWorkState } from "../src/core/phase.js";
import { runComplete } from "../src/commands/complete.js";
import { evaluateRoute } from "../src/core/router.js";
import { persistRoute } from "../src/core/route-artifact.js";
import { getPackageRoot } from "../src/core/templates.js";
import { createWorkState, writeWorkState, readWorkState } from "../src/core/work-state.js";
import { canonicalFingerprint } from "../src/core/artifacts.js";
import { prepareCompletion, recordCheck as recordCheckArtifact } from "../src/core/completion-artifacts.js";
import { createTaskDescriptor, writeTaskDescriptor } from "../src/core/task-descriptor.js";

import { rebindCompletionRejectionSnapshot } from "../src/core/completion-recovery-rebind.js";
import { openStorageDatabase } from "../src/storage/index.js";

const packageRoot = getPackageRoot();


async function withTarget(run) {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-recovery-rebind-"));
  try {
    await run(target);
  } finally {
    await removeTempTree(target);
  }
}

async function setupFreshTask(target, { taskId = "rebind-task", phase = "EXECUTING", previousPhase = "PLANNED", appendExecution = true } = {}) {
  await writeTaskDescriptor(target, createTaskDescriptor({
    taskId,
    writeClaims: ["package.json"],
  }), packageRoot);
  const contract = createContract({
    taskId,
    objective: "Objective is satisfied in the current repository.",
    deliverables: ["package.json"],
    constraints: [],
    risks: [],
    verification: [
      { id: "regression-tests", text: "pack tarball test asserts the README image is excluded from the npm package", type: "VERIFICATION" },
      { id: "native-suite", text: "npm test and docs checks all exit 0", type: "VERIFICATION" },
    ],
    successCriteria: ["objective is present in the current repository"],
    stopConditions: [],
    unresolvedDecisions: [],
    sourceRefs: [],
  });
  const contractHash = contractFingerprint(contract);
  await writeContract(target, contract, packageRoot, { taskId });
  const route = evaluateRoute({ workType: "documentation", surfaces: ["documentation"], platforms: [] });
  const persistedRoute = await persistRoute(target, route, packageRoot, { contractFingerprint: contractHash, taskId });
  await writeWorkState(target, createWorkState({
    taskId,
    contractFingerprint: contractHash,
    routeFingerprint: persistedRoute.fingerprint,
    repositoryFingerprint: { branch: null, head: null },
    phase,
    previousPhase,
    selectedGuides: route.guides,
    requiredGates: [],
    satisfiedGates: [],
    completedSteps: ["contract", "route", "planning", "implementation"],
    pendingSteps: ["verification"],
    checks: [],
    failures: [],
    blockers: [],
    verificationEvidence: [],
  }), { packageRoot, taskId });
  await appendProtocolEvent(target, { taskId, event: "TASK_RECEIVED" }, packageRoot, { taskId });
  await appendProtocolEvent(target, { taskId, event: "CONTRACT_VALIDATED" }, packageRoot, { taskId });
  await appendProtocolEvent(target, { taskId, event: "ROUTE_VALIDATED" }, packageRoot, { taskId });
  const preflight = await runPreflight({ target, packageRoot, taskId });
  assert.equal(preflight.status, "READY");
  if (!appendExecution) return { taskId };
  await appendProtocolEvent(target, { taskId, event: "PLAN_RECORDED" }, packageRoot, { taskId });
  await appendProtocolEvent(target, { taskId, event: "EXECUTION_STARTED" }, packageRoot, { taskId });
  return { taskId };
}

/**
 * Drives a task into REVIEWING with a persisted evidence-only completion
 * rejection, then simulates an out-of-band work-state mutation (as performed by
 * recovery/resume cycles) so the ledger rejection snapshot no longer matches
 * the live checkpoint fingerprint while the checkpoint stays fresh.
 */
async function setupDriftedReviewingRejection(target, options = {}) {
  const { taskId } = await setupFreshTask(target, { taskId: options.taskId ?? "rebind-task", phase: "EXECUTING" });

  await advanceWorkState(target, "VERIFYING", { packageRoot, taskId });
  await prepareCompletion({ target, packageRoot, taskId });
  await recordCheckArtifact({
    target,
    packageRoot,
    taskId,
    id: "regression-tests",
    kind: "manual-review",
    requirement: "pack tarball test asserts the README image is excluded from the npm package",
    status: "passed",
    evidenceKind: "OBSERVED",
    result: "objective check passed",
  });
  await advanceWorkState(target, "REVIEWING", { packageRoot, taskId });

  const completion = await runComplete({ target, packageRoot, taskId });
  assert.equal(completion.status, "REJECTED");

    const state = await readWorkState(target, { packageRoot, taskId });
    await writeWorkState(target, {
      ...state,
      revision: (state.revision ?? 0) + 1,
      lastUpdated: new Date().toISOString(),
      ...(options.repositoryDrift ? { repositoryFingerprint: { branch: "main", head: "d6b8991dd0da318543a17d0d1c537687567992d1" } } : {}),
    }, { packageRoot, taskId });

  return { taskId };
}

test("reconcile-closure rebinds a drifted rejection snapshot and completes canonically", async () => {
  await withTarget(async (target) => {
    const { taskId } = await setupDriftedReviewingRejection(target, { repositoryDrift: true });

    const eventsBefore = await readEvents(target, packageRoot, { taskId });
    const rejectionsBefore = eventsBefore.filter((event) => event.event === "COMPLETION_REJECTED");
    assert.equal(rejectionsBefore.length, 1);

    const report = await runReconcileClosure({
      target,
      packageRoot,
      taskId,
      checkId: "regression-tests",
      requirement: "pack tarball test asserts the README image is excluded from the npm package",
      argv: ["node", "-e", "process.exit(0)"],
    });
    assert.equal(report.reconciled, true);

    const eventsAfter = await readEvents(target, packageRoot, { taskId });
    const rejectionsAfter = eventsAfter.filter((event) => event.event === "COMPLETION_REJECTED");

    // Append-only: the original rejection is untouched; a rebound rejection
    // bound to the current checkpoint fingerprint is appended.
    assert.equal(rejectionsAfter.length, 2);
    assert.deepEqual(
      { ...rejectionsBefore[0].details },
      { ...rejectionsAfter[0].details },
    );
    assert.equal(rejectionsAfter[0].hash, rejectionsBefore[0].hash);
    assert.equal(rejectionsAfter[1].details.reboundFromStateFingerprint, rejectionsAfter[0].details.stateFingerprint);
    assert.ok(eventsAfter.find((event) => event.event === "CHECKPOINT_RECONCILED"));

    const ledger = await validateEventLedger(target, packageRoot, { taskId });
    assert.equal(ledger.valid, true);

    // Canonical closure completes in verification cycle 2.
    await advanceWorkState(target, "VERIFYING", { packageRoot, taskId });
    const cycleState = await readWorkState(target, { packageRoot, taskId });
    assert.equal(cycleState.phase, "VERIFYING");
    assert.equal(cycleState.verificationCycle, 2);

    await prepareCompletion({ target, packageRoot, taskId });
    await recordCheckArtifact({
      target,
      packageRoot,
      taskId,
      id: "regression-tests",
      kind: "manual-review",
      requirement: "pack tarball test asserts the README image is excluded from the npm package",
      status: "passed",
      evidenceKind: "OBSERVED",
      result: "objective check passed in cycle 2",
    });
    await recordCheckArtifact({
      target,
      packageRoot,
      taskId,
      id: "native-suite",
      kind: "manual-review",
      requirement: "npm test and docs checks all exit 0",
      status: "passed",
      evidenceKind: "OBSERVED",
      result: "full suite green in the current repository",
    });
    await recordCheckArtifact({
      target,
      packageRoot,
      taskId,
      id: "objective-present",
      kind: "manual-review",
      requirement: "objective is present in the current repository",
      status: "passed",
      evidenceKind: "OBSERVED",
      result: "reconciled checkpoint with contract-bound evidence",
    });
    await advanceWorkState(target, "REVIEWING", { packageRoot, taskId });
    const finalCompletion = await runComplete({ target, packageRoot, taskId });
    assert.equal(finalCompletion.status, "VALID");
    const finalState = await readWorkState(target, { packageRoot, taskId });
    assert.equal(finalState.phase, "COMPLETE");
  });
});

test("advance REVIEWING -> VERIFYING rebinds a drifted rejection snapshot and enters cycle 2", async () => {
  await withTarget(async (target) => {
    const { taskId } = await setupDriftedReviewingRejection(target);

    await advanceWorkState(target, "VERIFYING", { packageRoot, taskId });
    const state = await readWorkState(target, { packageRoot, taskId });
    assert.equal(state.phase, "VERIFYING");
    assert.equal(state.verificationCycle, 2);
    assert.equal(state.lastCompletionAttempt, undefined);

    const ledger = await validateEventLedger(target, packageRoot, { taskId });
    assert.equal(ledger.valid, true);
  });
});

test("rebind refuses a rejection whose logical fields no longer match the ledger", async () => {
  await withTarget(async (target) => {
    const { taskId } = await setupDriftedReviewingRejection(target);

    const state = await readWorkState(target, { packageRoot, taskId });
    state.lastCompletionAttempt = {
      ...state.lastCompletionAttempt,
      missingRequirementIds: [...state.lastCompletionAttempt.missingRequirementIds, "REQ_TAMPERED"],
    };
    await writeWorkState(target, state, { packageRoot, taskId });
    const tamperedFingerprint = canonicalFingerprint(state);

    const eventsBefore = await readEvents(target, packageRoot, { taskId });
    const rejectionCountBefore = eventsBefore.filter((event) => event.event === "COMPLETION_REJECTED").length;

    await assert.rejects(
      () => runReconcileClosure({
        target,
        packageRoot,
        taskId,
        checkId: "regression-tests",
        requirement: "pack tarball test asserts the README image is excluded from the npm package",
        argv: ["node", "-e", "process.exit(0)"],
      }),
      (error) => error.code === "E_COMPLETION_REJECTION_STATE_FINGERPRINT_MISMATCH"
        || error.code === "E_COMPLETION_RECOVERY_UNAUTHORIZED"
        || error.code === "E_COMPLETION_REJECTION_LEDGER_MISMATCH",
    );

    const eventsAfter = await readEvents(target, packageRoot, { taskId });
    const rejectionCountAfter = eventsAfter.filter((event) => event.event === "COMPLETION_REJECTED").length;
    assert.equal(rejectionCountAfter, rejectionCountBefore, "no rebound rejection may be appended on logical mismatch");

    const currentState = await readWorkState(target, { packageRoot, taskId });
    assert.equal(canonicalFingerprint(currentState), tamperedFingerprint, "work-state must stay untouched on logical mismatch");
  });
});

test("preflight recreates a resumable checkpoint at the ledger-derived phase", async () => {
  await withTarget(async (target) => {
    const { taskId } = await setupFreshTask(target, { taskId: "resume-task", phase: "EXECUTING" });
    await appendProtocolEvent(target, { taskId, event: "VERIFICATION_STARTED", details: { verificationCycle: 1 } }, packageRoot, { taskId });

    const { taskDirectory } = await import("../src/core/task-paths.js");
    await deleteFixtureArtifact(target, path.join(taskDirectory(taskId), "work-state.json"));

    const preflight = await runPreflight({ target, packageRoot, taskId });
    assert.equal(preflight.status, "READY");

    const restored = await readWorkState(target, { packageRoot, taskId });
    assert.equal(restored.phase, "VERIFYING");
    assert.deepEqual(restored.completedSteps, ["contract", "route", "planning", "implementation"]);
    assert.deepEqual(restored.pendingSteps, ["verification"]);

    // The restored checkpoint can reach REVIEWING without invalidating the ledger.
    await advanceWorkState(target, "REVIEWING", { packageRoot, taskId });
    const reviewing = await readWorkState(target, { packageRoot, taskId });
    assert.equal(reviewing.phase, "REVIEWING");
    const ledger = await validateEventLedger(target, packageRoot, { taskId });
    assert.equal(ledger.valid, true);
  });
});

test("preflight keeps ROUTED resume for a ledger without execution milestones", async () => {
  await withTarget(async (target) => {
    const { taskId } = await setupFreshTask(target, { taskId: "early-task", phase: "ROUTED", previousPhase: "CONTRACT_READY", appendExecution: false });

    const { taskDirectory } = await import("../src/core/task-paths.js");
    await deleteFixtureArtifact(target, path.join(taskDirectory(taskId), "work-state.json"));

    const preflight = await runPreflight({ target, packageRoot, taskId });
    assert.equal(preflight.status, "READY");

    const restored = await readWorkState(target, { packageRoot, taskId });
    assert.equal(restored.phase, "ROUTED");
    assert.deepEqual(restored.pendingSteps, ["planning", "implementation", "verification"]);
  });
});


test("direct completion rejection rebind rolls back state when event publication fails", async () => {
  await withTarget(async target => {
    const { taskId } = await setupDriftedReviewingRejection(target);
    const db = openStorageDatabase(path.join(target, ".forgeloop/state.sqlite"));
    try {
      const before = db.prepare("SELECT state_json FROM tasks WHERE task_id = ?").get(taskId).state_json;
      const count = db.prepare("SELECT COUNT(*) AS n FROM events WHERE task_id = ?").get(taskId).n;
      const artifacts = db.prepare("SELECT kind, artifact_id, payload_json, fingerprint FROM task_artifacts WHERE task_id = ? ORDER BY kind, artifact_id").all(taskId);
      db.exec("CREATE TRIGGER refuse_rebound_event BEFORE INSERT ON events BEGIN SELECT RAISE(ABORT, 'injected rebound event failure'); END");
      await assert.rejects(rebindCompletionRejectionSnapshot({ target, packageRoot, taskId }), /injected rebound event failure/);
      assert.equal(db.prepare("SELECT state_json FROM tasks WHERE task_id = ?").get(taskId).state_json, before, "State must roll back with the rejected event");
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM events WHERE task_id = ?").get(taskId).n, count);
      assert.deepEqual(db.prepare("SELECT kind, artifact_id, payload_json, fingerprint FROM task_artifacts WHERE task_id = ? ORDER BY kind, artifact_id").all(taskId), artifacts, "Receipt and other artifacts must roll back too");
    } finally { db.close(); }
  });
});
