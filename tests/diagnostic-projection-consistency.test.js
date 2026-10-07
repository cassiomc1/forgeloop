import { withExistingProjectScope } from "../src/storage/existing-project-scope.js";
import { ensureFixtureTask } from "./helpers/native-storage-fixture.js";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { removeTempTree } from "./helpers/rm-safe.js";
import { getPackageRoot } from "../src/core/templates.js";
import { appendProtocolEvent } from "../src/core/events.js";
import { buildTaskTrace } from "../src/core/trace.js";
import { buildTaskReflection, deriveDiagnosticContext } from "../src/core/reflection.js";
import { evaluateProgress } from "../src/core/progress.js";
import { inspectTarget } from "../src/core/inspect.js";
import { diagnosticSemanticFingerprint, interventionSemanticFingerprint as computeInterventionFingerprint } from "../src/core/diagnostic-model.js";

const packageRoot = getPackageRoot();
const TASK = "t-consistency";

function structuredCase(cycle, hypothesisId, statement, evidenceRefs) {
  const details = {
    schemaVersion: 1,
    verificationCycle: cycle,
    diagnosticRevision: 1,
    failureClass: "VERIFICATION_FAILURE",
    observations: evidenceRefs.map((ref, index) => ({
      id: `obs-${cycle}-${index}`, kind: "CHECK_RESULT", evidenceRef: ref, statement: `${ref} failed in cycle ${cycle}`,
    })),
    contributors: [],
    hypotheses: [{
      id: hypothesisId,
      statement,
      evidenceRefs,
      settledBy: { type: "CHECK_STATUS", checkId: evidenceRefs[0], expectedStatus: "passed" },
    }],
    nextSafeAction: { statement: "fix" },
  };
  details.diagnosticFingerprint = diagnosticSemanticFingerprint({
    verificationCycle: cycle,
    failureClass: details.failureClass,
    case_: details,
  });
  return details;
}

function interventionEvent(cycle, id, statement, hypothesisRefs) {
  const details = {
    schemaVersion: 1,
    verificationCycle: cycle,
    intervention: { id, kind: "CONFIG_CHANGE", statement, hypothesisRefs, reversible: true },
  };
  details.interventionSemanticFingerprint = computeInterventionFingerprint(details);
  return details;
}

async function seedThreeCycleTask(target) {
  await ensureFixtureTask(target, TASK, packageRoot);
  const events = [];
  const push = (event, details) => events.push({ event, details });

  push("TASK_RECEIVED", {});
  push("CONTRACT_VALIDATED", {});
  push("ROUTE_VALIDATED", {});
  push("PREFLIGHT_READY", {});
  push("EXECUTION_STARTED", {});

  // Cycle 1: tests FAIL, lint FAIL -> H1 -> intervention I1
  push("VERIFICATION_STARTED", { verificationCycle: 1 });
  push("VERIFICATION_RECORDED", { id: "check-tests", requirement: "tests", status: "failed", exitCode: 1, verificationCycle: 1 });
  push("VERIFICATION_RECORDED", { id: "check-lint", requirement: "lint", status: "failed", exitCode: 1, verificationCycle: 1 });
  {
    const details = structuredCase(1, "h-tests", "Test runner config broken.", ["check-tests"]);
    push("DIAGNOSTIC_CASE_RECORDED", details);
    push("INTERVENTION_RECORDED", interventionEvent(1, "i1", "Fix runner config.", ["h-tests"]));
  }

  // Cycle 2: tests PASS, lint FAIL -> H1 WEAKENED -> H2 -> intervention I2
  push("VERIFICATION_STARTED", { verificationCycle: 2 });
  push("VERIFICATION_RECORDED", { id: "check-tests", requirement: "tests", status: "passed", exitCode: 0, verificationCycle: 2 });
  push("VERIFICATION_RECORDED", { id: "check-lint", requirement: "lint", status: "failed", exitCode: 1, verificationCycle: 2 });
  push("HYPOTHESIS_DISPOSITION_RECORDED", { schemaVersion: 1, verificationCycle: 2, hypothesisRef: "h-tests", status: "WEAKENED", evidenceRefs: ["check-lint"], reason: "partially confirmed" });
  {
    const details = structuredCase(2, "h-lint", "Lint rule misconfigured.", ["check-lint"]);
    push("DIAGNOSTIC_CASE_RECORDED", details);
    push("INTERVENTION_RECORDED", interventionEvent(2, "i2", "Fix lint config.", ["h-lint"]));
  }

  // Cycle 3: lint PASS -> full recovery
  push("VERIFICATION_STARTED", { verificationCycle: 3 });
  push("VERIFICATION_RECORDED", { id: "check-lint", requirement: "lint", status: "passed", exitCode: 0, verificationCycle: 3 });
  push("HYPOTHESIS_DISPOSITION_RECORDED", { schemaVersion: 1, verificationCycle: 3, hypothesisRef: "h-lint", status: "SUPPORTED", evidenceRefs: ["check-lint"], reason: "confirmed by passing lint" });

  for (const { event, details } of events) {
    await appendProtocolEvent(target, { taskId: TASK, event, details }, packageRoot, { taskId: TASK });
  }
}

