import assert from "node:assert/strict";
import { test } from "node:test";

import { runTaskRecover } from "../src/commands/task-recover.js";
import { runTaskCreate } from "../src/commands/task-create.js";
import { discoverTasks } from "../src/core/task-discovery.js";
import { readEvents } from "../src/core/events.js";
import { ensureWithin } from "../src/core/filesystem.js";
import { taskArtifactPath } from "../src/core/task-paths.js";
import { createWorkState, readWorkState, writeWorkState } from "../src/core/work-state.js";
import { readTaskDescriptor } from "../src/core/task-descriptor.js";
import { resolveTaskContext } from "../src/core/task-context.js";
import { inspectTaskConflictState } from "../src/core/task-conflict-inspection.js";
import { readTaskRecovery } from "../src/core/task-recovery.js";
import { readRawFixtureText, overwriteFixtureText, overwriteFixtureLease, readRawFixtureLease } from "./helpers/native-storage-fixture.js";
import { acquireTaskLock, readLockInfo } from "../src/core/task-lock.js";
import {
  packageRoot,
  setupAbandonedTask,
  withRecoveryTarget,
} from "./helpers/task-recovery-fixture.js";

test("task-resume reacquires released claims and removes recovery state transactionally", async () => {
  const command = await import("../src/commands/task-resume.js").catch(() => null);
  assert.equal(typeof command?.runTaskResume, "function");

  await withRecoveryTarget(async (target) => {
    const { taskId } = await setupAbandonedTask(target);
    const recovered = await runTaskRecover({ target, packageRoot, taskId, acknowledgeRecovery: true });
    const stateBeforeResume = await readWorkState(target, { packageRoot, taskId });

    const result = await command.runTaskResume({ target, packageRoot, taskId });

    assert.equal(result.resumed, true);
    assert.equal(result.recoveryId, recovered.recoveryId);
    assert.deepEqual(result.reacquiredClaims, ["tests"]);
    assert.deepEqual(await readWorkState(target, { packageRoot, taskId }), stateBeforeResume);
    assert.equal(
      (await readTaskRecovery(target, { taskId, packageRoot })) !== null,
      false,
    );

    const task = (await discoverTasks(target, packageRoot)).find((candidate) => candidate.taskId === taskId);
    assert.deepEqual(task.writeClaims, ["tests"]);
    assert.equal(task.mutationAllowed, true);

    const resumeEvents = (await readEvents(target, packageRoot, { taskId }))
      .filter((event) => event.event === "TASK_RECOVERY_RESUMED");
    assert.equal(resumeEvents.length, 1);
    assert.equal(resumeEvents[0].details.recoveryId, recovered.recoveryId);
  });
});

test("task-resume refuses to reacquire a claim owned by another active task", async () => {
  const { runTaskResume } = await import("../src/commands/task-resume.js");
  await withRecoveryTarget(async (target) => {
    const { taskId } = await setupAbandonedTask(target, { taskId: "recovered-owner" });
    await runTaskRecover({ target, packageRoot, taskId, acknowledgeRecovery: true });
    await runTaskCreate({ target, packageRoot, taskId: "new-owner", claims: ["tests"] });

    await assert.rejects(
      () => runTaskResume({ target, packageRoot, taskId }),
      (error) => error.code === "E_TASK_SCOPE_CONFLICT"
        && typeof error.conflicts?.[0]?.classification === "string"
        && typeof error.conflicts?.[0]?.nextAction === "string"
        && Array.isArray(error.conflicts?.[0]?.commandSpecs),
    );

    assert.equal(
      (await readTaskRecovery(target, { taskId, packageRoot })) !== null,
      true,
    );
    const tasks = await discoverTasks(target, packageRoot);
    assert.deepEqual(tasks.find((task) => task.taskId === taskId).writeClaims, []);
    assert.deepEqual(tasks.find((task) => task.taskId === "new-owner").writeClaims, ["tests"]);
  });
});

test("task-resume requires active recovery state", async () => {
  const { runTaskResume } = await import("../src/commands/task-resume.js");
  await withRecoveryTarget(async (target) => {
    const { taskId } = await setupAbandonedTask(target, { taskId: "not-recovered" });
    await assert.rejects(
      () => runTaskResume({ target, packageRoot, taskId }),
      (error) => error.code === "E_TASK_NOT_RECOVERED",
    );
  });
});

