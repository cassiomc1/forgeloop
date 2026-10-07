import { ensureFixtureTask } from "./helpers/native-storage-fixture.js";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { writeFile } from "node:fs/promises";
import { removeTempTree } from "./helpers/rm-safe.js";
import { getPackageRoot } from "../src/core/templates.js";
import { createWorkState, writeWorkState } from "../src/core/work-state.js";
import { appendProtocolEvent, validateEventLedger } from "../src/core/events.js";
import { recordStructuredDiagnosticCase, recordIntervention, recordHypothesisDisposition } from "../src/core/diagnostic-record.js";

const packageRoot = getPackageRoot();

async function seedDiagnosingTask({ target, cycle = 1 }) {
  const taskId = "task-structured-diag";
  await ensureFixtureTask(target, taskId, packageRoot);
  await appendProtocolEvent(target, { taskId, event: "TASK_RECEIVED" }, packageRoot, { taskId });
  await appendProtocolEvent(target, { taskId, event: "CONTRACT_VALIDATED" }, packageRoot, { taskId });
  await appendProtocolEvent(target, { taskId, event: "ROUTE_VALIDATED" }, packageRoot, { taskId });
  await appendProtocolEvent(target, { taskId, event: "PREFLIGHT_READY" }, packageRoot, { taskId });
  await appendProtocolEvent(target, { taskId, event: "EXECUTION_STARTED" }, packageRoot, { taskId });
  await appendProtocolEvent(target, {
    taskId,
    event: "VERIFICATION_STARTED",
    details: { verificationCycle: cycle },
  }, packageRoot, { taskId });

  const state = createWorkState({
    taskId,
    contractFingerprint: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    routeFingerprint: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    repositoryFingerprint: { branch: null, head: null },
    phase: "DIAGNOSING",
    completedSteps: ["contract", "route", "implementation"],
    pendingSteps: ["verification"],
    verificationCycle: cycle,
    checks: [
      {
        id: "check-lint",
        requirement: "lint",
        status: "failed",
        evidenceKind: "OBSERVED",
        result: "no-unused-vars",
        details: { verificationCycle: cycle },
      },
    ],
  });
  await writeWorkState(target, state, { packageRoot, taskId });
  return { taskId, state };
}

function caseFileContent({ revision = 1, previousFingerprint = null, statement = "Unused import triggers lint rule." }) {
  const content = {
    schemaVersion: 1,
    failureClass: "VERIFICATION_FAILURE",
    observations: [
      { id: "obs-lint", kind: "CHECK_RESULT", evidenceRef: "check-lint", statement: "Lint reported no-unused-vars." },
    ],
    contributors: [
      { id: "c-import", type: "CODE", statement: statement, basis: ["obs-lint"], status: "SUSPECTED" },
    ],
    hypotheses: [
      {
        id: "h-unused-import",
        statement: statement,
        contributorRefs: ["c-import"],
        evidenceRefs: ["check-lint"],
        settledBy: { type: "CHECK_STATUS", checkId: "check-lint", expectedStatus: "passed" },
      },
    ],
    nextSafeAction: { statement: "Remove the unused import." },
  };
  if (revision > 1) {
    content.diagnosticRevision = revision;
    if (previousFingerprint) content.previousDiagnosticFingerprint = previousFingerprint;
  }
  return content;
}

test("structured diagnostic case records with fingerprint and idempotent re-record", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-diag-case-"));
  try {
    const { taskId } = await seedDiagnosingTask({ target });
    const filePath = path.join(target, "diagnostic-case.json");
    await writeFile(filePath, JSON.stringify(caseFileContent({})));

    const first = await recordStructuredDiagnosticCase({ target, packageRoot, caseFile: "diagnostic-case.json", taskId });
    assert.equal(first.event.event, "DIAGNOSTIC_CASE_RECORDED");
    assert.equal(first.diagnosticCase.diagnosticRevision, 1);
    assert.equal(first.idempotent, false);

    const ledger = await validateEventLedger(target, packageRoot, { taskId });
    assert.equal(ledger.valid, true);

    // Same semantic content is idempotent even under a different file name.
    await writeFile(path.join(target, "case-copy.json"), JSON.stringify(caseFileContent({})));
    const second = await recordStructuredDiagnosticCase({ target, packageRoot, caseFile: "case-copy.json", taskId });
    assert.equal(second.idempotent, true);
    assert.equal(second.event.seq, first.event.seq);

    const ledgerAfter = await validateEventLedger(target, packageRoot, { taskId });
    assert.equal(ledgerAfter.valid, true);
    assert.equal(
      ledgerAfter.events.filter((event) => event.event === "DIAGNOSTIC_CASE_RECORDED").length,
      1,
    );
  } finally {
    await removeTempTree(target);
  }
});