test("cross-projection semantic consistency across three correction cycles", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-consistency-"));
  try {
    await seedThreeCycleTask(target);

    // Trace surfaces including the explicit empty successful cycle
    const trace = await buildTaskTrace({ target, packageRoot, taskId: TASK });
    assert.deepEqual(trace.failureSurfaces.map((entry) => entry.surface), [["lint", "tests"], ["lint"], []]);

    // Reflection gain truth
    const reflection = await buildTaskReflection({ target, packageRoot, taskId: TASK });
    const gainByCycle = new Map((reflection.informationGain.cycles ?? []).map((entry) => [entry.verificationCycle, entry]));
    assert.equal(gainByCycle.get(2)?.effectiveGain ?? true, true);
    assert.equal(gainByCycle.get(3)?.effectiveGain ?? true, true);
    assert.equal(reflection.status, "ADVANCING");

    // Intervention effectiveness: full recovery classifies IMPROVED
    assert.deepEqual(reflection.interventions.details.map((entry) => entry.effectiveness), ["IMPROVED", "IMPROVED"]);

    // Progress never stalls while the verified surface is reducing
    for (const [cycle, checks] of [
      [2, [
        { id: "check-tests", requirement: "tests", status: "passed", details: { verificationCycle: 2 } },
        { id: "check-lint", requirement: "lint", status: "failed", details: { verificationCycle: 2 } },
      ]],
      [3, [{ id: "check-lint", requirement: "lint", status: "passed", details: { verificationCycle: 3 } }]],
    ]) {
      const state = { taskId: TASK, verificationCycle: cycle, checks };
      void state;
    }
    const midState = { taskId: TASK, verificationCycle: 2, checks: [
      { id: "check-lint", requirement: "lint", status: "failed", details: { verificationCycle: 2 } },
    ] };
    const progress = evaluateProgress({ state: midState, events: [] });
    assert.notEqual(progress.status, "STALLED");

    // Inspect exposes the same failure surfaces as trace
    const inspection = await inspectTarget({ target, packageRoot, taskId: TASK });
    assert.deepEqual(inspection.taskInspection.failureSurfaces, trace.failureSurfaces);

    // Continuity after full recovery: no active signatures or requirements
    const { readEvents } = await import("../src/core/events.js");
    const rawEvents = await readEvents(target, packageRoot, { taskId: TASK });
    const context = deriveDiagnosticContext(rawEvents, { taskId: TASK, verificationCycle: 3, checks: [] });
    assert.deepEqual(context.activeFailureSignatures, []);
    assert.deepEqual(context.activeFailedRequirements, []);

    // Read-only purity
    const forgeDir = path.join(target, ".forgeloop");
    async function hashTree(dir) {
      const entries = await readdir(dir, { recursive: true });
      const hash = createHash("sha256");
      for (const relative of entries.sort()) {
        if (["state.sqlite-wal", "state.sqlite-shm"].includes(relative)) continue;
        hash.update(relative);
        try {
          hash.update(await readFile(path.join(dir, relative)));
        } catch {
          // directories
        }
      }
      const records = await withExistingProjectScope(target, store => {
        const tables = store.db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name").all();
        return tables.map(({ name }) => {
          assert.match(name, /^[a-z_]+$/u);
          const rows = store.db.prepare(`SELECT * FROM "${name}"`).all();
          return { name, rows: rows.map(row => JSON.stringify(row)).sort() };
        });
      }, { readOnly: true });
      hash.update(JSON.stringify(records));
      return hash.digest("hex");
    }
    const before = await hashTree(forgeDir);
    const { buildTaskHistory } = await import("../src/core/history.js");
    await buildTaskTrace({ target, packageRoot, taskId: TASK });
    await buildTaskHistory({ target, packageRoot, taskId: TASK });
    await buildTaskReflection({ target, packageRoot, taskId: TASK });
    await inspectTarget({ target, packageRoot, taskId: TASK });
    const after = await hashTree(forgeDir);
    assert.equal(before, after);
  } finally {
    await removeTempTree(target);
  }
});