test("task-resume can replace historical claims through normal conflict checks", async () => {
  const { runTaskResume } = await import("../src/commands/task-resume.js");
  await withRecoveryTarget(async (target) => {
    const { taskId } = await setupAbandonedTask(target, { taskId: "resume-new-scope" });
    await runTaskRecover({ target, packageRoot, taskId, acknowledgeRecovery: true });

    const result = await runTaskResume({ target, packageRoot, taskId, claims: ["src"] });
    assert.deepEqual(result.reacquiredClaims, ["src"]);
    const descriptor = await readTaskDescriptor(target, taskId, packageRoot);
    assert.deepEqual(descriptor.value.writeClaims, ["src"]);
  });
});

test("task-resume fails closed when historical descriptor claims no longer match recovery state", async () => {
  const { runTaskResume } = await import("../src/commands/task-resume.js");
  await withRecoveryTarget(async (target) => {
    const { taskId } = await setupAbandonedTask(target, { taskId: "resume-tampered-history" });
    await runTaskRecover({ target, packageRoot, taskId, acknowledgeRecovery: true });

    const descriptorPath = ensureWithin(target, taskArtifactPath(taskId, "descriptor"));
    const descriptor = JSON.parse(await readRawFixtureText(target, descriptorPath));
    await overwriteFixtureText(target, descriptorPath, `${JSON.stringify({
      ...descriptor,
      writeClaims: ["src"],
    }, null, 2)}\n`, "utf8");

    await assert.rejects(
      () => runTaskResume({ target, packageRoot, taskId }),
      (error) => error.code === "E_TASK_RECOVERY_INCONSISTENT",
    );
    assert.equal(
      (await readTaskRecovery(target, { taskId, packageRoot })) !== null,
      true,
    );
  });
});

test("task-resume succeeds after the conflicting owner reaches canonical COMPLETE", async () => {
  const { runTaskResume } = await import("../src/commands/task-resume.js");
  await withRecoveryTarget(async (target) => {
    // Drive completed-owner through the official completion pipeline first
    // (single-task target) so its COMPLETE state carries canonical proof.
    const { currentRepositoryFingerprint } = await import("../src/core/repository.js");
    const ownerRepo = await currentRepositoryFingerprint(target);
    const { setupRecoverableTask } = await import("./helpers/task-recovery-fixture.js");
    await setupRecoverableTask(target, { taskId: "completed-owner", writeClaims: ["tests"] });
    const ownerState = await readWorkState(target, { packageRoot, taskId: "completed-owner" });
    await writeWorkState(target, createWorkState({ ...ownerState, repositoryFingerprint: ownerRepo }), { packageRoot, taskId: "completed-owner" });
    const { prepareCompletion, recordCheck } = await import("../src/core/completion-artifacts.js");
    await prepareCompletion({ target, packageRoot, taskId: "completed-owner" });
    await recordCheck({ kind: "manual-review",
      target,
      packageRoot,
      taskId: "completed-owner",
      id: "final-check",
      requirement: "tests",
      status: "passed",
      evidenceKind: "OBSERVED",
      command: "npm test",
      result: "Passed",
    });
    await recordCheck({ kind: "manual-review",
      target,
      packageRoot,
      taskId: "completed-owner",
      id: "objective-check",
      requirement: "objective is present in the current repository",
      status: "passed",
      evidenceKind: "OBSERVED",
      command: "npm test",
      result: "Passed",
    });
    const { advanceWorkState } = await import("../src/core/phase.js");
    await advanceWorkState(target, "REVIEWING", { packageRoot, taskId: "completed-owner" });
    const { runComplete } = await import("../src/commands/complete.js");
    const completion = await runComplete({ target, packageRoot, taskId: "completed-owner" });
    assert.equal(completion.status, "VALID", JSON.stringify(completion.errors ?? [], null, 1));

    // Then create and recover the resumable task.
    const { taskId } = await setupAbandonedTask(target, { taskId: "resume-after-complete", writeClaims: ["tests"] });
    await runTaskRecover({ target, packageRoot, taskId, acknowledgeRecovery: true });

    const result = await runTaskResume({ target, packageRoot, taskId });
    assert.equal(result.resumed, true);
    assert.deepEqual(result.reacquiredClaims, ["tests"]);
    const tasks = await discoverTasks(target, packageRoot);
    assert.deepEqual(tasks.find((task) => task.taskId === "completed-owner").writeClaims, []);
    assert.deepEqual(tasks.find((task) => task.taskId === taskId).writeClaims, ["tests"]);
  });
});

