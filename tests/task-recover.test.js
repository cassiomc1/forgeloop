import assert from "node:assert/strict";
import { readRawFixtureText, overwriteFixtureLease, readRawFixtureLease } from "./helpers/native-storage-fixture.js";
import { test } from "node:test";

import { runTaskRecover, formatTaskRecoverResult } from "../src/commands/task-recover.js";
import { runAdvance } from "../src/commands/advance.js";
import { runTaskScope } from "../src/commands/task-scope.js";
import { runTaskShow } from "../src/commands/task-show.js";
import { runTaskList } from "../src/commands/task-list.js";
import { discoverTasks } from "../src/core/task-discovery.js";
import { readEvents } from "../src/core/events.js";
import { readWorkState } from "../src/core/work-state.js";
import { taskArtifactPath } from "../src/core/task-paths.js";
import { createWorkState, writeWorkState } from "../src/core/work-state.js";
import { appendProtocolEvent } from "../src/core/events.js";
import { withTaskTransaction } from "../src/core/transaction.js";
import { acquireTaskLock, readLockInfo } from "../src/core/task-lock.js";
import { exportTaskBundle, readTaskBundle } from "../src/core/bundles.js";
import { inspectTaskConflictState } from "../src/core/task-conflict-inspection.js";
import { runStatus } from "../src/commands/status.js";
import { runAudit } from "../src/commands/audit.js";
import {
  packageRoot,
  setupAbandonedTask,
  setupRecoverableTask,
  withRecoveryTarget,
} from "./helpers/task-recovery-fixture.js";

test("task-recover requires explicit caller acknowledgement", async () => {
  await withRecoveryTarget(async (target) => {
    const { taskId } = await setupAbandonedTask(target);
    await assert.rejects(
      () => runTaskRecover({ target, packageRoot, taskId }),
      (error) => error.code === "E_TASK_RECOVERY_AUTHORIZATION_REQUIRED",
    );
  });
});

test("task-recover releases claims of a deadlocked task without fabricating completion", async () => {
  await withRecoveryTarget(async (target) => {
    const { taskId } = await setupAbandonedTask(target);

    const before = await discoverTasks(target, packageRoot);
    const beforeTask = before.find((task) => task.taskId === taskId);
    assert.deepEqual(beforeTask.writeClaims, ["tests"]);
    const stateBeforeRecovery = await readWorkState(target, { packageRoot, taskId });

    const result = await runTaskRecover({ target, packageRoot, taskId, acknowledgeRecovery: true });
    assert.equal(result.recovered, true);
    assert.equal(result.claimsReleased, true);
    assert.deepEqual(result.releasedClaims, ["tests"]);

    const recoveryPath = `${taskArtifactPath(taskId, "state").replace(/work-state\.json$/, "")}recovery.json`;
    assert.ok(await readRawFixtureText(target, recoveryPath), "recovery state must be durable outside the event tail");
    const recoveryState = JSON.parse(await readRawFixtureText(target, recoveryPath));
    assert.equal(recoveryState.status, "RECOVERED");
    assert.deepEqual(recoveryState.releasedClaims, ["tests"]);
    assert.deepEqual(recoveryState.authority, { kind: "CALLER_ACKNOWLEDGED" });
    const formatted = formatTaskRecoverResult(result);
    assert.match(formatted, /caller acknowledgement/);
    assert.doesNotMatch(formatted, /operator authorization|host attest/i);

    const events = await readEvents(target, packageRoot, { taskId });
    const recovery = events.filter((event) => event.event === "OPERATOR_RECOVERY_RECORDED");
    assert.equal(recovery.length, 1);
    assert.equal(recovery[0].details.authorityKind, "CALLER_ACKNOWLEDGED");
    assert.equal(recovery[0].details.previousPhase, "VERIFYING");

    const state = await readWorkState(target, { packageRoot, taskId });
    assert.notEqual(state.phase, "COMPLETE");
    assert.deepEqual(state, stateBeforeRecovery, "recovery must preserve lifecycle evidence and repository freshness state");

    const after = await discoverTasks(target, packageRoot);
    const afterTask = after.find((task) => task.taskId === taskId);
    assert.deepEqual(afterTask.writeClaims, []);
    assert.ok(afterTask.operatorRecoveredAt);

    const shown = await runTaskShow({ target, packageRoot, taskId });
    const listed = (await runTaskList({ target, packageRoot })).tasks.find((task) => task.taskId === taskId);
    const scoped = await runTaskScope({ target, packageRoot, taskId });
    for (const projection of [shown, listed, scoped]) {
      assert.deepEqual(projection.writeClaims, []);
      assert.deepEqual(projection.historicalWriteClaims, ["tests"]);
      assert.equal(projection.claimState, "RELEASED_BY_RECOVERY");
      assert.equal(projection.mutationAllowed, false);
    }
  });
});