test("cycle mismatch and unknown evidence refs fail closed", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-diag-cycle-"));
  try {
    const { taskId } = await seedDiagnosingTask({ target });

    const wrongCycle = caseFileContent({});
    wrongCycle.verificationCycle = 7;
    await writeFile(path.join(target, "wrong-cycle.json"), JSON.stringify(wrongCycle));
    await assert.rejects(
      () => recordStructuredDiagnosticCase({ target, packageRoot, caseFile: "wrong-cycle.json", taskId }),
      { code: "E_DIAGNOSTIC_CASE_CYCLE_MISMATCH" },
    );

    const badEvidence = caseFileContent({});
    badEvidence.hypotheses[0].evidenceRefs = ["nonexistent-check"];
    await writeFile(path.join(target, "bad-evidence.json"), JSON.stringify(badEvidence));
    await assert.rejects(
      () => recordStructuredDiagnosticCase({ target, packageRoot, caseFile: "bad-evidence.json", taskId }),
      { code: "E_DIAGNOSTIC_CASE_EVIDENCE_INVALID" },
    );
  } finally {
    await removeTempTree(target);
  }
});

test("intervention requires CORRECTING phase, known hypothesis, and detects repetition", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-intervention-"));
  try {
    const { taskId } = await seedDiagnosingTask({ target });
    const casePath = path.join(target, "case.json");
    await writeFile(casePath, JSON.stringify(caseFileContent({})));
    await recordStructuredDiagnosticCase({ target, packageRoot, caseFile: "case.json", taskId });

    const interventionInput = {
      schemaVersion: 1,
      id: "i-remove-import",
      kind: "CODE_CHANGE",
      statement: "Remove the unused import.",
      hypothesisRefs: ["h-unused-import"],
      reversible: true,
    };

    await assert.rejects(
      () => recordIntervention({ target, packageRoot, interventionInput, taskId }),
      { code: "E_PHASE_PREREQUISITE_MISSING" },
    );

    const { readWorkState, mutateWorkState } = await import("../src/core/work-state.js");
    const diagnosing = await readWorkState(target, { packageRoot, taskId });
    await mutateWorkState(target, { expectedRevision: diagnosing.revision ?? 0, packageRoot, taskId }, () => ({
      ...diagnosing,
      phase: "CORRECTING",
    }));

    const unknownHypothesis = { ...interventionInput, hypothesisRefs: ["h-unknown"] };
    await assert.rejects(
      () => recordIntervention({ target, packageRoot, interventionInput: unknownHypothesis, taskId }),
      { code: "E_INTERVENTION_REFERENCE_INVALID" },
    );

    const first = await recordIntervention({ target, packageRoot, interventionInput, taskId });
    assert.equal(first.event.event, "INTERVENTION_RECORDED");
    assert.equal(first.repeatedSemanticIntervention, false);

    const second = await recordIntervention({
      target,
      packageRoot,
      interventionInput: { ...interventionInput, id: "i-different-id" },
      taskId,
    });
    assert.equal(second.repeatedSemanticIntervention, true);

    const ledger = await validateEventLedger(target, packageRoot, { taskId });
    assert.equal(ledger.valid, true);
  } finally {
    await removeTempTree(target);
  }
});

test("hypothesis disposition validates chronology, transitions, and evidence", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-disposition-"));
  try {
    const { taskId } = await seedDiagnosingTask({ target });
    const casePath = path.join(target, "case.json");
    await writeFile(casePath, JSON.stringify(caseFileContent({})));
    await recordStructuredDiagnosticCase({ target, packageRoot, caseFile: "case.json", taskId });

    await assert.rejects(
      () => recordHypothesisDisposition({
        target,
        packageRoot,
        hypothesisRef: "h-unknown",
        status: "SUPPORTED",
        evidenceRefs: ["check-lint"],
        reason: "Evidence supports it.",
        taskId,
      }),
      { code: "E_HYPOTHESIS_DISPOSITION_INVALID" },
    );

    await assert.rejects(
      () => recordHypothesisDisposition({
        target,
        packageRoot,
        hypothesisRef: "h-unused-import",
        status: "SUPPORTED",
        evidenceRefs: ["missing-check"],
        reason: "Bad evidence.",
        taskId,
      }),
      { code: "E_HYPOTHESIS_DISPOSITION_EVIDENCE_INVALID" },
    );

    const disposition = await recordHypothesisDisposition({
      target,
      packageRoot,
      hypothesisRef: "h-unused-import",
      status: "SUPPORTED",
      evidenceRefs: ["check-lint"],
      reason: "Removing the import makes lint pass locally.",
      taskId,
    });
    assert.equal(disposition.event.event, "HYPOTHESIS_DISPOSITION_RECORDED");
    assert.equal(disposition.disposition.status, "SUPPORTED");

    const ledger = await validateEventLedger(target, packageRoot, { taskId });
    assert.equal(ledger.valid, true);
  } finally {
    await removeTempTree(target);
  }
});
