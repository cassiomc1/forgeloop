import { ensureFixtureTask } from "./helpers/native-storage-fixture.js";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { removeTempTree } from "./helpers/rm-safe.js";
import { getPackageRoot } from "../src/core/templates.js";
import { appendProtocolEvent, readEvents, buildProtocolEvent } from "../src/core/events.js";
import { createWorkState, writeWorkState } from "../src/core/work-state.js";
import { createEvidence } from "../src/core/evidence.js";
import { evaluateTrajectory } from "../src/core/trajectory-evaluation.js";
import { taskEvaluationPath } from "../src/core/task-paths.js";
import { openStorageDatabase, appendEvent } from "../src/storage/index.js";
import { runEval } from "../src/commands/eval.js";
import { runEfficiency } from "../src/commands/efficiency.js";

const packageRoot = getPackageRoot();

async function withTarget(run) {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-trajectory-eval-"));
  try {
    await run(target);
  } finally {
    await removeTempTree(target);
  }
}

async function seedTask(target, taskId = "task-evaluation") {
  await ensureFixtureTask(target, taskId, packageRoot);
  const fingerprint = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  await writeWorkState(target, createWorkState({
    taskId,
    contractFingerprint: fingerprint,
    routeFingerprint: fingerprint,
    repositoryFingerprint: { branch: null, head: null },
    phase: "COMPLETE",
    completedSteps: ["contract", "route", "implementation", "verification"],
    pendingSteps: [],
    verificationCycle: 1,
    checks: [{ id: "tests", requirement: "tests", status: "passed", evidenceKind: "OBSERVED" }],
    verificationEvidence: [createEvidence({ kind: "OBSERVED", source: "tests", result: "passed" })],
  }), { packageRoot, taskId });
  for (const [event, details] of [
    ["TASK_RECEIVED"],
    ["CONTRACT_VALIDATED"],
    ["ROUTE_VALIDATED"],
    ["PREFLIGHT_READY"],
    ["EXECUTION_STARTED"],
    ["VERIFICATION_STARTED", { verificationCycle: 1 }],
    ["VERIFICATION_RECORDED", { id: "tests", requirement: "tests", status: "passed", exitCode: 0, verificationCycle: 1 }],
    ["COMPLETION_VALIDATED"],
  ]) {
    await appendProtocolEvent(target, {
      taskId,
      event,
      ...(details ? { details } : {}),
    }, packageRoot, { taskId });
  }
}

function scenario(overrides = {}) {
  return {
    schemaVersion: 1,
    scenarioId: "evaluation-reference",
    requiredMilestones: [
      "CONTRACT_VALIDATED",
      "ROUTE_VALIDATED",
      "PREFLIGHT_READY",
      "EXECUTION_STARTED",
      "VERIFICATION_STARTED",
      "COMPLETION_VALIDATED",
    ],
    forbidden: { completionBeforeVerification: true, unresolvedRequiredAction: true },
    limits: { maxVerificationCycles: 2, maxNonInformativeInterventions: 0, maxAmbiguousActions: 0 },
    reference: { comparableSteps: 10 },
    ...overrides,
  };
}

test("direct trajectory evaluation rejects a ledger change during its external usage callback", async () => {
  await withTarget(async target => {
    const taskId = "task-evaluation-race";
    await seedTask(target, taskId);
    await writeFile(path.join(target, "scenario.json"), JSON.stringify(scenario()));
    const writer = openStorageDatabase(path.join(target, ".forgeloop/state.sqlite"));
    const options = { target, packageRoot, taskId, scenarioPath: "scenario.json", evaluationId: "eval-race" };
    try {
      const last = (await readEvents(target, packageRoot, { taskId })).at(-1);
      const observation = buildProtocolEvent({ taskId, event: "OBSERVATION", details: { message: "concurrent writer" } },
        { checkpoint: { seq: last.seq, lastHash: last.hash } });
      await assert.rejects(evaluateTrajectory({ ...options, runtimeContext: { usageProvider: {
        async getTaskUsage() { appendEvent(writer, { taskId, event: observation }); return null; },
      } } }), { code: "E_STATE_REVISION_CONFLICT" });
      assert.equal(writer.prepare("SELECT COUNT(*) AS count FROM task_artifacts WHERE task_id = ? AND kind = 'evaluation'").get(taskId).count, 0);
      assert.equal(writer.prepare("SELECT COUNT(*) AS count FROM events WHERE task_id = ? AND event_type = 'TRAJECTORY_EVALUATED'").get(taskId).count, 0);
      assert.equal((await readEvents(target, packageRoot, { taskId })).at(-1).hash, observation.hash);
      const result = await evaluateTrajectory(options);
      assert.equal(result.evaluationId, options.evaluationId);
      assert.equal(writer.prepare("SELECT COUNT(*) AS count FROM events WHERE task_id = ? AND event_type = 'TRAJECTORY_EVALUATED'").get(taskId).count, 1);
    } finally { writer.close(); }
  });
});