test("task-recover refuses a fresh ACTIVE task", async () => {
  await withRecoveryTarget(async (target) => {
    const { taskId, contractHash } = await setupAbandonedTask(target);
    const state = await readWorkState(target, { packageRoot, taskId });
    const currentHead = (await import("../src/core/repository.js")).currentRepositoryFingerprint;
    const repository = await currentHead(target);
    await writeWorkState(target, createWorkState({
      ...state,
      contractFingerprint: contractHash,
      repositoryFingerprint: repository,
      lastUpdated: new Date().toISOString(),
    }), { packageRoot, taskId });

    await assert.rejects(
      () => runTaskRecover({ target, packageRoot, taskId, acknowledgeRecovery: true }),
      (error) => error.code === "E_TASK_RECOVERY_UNSAFE",
    );
  });
});

test("task-recover refuses RECOVERABLE tasks that have an official reconciliation path", async () => {
  await withRecoveryTarget(async (target) => {
    const { taskId } = await setupRecoverableTask(target, { taskId: "official-recovery-task" });

    await assert.rejects(
      () => runTaskRecover({ target, packageRoot, taskId, acknowledgeRecovery: true }),
      (error) => error.code === "E_TASK_RECOVERY_OFFICIAL_PATH_AVAILABLE",
    );

    const task = (await discoverTasks(target, packageRoot)).find((candidate) => candidate.taskId === taskId);
    assert.deepEqual(task.writeClaims, ["tests"]);
  });
});

test("durable recovery keeps claims released after the recovery event leaves the discovery tail", async () => {
  await withRecoveryTarget(async (target) => {
    const { taskId } = await setupAbandonedTask(target);
    await runTaskRecover({ target, packageRoot, taskId, acknowledgeRecovery: true });

    await withTaskTransaction({ target, taskId, operation: "evict-recovery-tail", packageRoot }, async () => {
      for (let index = 0; index < 500; index += 1) {
        await appendProtocolEvent(target, {
          taskId,
          event: "POST_RECOVERY_ACTIVITY_RECORDED",
          details: { index },
        }, packageRoot, { taskId });
      }
    });

    const discovered = await discoverTasks(target, packageRoot);
    const recovered = discovered.find((task) => task.taskId === taskId);
    assert.deepEqual(recovered.writeClaims, []);
  });
});

test("ordinary task mutations are rejected after recovery releases claims", async () => {
  await withRecoveryTarget(async (target) => {
    const { taskId } = await setupAbandonedTask(target);
    await runTaskRecover({ target, packageRoot, taskId, acknowledgeRecovery: true });
    const before = await readWorkState(target, { packageRoot, taskId });

    await assert.rejects(
      () => runAdvance({ target, packageRoot, taskId, to: "REVIEWING" }),
      (error) => error.code === "E_TASK_RECOVERED",
    );

    assert.deepEqual(await readWorkState(target, { packageRoot, taskId }), before);
  });
});

test("task-scope cannot rewrite historical claims while a task is recovered", async () => {
  await withRecoveryTarget(async (target) => {
    const { taskId } = await setupAbandonedTask(target, { taskId: "recovered-scope" });
    await runTaskRecover({ target, packageRoot, taskId, acknowledgeRecovery: true });

    await assert.rejects(
      () => runTaskScope({ target, packageRoot, taskId, claims: ["src"] }),
      (error) => error.code === "E_TASK_RECOVERED",
    );

    const recovered = (await discoverTasks(target, packageRoot)).find((task) => task.taskId === taskId);
    assert.deepEqual(recovered.historicalWriteClaims, ["tests"]);
    assert.deepEqual(recovered.writeClaims, []);
  });
});

test("repeated task-recover is rejected without replacing recovery state or duplicating events", async () => {
  await withRecoveryTarget(async (target) => {
    const { taskId } = await setupAbandonedTask(target, { taskId: "idempotent-recovery" });
    const first = await runTaskRecover({ target, packageRoot, taskId, acknowledgeRecovery: true });

    await assert.rejects(
      () => runTaskRecover({ target, packageRoot, taskId, acknowledgeRecovery: true }),
      (error) => error.code === "E_TASK_ALREADY_RECOVERED"
        && error.recovery?.recoveryId === first.recoveryId,
    );

    const recoveryPath = taskArtifactPath(taskId, "recovery");
    const persisted = JSON.parse(await readRawFixtureText(target, recoveryPath));
    assert.equal(persisted.recoveryId, first.recoveryId);
    const recoveryEvents = (await readEvents(target, packageRoot, { taskId }))
      .filter((event) => event.event === "OPERATOR_RECOVERY_RECORDED");
    assert.equal(recoveryEvents.length, 1);
  });
});

