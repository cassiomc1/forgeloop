import { ensureFixtureTask } from "./helpers/native-storage-fixture.js";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { writeFile } from "node:fs/promises";
import { removeTempTree } from "./helpers/rm-safe.js";
import { runPreflight } from "../src/commands/preflight.js";
import { prepareCompletion } from "../src/core/completion-artifacts.js";
import { recordCheck } from "../src/core/completion-artifacts.js";

import { createContract, contractFingerprint, writeContract } from "../src/core/contract.js";
import { appendProtocolEvent, validateEventLedger, readEvents } from "../src/core/events.js";
import { advanceWorkState } from "../src/core/phase.js";
import { getNextAction, NEXT_ACTIONS } from "../src/core/next-action.js";
import { evaluateRoute } from "../src/core/router.js";
import { persistRoute } from "../src/core/route-artifact.js";
import { recordStructuredDiagnosticCase, recordIntervention } from "../src/core/diagnostic-record.js";
import { resolveCurrentCycleDiagnostic } from "../src/core/diagnostic-projection.js";
import { diagnosisFingerprint } from "../src/core/diagnosis-model.js";
import { getPackageRoot } from "../src/core/templates.js";
import { createWorkState, writeWorkState } from "../src/core/work-state.js";

const packageRoot = getPackageRoot();
const TASK_ID = "task-structured-lifecycle";

async function withTarget(run) {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-struct-diag-"));
  try {
    await run(target);
  } finally {
    await removeTempTree(target);
  }
}

