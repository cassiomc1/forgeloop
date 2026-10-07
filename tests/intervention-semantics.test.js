import { ensureFixtureTask } from "./helpers/native-storage-fixture.js";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { removeTempTree } from "./helpers/rm-safe.js";
import { getPackageRoot } from "../src/core/templates.js";
import { createWorkState, writeWorkState } from "../src/core/work-state.js";
import { appendProtocolEvent } from "../src/core/events.js";
import { recordIntervention } from "../src/core/diagnostic-record.js";
import { diagnosticSemanticFingerprint } from "../src/core/diagnostic-model.js";

const packageRoot = getPackageRoot();
const TASK = "t-intervention-semantics";

async function seedCorrectingTask(target) {
  await ensureFixtureTask(target, TASK, packageRoot);
  for (const milestone of ["TASK_RECEIVED", "CONTRACT_VALIDATED", "ROUTE_VALIDATED", "PREFLIGHT_READY", "EXECUTION_STARTED"]) {
    await appendProtocolEvent(target, { taskId: TASK, event: milestone }, packageRoot, { taskId: TASK });
  }
  await appendProtocolEvent(target, {
    taskId: TASK,
    event: "VERIFICATION_STARTED",
    details: { verificationCycle: 1 },
  }, packageRoot, { taskId: TASK });
  const caseDetails = {
    schemaVersion: 1,
    verificationCycle: 1,
    diagnosticRevision: 1,
    failureClass: "VERIFICATION_FAILURE",
    observations: [{ id: "obs-1", kind: "CHECK_RESULT", evidenceRef: "check-tests", statement: "tests failed" }],
    contributors: [{ id: "c-1", type: "CODE", statement: "module X broken", basis: ["obs-1"], status: "SUSPECTED" }],
    hypotheses: [{ id: "h-x", statement: "Module X breaks the flow.", evidenceRefs: ["check-tests"], settledBy: { type: "CHECK_STATUS", checkId: "check-tests", expectedStatus: "passed" } }],
    nextSafeAction: { statement: "Fix module X." },
  };
  caseDetails.diagnosticFingerprint = diagnosticSemanticFingerprint({
    verificationCycle: 1,
    failureClass: "VERIFICATION_FAILURE",
    case_: caseDetails,
  });
  await appendProtocolEvent(target, {
    taskId: TASK,
    event: "VERIFICATION_RECORDED",
    details: { id: "check-tests", requirement: "tests", status: "failed", verificationCycle: 1 },
  }, packageRoot, { taskId: TASK });
  await appendProtocolEvent(target, {
    taskId: TASK,
    event: "DIAGNOSTIC_CASE_RECORDED",
    details: caseDetails,
  }, packageRoot, { taskId: TASK });
  const state = createWorkState({
    taskId: TASK,
    contractFingerprint: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    routeFingerprint: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    repositoryFingerprint: { branch: null, head: null },
    phase: "CORRECTING",
    diagnosedHypothesis: "Module X breaks the flow.",
    completedSteps: ["contract", "route", "implementation"],
    pendingSteps: ["verification"],
    verificationCycle: 1,
    checks: [{ id: "check-tests", requirement: "tests", status: "failed", evidenceKind: "OBSERVED", details: { verificationCycle: 1 } }],
  });
  await writeWorkState(target, state, { packageRoot, taskId: TASK });
}

test("repeated semantic intervention reports repetition without effectiveness overclaim", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-int-sem-"));
  try {
    await seedCorrectingTask(target);
    const input = { id: "i-1", kind: "CODE_CHANGE", reversible: true, hypothesisRefs: ["h-x"], statement: "Remove module X usage." };
    const first = await recordIntervention({ target, packageRoot, interventionInput: input, taskId: TASK });
    assert.equal(first.repeatedSemanticIntervention, false);
    assert.equal(first.effectiveness, "PENDING");
    assert.equal(first.repeatedWithoutGain, undefined);

    const second = await recordIntervention({ target, packageRoot, interventionInput: { ...input, id: "i-2" }, taskId: TASK });
    assert.equal(second.repeatedSemanticIntervention, true);
    assert.equal(second.effectiveness, "PENDING", "effectiveness stays pending until later verification");
    assert.equal(second.repeatedWithoutGain, undefined, "no retrospective ineffectiveness claim may exist");
  } finally {
    await removeTempTree(target);
  }
});
