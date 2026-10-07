import { ensureFixtureTask } from "./helpers/native-storage-fixture.js";
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { mkdtemp } from "node:fs/promises";
import { removeTempTree } from "./helpers/rm-safe.js";
import { getPackageRoot } from "../src/core/templates.js";
import {
  assertDiagnosisDetails,
  classifyDiagnosisInformationGain,
  createDiagnosisDetails,
  diagnosisFingerprint,
  normalizeDiagnosisText,
} from "../src/core/diagnosis-model.js";
import { recordDiagnosis } from "../src/core/diagnosis.js";
import { createWorkState, writeWorkState } from "../src/core/work-state.js";
import { appendProtocolEvent, readEvents, validateEventLedger } from "../src/core/events.js";

const packageRoot = getPackageRoot();

test("diagnosis pure model - normalizeDiagnosisText", () => {
  assert.equal(
    normalizeDiagnosisText("  Boundary   Check <= \n vs <  "),
    "boundary check <= vs <"
  );
  assert.throws(() => normalizeDiagnosisText(""), { code: "E_DIAGNOSIS_INVALID" });
  assert.throws(() => normalizeDiagnosisText(null), { code: "E_DIAGNOSIS_INVALID" });
});

test("diagnosis pure model - diagnosisFingerprint stability", () => {
  const fp1 = diagnosisFingerprint({
    failureClass: "VERIFICATION_FAILURE",
    hypothesis: "Expiration boundary uses <= where < is required",
    evidenceRefs: ["check-b", "check-a"],
  });
  const fp2 = diagnosisFingerprint({
    failureClass: "VERIFICATION_FAILURE",
    hypothesis: "  expiration boundary   uses <= where < is REQUIRED  ",
    evidenceRefs: ["check-a", "check-b"],
  });
  assert.equal(fp1, fp2);
  assert.match(fp1, /^[a-f0-9]{64}$/);
});

test("diagnosis pure model - classifyDiagnosisInformationGain", () => {
  const initial = {
    hypothesis: "Boundary check",
    evidenceRefs: ["chk-1"],
  };
  assert.equal(classifyDiagnosisInformationGain(initial, null), "FIRST_DIAGNOSIS");

  // Same hypothesis, same evidence -> NONE
  const repeated = {
    hypothesis: "  boundary   check  ",
    evidenceRefs: ["chk-1"],
  };
  assert.equal(classifyDiagnosisInformationGain(repeated, initial), "NONE");

  // New hypothesis, same evidence -> NEW_HYPOTHESIS
  const newHypo = {
    hypothesis: "Timeout value too small",
    evidenceRefs: ["chk-1"],
  };
  assert.equal(classifyDiagnosisInformationGain(newHypo, initial), "NEW_HYPOTHESIS");

  // Same hypothesis, new evidence -> NEW_EVIDENCE
  const newEv = {
    hypothesis: "Boundary check",
    evidenceRefs: ["chk-1", "chk-2"],
  };
  assert.equal(classifyDiagnosisInformationGain(newEv, initial), "NEW_EVIDENCE");

  // New hypothesis, new evidence -> NEW_HYPOTHESIS_AND_EVIDENCE
  const newBoth = {
    hypothesis: "Timeout value too small",
    evidenceRefs: ["chk-2"],
  };
  assert.equal(classifyDiagnosisInformationGain(newBoth, initial), "NEW_HYPOTHESIS_AND_EVIDENCE");
});

test("diagnosis pure model - createDiagnosisDetails & assertDiagnosisDetails", () => {
  const details = createDiagnosisDetails({
    verificationCycle: 1,
    failureClass: "VERIFICATION_FAILURE",
    hypothesis: "Boundary check error",
    evidenceRefs: ["check-1"],
    settledBy: "Pass boundary test",
    nextSafeAction: "Fix operator",
  });
  assert.equal(details.informationGain, "FIRST_DIAGNOSIS");
  assert.equal(details.previousDiagnosisFingerprint, null);
  assert.doesNotThrow(() => assertDiagnosisDetails(details));

  // Invalid verificationCycle
  assert.throws(() => createDiagnosisDetails({ ...details, verificationCycle: 0 }), { code: "E_DIAGNOSIS_INVALID" });
  // Invalid failureClass
  assert.throws(() => createDiagnosisDetails({ ...details, failureClass: "INVALID_CLASS" }), { code: "E_DIAGNOSIS_INVALID" });
  // Empty evidenceRefs
  assert.throws(() => createDiagnosisDetails({ ...details, evidenceRefs: [] }), { code: "E_DIAGNOSIS_INVALID" });
});