test("native trajectory command adapters preserve derived evaluation and read-only efficiency", async () => {
  await withTarget(async target => {
    const taskId = "task-trajectory-adapters";
    await seedTask(target, taskId);
    await writeFile(path.join(target, "scenario.json"), JSON.stringify(scenario()));
    const before = await readEvents(target, packageRoot, { taskId });
    const report = await runEfficiency({ target, packageRoot, taskId });
    assert.equal(report.taskId, taskId);
    assert.equal(report.comparison.status, "NOT_COMPARABLE");
    assert.equal(report.usage.source, "UNKNOWN");
    assert.deepEqual(await readEvents(target, packageRoot, { taskId }), before);
    const result = await runEval({ target, packageRoot, taskId, scenarioPath: "scenario.json" });
    assert.equal(result.result, "PASS");
    const after = await readEvents(target, packageRoot, { taskId });
    assert.equal(after.length, before.length + 1);
    assert.equal(after.at(-1).event, "TRAJECTORY_EVALUATED");
    assert.equal(after.at(-1).details.evaluationFingerprint, result.evaluationFingerprint);
  });
});

test("trajectory evaluation persists a reproducible PASS and emits a bound event", async () => {
  await withTarget(async (target) => {
    await seedTask(target);
    await writeFile(path.join(target, "scenario-pass.json"), JSON.stringify(scenario()), "utf8");
    const evaluation = await evaluateTrajectory({
      target,
      packageRoot,
      taskId: "task-evaluation",
      scenarioPath: "scenario-pass.json",
      evaluationId: "eval-pass",
    });

    assert.equal(evaluation.result, "PASS");
    assert.equal(evaluation.completionValid, true);
    assert.equal(evaluation.safetyValid, true);
    assert.equal(evaluation.efficiency.referenceComparableSteps, 10);
    assert.equal(evaluation.efficiency.actualComparableSteps, 2);
    assert.equal(evaluation.efficiency.ratio, 5);
    const events = await readEvents(target, packageRoot, { taskId: "task-evaluation" });
    const event = events.find((entry) => entry.event === "TRAJECTORY_EVALUATED");
    assert.equal(event.details.evaluationId, "eval-pass");
    assert.equal(event.fingerprint, evaluation.evaluationFingerprint);
    const evaluationPath = path.join(target, taskEvaluationPath("task-evaluation", "eval-pass"));
    assert.ok(evaluationPath.endsWith(path.join("evaluations", "eval-pass.json")));
  });
});

test("trajectory evaluation returns FAIL when a scenario limit is exceeded and omits efficiency without reference", async () => {
  await withTarget(async (target) => {
    await seedTask(target);
    await writeFile(path.join(target, "scenario-fail.json"), JSON.stringify(scenario({
      scenarioId: "evaluation-fail",
      requiredMilestones: ["CONTRACT_VALIDATED", "MISSING_MILESTONE"],
      limits: { maxVerificationCycles: 1 },
      reference: undefined,
    })), "utf8");
    const evaluation = await evaluateTrajectory({
      target,
      packageRoot,
      taskId: "task-evaluation",
      scenarioPath: "scenario-fail.json",
      evaluationId: "eval-fail",
    });

    assert.equal(evaluation.result, "FAIL");
    assert.equal(evaluation.completionValid, false);
    assert.ok(evaluation.missingMilestones.includes("MISSING_MILESTONE"));
    assert.equal(evaluation.efficiency, null);
    assert.equal(evaluation.limits.verificationCycles.pass, true);
  });
});

test("trajectory evaluation rejects paths outside the project-local scenario boundary", async () => {
  await withTarget(async (target) => {
    await assert.rejects(
      () => evaluateTrajectory({ target, packageRoot, taskId: "task-evaluation", scenarioPath: "../scenario.json" }),
      (error) => error.code === "E_TRAJECTORY_SCENARIO_INVALID",
    );
  });
});
