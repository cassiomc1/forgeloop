import { ensureFixtureTask } from "./helpers/native-storage-fixture.js";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { removeTempTree } from "./helpers/rm-safe.js";
import { runComplete } from "../src/commands/complete.js";
import { runPreflight } from "../src/commands/preflight.js";
import { prepareCompletion, recordCheck } from "../src/core/completion-artifacts.js";

import { createContract, contractFingerprint, writeContract } from "../src/core/contract.js";
import { appendProtocolEvent, validateEventLedger } from "../src/core/events.js";
import { advanceWorkState } from "../src/core/phase.js";
import { NEXT_ACTIONS, getNextAction } from "../src/core/next-action.js";
import { evaluateRoute } from "../src/core/router.js";
import { persistRoute } from "../src/core/route-artifact.js";
import { recordDiagnosis } from "../src/core/diagnosis.js";
import { getPackageRoot } from "../src/core/templates.js";
import { createWorkState, writeWorkState } from "../src/core/work-state.js";

const packageRoot = getPackageRoot();
const taskId = "task-correction";

async function withTarget(run) {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-correction-"));
  try {
    await run(target);
  } finally {
    await removeTempTree(target);
  }
}

async function setupTarget(target, { successCriteria = ["tests"] } = {}) {
  await ensureFixtureTask(target, taskId, packageRoot);
  const contract = createContract({
    taskId: "task-correction",
    objective: "Exercise product correction and multi-cycle verification",
    deliverables: ["src/app.js"],
    constraints: ["offline"],
    risks: [],
    verification: ["tests"],
    successCriteria,
    stopConditions: ["verification unavailable"],
    unresolvedDecisions: [],
    sourceRefs: [],
  });
  const contractHash = contractFingerprint(contract);
  await writeContract(target, contract, packageRoot, { taskId });
  const route = evaluateRoute({ workType: "code", surfaces: ["config"], platforms: [] });
  const persistedRoute = await persistRoute(target, route, packageRoot, {
    contractFingerprint: contractHash,
    taskId,
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
  await writeWorkState(target, state, { packageRoot, taskId });
  await appendProtocolEvent(target, { taskId: contract.taskId, event: "CONTRACT_VALIDATED" }, packageRoot, { taskId });
  await appendProtocolEvent(target, { taskId: contract.taskId, event: "ROUTE_VALIDATED" }, packageRoot, { taskId });
  const preflight = await runPreflight({ target, packageRoot, taskId });
  assert.equal(preflight.status, "READY");
  await advanceWorkState(target, "EXECUTING", { packageRoot, taskId });
}

test("full failed-check -> diagnose -> correct -> verify-again -> complete cycle succeeds (P0-1 & P0-2)", async () => {
  await withTarget(async (target) => {
    await setupTarget(target);

    // 1. Advance to VERIFYING (cycle 1)
    let next = await getNextAction({ target, packageRoot, taskId });
    assert.equal(next.nextAction, NEXT_ACTIONS.ENTER_VERIFYING);
    let state = await advanceWorkState(target, "VERIFYING", { packageRoot, taskId });
    assert.equal(state.phase, "VERIFYING");
    assert.equal(state.verificationCycle, 1);

    await prepareCompletion({ target, packageRoot, taskId });

    // 2. Record failed observed check in cycle 1
    await recordCheck({ kind: "manual-review",
      target,
      packageRoot,
      taskId,
      id: "unit-tests",
      requirement: "tests",
      status: "failed",
      evidenceKind: "OBSERVED",
      command: "npm test",
      result: "1 test failed in math.test.js",
      exitCode: 1,
    });

    // 3. next -> DIAGNOSE
    next = await getNextAction({ target, packageRoot, taskId });
    assert.equal(next.nextAction, NEXT_ACTIONS.DIAGNOSE);

    // 4. Advance to DIAGNOSING
    state = await advanceWorkState(target, "DIAGNOSING", { packageRoot, taskId });
    assert.equal(state.phase, "DIAGNOSING");

    // 5. Record diagnosis
    next = await getNextAction({ target, packageRoot, taskId });
    assert.equal(next.nextAction, NEXT_ACTIONS.RECORD_DIAGNOSIS);

    await recordDiagnosis({
      target,
      packageRoot,
      taskId,
      hypothesis: "Off-by-one error in calculateTotal function",
      failureClass: "VERIFICATION_FAILURE",
      evidenceRefs: ["unit-tests"],
      settledBy: "math.test.js passes",
      nextSafeAction: "Fix off-by-one in calculateTotal",
    });

    // 6. next -> CORRECT
    next = await getNextAction({ target, packageRoot, taskId });
    assert.equal(next.nextAction, NEXT_ACTIONS.CORRECT);

    // 7. Advance to CORRECTING
    state = await advanceWorkState(target, "CORRECTING", { packageRoot, taskId });
    assert.equal(state.phase, "CORRECTING");

    // 8. next -> ENTER_VERIFYING
    next = await getNextAction({ target, packageRoot, taskId });
    assert.equal(next.nextAction, NEXT_ACTIONS.ENTER_VERIFYING);
    assert.deepEqual(next.commands, ["forgeloop advance --to VERIFYING"]);

    // 9. Advance to VERIFYING (cycle 2) - P0-1 fix
    state = await advanceWorkState(target, "VERIFYING", { packageRoot, taskId });
    assert.equal(state.phase, "VERIFYING");
    assert.equal(state.verificationCycle, 2);

    // 10. Record passed observed check in cycle 2
    await recordCheck({ kind: "manual-review",
      target,
      packageRoot,
      taskId,
      id: "unit-tests",
      requirement: "tests",
      status: "passed",
      evidenceKind: "OBSERVED",
      command: "npm test",
      result: "All 5 tests passed",
      exitCode: 0,
    });

    // 11. next -> ENTER_REVIEWING
    next = await getNextAction({ target, packageRoot, taskId });
    assert.equal(next.nextAction, NEXT_ACTIONS.ENTER_REVIEWING);

    // 12. Advance to REVIEWING
    state = await advanceWorkState(target, "REVIEWING", { packageRoot, taskId });
    assert.equal(state.phase, "REVIEWING");
    assert.equal(state.verificationCycle, 2);

    // 13. next -> RUN_COMPLETE
    next = await getNextAction({ target, packageRoot, taskId });
    assert.equal(next.nextAction, NEXT_ACTIONS.RUN_COMPLETE);

    // 14. complete returns VALID
    const completion = await runComplete({ target, packageRoot, taskId });
    assert.equal(completion.status, "VALID");

    // 15. Ledger verification: two VERIFICATION_STARTED milestones
    const ledger = await validateEventLedger(target, packageRoot, { taskId });
    assert.equal(ledger.valid, true);
    const verificationEvents = ledger.events.filter((e) => e.event === "VERIFICATION_STARTED");
    assert.equal(verificationEvents.length, 2);
    assert.equal(verificationEvents[0].details?.verificationCycle, 1);
    assert.equal(verificationEvents[1].details?.verificationCycle, 2);
  });
});

test("multiple corrections (cycles 1, 2 FAIL -> cycle 3 PASS) increment cycles monotonically", async () => {
  await withTarget(async (target) => {
    await setupTarget(target);

    // Cycle 1
    await advanceWorkState(target, "VERIFYING", { packageRoot, taskId });
    await prepareCompletion({ target, packageRoot, taskId });
    await recordCheck({ kind: "manual-review",
      target,
      packageRoot,
      taskId,
      id: "tests-c1",
      requirement: "tests",
      status: "failed",
      evidenceKind: "OBSERVED",
      command: "npm test",
      result: "Failed cycle 1",
    });
    let state = await advanceWorkState(target, "DIAGNOSING", { packageRoot, taskId });
    await recordDiagnosis({
      target,
      packageRoot,
      taskId,
      hypothesis: "Hypothesis 1",
      failureClass: "VERIFICATION_FAILURE",
      evidenceRefs: ["tests-c1"],
      settledBy: "Cycle 1 test passes",
      nextSafeAction: "Fix cycle 1 bug",
    });
    await advanceWorkState(target, "CORRECTING", { packageRoot, taskId });

    // Cycle 2
    state = await advanceWorkState(target, "VERIFYING", { packageRoot, taskId });
    assert.equal(state.verificationCycle, 2);
    await recordCheck({ kind: "manual-review",
      target,
      packageRoot,
      taskId,
      id: "tests-c2",
      requirement: "tests",
      status: "failed",
      evidenceKind: "OBSERVED",
      command: "npm test",
      result: "Failed cycle 2",
    });
    state = await advanceWorkState(target, "DIAGNOSING", { packageRoot, taskId });
    await recordDiagnosis({
      target,
      packageRoot,
      taskId,
      hypothesis: "Hypothesis 2",
      failureClass: "VERIFICATION_FAILURE",
      evidenceRefs: ["tests-c2"],
      settledBy: "Cycle 2 test passes",
      nextSafeAction: "Fix cycle 2 bug",
    });
    await advanceWorkState(target, "CORRECTING", { packageRoot, taskId });

    // Cycle 3
    state = await advanceWorkState(target, "VERIFYING", { packageRoot, taskId });
    assert.equal(state.verificationCycle, 3);
    await recordCheck({ kind: "manual-review",
      target,
      packageRoot,
      taskId,
      id: "tests-c3",
      requirement: "tests",
      status: "passed",
      evidenceKind: "OBSERVED",
      command: "npm test",
      result: "Passed cycle 3",
    });

    state = await advanceWorkState(target, "REVIEWING", { packageRoot, taskId });
    assert.equal(state.verificationCycle, 3);

    const completion = await runComplete({ target, packageRoot, taskId });
    assert.equal(completion.status, "VALID");

    const ledger = await validateEventLedger(target, packageRoot, { taskId });
    assert.equal(ledger.valid, true);
    const verificationEvents = ledger.events.filter((e) => e.event === "VERIFICATION_STARTED");
    assert.equal(verificationEvents.length, 3);
    assert.deepEqual(verificationEvents.map((e) => e.details?.verificationCycle), [1, 2, 3]);
  });
});

test("cycle 1 PASS superseded by cycle 2 FAIL causes overall FAIL (historical pass must not hide failure)", async () => {
  await withTarget(async (target) => {
    await setupTarget(target);

    // Cycle 1 failed check
    await advanceWorkState(target, "VERIFYING", { packageRoot, taskId });
    await prepareCompletion({ target, packageRoot, taskId });
    await recordCheck({ kind: "manual-review",
      target,
      packageRoot,
      taskId,
      id: "test-suite",
      requirement: "tests",
      status: "failed",
      evidenceKind: "OBSERVED",
      command: "npm test",
      result: "Failed cycle 1",
    });

    let state = await advanceWorkState(target, "DIAGNOSING", { packageRoot, taskId });
    await recordDiagnosis({
      target,
      packageRoot,
      taskId,
      hypothesis: "Refactoring needed",
      failureClass: "VERIFICATION_FAILURE",
      evidenceRefs: ["test-suite"],
      settledBy: "Suite passes",
      nextSafeAction: "Refactor code",
    });
    await advanceWorkState(target, "CORRECTING", { packageRoot, taskId });

    // Cycle 2 failed
    state = await advanceWorkState(target, "VERIFYING", { packageRoot, taskId });
    assert.equal(state.verificationCycle, 2);
    await recordCheck({ kind: "manual-review",
      target,
      packageRoot,
      taskId,
      id: "test-suite",
      requirement: "tests",
      status: "failed",
      evidenceKind: "OBSERVED",
      command: "npm test",
      result: "Regression introduced in cycle 2",
    });

    const next = await getNextAction({ target, packageRoot, taskId });
    // Because latest check in cycle 2 failed, it must not allow advance to reviewing/complete
    assert.equal(next.nextAction, NEXT_ACTIONS.DIAGNOSE);
  });
});
