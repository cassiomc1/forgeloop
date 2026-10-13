import test from "node:test";
import assert from "node:assert/strict";
import {
  PROGRESS_STATUS,
  PROGRESS_SIGNAL,
  evaluateProgress as projectProgress,
} from "../src/core/progress.js";
import { decodedLedgerSource } from "./helpers/ledger-event-collection.js";

function evaluateProgress(input) {
  const expected = projectProgress(structuredClone(input));
  assert.deepEqual(projectProgress({ ...structuredClone(input), events: decodedLedgerSource(input.events ?? []) }), expected);
  return expected;
}

test("evaluateProgress - one failed cycle -> ADVANCING", () => {
  const state = {
    taskId: "task-1",
    verificationCycle: 1,
    checks: [
      { id: "c1", requirement: "tests", status: "failed", details: { verificationCycle: 1 } },
    ],
  };
  const events = [
    {
      taskId: "task-1",
      event: "DIAGNOSIS_RECORDED",
      details: {
        verificationCycle: 1,
        hypothesis: "Hypothesis A",
        evidenceRefs: ["c1"],
        informationGain: "FIRST_DIAGNOSIS",
      },
    },
  ];
  const progress = evaluateProgress({ state, events });
  assert.equal(progress.status, PROGRESS_STATUS.ADVANCING);
  assert.equal(progress.signals.length, 0);
});

test("evaluateProgress - two failures same requirement + new diagnosis -> ADVANCING", () => {
  const state = {
    taskId: "task-1",
    verificationCycle: 2,
    checks: [
      { id: "c1", requirement: "tests", status: "failed", details: { verificationCycle: 1 } },
      { id: "c2", requirement: "tests", status: "failed", details: { verificationCycle: 2 } },
    ],
  };
  const events = [
    {
      taskId: "task-1",
      event: "DIAGNOSIS_RECORDED",
      details: {
        verificationCycle: 1,
        hypothesis: "Hypothesis A",
        evidenceRefs: ["c1"],
        informationGain: "FIRST_DIAGNOSIS",
      },
    },
    {
      taskId: "task-1",
      event: "DIAGNOSIS_RECORDED",
      details: {
        verificationCycle: 2,
        hypothesis: "Hypothesis B",
        evidenceRefs: ["c2"],
        informationGain: "NEW_HYPOTHESIS_AND_EVIDENCE",
      },
    },
  ];
  const progress = evaluateProgress({ state, events });
  assert.equal(progress.status, PROGRESS_STATUS.ADVANCING);
  assert.equal(progress.signals.length, 0);
});

test("evaluateProgress - three failures same requirement + new evidence -> WATCH", () => {
  const state = {
    taskId: "task-1",
    verificationCycle: 3,
    checks: [
      { id: "c1", requirement: "tests", status: "failed", details: { verificationCycle: 1 } },
      { id: "c2", requirement: "tests", status: "failed", details: { verificationCycle: 2 } },
      { id: "c3", requirement: "tests", status: "failed", details: { verificationCycle: 3 } },
    ],
  };
  const events = [
    {
      taskId: "task-1",
      event: "DIAGNOSIS_RECORDED",
      details: {
        verificationCycle: 3,
        hypothesis: "Hypothesis C",
        evidenceRefs: ["c3"],
        informationGain: "NEW_HYPOTHESIS_AND_EVIDENCE",
      },
    },
  ];
  const progress = evaluateProgress({ state, events });
  assert.equal(progress.status, PROGRESS_STATUS.WATCH);
  assert.equal(progress.signals.length, 1);
  assert.equal(progress.signals[0].code, PROGRESS_SIGNAL.REPEATED_FAILED_REQUIREMENT);
  assert.deepEqual(progress.signals[0].verificationCycles, [1, 2, 3]);
});

test("evaluateProgress - latest diagnosis informationGain NONE -> STALLED", () => {
  const state = {
    taskId: "task-1",
    verificationCycle: 2,
    checks: [
      { id: "c1", requirement: "tests", status: "failed", details: { verificationCycle: 2 } },
    ],
  };
  const events = [
    {
      taskId: "task-1",
      event: "DIAGNOSIS_RECORDED",
      details: {
        verificationCycle: 2,
        hypothesis: "Repeated hypothesis",
        evidenceRefs: ["c1"],
        informationGain: "NONE",
      },
    },
  ];
  const progress = evaluateProgress({ state, events });
  assert.equal(progress.status, PROGRESS_STATUS.STALLED);
  assert.equal(progress.signals.some((s) => s.code === PROGRESS_SIGNAL.NO_DIAGNOSTIC_INFORMATION_GAIN), true);
});