test("task-resume activity prevents immediate abandoned reclassification", async () => {
  const { runTaskResume } = await import("../src/commands/task-resume.js");
  await withRecoveryTarget(async (target) => {
    const { taskId } = await setupAbandonedTask(target, { taskId: "resume-is-activity" });
    await runTaskRecover({ target, packageRoot, taskId, acknowledgeRecovery: true });
    await runTaskResume({ target, packageRoot, taskId });

    const inspection = await inspectTaskConflictState(target, { taskId, packageRoot });
    assert.notEqual(inspection.classification, "ABANDONED");
    assert.equal(inspection.evidence.lastMeaningfulEventType, "TASK_RECOVERY_RESUMED");
  });
});

test("implicit task resolution ignores recovered tasks when one mutation-active task exists", async () => {
  await withRecoveryTarget(async (target) => {
    const { taskId } = await setupAbandonedTask(target, {
      taskId: "implicit-recovered",
      writeClaims: ["tests/recovered"],
    });
    await runTaskRecover({ target, packageRoot, taskId, acknowledgeRecovery: true });
    await runTaskCreate({
      target,
      packageRoot,
      taskId: "implicit-active",
      claims: ["tests/active"],
    });

    const context = await resolveTaskContext(target, { packageRoot });
    assert.equal(context.taskId, "implicit-active");
  });
});

test("task-resume CAS-settles an unchanged stale task lock", async () => {
  const { runTaskResume } = await import("../src/commands/task-resume.js");
  await withRecoveryTarget(async (target) => {
    const { taskId } = await setupAbandonedTask(target, { taskId: "resume-stale-lock" });
    await runTaskRecover({ target, packageRoot, taskId, acknowledgeRecovery: true });
    const handle = await acquireTaskLock(target, taskId, "crashed-owner");
    const stale = {
      ...handle.lockData,
      acquiredAt: "2020-01-01T00:00:00.000Z",
      heartbeatAt: "2020-01-01T00:00:00.000Z",
      leaseMs: 1,
    };
    await overwriteFixtureLease(target, taskId, stale);

    const result = await runTaskResume({ target, packageRoot, taskId });
    assert.equal(result.resumed, true);
    assert.equal(await readLockInfo(target, taskId), null);
  });
});

test("task-resume preserves and rejects a live replacement task lock", async () => {
  const { runTaskResume } = await import("../src/commands/task-resume.js");
  await withRecoveryTarget(async (target) => {
    const { taskId } = await setupAbandonedTask(target, { taskId: "resume-replacement-lock" });
    await runTaskRecover({ target, packageRoot, taskId, acknowledgeRecovery: true });
    const replacement = await acquireTaskLock(target, taskId, "replacement-owner");

    await assert.rejects(
      () => runTaskResume({ target, packageRoot, taskId }),
      (error) => error.code === "E_TASK_LOCKED",
    );
    assert.equal((await readLockInfo(target, taskId)).lockId, replacement.lockData.lockId);
    await replacement.release();
  });
});

test("task-resume fails closed for corrupt and unknown task-lock ownership", async () => {
  const { runTaskResume } = await import("../src/commands/task-resume.js");
  await withRecoveryTarget(async (target) => {
    const { taskId } = await setupAbandonedTask(target, { taskId: "resume-invalid-lock" });
    await runTaskRecover({ target, packageRoot, taskId, acknowledgeRecovery: true });

    for (const invalidLock of ["{broken", `${JSON.stringify({ taskId, heartbeatAt: "not-a-date" })}\n`]) {
      await overwriteFixtureLease(target, taskId, invalidLock);
      await assert.rejects(
        () => runTaskResume({ target, packageRoot, taskId }),
        (error) => error.code === "E_TASK_RECOVERY_INCONSISTENT",
      );
      assert.equal(await readRawFixtureLease(target, taskId), invalidLock);
    }
  });
});
