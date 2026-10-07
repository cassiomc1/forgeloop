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
import { createWorkState, writeWorkState } from "../src/core/work-state.js";
import { appendProtocolEvent } from "../src/core/events.js";
import { buildTaskTrace } from "../src/core/trace.js";
import { diagnosisFingerprint } from "../src/core/diagnosis-model.js";

const packageRoot = getPackageRoot();

async function withTarget(run) {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-trace-fix-"));
  try {
    await run(target);
  } finally {
    await removeTempTree(target);
  }
}

async function seedTask(target, { taskId, events = [], checks = [], phase = "VERIFYING", cycle = 1 }) {
  await ensureFixtureTask(target, taskId, packageRoot);
  for (const { event, details } of events) {
    await appendProtocolEvent(target, { taskId, event, details }, packageRoot, { taskId });
  }
  const state = createWorkState({
    taskId,
    contractFingerprint: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    routeFingerprint: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    repositoryFingerprint: { branch: null, head: null },
    phase,
    completedSteps: ["contract", "route", "implementation"],
    pendingSteps: ["verification"],
    verificationCycle: cycle,
    checks,
  });
  await writeWorkState(target, state, { packageRoot, taskId });
}

const failedEvent = (cycle) => ({
  event: "VERIFICATION_RECORDED",
  details: {
    id: "check-a",
    requirement: "auth-tests",
    status: "failed",
    exitCode: 1,
    provenance: "FORGELOOP_EXECUTED",
    verificationCycle: cycle,
  },
});

test("C0/P3 safety net: one ledger event plus the same state check is exactly one attempt", async () => {
  await withTarget(async (target) => {
    await seedTask(target, {
      taskId: "t1",
      events: [failedEvent(1)],
      checks: [{
        id: "check-a",
        requirement: "auth-tests",
        status: "failed",
        evidenceKind: "OBSERVED",
        details: { verificationCycle: 1 },
      }],
    });
    const trace = await buildTaskTrace({ target, packageRoot, taskId: "t1" });
    const check = trace.checks.find((entry) => entry.id === "check-a");
    assert.equal(check.attemptCount, 1);
    assert.equal(check.failedAttempts, 1);
  });
});

test("C0/P3 safety net: two distinct ledger attempts stay two attempts; state-only check is one fallback attempt", async () => {
  await withTarget(async (target) => {
    await seedTask(target, {
      taskId: "t2",
      events: [failedEvent(1), failedEvent(1), {
        event: "VERIFICATION_RECORDED",
        details: { id: "state-only", requirement: "lint", status: "failed", verificationCycle: 1 },
      }],
      checks: [
        { id: "check-a", requirement: "auth-tests", status: "failed", evidenceKind: "OBSERVED", details: { verificationCycle: 1 } },
        { id: "state-only", requirement: "lint", status: "failed", evidenceKind: "OBSERVED", details: { verificationCycle: 1 } },
      ],
    });
    const trace = await buildTaskTrace({ target, packageRoot, taskId: "t2" });
    assert.equal(trace.checks.find((c) => c.id === "check-a").attemptCount, 2);
    assert.equal(trace.checks.find((c) => c.id === "state-only").attemptCount, 1);
  });
});