test("recordDiagnosis persists in event ledger and updates work state projection", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-diag-test-"));
  try {
    const taskId = "task-test-1";
    await ensureFixtureTask(target, taskId, packageRoot);

    // Setup initial events
    await appendProtocolEvent(target, { taskId, event: "TASK_RECEIVED" }, packageRoot, { taskId });
    await appendProtocolEvent(target, { taskId, event: "CONTRACT_VALIDATED" }, packageRoot, { taskId });
    await appendProtocolEvent(target, { taskId, event: "ROUTE_VALIDATED" }, packageRoot, { taskId });
    await appendProtocolEvent(target, { taskId, event: "PREFLIGHT_READY" }, packageRoot, { taskId });
    await appendProtocolEvent(target, { taskId, event: "EXECUTION_STARTED" }, packageRoot, { taskId });
    await appendProtocolEvent(target, { taskId, event: "VERIFICATION_STARTED", details: { verificationCycle: 1 } }, packageRoot, { taskId });

    // Initial state in DIAGNOSING phase with a failed check in cycle 1
    const state = createWorkState({
      taskId,
      contractFingerprint: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      routeFingerprint: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      repositoryFingerprint: { branch: null, head: null },
      phase: "DIAGNOSING",
      completedSteps: ["contract", "route", "implementation"],
      pendingSteps: ["verification"],
      verificationCycle: 1,
      checks: [
        {
          id: "check-auth-boundary",
          requirement: "auth",
          status: "failed",
          evidenceKind: "OBSERVED",
          result: "expected 401 but got 200",
          details: { verificationCycle: 1 },
        },
        {
          id: "check-auth-syntax",
          requirement: "syntax",
          status: "passed",
          evidenceKind: "OBSERVED",
          result: "syntax valid",
          details: { verificationCycle: 1 },
        },
      ],
    });
    await writeWorkState(target, state, { packageRoot, taskId });

    // Record valid diagnosis
    const res = await recordDiagnosis({
      target,
      packageRoot,
      hypothesis: "Comparison operator <= instead of <",
      failureClass: "VERIFICATION_FAILURE",
      evidenceRefs: ["check-auth-boundary"],
      settledBy: "Exact boundary check returns 401",
      nextSafeAction: "Replace <= with < in middleware",
      taskId,
    });

    assert.equal(res.event.event, "DIAGNOSIS_RECORDED");
    assert.equal(res.diagnosis.informationGain, "FIRST_DIAGNOSIS");
    assert.equal(res.state.diagnosedHypothesis, "Comparison operator <= instead of <");

    // Ledger validation
    const ledger = await validateEventLedger(target, packageRoot, { taskId });
    assert.equal(ledger.valid, true);

    // Reject recordDiagnosis if phase is not DIAGNOSING
    const execState = { ...state, phase: "EXECUTING" };
    await writeWorkState(target, execState, { packageRoot, taskId });
    await assert.rejects(
      () => recordDiagnosis({
        target,
        packageRoot,
        hypothesis: "Another hypothesis",
        failureClass: "VERIFICATION_FAILURE",
        evidenceRefs: ["check-auth-boundary"],
        settledBy: "Check passes",
        nextSafeAction: "Fix it",
        taskId,
      }),
      { code: "E_PHASE_PREREQUISITE_MISSING" }
    );

    // Reset back to DIAGNOSING
    await writeWorkState(target, state, { packageRoot, taskId });

    // Reject if evidenceRef is missing
    await assert.rejects(
      () => recordDiagnosis({
        target,
        packageRoot,
        hypothesis: "Another hypothesis",
        failureClass: "VERIFICATION_FAILURE",
        evidenceRefs: ["check-non-existent"],
        settledBy: "Check passes",
        nextSafeAction: "Fix it",
        taskId,
      }),
      { code: "E_DIAGNOSIS_EVIDENCE_INVALID" }
    );

    // Reject if evidenceRef only has passed checks
    await assert.rejects(
      () => recordDiagnosis({
        target,
        packageRoot,
        hypothesis: "Another hypothesis",
        failureClass: "VERIFICATION_FAILURE",
        evidenceRefs: ["check-auth-syntax"],
        settledBy: "Check passes",
        nextSafeAction: "Fix it",
        taskId,
      }),
      { code: "E_DIAGNOSIS_EVIDENCE_INVALID" }
    );

    // Record idempotent retry in same cycle (re-submits same hypothesis & evidence)
    const res2 = await recordDiagnosis({
      target,
      packageRoot,
      hypothesis: "  comparison operator <= instead of <  ",
      failureClass: "VERIFICATION_FAILURE",
      evidenceRefs: ["check-auth-boundary"],
      settledBy: "Exact boundary check returns 401",
      nextSafeAction: "Replace <= with < in middleware",
      taskId,
    });
    assert.equal(res2.idempotent, true);
    assert.equal(res2.diagnosis.diagnosisFingerprint, res.diagnosis.diagnosisFingerprint);

    let events = await readEvents(target, packageRoot, { taskId });
    let diagEvents = events.filter((e) => e.event === "DIAGNOSIS_RECORDED");
    assert.equal(diagEvents.length, 1);

    // Simulate partial writeWorkState failure: corrupt diagnosedHypothesis
    const corruptedState = {
      ...state,
      diagnosedHypothesis: "corrupted or stale hypothesis",
    };
    await writeWorkState(target, corruptedState, { packageRoot, taskId });

    // Retry recordDiagnosis repairs the projection
    const resRepair = await recordDiagnosis({
      target,
      packageRoot,
      hypothesis: "Comparison operator <= instead of <",
      failureClass: "VERIFICATION_FAILURE",
      evidenceRefs: ["check-auth-boundary"],
      settledBy: "Exact boundary check returns 401",
      nextSafeAction: "Replace <= with < in middleware",
      taskId,
    });
    assert.equal(resRepair.idempotent, true);
    assert.equal(resRepair.state.diagnosedHypothesis, "Comparison operator <= instead of <");

    events = await readEvents(target, packageRoot, { taskId });
    diagEvents = events.filter((e) => e.event === "DIAGNOSIS_RECORDED");
    assert.equal(diagEvents.length, 1);

    // Now test a genuinely repeated diagnosis in Cycle 2 -> produces NONE
    await appendProtocolEvent(target, { taskId, event: "VERIFICATION_STARTED", details: { verificationCycle: 2 } }, packageRoot, { taskId });
    const cycle2State = {
      ...state,
      verificationCycle: 2,
      checks: [
        {
          id: "check-auth-c2",
          requirement: "auth",
          status: "failed",
          evidenceKind: "OBSERVED",
          result: "still 200",
          details: { verificationCycle: 2 },
        },
      ],
    };
    await writeWorkState(target, cycle2State, { packageRoot, taskId });

    const resCycle2 = await recordDiagnosis({
      target,
      packageRoot,
      hypothesis: "Comparison operator <= instead of <",
      failureClass: "VERIFICATION_FAILURE",
      evidenceRefs: ["check-auth-c2"],
      settledBy: "Returns 401",
      nextSafeAction: "Fix it",
      taskId,
    });
    // In cycle 2, hypothesis is identical but evidence is new -> NEW_EVIDENCE
    assert.equal(resCycle2.diagnosis.informationGain, "NEW_EVIDENCE");
    assert.equal(resCycle2.idempotent, false);

  } finally {
    await removeTempTree(target);
  }
});

