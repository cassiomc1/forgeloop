import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { test } from "node:test";

import { runStatus } from "../src/commands/status.js";
import { runTaskList } from "../src/commands/task-list.js";
import { runTaskRecover } from "../src/commands/task-recover.js";
import { runTaskResume } from "../src/commands/task-resume.js";
import { runTaskShow } from "../src/commands/task-show.js";
import { appendProtocolEvent } from "../src/core/events.js";
import { resolveTaskClaimState } from "../src/core/task-claim-state.js";
import { withTaskMutation } from "../src/core/task-command.js";
import { ensureWithin } from "../src/core/filesystem.js";
import { readTaskDescriptor } from "../src/core/task-descriptor.js";
import { TASK_STATE_ROOT, taskArtifactPath } from "../src/core/task-paths.js";
import {
  createTaskRecovery,
  taskClaimProjection,
  writeTaskRecovery,
} from "../src/core/task-recovery.js";
import { createWorkState, readWorkState, writeWorkState } from "../src/core/work-state.js";
import {
  packageRoot,
  setupAbandonedTask,
  withRecoveryTarget,
} from "./helpers/task-recovery-fixture.js";

function assertFailClosed(result, expectedClaims = ["tests"]) {
  assert.equal(result.claimState, "INCONSISTENT");
  assert.equal(result.valid, false);
  assert.equal(result.mutationAllowed, false);
  assert.deepEqual(result.effectiveWriteClaims, expectedClaims);
  assert.ok(result.reasonCodes.includes("E_TASK_CLAIM_OWNERSHIP_INCONSISTENT"));
  assert.ok(result.errors.some((error) => error.code === "E_TASK_RECOVERY_INCONSISTENT"));
}

test("pure claim projection never trusts a raw recovery artifact", () => {
  assert.deepEqual(taskClaimProjection({
    phase: "COMPLETE",
    validatedClaimState: null,
    writeClaims: ["tests"],
  }), {
    writeClaims: ["tests"],
    historicalWriteClaims: ["tests"],
    effectiveWriteClaims: ["tests"],
    claimState: "ACTIVE",
    mutationAllowed: true,
  });
});

test("resolveTaskClaimState preserves claims and mutation authority for an active task", async () => {
  await withRecoveryTarget(async (target) => {
    const { taskId } = await setupAbandonedTask(target, { taskId: "claim-state-active" });

    const result = await resolveTaskClaimState(target, { taskId, packageRoot });

    assert.equal(result.claimState, "ACTIVE");
    assert.equal(result.valid, true);
    assert.equal(result.mutationAllowed, true);
    assert.deepEqual(result.historicalWriteClaims, ["tests"]);
    assert.deepEqual(result.effectiveWriteClaims, ["tests"]);
  });
});

test("resolveTaskClaimState releases claims only for a validated active recovery", async () => {
  await withRecoveryTarget(async (target) => {
    const { taskId } = await setupAbandonedTask(target, { taskId: "claim-state-recovered" });
    await runTaskRecover({ target, packageRoot, taskId, acknowledgeRecovery: true });

    const result = await resolveTaskClaimState(target, { taskId, packageRoot });

    assert.equal(result.claimState, "RELEASED_BY_RECOVERY");
    assert.equal(result.valid, true);
    assert.equal(result.mutationAllowed, false);
    assert.deepEqual(result.historicalWriteClaims, ["tests"]);
    assert.deepEqual(result.effectiveWriteClaims, []);
    assert.equal(result.recoveryStatus, "ACTIVE");
  });
});

test("resolveTaskClaimState rejects a valid-looking recovery artifact without a ledger event", async () => {
  await withRecoveryTarget(async (target) => {
    const { taskId } = await setupAbandonedTask(target, { taskId: "claim-state-fake" });
    const state = await readWorkState(target, { packageRoot, taskId });
    await writeTaskRecovery(target, createTaskRecovery({
      taskId,
      recoveredAt: new Date().toISOString(),
      recoveryId: "recovery-fake",
      recoveryEventSeq: 999,
      classificationAtRecovery: "ABANDONED",
      reasonCodes: ["IDLE_BEYOND_THRESHOLD"],
      releasedClaims: ["tests"],
      previousPhase: state.phase,
      previousRevision: state.revision,
      repositoryFingerprint: state.repositoryFingerprint,
      authority: { kind: "CALLER_ACKNOWLEDGED" },
    }), packageRoot);

    assertFailClosed(await resolveTaskClaimState(target, { taskId, packageRoot }));
  });
});

test("resolveTaskClaimState blocks claim resurrection when an active recovery tombstone is deleted", async () => {
  await withRecoveryTarget(async (target) => {
    const { taskId } = await setupAbandonedTask(target, { taskId: "claim-state-deleted" });
    await runTaskRecover({ target, packageRoot, taskId, acknowledgeRecovery: true });
    await rm(ensureWithin(target, taskArtifactPath(taskId, "recovery")));

    assertFailClosed(await resolveTaskClaimState(target, { taskId, packageRoot }));
  });
});