test("evaluateProgress - three failures same requirement + repeated diagnosis -> STALLED", () => {
  const state = {
    taskId: "task-1",
    verificationCycle: 3,
    checks: [
      { id: "c1", requirement: "tests", status: "failed", details: { verificationCycle: 1 } },
      { id: "c2", requirement: "tests", status: "failed", details: { verificationCycle: 2 } },
      { id: "c3", requirement: "tests", status: "failed", details: { verificationCycle: 3 } },
    ],
  };
  const events = [
    {
      taskId: "task-1",
      event: "DIAGNOSIS_RECORDED",
      details: {
        verificationCycle: 3,
        hypothesis: "Hypothesis A",
        evidenceRefs: ["c3"],
        informationGain: "NONE",
      },
    },
  ];
  const progress = evaluateProgress({ state, events });
  assert.equal(progress.status, PROGRESS_STATUS.STALLED);
  assert.equal(progress.signals.some((s) => s.code === PROGRESS_SIGNAL.REPEATED_FAILURE_WITH_SAME_DIAGNOSIS), true);
});

test("evaluateProgress - four cycles with changing evidence -> WATCH, never STALLED", () => {
  const state = {
    taskId: "task-1",
    verificationCycle: 4,
    checks: [
      { id: "c1", requirement: "req1", status: "failed", details: { verificationCycle: 1 } },
      { id: "c2", requirement: "req2", status: "failed", details: { verificationCycle: 2 } },
      { id: "c3", requirement: "req3", status: "failed", details: { verificationCycle: 3 } },
      { id: "c4", requirement: "req4", status: "failed", details: { verificationCycle: 4 } },
    ],
  };
  const events = [
    {
      taskId: "task-1",
      event: "DIAGNOSIS_RECORDED",
      details: {
        verificationCycle: 4,
        hypothesis: "Different hypothesis",
        evidenceRefs: ["c4"],
        informationGain: "NEW_HYPOTHESIS_AND_EVIDENCE",
      },
    },
  ];
  const progress = evaluateProgress({ state, events });
  assert.equal(progress.status, PROGRESS_STATUS.WATCH);
  assert.equal(progress.signals.some((s) => s.code === PROGRESS_SIGNAL.HIGH_CORRECTION_CYCLE_COUNT), true);
  assert.equal(progress.signals.some((s) => s.severity === "BLOCKING_FOR_RETRY"), false);
});

test("evaluateProgress - requirement A failed 3 cycles, but latest NONE diagnosis belongs to B -> no false A repeated-diagnosis signal", () => {
  const state = {
    taskId: "task-1",
    verificationCycle: 4,
    checks: [
      { id: "c1", requirement: "reqA", status: "failed", details: { verificationCycle: 1 } },
      { id: "c2", requirement: "reqA", status: "failed", details: { verificationCycle: 2 } },
      { id: "c3", requirement: "reqA", status: "failed", details: { verificationCycle: 3 } },
      { id: "c4", requirement: "reqB", status: "failed", details: { verificationCycle: 4 } },
    ],
  };
  const events = [
    {
      taskId: "task-1",
      event: "DIAGNOSIS_RECORDED",
      details: {
        verificationCycle: 4,
        hypothesis: "Repeated hypothesis for B",
        evidenceRefs: ["c4"],
        informationGain: "NONE",
      },
    },
  ];
  const progress = evaluateProgress({ state, events });
  // Global status is STALLED due to latest diagnosis informationGain === NONE
  assert.equal(progress.status, PROGRESS_STATUS.STALLED);
  assert.equal(progress.signals.some((s) => s.code === PROGRESS_SIGNAL.NO_DIAGNOSTIC_INFORMATION_GAIN), true);

  // Requirement A has 3 failed cycles -> REPEATED_FAILED_REQUIREMENT, but NOT REPEATED_FAILURE_WITH_SAME_DIAGNOSIS
  const signalA = progress.signals.find((s) => s.requirement === "reqA");
  assert.ok(signalA);
  assert.equal(signalA.code, PROGRESS_SIGNAL.REPEATED_FAILED_REQUIREMENT);
  assert.equal(progress.signals.some((s) => s.code === PROGRESS_SIGNAL.REPEATED_FAILURE_WITH_SAME_DIAGNOSIS && s.requirement === "reqA"), false);
});

test("evaluateProgress - requirement A failed 3 cycles and latest NONE diagnosis belongs to A -> REPEATED_FAILURE_WITH_SAME_DIAGNOSIS for A", () => {
  const state = {
    taskId: "task-1",
    verificationCycle: 3,
    checks: [
      { id: "c1", requirement: "reqA", status: "failed", details: { verificationCycle: 1 } },
      { id: "c2", requirement: "reqA", status: "failed", details: { verificationCycle: 2 } },
      { id: "c3", requirement: "reqA", status: "failed", details: { verificationCycle: 3 } },
    ],
  };
  const events = [
    {
      taskId: "task-1",
      event: "DIAGNOSIS_RECORDED",
      details: {
        verificationCycle: 3,
        hypothesis: "Repeated hypothesis for A",
        evidenceRefs: ["c3"],
        informationGain: "NONE",
      },
    },
  ];
  const progress = evaluateProgress({ state, events });
  assert.equal(progress.status, PROGRESS_STATUS.STALLED);
  assert.equal(progress.signals.some((s) => s.code === PROGRESS_SIGNAL.REPEATED_FAILURE_WITH_SAME_DIAGNOSIS && s.requirement === "reqA"), true);
});