test("C0/P4 safety net: phases reconstruct forward and VERIFICATION_STARTED appears in transitions", async () => {
  await withTarget(async (target) => {
    await seedTask(target, {
      taskId: "t3",
      events: [
        { event: "TASK_RECEIVED" },
        { event: "EXECUTION_STARTED" },
        { event: "VERIFICATION_STARTED", details: { verificationCycle: 1 } },
        failedEvent(1),
        {
          event: "DIAGNOSIS_RECORDED",
          details: {
            verificationCycle: 1,
            hypothesis: "h",
            informationGain: "FIRST_DIAGNOSIS",
            failureClass: "VERIFICATION_FAILURE",
            evidenceRefs: ["check-a"],
            settledBy: "check-a passes on rerun",
            nextSafeAction: "rerun check-a",
            previousDiagnosisFingerprint: null,
            diagnosisFingerprint: diagnosisFingerprint({
              failureClass: "VERIFICATION_FAILURE",
              hypothesis: "h",
              evidenceRefs: ["check-a"],
            }),
          },
        },
        { event: "REVIEW_STARTED" },
      ],
      phase: "REVIEWING",
    });
    const trace = await buildTaskTrace({ target, packageRoot, taskId: "t3" });

    assert.ok(
      !trace.transitions.some((transition) => transition.type === "VERIFICATION_STARTED_PLACEHOLDER"),
      "placeholder transition must not appear",
    );
    assert.ok(trace.transitions.some((transition) => transition.type === "VERIFICATION_STARTED"));

    const phaseByType = new Map();
    for (const event of trace.events) {
      if (!phaseByType.has(event.type)) phaseByType.set(event.type, event.phase);
    }
    assert.equal(phaseByType.get("EXECUTION_STARTED"), "EXECUTING");
    assert.equal(phaseByType.get("VERIFICATION_STARTED"), "VERIFYING");
    assert.equal(phaseByType.get("VERIFICATION_RECORDED"), "DIAGNOSING");
    assert.equal(phaseByType.get("DIAGNOSIS_RECORDED"), "DIAGNOSING");
    assert.equal(phaseByType.get("REVIEW_STARTED"), "REVIEWING");

    // forward reconstruction: early events must not inherit the final phase
    const taskReceived = trace.events.find((event) => event.type === "TASK_RECEIVED");
    assert.notEqual(taskReceived.phase, "REVIEWING");
  });
});

test("C0/P4 safety net: failure signatures and surfaces are populated in trace", async () => {
  await withTarget(async (target) => {
    await seedTask(target, {
      taskId: "t4",
      events: [
        failedEvent(1),
        {
          event: "VERIFICATION_RECORDED",
          details: { id: "check-b", requirement: "lint", status: "blocked", verificationCycle: 1 },
        },
      ],
      checks: [],
    });
    const trace = await buildTaskTrace({ target, packageRoot, taskId: "t4" });
    assert.equal(trace.failureSurfaces.length >= 1, true);
    const cycle1 = trace.failureSurfaces.find((surface) => surface.verificationCycle === 1);
    assert.deepEqual(cycle1.surface, ["auth-tests", "lint"]);
    assert.equal(cycle1.size, 2);
    assert.ok(trace.failureSignatures.length >= 1);
    for (const signature of trace.failureSignatures) {
      assert.match(signature.signature, /^[0-9a-f]{64}$/);
      assert.ok(signature.requirements.length >= 1);
      assert.ok(signature.cycles.length >= 1);
    }
  });
});

test("C0/invariant F safety net: read-only projections do not mutate .forgeloop artifacts", async () => {
  await withTarget(async (target) => {
    await seedTask(target, { taskId: "t5", events: [failedEvent(1)], checks: [] });
    const forgeDir = path.join(target, ".forgeloop");
    async function hashTree(dir) {
      const entries = await readdir(dir, { recursive: true });
      const hash = createHash("sha256");
      for (const relative of entries.sort()) {
        if (["state.sqlite-wal", "state.sqlite-shm"].includes(relative)) continue;
        const full = path.join(dir, relative);
        hash.update(relative);
        try {
          hash.update(await readFile(full));
        } catch {
          // directories
        }
      }
      // SQLite readers may create coordination sidecars. Check every logical
      // table as well as persistent file bytes so WAL-backed writes cannot hide.
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
    await buildTaskTrace({ target, packageRoot, taskId: "t5" });
    const { buildTaskHistory } = await import("../src/core/history.js");
    const { buildTaskReflection } = await import("../src/core/reflection.js");
    const { inspectTarget } = await import("../src/core/inspect.js");
    const { evaluateProgress } = await import("../src/core/progress.js");
    await buildTaskHistory({ target, packageRoot, taskId: "t5" });
    await buildTaskReflection({ target, packageRoot, taskId: "t5" });
    await inspectTarget({ target, packageRoot, taskId: "t5" });
    evaluateProgress({ state: { taskId: "t5", checks: [], verificationCycle: 1 }, events: [] });
    const after = await hashTree(forgeDir);
    assert.equal(before, after, "read-only commands must not alter canonical artifacts");
  });
});