test("task-recover CAS-releases an unchanged stale task lock before recovery", async () => {
  await withRecoveryTarget(async (target) => {
    const { taskId } = await setupAbandonedTask(target, { taskId: "stale-lock-recovery" });
    const handle = await acquireTaskLock(target, taskId, "expired-owner");
    const staleLock = {
      ...handle.lockData,
      acquiredAt: "2020-01-01T00:00:00.000Z",
      heartbeatAt: "2020-01-01T00:00:00.000Z",
      leaseMs: 1,
    };
    await overwriteFixtureLease(target, taskId, staleLock);

    const result = await runTaskRecover({ target, packageRoot, taskId, acknowledgeRecovery: true });
    assert.equal(result.recovered, true);
    assert.equal(await readLockInfo(target, taskId), null);
  });
});

test("task-recover fails closed when the task lock is corrupt", async () => {
  await withRecoveryTarget(async (target) => {
    const { taskId } = await setupAbandonedTask(target, { taskId: "corrupt-lock-recovery" });
    await overwriteFixtureLease(target, taskId, "{broken");

    await assert.rejects(
      () => runTaskRecover({ target, packageRoot, taskId, acknowledgeRecovery: true }),
      (error) => error.code === "E_TASK_RECOVERY_INCONSISTENT",
    );
    assert.equal(await readRawFixtureLease(target, taskId), "{broken");
  });
});

test("portable task bundles preserve active recovery state", async () => {
  await withRecoveryTarget(async (target) => {
    const { taskId } = await setupAbandonedTask(target, { taskId: "bundled-recovery" });
    const recovered = await runTaskRecover({ target, packageRoot, taskId, acknowledgeRecovery: true });

    const bundle = await exportTaskBundle(target, taskId, packageRoot);
    assert.ok(bundle.artifacts.includes("recovery.json"));
    const loaded = await readTaskBundle(target, taskId, packageRoot);
    assert.equal(loaded.artifacts.recovery.recoveryId, recovered.recoveryId);
  });
});

test("recent meaningful ledger activity prevents abandoned-task recovery", async () => {
  await withRecoveryTarget(async (target) => {
    const { taskId } = await setupAbandonedTask(target, { taskId: "recent-ledger-activity" });
    await appendProtocolEvent(target, {
      taskId,
      event: "CONTINUITY_RECORDED",
      at: new Date().toISOString(),
      details: { source: "test-harness" },
    }, packageRoot, { taskId });

    const inspection = await inspectTaskConflictState(target, { taskId, packageRoot });
    assert.equal(inspection.classification, "ACTIVE");
    assert.equal(inspection.evidence.lastMeaningfulEventType, "CONTINUITY_RECORDED");
    await assert.rejects(
      () => runTaskRecover({ target, packageRoot, taskId, acknowledgeRecovery: true }),
      (error) => error.code === "E_TASK_RECOVERY_UNSAFE",
    );
  });
});

test("task-recover accepts a STALE pre-execution classification", async () => {
  await withRecoveryTarget(async (target) => {
    const { taskId } = await setupAbandonedTask(target, { taskId: "stale-pre-execution" });
    const state = await readWorkState(target, { packageRoot, taskId });
    await writeWorkState(target, createWorkState({
      ...state,
      phase: "PLANNED",
      previousPhase: "ROUTED",
      lastUpdated: new Date(Date.now() - (15 * 24 * 60 * 60 * 1000)).toISOString(),
    }), { packageRoot, taskId });

    const inspection = await inspectTaskConflictState(target, { taskId, packageRoot });
    assert.equal(inspection.classification, "STALE");
    const result = await runTaskRecover({ target, packageRoot, taskId, acknowledgeRecovery: true });
    assert.equal(result.classification, "STALE");
  });
});

test("status and audit expose recovery without treating it as completion", async () => {
  await withRecoveryTarget(async (target) => {
    const { taskId } = await setupAbandonedTask(target, { taskId: "observable-recovery" });
    const recovered = await runTaskRecover({ target, packageRoot, taskId, acknowledgeRecovery: true });

    const status = await runStatus({ target, packageRoot, taskId });
    assert.equal(status.recovery.recoveryId, recovered.recoveryId);
    assert.equal(status.claimState, "RELEASED_BY_RECOVERY");
    assert.equal(status.mutationAllowed, false);

    const audit = await runAudit({ target, packageRoot, taskId });
    assert.equal(audit.recovery.recoveryId, recovered.recoveryId);
    assert.equal(audit.claims.state, "RELEASED_BY_RECOVERY");
    assert.notEqual(audit.completion.status, "VALID");
  });
});
