import { ensureFixtureTask } from "./helpers/native-storage-fixture.js";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { removeTempTree } from "./helpers/rm-safe.js";
import { runPreflight } from "../src/commands/preflight.js";
import { prepareCompletion, recordCheck } from "../src/core/completion-artifacts.js";

import { createContract, contractFingerprint, writeContract } from "../src/core/contract.js";
import { appendProtocolEvent } from "../src/core/events.js";
import { recordDiagnosis } from "../src/core/diagnosis.js";
import { advanceWorkState } from "../src/core/phase.js";
import { NEXT_ACTIONS, getNextAction } from "../src/core/next-action.js";
import { evaluateRoute } from "../src/core/router.js";
import { persistRoute } from "../src/core/route-artifact.js";
import { getPackageRoot } from "../src/core/templates.js";
import { createWorkState, readWorkState, writeWorkState } from "../src/core/work-state.js";

const packageRoot = getPackageRoot();

async function withTarget(run) {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-supersession-"));
  try {
    await ensureFixtureTask(target, "task-supersession", packageRoot);
    await run(target);
  } finally {
    await removeTempTree(target);
  }
}

async function setupTarget(target, { verification = ["tests"], successCriteria = ["tests"] } = {}) {
  const contract = createContract({
    taskId: "task-supersession",
    objective: "Exercise historical check supersession in next and evidence readiness",
    deliverables: ["src/app.js"],
    constraints: ["offline"],
    risks: [],
    verification,
    successCriteria,
    stopConditions: [],
    unresolvedDecisions: [],
    sourceRefs: [],
  });
  const contractHash = contractFingerprint(contract);
  await writeContract(target, contract, packageRoot, { taskId: contract.taskId });

  const route = evaluateRoute({ workType: "code", surfaces: ["config"], platforms: [] });
  const persistedRoute = await persistRoute(target, route, packageRoot, {
    contractFingerprint: contractHash,
    taskId: contract.taskId,
  });

  const state = createWorkState({
    taskId: contract.taskId,
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
  await writeWorkState(target, state, { packageRoot, taskId: "task-supersession" });
  await appendProtocolEvent(target, { taskId: contract.taskId, event: "CONTRACT_VALIDATED" }, packageRoot, { taskId: "task-supersession" });
  await appendProtocolEvent(target, { taskId: contract.taskId, event: "ROUTE_VALIDATED" }, packageRoot, { taskId: "task-supersession" });

  const preflight = await runPreflight({ target, packageRoot, taskId: "task-supersession" });
  assert.equal(preflight.status, "READY");

  await advanceWorkState(target, "EXECUTING", { packageRoot, taskId: "task-supersession" });
  await advanceWorkState(target, "VERIFYING", { packageRoot, taskId: "task-supersession" });
  await prepareCompletion({ target, packageRoot, taskId: "task-supersession" });
}

test("Test A & D: Historical Fail in cycle 1 -> New Pass in cycle 2 with same ID results in ENTER_REVIEWING (P0-2)", async () => {
  await withTarget(async (target) => {
    await setupTarget(target);

    // Cycle 1: record failed check
    await recordCheck({ kind: "manual-review",
      target,
      packageRoot,
      taskId: "task-supersession",
      id: "unit-tests",
      requirement: "tests",
      status: "failed",
      evidenceKind: "OBSERVED",
      command: "npm test",
      result: "1 test failed",
    });

    let next = await getNextAction(target, packageRoot);
    assert.equal(next.nextAction, NEXT_ACTIONS.DIAGNOSE);

    // Enter DIAGNOSING -> CORRECTING -> VERIFYING (cycle 2)
    await advanceWorkState(target, "DIAGNOSING", { packageRoot, taskId: "task-supersession" });
    await recordDiagnosis({
      target,
      packageRoot,
      taskId: "task-supersession",
      hypothesis: "Fixed bug in math logic",
      failureClass: "VERIFICATION_FAILURE",
      evidenceRefs: ["unit-tests"],
      settledBy: "Pass tests",
      nextSafeAction: "Fix bug",
    });

    await advanceWorkState(target, "CORRECTING", { packageRoot, taskId: "task-supersession" });
    await advanceWorkState(target, "VERIFYING", { packageRoot, taskId: "task-supersession" });

    const state = await readWorkState(target, { packageRoot, taskId: "task-supersession" });
    assert.equal(state.verificationCycle, 2);

    // Cycle 2: record passing check with same ID
    await recordCheck({ kind: "manual-review",
      target,
      packageRoot,
      taskId: "task-supersession",
      id: "unit-tests",
      requirement: "tests",
      status: "passed",
      evidenceKind: "OBSERVED",
      command: "npm test",
      result: "All tests passed",
    });

    next = await getNextAction(target, packageRoot);
    assert.notEqual(next.nextAction, NEXT_ACTIONS.DIAGNOSE);
    assert.equal(next.nextAction, NEXT_ACTIONS.ENTER_REVIEWING);
  });
});

test("Test E: Historical Fail in cycle 1 -> New Pass in cycle 2 with DIFFERENT check ID results in ENTER_REVIEWING (P0-2)", async () => {
  await withTarget(async (target) => {
    await setupTarget(target);

    // Cycle 1: record failed check with ID tests-old
    await recordCheck({ kind: "manual-review",
      target,
      packageRoot,
      taskId: "task-supersession",
      id: "tests-old",
      requirement: "tests",
      status: "failed",
      evidenceKind: "OBSERVED",
      command: "npm test",
      result: "1 test failed",
    });

    let next = await getNextAction(target, packageRoot);
    assert.equal(next.nextAction, NEXT_ACTIONS.DIAGNOSE);

    // Advance to DIAGNOSING -> CORRECTING -> VERIFYING (cycle 2)
    await advanceWorkState(target, "DIAGNOSING", { packageRoot, taskId: "task-supersession" });
    await recordDiagnosis({
      target,
      packageRoot,
      taskId: "task-supersession",
      hypothesis: "Resolved failure",
      failureClass: "VERIFICATION_FAILURE",
      evidenceRefs: ["tests-old"],
      settledBy: "Pass tests",
      nextSafeAction: "Fix bug",
    });

    await advanceWorkState(target, "CORRECTING", { packageRoot, taskId: "task-supersession" });
    await advanceWorkState(target, "VERIFYING", { packageRoot, taskId: "task-supersession" });

    // Cycle 2: record passing check with ID tests-new for same requirement
    await recordCheck({ kind: "manual-review",
      target,
      packageRoot,
      taskId: "task-supersession",
      id: "tests-new",
      requirement: "tests",
      status: "passed",
      evidenceKind: "OBSERVED",
      command: "npm test",
      result: "All tests passed",
    });

    // Verify historical check is still persisted
    const state = await readWorkState(target, { packageRoot, taskId: "task-supersession" });
    assert.equal(state.checks.length, 2);
    assert.ok(state.checks.some((c) => c.id === "tests-old" && c.status === "failed"));
    assert.ok(state.checks.some((c) => c.id === "tests-new" && c.status === "passed"));

    // Next action must evaluate authoritative check and recommend ENTER_REVIEWING
    next = await getNextAction(target, packageRoot);
    assert.notEqual(next.nextAction, NEXT_ACTIONS.DIAGNOSE);
    assert.equal(next.nextAction, NEXT_ACTIONS.ENTER_REVIEWING);
  });
});

test("Test B: Historical Blocked in cycle 1 -> New Pass in cycle 2 results in ENTER_REVIEWING (P0-2)", async () => {
  await withTarget(async (target) => {
    await setupTarget(target);

    // Cycle 1: record blocked check
    await recordCheck({ kind: "manual-review",
      target,
      packageRoot,
      taskId: "task-supersession",
      id: "browser-check-c1",
      requirement: "tests",
      status: "blocked",
      evidenceKind: "BLOCKED",
      command: "npm test",
      result: "Environment locked",
    });

    let next = await getNextAction(target, packageRoot);
    assert.equal(next.nextAction, NEXT_ACTIONS.RESOLVE_BLOCKER);

    // Advance through correction cycle
    await advanceWorkState(target, "DIAGNOSING", { packageRoot, taskId: "task-supersession" });
    await recordDiagnosis({
      target,
      packageRoot,
      taskId: "task-supersession",
      hypothesis: "Unlocked test harness",
      failureClass: "ENVIRONMENT_FAILURE",
      evidenceRefs: ["browser-check-c1"],
      settledBy: "Pass tests",
      nextSafeAction: "Fix env",
    });

    await advanceWorkState(target, "CORRECTING", { packageRoot, taskId: "task-supersession" });
    await advanceWorkState(target, "VERIFYING", { packageRoot, taskId: "task-supersession" });

    // Cycle 2: record passing check
    await recordCheck({ kind: "manual-review",
      target,
      packageRoot,
      taskId: "task-supersession",
      id: "browser-check-c2",
      requirement: "tests",
      status: "passed",
      evidenceKind: "OBSERVED",
      command: "npm test",
      result: "Tests passed in browser",
    });

    next = await getNextAction(target, packageRoot);
    assert.notEqual(next.nextAction, NEXT_ACTIONS.RESOLVE_BLOCKER);
    assert.equal(next.nextAction, NEXT_ACTIONS.ENTER_REVIEWING);
  });
});

test("Test C: Historical Pass in cycle 1 -> New Fail in cycle 2 results in DIAGNOSE (P0-2)", async () => {
  await withTarget(async (target) => {
    await setupTarget(target);

    // Cycle 1: record passed check
    await recordCheck({ kind: "manual-review",
      target,
      packageRoot,
      taskId: "task-supersession",
      id: "test-c1",
      requirement: "tests",
      status: "passed",
      evidenceKind: "OBSERVED",
      command: "npm test",
      result: "Passed",
    });

    let next = await getNextAction(target, packageRoot);
    assert.equal(next.nextAction, NEXT_ACTIONS.ENTER_REVIEWING);

    // Cycle 1 also had a failure to investigate
    await recordCheck({ kind: "manual-review",
      target,
      packageRoot,
      taskId: "task-supersession",
      id: "test-c1-fail",
      requirement: "tests",
      status: "failed",
      evidenceKind: "OBSERVED",
      command: "npm test",
      result: "Investigating failure",
    });

    // Advance to cycle 2 through correction transition
    await advanceWorkState(target, "DIAGNOSING", { packageRoot, taskId: "task-supersession" });
    await recordDiagnosis({
      target,
      packageRoot,
      taskId: "task-supersession",
      hypothesis: "Investigating regression",
      failureClass: "VERIFICATION_FAILURE",
      evidenceRefs: ["test-c1-fail"],
      settledBy: "Pass tests",
      nextSafeAction: "Fix bug",
    });

    await advanceWorkState(target, "CORRECTING", { packageRoot, taskId: "task-supersession" });
    await advanceWorkState(target, "VERIFYING", { packageRoot, taskId: "task-supersession" });

    await recordCheck({ kind: "manual-review",
      target,
      packageRoot,
      taskId: "task-supersession",
      id: "test-c2",
      requirement: "tests",
      status: "failed",
      evidenceKind: "OBSERVED",
      command: "npm test",
      result: "Failed on regression",
    });

    next = await getNextAction(target, packageRoot);
    assert.equal(next.nextAction, NEXT_ACTIONS.DIAGNOSE);
  });
});