async function setupToVerifyingThenFail(target) {
  await ensureFixtureTask(target, TASK_ID, packageRoot);
  const contract = createContract({
    taskId: TASK_ID,
    objective: "Exercise structured-diagnostic correction lifecycle",
    deliverables: ["src/app.js"],
    constraints: ["offline"],
    risks: [],
    verification: ["lint"],
    successCriteria: ["lint"],
    stopConditions: ["verification unavailable"],
    unresolvedDecisions: [],
    sourceRefs: [],
  });
  const contractHash = contractFingerprint(contract);
  await writeContract(target, contract, packageRoot, { taskId: TASK_ID });
  const route = evaluateRoute({ workType: "code", surfaces: ["config"], platforms: [] });
  const persistedRoute = await persistRoute(target, route, packageRoot, { contractFingerprint: contractHash, taskId: TASK_ID });
  const state = createWorkState({
    taskId: TASK_ID,
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
  await writeWorkState(target, state, { packageRoot, taskId: TASK_ID });
  await appendProtocolEvent(target, { taskId: TASK_ID, event: "CONTRACT_VALIDATED" }, packageRoot, { taskId: TASK_ID });
  await appendProtocolEvent(target, { taskId: TASK_ID, event: "ROUTE_VALIDATED" }, packageRoot, { taskId: TASK_ID });
  const preflight = await runPreflight({ target, packageRoot, taskId: TASK_ID });
  assert.equal(preflight.status, "READY");
  await advanceWorkState(target, "EXECUTING", { packageRoot, taskId: TASK_ID });
  await advanceWorkState(target, "VERIFYING", { packageRoot, taskId: TASK_ID });
  await prepareCompletion({ target, packageRoot, taskId: TASK_ID });
  await recordCheck({ kind: "manual-review",
    target,
    packageRoot,
    taskId: TASK_ID,
    id: "check-lint",
    requirement: "lint",
    status: "failed",
    evidenceKind: "OBSERVED",
    command: "npm run lint",
    result: "no-unused-vars in app.js",
    exitCode: 1,
  });
  await advanceWorkState(target, "DIAGNOSING", { packageRoot, taskId: TASK_ID });
}

function caseFileContent({ statement = "Unused import triggers lint rule.", revision } = {}) {
  const content = {
    schemaVersion: 1,
    failureClass: "VERIFICATION_FAILURE",
    observations: [
      { id: "obs-lint", kind: "CHECK_RESULT", evidenceRef: "check-lint", statement: "Lint reported no-unused-vars." },
    ],
    contributors: [
      { id: "c-import", type: "CODE", statement, basis: ["obs-lint"], status: "SUSPECTED" },
    ],
    hypotheses: [
      {
        id: "h-unused-import",
        statement,
        contributorRefs: ["c-import"],
        evidenceRefs: ["check-lint"],
        settledBy: { type: "CHECK_STATUS", checkId: "check-lint", expectedStatus: "passed" },
      },
    ],
    nextSafeAction: { statement: "Remove the unused import." },
  };
  if (revision > 1) content.diagnosticRevision = revision;
  return content;
}

test("C0/P0 safety net: structured-only diagnosis completes DIAGNOSING -> CORRECTING -> VERIFYING without legacy events", async () => {
  await withTarget(async (target) => {
    await setupToVerifyingThenFail(target);

    const filePath = path.join(target, "diagnostic-case.json");
    await writeFile(filePath, JSON.stringify(caseFileContent({})));
    const recorded = await recordStructuredDiagnosticCase({ target, packageRoot, taskId: TASK_ID, caseFile: "diagnostic-case.json" });
    assert.equal(recorded.event.event, "DIAGNOSTIC_CASE_RECORDED");

    const next = await getNextAction({ target, packageRoot, taskId: TASK_ID });
    assert.equal(next.nextAction, NEXT_ACTIONS.CORRECT);
    assert.ok(
      !next.reasons?.some((reason) => reason.code === "E_DIAGNOSIS_REQUIRED"),
      "next must not return E_DIAGNOSIS_REQUIRED when a valid structured case exists",
    );

    const correcting = await advanceWorkState(target, "CORRECTING", { packageRoot, taskId: TASK_ID });
    assert.equal(correcting.phase, "CORRECTING");
    assert.equal(correcting.diagnosedHypothesis, "Unused import triggers lint rule.");

    await recordIntervention({
      target,
      packageRoot,
    taskId: TASK_ID,
      interventionInput: { id: "int-remove-import", kind: "CODE_CHANGE", reversible: true, hypothesisRefs: ["h-unused-import"], statement: "Remove unused import." },
    });

    const verifying = await advanceWorkState(target, "VERIFYING", { packageRoot, taskId: TASK_ID });
    assert.equal(verifying.phase, "VERIFYING");

    const ledger = await validateEventLedger(target, packageRoot, { taskId: TASK_ID });
    assert.equal(ledger.valid, true);
    assert.ok(
      !ledger.events.some((event) => event.event === "DIAGNOSIS_RECORDED"),
      "no legacy DIAGNOSIS_RECORDED event may be synthesized",
    );
    assert.ok(ledger.events.some((event) => event.event === "DIAGNOSTIC_CASE_RECORDED"));
  });
});

test("C0/P0 safety net: resolver prefers latest valid structured case over legacy in the same cycle", async () => {
  await withTarget(async (target) => {
    await setupToVerifyingThenFail(target);
    assert.equal(resolveCurrentCycleDiagnostic([], TASK_ID, 1), null);

    const legacyDetails = {
      verificationCycle: 1,
      failureClass: "VERIFICATION_FAILURE",
      hypothesis: "legacy flaky runner",
      evidenceRefs: ["check-lint"],
      settledBy: "rerun passes",
      nextSafeAction: "rerun",
      previousDiagnosisFingerprint: null,
    };
    await appendProtocolEvent(target, {
      taskId: TASK_ID,
      event: "DIAGNOSIS_RECORDED",
      details: {
        ...legacyDetails,
        diagnosisFingerprint: diagnosisFingerprint(legacyDetails),
        informationGain: "FIRST_DIAGNOSIS",
      },
    }, packageRoot, { taskId: TASK_ID });

    const legacyResolved = resolveCurrentCycleDiagnostic(await readEvents(target, packageRoot, { taskId: TASK_ID }), TASK_ID, 1);
    assert.equal(legacyResolved.sourceModel, "LEGACY_DIAGNOSIS_V1");

    await writeFile(path.join(target, "case.json"), JSON.stringify(caseFileContent({ statement: "Structured runner hypothesis." })));
    await recordStructuredDiagnosticCase({ target, packageRoot, taskId: TASK_ID, caseFile: "case.json" });

    const events = await readEvents(target, packageRoot, { taskId: TASK_ID });
    const resolved = resolveCurrentCycleDiagnostic(events, TASK_ID, 1);
    assert.equal(resolved.sourceModel, "STRUCTURED_DIAGNOSTIC_CASE_V1");
    assert.equal(resolved.diagnosticCase.hypotheses[0].statement, "Structured runner hypothesis.");
  });
});
