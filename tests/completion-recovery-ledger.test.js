import { buildTaskArtifactPaths } from "../src/core/task-paths.js";
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

import { readJsonArtifact } from "../src/core/artifacts.js";
import { createContract, contractFingerprint, writeContract } from "../src/core/contract.js";
import { appendProtocolEvent, validateCompletionRecoveryAuthorization, validateEventLedger } from "../src/core/events.js";
import { advanceWorkState } from "../src/core/phase.js";
import { NEXT_ACTIONS, getNextAction } from "../src/core/next-action.js";
import { evaluateRoute } from "../src/core/router.js";
import { persistRoute } from "../src/core/route-artifact.js";
import { getPackageRoot } from "../src/core/templates.js";
import { createWorkState, readWorkState, writeWorkState } from "../src/core/work-state.js";

const packageRoot = getPackageRoot();
const ARTIFACT_PATHS = buildTaskArtifactPaths("task-ledger-recovery");

async function withTarget(run) {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-ledger-recovery-"));
  try {
    await ensureFixtureTask(target, "task-ledger-recovery", packageRoot);
    await run(target);
  } finally {
    await removeTempTree(target);
  }
}

async function setupTarget(target, { successCriteria = ["tests", "build"] } = {}) {
  const contract = createContract({
    taskId: "task-ledger-recovery",
    objective: "Exercise completion recovery authorization and ledger binding",
    deliverables: ["src/app.js"],
    constraints: ["offline"],
    risks: [],
    verification: ["tests", "build"],
    successCriteria,
    stopConditions: ["verification unavailable"],
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
  await writeWorkState(target, state, { packageRoot, taskId: "task-ledger-recovery" });
  await appendProtocolEvent(target, { taskId: contract.taskId, event: "CONTRACT_VALIDATED" }, packageRoot, { taskId: "task-ledger-recovery" });
  await appendProtocolEvent(target, { taskId: contract.taskId, event: "ROUTE_VALIDATED" }, packageRoot, { taskId: "task-ledger-recovery" });
  const preflight = await runPreflight({ target, packageRoot, taskId: "task-ledger-recovery" });
  assert.equal(preflight.status, "READY");
  await advanceWorkState(target, "EXECUTING", { packageRoot, taskId: "task-ledger-recovery" });
}

test("completion rejection binds to ledger and authorizes REVIEWING -> VERIFYING cycle 2 (Matrix C)", async () => {
  await withTarget(async (target) => {
    await setupTarget(target);

    // 1. Advance to VERIFYING (cycle 1)
    await advanceWorkState(target, "VERIFYING", { packageRoot, taskId: "task-ledger-recovery" });
    await prepareCompletion({ target, packageRoot, taskId: "task-ledger-recovery" });

    // 2. Only record 1 of 2 checks ("tests" recorded, "build" missing)
    await recordCheck({ kind: "manual-review",
      target,
      packageRoot,
      taskId: "task-ledger-recovery",
      id: "unit-tests",
      requirement: "tests",
      status: "passed",
      evidenceKind: "OBSERVED",
      command: "npm test",
      result: "Passed",
    });

    // 3. Advance to REVIEWING
    await advanceWorkState(target, "REVIEWING", { packageRoot, taskId: "task-ledger-recovery" });

    // 4. Run complete - must be REJECTED because "build" evidence is missing
    const completion = await runComplete({ target, packageRoot, taskId: "task-ledger-recovery" });
    assert.equal(completion.status, "REJECTED");
    assert.ok(completion.errors.some((e) => e.code === "E_EVIDENCE_REQUIRED"));

    // Verify state has lastCompletionAttempt
    let state = await readWorkState(target, { packageRoot, taskId: "task-ledger-recovery" });
    assert.equal(state.lastCompletionAttempt?.status, "REJECTED");
    assert.equal(state.lastCompletionAttempt?.verificationCycle, 1);
    assert.ok(state.lastCompletionAttempt?.missingRequirementIds?.length > 0);

    // Verify ledger has COMPLETION_REJECTED event
    const ledger = await validateEventLedger(target, packageRoot, { taskId: "task-ledger-recovery" });
    assert.equal(ledger.valid, true);
    const rejectionEvent = ledger.events.find((e) => e.event === "COMPLETION_REJECTED");
    assert.ok(rejectionEvent);
    assert.equal(rejectionEvent.details?.verificationCycle, 1);

    // Recovery is authorized
    const receipt = await readJsonArtifact(target, ARTIFACT_PATHS.receipt, "execution-receipt", packageRoot);
    const auth = validateCompletionRecoveryAuthorization({ state, receipt: receipt.value, events: ledger.events });
    assert.equal(auth.authorized, true);

    // nextAction should offer ENTER_VERIFYING
    const next = await getNextAction(target, packageRoot);
    assert.equal(next.nextAction, NEXT_ACTIONS.ENTER_VERIFYING);

    // 5. Advance back to VERIFYING (cycle 2)
    state = await advanceWorkState(target, "VERIFYING", { packageRoot, taskId: "task-ledger-recovery" });
    assert.equal(state.phase, "VERIFYING");
    assert.equal(state.verificationCycle, 2);
    assert.equal(state.lastCompletionAttempt, undefined); // Cleared on re-entry

    // 6. Record missing check in cycle 2
    await recordCheck({ kind: "manual-review",
      target,
      packageRoot,
      taskId: "task-ledger-recovery",
      id: "build-check",
      requirement: "build",
      status: "passed",
      evidenceKind: "OBSERVED",
      command: "npm run build",
      result: "Built successfully",
    });

    // 7. Advance to REVIEWING
    await advanceWorkState(target, "REVIEWING", { packageRoot, taskId: "task-ledger-recovery" });

    // 8. Run complete - should now be VALID
    const secondCompletion = await runComplete({ target, packageRoot, taskId: "task-ledger-recovery" });
    assert.equal(secondCompletion.status, "VALID");

    const finalState = await readWorkState(target, { packageRoot, taskId: "task-ledger-recovery" });
    assert.equal(finalState.phase, "COMPLETE");
    assert.equal(finalState.verificationCycle, 2);
  });
});

test("forged recovery attempt (fake lastCompletionAttempt without ledger event) is rejected (Matrix F)", async () => {
  await withTarget(async (target) => {
    await setupTarget(target);
    await advanceWorkState(target, "VERIFYING", { packageRoot, taskId: "task-ledger-recovery" });
    await prepareCompletion({ target, packageRoot, taskId: "task-ledger-recovery" });
    await recordCheck({ kind: "manual-review",
      target,
      packageRoot,
      taskId: "task-ledger-recovery",
      id: "unit-tests",
      requirement: "tests",
      status: "passed",
      evidenceKind: "OBSERVED",
      command: "npm test",
      result: "Passed",
    });
    await advanceWorkState(target, "REVIEWING", { packageRoot, taskId: "task-ledger-recovery" });

    // Manually forge lastCompletionAttempt in state without matching COMPLETION_REJECTED in ledger
    const state = await readWorkState(target, { packageRoot, taskId: "task-ledger-recovery" });
    state.lastCompletionAttempt = {
      status: "REJECTED",
      verificationCycle: 1,
      timestamp: new Date().toISOString(),
      reasonCodes: ["E_EVIDENCE_REQUIRED"],
      missingRequirementIds: ["REQ_FAKE"],
      stateFingerprint: "0000000000000000000000000000000000000000000000000000000000000000",
      receiptFingerprint: "0000000000000000000000000000000000000000000000000000000000000000",
    };
    await writeWorkState(target, state, { packageRoot, taskId: "task-ledger-recovery" });

    const ledger = await validateEventLedger(target, packageRoot, { taskId: "task-ledger-recovery" });
    const auth = validateCompletionRecoveryAuthorization({ state, events: ledger.events });
    assert.equal(auth.authorized, false);
    assert.equal(auth.errors[0]?.code, "E_COMPLETION_RECOVERY_UNAUTHORIZED");

    // advanceWorkState to VERIFYING must fail
    await assert.rejects(
      () => advanceWorkState(target, "VERIFYING", { packageRoot, taskId: "task-ledger-recovery" }),
      (err) => err.code === "E_COMPLETION_RECOVERY_UNAUTHORIZED" || err.code === "E_COMPLETION_REJECTION_LEDGER_MISMATCH",
    );
  });
});

test("wrong recovery cycle (state cycle=2, rejection event cycle=1) is rejected (Matrix G)", async () => {
  await withTarget(async (target) => {
    await setupTarget(target);
    await advanceWorkState(target, "VERIFYING", { packageRoot, taskId: "task-ledger-recovery" });
    await prepareCompletion({ target, packageRoot, taskId: "task-ledger-recovery" });
    await advanceWorkState(target, "REVIEWING", { packageRoot, taskId: "task-ledger-recovery" });

    // Append rejection for cycle 1 in ledger
    await appendProtocolEvent(target, {
      taskId: "task-ledger-recovery",
      event: "COMPLETION_REJECTED",
      details: {
        verificationCycle: 1,
        reasonCodes: ["E_EVIDENCE_REQUIRED"],
        missingRequirementIds: ["REQ_MISSING"],
      },
    }, packageRoot, { taskId: "task-ledger-recovery" });

    // State is at cycle 2 with lastCompletionAttempt claiming cycle 2
    const state = await readWorkState(target, { packageRoot, taskId: "task-ledger-recovery" });
    state.verificationCycle = 2;
    state.lastCompletionAttempt = {
      status: "REJECTED",
      verificationCycle: 2,
      timestamp: new Date().toISOString(),
      reasonCodes: ["E_EVIDENCE_REQUIRED"],
      missingRequirementIds: ["REQ_MISSING"],
      stateFingerprint: "0000000000000000000000000000000000000000000000000000000000000000",
      receiptFingerprint: "0000000000000000000000000000000000000000000000000000000000000000",
    };
    await writeWorkState(target, state, { packageRoot, taskId: "task-ledger-recovery" });

    const ledger = await validateEventLedger(target, packageRoot, { taskId: "task-ledger-recovery" });
    const auth = validateCompletionRecoveryAuthorization({ state, events: ledger.events });
    assert.equal(auth.authorized, false);
    assert.equal(auth.errors[0]?.code, "E_COMPLETION_REJECTION_LEDGER_MISMATCH");
  });
});

test("rejection event idempotency prevents duplicate events on repeated failed complete", async () => {
  await withTarget(async (target) => {
    await setupTarget(target);
    await advanceWorkState(target, "VERIFYING", { packageRoot, taskId: "task-ledger-recovery" });
    await prepareCompletion({ target, packageRoot, taskId: "task-ledger-recovery" });

    // Record partial check
    await recordCheck({ kind: "manual-review",
      target,
      packageRoot,
      taskId: "task-ledger-recovery",
      id: "unit-tests",
      requirement: "tests",
      status: "passed",
      evidenceKind: "OBSERVED",
      command: "npm test",
      result: "Passed",
    });

    await advanceWorkState(target, "REVIEWING", { packageRoot, taskId: "task-ledger-recovery" });

    // First completion run fails
    const run1 = await runComplete({ target, packageRoot, taskId: "task-ledger-recovery" });
    assert.equal(run1.status, "REJECTED");

    // Second completion run fails with identical state
    const run2 = await runComplete({ target, packageRoot, taskId: "task-ledger-recovery" });
    assert.equal(run2.status, "REJECTED");

    const ledger = await validateEventLedger(target, packageRoot, { taskId: "task-ledger-recovery" });
    const rejections = ledger.events.filter((e) => e.event === "COMPLETION_REJECTED");
    assert.equal(rejections.length, 1); // Idempotent, did not duplicate
  });
});

test("canonical recoverable completion evidence codes consistency", async () => {
  const { RECOVERABLE_COMPLETION_EVIDENCE_CODES, isRecoverableCompletionEvidenceCode } = await import("../src/core/completion-recovery.js");

  for (const code of RECOVERABLE_COMPLETION_EVIDENCE_CODES) {
    assert.equal(isRecoverableCompletionEvidenceCode(code), true);
  }

  assert.equal(isRecoverableCompletionEvidenceCode("E_CONTRACT_STALE"), false);
  assert.equal(isRecoverableCompletionEvidenceCode("E_PHASE_PREREQUISITE_MISSING"), false);
  assert.equal(isRecoverableCompletionEvidenceCode("E_GATE_UNVERIFIED"), false);
});

test("actual state and receipt fingerprint validation against ledger rejection event (P0-1)", async () => {
  const { canonicalFingerprint } = await import("../src/core/artifacts.js");

  const baseState = {
    taskId: "task-fp-1",
    verificationCycle: 1,
    phase: "REVIEWING",
    completedSteps: ["step1"],
    lastCompletionAttempt: {
      status: "REJECTED",
      verificationCycle: 1,
      reasonCodes: ["E_EVIDENCE_REQUIRED"],
      missingRequirementIds: ["REQ_1"],
    },
  };
  const baseReceipt = {
    taskId: "task-fp-1",
    status: "incomplete",
    verificationCycle: 1,
  };

  const stateFp = canonicalFingerprint(baseState);
  const receiptFp = canonicalFingerprint(baseReceipt);

  const events = [
    {
      taskId: "task-fp-1",
      event: "COMPLETION_REJECTED",
      details: {
        verificationCycle: 1,
        reasonCodes: ["E_EVIDENCE_REQUIRED"],
        missingRequirementIds: ["REQ_1"],
        stateFingerprint: stateFp,
        receiptFingerprint: receiptFp,
      },
    },
  ];

  // Test A: Legitimate unchanged state and receipt -> Authorized
  const validAuth = validateCompletionRecoveryAuthorization({
    state: baseState,
    receipt: baseReceipt,
    events,
  });
  assert.equal(validAuth.authorized, true);

  // Test B: Work-state tampering -> Rejected
  const tamperedState = { ...baseState, completedSteps: ["step1", "unauthorized-step"] };
  const stateTamperAuth = validateCompletionRecoveryAuthorization({
    state: tamperedState,
    receipt: baseReceipt,
    events,
  });
  assert.equal(stateTamperAuth.authorized, false);
  assert.ok(stateTamperAuth.errors.some((e) => e.code === "E_COMPLETION_REJECTION_STATE_FINGERPRINT_MISMATCH"));

  // Test C: Receipt tampering -> Rejected
  const tamperedReceipt = { ...baseReceipt, notes: "tampered" };
  const receiptTamperAuth = validateCompletionRecoveryAuthorization({
    state: baseState,
    receipt: tamperedReceipt,
    events,
  });
  assert.equal(receiptTamperAuth.authorized, false);
  assert.ok(receiptTamperAuth.errors.some((e) => e.code === "E_COMPLETION_REJECTION_RECEIPT_FINGERPRINT_MISMATCH"));

  // Test D: Cycle mismatch -> Rejected
  const cycleMismatchState = {
    ...baseState,
    verificationCycle: 2,
    lastCompletionAttempt: {
      ...baseState.lastCompletionAttempt,
      verificationCycle: 1,
    },
  };
  const cycleAuth = validateCompletionRecoveryAuthorization({
    state: cycleMismatchState,
    receipt: baseReceipt,
    events,
  });
  assert.equal(cycleAuth.authorized, false);
  assert.ok(cycleAuth.errors.some((e) => e.code === "E_COMPLETION_REJECTION_LEDGER_MISMATCH"));

  // Test E: Reason mismatch -> Rejected
  const reasonMismatchState = {
    ...baseState,
    lastCompletionAttempt: {
      ...baseState.lastCompletionAttempt,
      reasonCodes: ["E_EVIDENCE_INVALID"],
    },
  };
  const reasonAuth = validateCompletionRecoveryAuthorization({
    state: reasonMismatchState,
    receipt: baseReceipt,
    events,
  });
  assert.equal(reasonAuth.authorized, false);
  assert.ok(reasonAuth.errors.some((e) => e.code === "E_COMPLETION_REJECTION_LEDGER_MISMATCH"));

  // Test F: Legitimate rejection without receipt (receiptFingerprint undefined in event)
  const noReceiptEvents = [
    {
      taskId: "task-fp-1",
      event: "COMPLETION_REJECTED",
      details: {
        verificationCycle: 1,
        reasonCodes: ["E_EVIDENCE_REQUIRED"],
        missingRequirementIds: ["REQ_1"],
        stateFingerprint: stateFp,
      },
    },
  ];
  const noReceiptAuth = validateCompletionRecoveryAuthorization({
    state: baseState,
    receipt: null,
    events: noReceiptEvents,
  });
  assert.equal(noReceiptAuth.authorized, true);
});

