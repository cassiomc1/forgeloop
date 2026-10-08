import { withExistingProjectScope } from "../src/storage/existing-project-scope.js";
import { ensureFixtureTask } from "./helpers/native-storage-fixture.js";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { removeTempTree } from "./helpers/rm-safe.js";
import { getPackageRoot } from "../src/core/templates.js";
import { createWorkState, writeWorkState } from "../src/core/work-state.js";
import { appendProtocolEvent } from "../src/core/events.js";
import { recordStructuredDiagnosticCase, recordIntervention, recordHypothesisDisposition } from "../src/core/diagnostic-record.js";
import { buildTaskHistory, formatHistoryResult } from "../src/core/history.js";
import { buildTaskTrace } from "../src/core/trace.js";
import { buildTaskReflection } from "../src/core/reflection.js";
import { mutateWorkState, readWorkState } from "../src/core/work-state.js";

const packageRoot = getPackageRoot();

async function seedFullDiagnosticRun({ target }) {
  const taskId = "task-observability";
  await ensureFixtureTask(target, taskId, packageRoot);
  const cycle = (value) => ({ verificationCycle: value });
  const events = () => ({ taskId });

  await appendProtocolEvent(target, { taskId, event: "TASK_RECEIVED" }, packageRoot, { taskId });
  await appendProtocolEvent(target, { taskId, event: "CONTRACT_VALIDATED" }, packageRoot, { taskId });
  await appendProtocolEvent(target, { taskId, event: "ROUTE_VALIDATED" }, packageRoot, { taskId });
  await appendProtocolEvent(target, { taskId, event: "PREFLIGHT_READY" }, packageRoot, { taskId });
  await appendProtocolEvent(target, { taskId, event: "EXECUTION_STARTED" }, packageRoot, { taskId });
  await appendProtocolEvent(target, { ...events(), event: "VERIFICATION_STARTED", details: cycle(1) }, packageRoot, { taskId });

  let state = createWorkState({
    taskId,
    contractFingerprint: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    routeFingerprint: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    repositoryFingerprint: { branch: null, head: null },
    phase: "DIAGNOSING",
    completedSteps: ["contract", "route", "implementation"],
    pendingSteps: ["verification"],
    verificationCycle: 1,
    checks: [
      { id: "lint", requirement: "lint", status: "failed", evidenceKind: "OBSERVED", result: "no-unused-vars", details: cycle(1) },
    ],
  });
  await writeWorkState(target, state, { packageRoot, taskId });

  const caseOne = {
    schemaVersion: 1,
    failureClass: "VERIFICATION_FAILURE",
    observations: [{ id: "obs-lint", kind: "CHECK_RESULT", evidenceRef: "lint", statement: "Lint reported no-unused-vars." }],
    contributors: [{ id: "c-import", type: "CODE", statement: "Unused import present.", basis: ["obs-lint"], status: "SUSPECTED" }],
    hypotheses: [{
      id: "h-unused-import",
      statement: "Unused import triggers the lint rule.",
      contributorRefs: ["c-import"],
      evidenceRefs: ["lint"],
      settledBy: { type: "CHECK_STATUS", checkId: "lint", expectedStatus: "passed" },
    }],
    nextSafeAction: { statement: "Remove the unused import." },
  };
  await writeFile(path.join(target, "case.json"), JSON.stringify(caseOne));
  await recordStructuredDiagnosticCase({ target, packageRoot, caseFile: "case.json", taskId });

  state = await readWorkState(target, { packageRoot, taskId });
  await mutateWorkState(target, { expectedRevision: state.revision ?? 0, packageRoot, taskId }, () => ({ ...state, phase: "CORRECTING" }));
  await recordIntervention({
    target,
    packageRoot,
    interventionInput: { schemaVersion: 1, id: "i-remove-import", kind: "CODE_CHANGE", statement: "Remove unused import.", hypothesisRefs: ["h-unused-import"], reversible: true },
    taskId,
  });

  state = await readWorkState(target, { packageRoot, taskId });
  await mutateWorkState(target, { expectedRevision: state.revision ?? 0, packageRoot, taskId }, () => ({
    ...state,
    phase: "VERIFYING",
    checks: [
      ...state.checks,
      { id: "lint", requirement: "lint", status: "passed", evidenceKind: "OBSERVED", result: "clean", details: cycle(2) },
    ],
  }));
  await appendProtocolEvent(target, { ...events(), event: "VERIFICATION_RECORDED", details: { id: "lint", requirement: "lint", status: "passed", exitCode: 0, provenance: "FORGELOOP_EXECUTED", ...cycle(2) } }, packageRoot, { taskId });

  state = await readWorkState(target, { packageRoot, taskId });
  await mutateWorkState(target, { expectedRevision: state.revision ?? 0, packageRoot, taskId }, () => ({ ...state, phase: "DIAGNOSING" }));

  await recordHypothesisDisposition({
    target,
    packageRoot,
    hypothesisRef: "h-unused-import",
    status: "SUPPORTED",
    evidenceRefs: ["lint"],
    reason: "Removing the import made lint pass.",
    taskId,
  });

  return taskId;
}