test("resolveTaskClaimState keeps historical claims when recovery JSON is corrupt", async () => {
  await withRecoveryTarget(async (target) => {
    const { taskId } = await setupAbandonedTask(target, { taskId: "claim-state-corrupt" });
    await writeFile(ensureWithin(target, taskArtifactPath(taskId, "recovery")), "{\"status\":", "utf8");

    assertFailClosed(await resolveTaskClaimState(target, { taskId, packageRoot }));
  });
});

test("resolveTaskClaimState fails closed when the task descriptor is corrupt", async () => {
  await withRecoveryTarget(async (target) => {
    const { taskId } = await setupAbandonedTask(target, { taskId: "claim-state-corrupt-descriptor" });
    await writeFile(ensureWithin(target, taskArtifactPath(taskId, "descriptor")), "{\"taskId\":", "utf8");

    assertFailClosed(await resolveTaskClaimState(target, { taskId, packageRoot }), []);
  });
});

test("resolveTaskClaimState fails closed when the work state is corrupt", async () => {
  await withRecoveryTarget(async (target) => {
    const { taskId } = await setupAbandonedTask(target, { taskId: "claim-state-corrupt-state" });
    await writeFile(ensureWithin(target, taskArtifactPath(taskId, "state")), "{\"phase\":", "utf8");

    assertFailClosed(await resolveTaskClaimState(target, { taskId, packageRoot }));
  });
});

test("resolveTaskClaimState rejects invalid supplied descriptor claims", async () => {
  await withRecoveryTarget(async (target) => {
    const { taskId } = await setupAbandonedTask(target, { taskId: "claim-state-invalid-supplied-claims" });
    const state = await readWorkState(target, { packageRoot, taskId });

    const result = await resolveTaskClaimState(target, {
      taskId,
      packageRoot,
      descriptor: { writeClaims: ["../escape"] },
      state,
    });

    assertFailClosed(result, []);
    assert.ok(result.errors.some((error) => /Invalid descriptor write claims/.test(error.message)));
  });
});

test("resolveTaskClaimState rejects ledger events belonging to another task", async () => {
  await withRecoveryTarget(async (target) => {
    const { taskId } = await setupAbandonedTask(target, { taskId: "claim-state-cross-task-ledger" });
    await appendProtocolEvent(target, {
      taskId: "different-task",
      event: "TASK_ACTIVITY_RECORDED",
      details: { operation: "cross-task-test" },
    }, packageRoot, { taskId });

    const result = await resolveTaskClaimState(target, { taskId, packageRoot });

    assertFailClosed(result);
    assert.ok(result.errors.some((error) => /different task/.test(error.message)));
  });
});

test("resolveTaskClaimState converts invalid task identity failures into an inconsistent projection", async () => {
  const result = await resolveTaskClaimState("/unused", {
    taskId: "x".repeat(257),
    packageRoot,
    descriptor: { writeClaims: ["tests"] },
    state: { phase: "EXECUTING" },
  });

  assertFailClosed(result);
  assert.ok(result.errors.length >= 2);
});

test("resolveTaskClaimState accepts completed recovery history without a tombstone", async () => {
  await withRecoveryTarget(async (target) => {
    const { taskId } = await setupAbandonedTask(target, { taskId: "claim-state-resumed" });
    await runTaskRecover({ target, packageRoot, taskId, acknowledgeRecovery: true });
    await runTaskResume({ target, packageRoot, taskId });

    const result = await resolveTaskClaimState(target, { taskId, packageRoot });

    assert.equal(result.claimState, "ACTIVE");
    assert.equal(result.valid, true);
    assert.equal(result.mutationAllowed, true);
    assert.deepEqual(result.effectiveWriteClaims, ["tests"]);
    assert.equal(result.recoveryStatus, "COMPLETED");
  });
});

test("resolveTaskClaimState conservatively reserves both descriptor and recovery claims after tampering", async () => {
  await withRecoveryTarget(async (target) => {
    const { taskId } = await setupAbandonedTask(target, { taskId: "claim-state-tampered-claims" });
    await runTaskRecover({ target, packageRoot, taskId, acknowledgeRecovery: true });
    const descriptorPath = ensureWithin(target, taskArtifactPath(taskId, "descriptor"));
    const descriptor = (await readTaskDescriptor(target, taskId, packageRoot)).value;
    await writeFile(descriptorPath, `${JSON.stringify({ ...descriptor, writeClaims: ["src"] }, null, 2)}\n`, "utf8");

    const result = await resolveTaskClaimState(target, { taskId, packageRoot });

    assertFailClosed(result, ["src", "tests"]);
    assert.deepEqual(result.historicalWriteClaims, ["src", "tests"]);
  });
});

