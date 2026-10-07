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
import { inspectTarget } from "../src/core/inspect.js";

const packageRoot = getPackageRoot();

async function withTarget(run) {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-inspect-task-"));
  try {
    await run(target);
  } finally {
    await removeTempTree(target);
  }
}

async function seedTask(target, { taskId, cycle, checks, phase }) {
  await ensureFixtureTask(target, taskId, packageRoot);
  await appendProtocolEvent(target, {
    taskId,
    event: "VERIFICATION_RECORDED",
    details: { ...checks[0], verificationCycle: cycle },
  }, packageRoot, { taskId });
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

test("C0/P2 safety net: inspect --task is isolated per task and progress receives raw work state", async () => {
  await withTarget(async (target) => {
    await seedTask(target, {
      taskId: "task-a",
      cycle: 2,
      phase: "DIAGNOSING",
      checks: [{ id: "check-auth", requirement: "auth-tests", status: "failed", evidenceKind: "OBSERVED", result: "auth fail", details: { verificationCycle: 2 } }],
    });
    await seedTask(target, {
      taskId: "task-b",
      cycle: 1,
      phase: "VERIFYING",
      checks: [{ id: "check-lint-b", requirement: "lint-b", status: "passed", evidenceKind: "OBSERVED", result: "ok", details: { verificationCycle: 1 } }],
    });

    for (const [selected, other] of [["task-a", "task-b"], ["task-b", "task-a"]]) {
      const inspection = await inspectTarget({ target, packageRoot, taskId: selected });
      const taskInspection = inspection.taskInspection;
      assert.ok(taskInspection, "task inspection present");

      assert.equal(taskInspection.lifecycle.phase, selected === "task-a" ? "DIAGNOSING" : "VERIFYING");
      assert.equal(taskInspection.lifecycle.verificationCycle, selected === "task-a" ? 2 : 1);

      const checkIds = taskInspection.verification.checks.map((check) => check.id);
      assert.ok(checkIds.length > 0, `${selected} must expose its own checks`);
      assert.ok(
        !checkIds.some((id) => id.includes(other === "task-a" ? "auth" : "lint-b") && !checkIds.includes(selected === "task-a" ? "check-auth" : "check-lint-b")),
        `no foreign check ids from ${other}`,
      );
      assert.ok(!checkIds.includes(other === "task-a" ? "check-auth" : "check-lint-b"), `inspect ${selected} leaked a check from ${other}`);

      // progress must be evaluated from the selected task's raw work state
      assert.equal(taskInspection.progress.status, selected === "task-a" ? "ADVANCING" : "ADVANCING");
      const serialized = JSON.stringify(taskInspection);
      const needle = other === "task-a" ? "check-auth" : "lint-b";
      if (serialized.includes(needle)) {
        const idx = serialized.indexOf(needle);
        assert.fail(`inspect ${selected} output mentions ${other} data near: ...${serialized.slice(Math.max(0, idx - 120), idx + 40)}...`);
      }
    }
  });
});