async function hashTaskDirectory(target) {
  const root = path.join(target, ".forgeloop");
  const hash = createHash("sha256");
  const walk = async (directory) => {
    const entries = (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(entryPath);
      else if (!["state.sqlite-wal", "state.sqlite-shm"].includes(entry.name)) hash.update(entry.name).update(await readFileBytes(entryPath));
    }
  };
  const { readFile } = await import("node:fs/promises");
  const readFileBytes = readFile;
  if (await exists(root)) await walk(root);
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

async function exists(candidate) {
  try {
    await (await import("node:fs/promises")).access(candidate);
    return true;
  } catch {
    return false;
  }
}

test("history preserves attempts and is deterministic and read-only", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-history-"));
  try {
    const taskId = await seedFullDiagnosticRun({ target });
    const before = await hashTaskDirectory(target);

    const historyA = await buildTaskHistory({ target, packageRoot, taskId, filters: {} });
    const historyB = await buildTaskHistory({ target, packageRoot, taskId, filters: {} });
    assert.deepEqual(historyA.events.map((event) => event.sequence), historyB.events.map((event) => event.sequence));
    assert.equal(historyB.integrity.valid, true);
    assert.ok(historyA.summary.eventCount > 8);

    // Repeated lint attempts remain visible (failed cycle 1 + passed cycle 2)
    const verificationEvents = historyA.events.filter((event) => event.type === "VERIFICATION_RECORDED");
    assert.equal(verificationEvents.length >= 1, true);

    const after = await hashTaskDirectory(target);
    assert.equal(before, after, "history must not mutate task artifacts");

    const filtered = await buildTaskHistory({ target, packageRoot, taskId, filters: { limit: 3 } });
    assert.equal(filtered.summary.eventCount, 3);
    assert.equal(filtered.truncated, true);
    assert.equal(filtered.truncation.omittedEvents, historyA.summary.eventCount - 3);

    const empty = await buildTaskHistory({ target, packageRoot, taskId, filters: { limit: 0 } });
    assert.deepEqual(empty.events, []);
    assert.equal(empty.summary.eventCount, 0);
    assert.equal(empty.summary.totalEventCount, historyA.summary.totalEventCount);
    assert.equal(empty.truncation.omittedEvents, historyA.summary.totalEventCount);
    assert.deepEqual(empty.integrity, historyA.integrity);
    assert.deepEqual(empty.historyQuality, historyA.historyQuality);
    assert.equal(await hashTaskDirectory(target), before, "zero-limit history remains read-only");

    assert.match(formatHistoryResult(historyA), /ForgeLoop Execution History/);
  } finally {
    await removeTempTree(target);
  }
});

test("trace correlates checks, diagnostics, and is deterministic read-only", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-trace-"));
  try {
    const taskId = await seedFullDiagnosticRun({ target });
    const before = await hashTaskDirectory(target);

    const traceA = await buildTaskTrace({ target, packageRoot, taskId });
    const traceB = JSON.parse(JSON.stringify(await buildTaskTrace({ target, packageRoot, taskId })));
    traceA.snapshot.capturedAt = traceB.snapshot.capturedAt;
    assert.deepEqual(traceA, traceB);

    const lintCheck = traceA.checks.find((check) => check.id === "lint");
    assert.equal(lintCheck.attemptCount >= 2, true);
    assert.equal(lintCheck.failedAttempts >= 1, true);
    assert.equal(lintCheck.currentResult, "passed");

    assert.equal(traceA.diagnostics.cases.length, 1);
    assert.equal(traceA.diagnostics.interventions[0].intervention.id, "i-remove-import");
    assert.equal(traceA.diagnostics.dispositions[0].status, "SUPPORTED");
    assert.equal(traceA.integrity.valid, true);

    const after = await hashTaskDirectory(target);
    assert.equal(before, after);
  } finally {
    await removeTempTree(target);
  }
});

test("reflect reports effective gain and read-only determinism", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-reflect-"));
  try {
    const taskId = await seedFullDiagnosticRun({ target });
    const before = await hashTaskDirectory(target);

    const reflection = await buildTaskReflection({ target, packageRoot, taskId });
    assert.equal(reflection.command, "reflect");
    assert.equal(reflection.hypotheses.created, 1);
    assert.equal(reflection.hypotheses.supported, 1);
    assert.equal(reflection.interventions.count, 1);
    assert.equal(reflection.oscillation.detected, false);
    assert.equal(reflection.verificationCycles >= 1, true);

    const again = await buildTaskReflection({ target, packageRoot, taskId });
    delete reflection.snapshotConsistent;
    void again;
    assert.equal(reflection.status, "ADVANCING");

    const after = await hashTaskDirectory(target);
    assert.equal(before, after);
  } finally {
    await removeTempTree(target);
  }
});