test("forged COMPLETE work-state cannot release claims and fails closed", async () => {
  await withRecoveryTarget(async (target) => {
    const { taskId } = await setupAbandonedTask(target, { taskId: "claim-state-complete" });
    const descriptor = (await readTaskDescriptor(target, taskId, packageRoot)).value;
    const state = await readWorkState(target, { packageRoot, taskId });

    const result = await resolveTaskClaimState(target, {
      taskId,
      packageRoot,
      descriptor,
      state: { ...state, phase: "COMPLETE" },
    });

    assert.equal(result.claimState, "INCONSISTENT");
    assert.equal(result.mutationAllowed, false);
    assert.deepEqual(result.effectiveWriteClaims, ["tests"]);
    assert.equal(result.ownershipValid, false);
    assert.ok(result.reasonCodes.includes("E_COMPLETION_OWNERSHIP_UNPROVEN"));
  });
});

test("ordinary mutation rejects a forged COMPLETE task as ownership-inconsistent", async () => {
  await withRecoveryTarget(async (target) => {
    const { taskId } = await setupAbandonedTask(target, { taskId: "complete-mutation-guard" });
    const state = await readWorkState(target, { packageRoot, taskId });
    await writeWorkState(target, createWorkState({
      ...state,
      phase: "COMPLETE",
      previousPhase: "REVIEWING",
      verificationEvidence: [{ kind: "OBSERVED", source: "fixture", result: "passed" }],
      evidenceCoverage: [],
    }), { packageRoot, taskId });

    await assert.rejects(
      () => withTaskMutation(target, { taskId, packageRoot }, "post-complete", async () => null),
      (error) => error.code === "E_TASK_CLAIM_OWNERSHIP_INCONSISTENT"
        && error.reasonCodes.includes("E_COMPLETION_OWNERSHIP_UNPROVEN"),
    );
  });
});

test("task-list, task-show, and status agree that forged COMPLETE is inconsistent and mutation-disabled", async () => {
  await withRecoveryTarget(async (target) => {
    const { taskId } = await setupAbandonedTask(target, { taskId: "complete-ownership-surfaces" });
    const state = await readWorkState(target, { packageRoot, taskId });
    await writeWorkState(target, createWorkState({
      ...state,
      phase: "COMPLETE",
      previousPhase: "REVIEWING",
      verificationEvidence: [{ kind: "OBSERVED", source: "fixture", result: "passed" }],
      evidenceCoverage: [],
    }), { packageRoot, taskId });

    const listed = (await runTaskList({ target, packageRoot })).tasks
      .find((task) => task.taskId === taskId);
    const shown = await runTaskShow({ target, packageRoot, taskId });
    const status = await runStatus({ target, packageRoot, taskId });
    for (const result of [listed, shown, status]) {
      assert.equal(result.claimState, "INCONSISTENT");
      assert.deepEqual(result.effectiveWriteClaims, ["tests"]);
      assert.equal(result.mutationAllowed, false);
      assert.equal(result.ownershipValid, false);
    }
    const active = await runTaskList({ target, packageRoot, active: true });
    assert.equal(active.tasks.some((task) => task.taskId === taskId), false);
  });
});

test("task-list phase filtering returns only the requested lifecycle phase", async () => {
  await withRecoveryTarget(async (target) => {
    const { taskId } = await setupAbandonedTask(target, { taskId: "phase-filter-task" });
    const corruptKey = "b".repeat(64);
    const corruptDirectory = ensureWithin(target, `${TASK_STATE_ROOT}/${corruptKey}`);
    await mkdir(corruptDirectory, { recursive: true });
    await writeFile(`${corruptDirectory}/events.ndjson`, "corrupt\n", "utf8");

    const matching = await runTaskList({ target, packageRoot, phase: "VERIFYING" });
    assert.deepEqual(matching.tasks.map((task) => task.taskId), [taskId]);
    assert.equal(matching.tasks.some((task) => task.healthy === false), false);

    const nonMatching = await runTaskList({ target, packageRoot, phase: "PLANNED" });
    assert.deepEqual(nonMatching.tasks, []);
  });
});

test("ordinary mutation rejects a recovered task until explicit resume", async () => {
  await withRecoveryTarget(async (target) => {
    const { taskId } = await setupAbandonedTask(target, { taskId: "recovered-mutation-guard" });
    await runTaskRecover({ target, packageRoot, taskId, acknowledgeRecovery: true });

    await assert.rejects(
      () => withTaskMutation(target, { taskId, packageRoot }, "post-recovery", async () => null),
      (error) => error.code === "E_TASK_RECOVERED",
    );
  });
});