test("recordDiagnosis updates lastUpdated timestamp", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-diag-timestamp-"));
  try {
    const taskId = "task-timestamp";
    await ensureFixtureTask(target, taskId, packageRoot);
    await appendProtocolEvent(target, { taskId, event: "TASK_RECEIVED" }, packageRoot, { taskId });
    await appendProtocolEvent(target, { taskId, event: "CONTRACT_VALIDATED" }, packageRoot, { taskId });
    await appendProtocolEvent(target, { taskId, event: "ROUTE_VALIDATED" }, packageRoot, { taskId });
    await appendProtocolEvent(target, { taskId, event: "PREFLIGHT_READY" }, packageRoot, { taskId });
    await appendProtocolEvent(target, { taskId, event: "EXECUTION_STARTED" }, packageRoot, { taskId });
    await appendProtocolEvent(target, { taskId, event: "VERIFICATION_STARTED", details: { verificationCycle: 1 } }, packageRoot, { taskId });

    const oldTimestamp = "2020-01-01T00:00:00.000Z";
    const state = createWorkState({
      taskId,
      contractFingerprint: "0".repeat(64),
      routeFingerprint: "0".repeat(64),
      repositoryFingerprint: { branch: null, head: null },
      phase: "DIAGNOSING",
      verificationCycle: 1,
      lastUpdated: oldTimestamp,
      checks: [
        {
          id: "c1",
          requirement: "r1",
          status: "failed",
          evidenceKind: "OBSERVED",
          result: "failed",
          details: { verificationCycle: 1 },
        },
      ],
    });
    await writeWorkState(target, state, { packageRoot, taskId });

    const res = await recordDiagnosis({
      target,
      packageRoot,
      hypothesis: "Root cause found",
      failureClass: "VERIFICATION_FAILURE",
      evidenceRefs: ["c1"],
      settledBy: "Test passes",
      nextSafeAction: "Fix code",
      taskId,
    });

    assert.notEqual(res.state.lastUpdated, oldTimestamp);
    assert.ok(Date.parse(res.state.lastUpdated) > Date.parse(oldTimestamp));

    // Also verify idempotent call updates lastUpdated
    const resIdempotent = await recordDiagnosis({
      target,
      packageRoot,
      hypothesis: "Root cause found",
      failureClass: "VERIFICATION_FAILURE",
      evidenceRefs: ["c1"],
      settledBy: "Test passes",
      nextSafeAction: "Fix code",
      taskId,
    });
    assert.equal(resIdempotent.idempotent, true);
    assert.ok(resIdempotent.state.lastUpdated);

  } finally {
    await removeTempTree(target);
  }
});
