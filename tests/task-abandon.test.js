import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { test } from "node:test";

import { runTaskAbandon } from "../src/commands/task-abandon.js";
import { runTaskResume } from "../src/commands/task-resume.js";
import { runTaskRecover } from "../src/commands/task-recover.js";
import { runTaskCreate } from "../src/commands/task-create.js";
import { readEvents, validateEventLedger } from "../src/core/events.js";
import { resolveTaskClaimState } from "../src/core/task-claim-state.js";
import { readTaskRecovery } from "../src/core/task-recovery.js";
import { readWorkState, createWorkState, writeWorkState } from "../src/core/work-state.js";
import { readTaskDescriptor } from "../src/core/task-descriptor.js";
import { ensureWithin } from "../src/core/filesystem.js";
import { taskArtifactPath } from "../src/core/task-paths.js";
import { appendProtocolEvent } from "../src/core/events.js";
import {
  packageRoot,
  setupAbandonedTask,
  withRecoveryTarget,
} from "./helpers/task-recovery-fixture.js";

async function prepareActiveReviewingTask(target, taskId = "active-reviewing") {
  const fixture = await setupAbandonedTask(target, { taskId });
  const state = await readWorkState(target, { packageRoot, taskId });
  await writeWorkState(target, createWorkState({
    ...state,
    contractFingerprint: fixture.contractHash,
    phase: "REVIEWING",
    previousPhase: "VERIFYING",
    verificationCycle: 1,
    repositoryFingerprint: { branch: null, head: null },
    verificationEvidence: [{ kind: "OBSERVED", source: "fixture", result: "focused checks passed" }],
    lastUpdated: new Date().toISOString(),
  }), { packageRoot, taskId });
  await appendProtocolEvent(target, {
    taskId,
    event: "REVIEW_STARTED",
    details: { verificationCycle: 1 },
  }, packageRoot, { taskId });
  return fixture;
}

test("task-abandon requires explicit acknowledgement and an explicit task", async () => {
  await withRecoveryTarget(async (target) => {
    const { taskId } = await prepareActiveReviewingTask(target, "abandon-auth");
    await assert.rejects(
      () => runTaskAbandon({ target, packageRoot, taskId }),
      (error) => error.code === "E_TASK_ABANDON_AUTHORIZATION_REQUIRED",
    );
    await assert.rejects(
      () => runTaskAbandon({ target, packageRoot, acknowledgeAbandonment: true }),
      (error) => error.code === "E_TASK_ABANDON_INVALID_STATE",
    );
  });
});

test("task-abandon releases active REVIEWING claims without changing lifecycle phase", async () => {
  await withRecoveryTarget(async (target) => {
    const { taskId } = await prepareActiveReviewingTask(target, "abandon-reviewing");
    const beforeState = await readWorkState(target, { packageRoot, taskId });
    const result = await runTaskAbandon({ target, packageRoot, taskId, acknowledgeAbandonment: true });

    assert.equal(result.abandoned, true);
    assert.equal(result.classification, "ABANDONED");
    assert.equal(result.phase, "REVIEWING");
    assert.equal(result.claimState, "RELEASED_BY_RECOVERY");
    assert.equal(result.mutationAllowed, false);
    assert.deepEqual(result.releasedClaims, ["tests"]);
    assert.deepEqual(result.effectiveWriteClaims, []);

    const afterState = await readWorkState(target, { packageRoot, taskId });
    assert.equal(afterState.phase, beforeState.phase);
    assert.equal(afterState.revision, beforeState.revision);
    const recovery = await readTaskRecovery(target, { packageRoot, taskId });
    assert.equal(recovery.value.classificationAtRecovery, "ABANDONED");
    assert.deepEqual(recovery.value.reasonCodes, ["CALLER_ABANDONED"]);
    assert.deepEqual(recovery.value.authority, { kind: "CALLER_ACKNOWLEDGED" });

    const events = await readEvents(target, packageRoot, { taskId });
    const abandoned = events.find((event) => event.event === "TASK_ABANDONED");
    const commit = events.find((event) => event.seq === abandoned.seq + 1);
    assert.ok(abandoned);
    assert.equal(commit.event, "TRANSACTION_COMMITTED");
    assert.equal(commit.details.operation, "task-abandon");
    assert.equal(commit.previousHash, abandoned.hash);
    assert.equal((await validateEventLedger(target, packageRoot, { taskId })).valid, true);

    const projection = await resolveTaskClaimState(target, { taskId, packageRoot });
    assert.equal(projection.claimState, "RELEASED_BY_RECOVERY");
    assert.equal(projection.ownershipValid, true);
    assert.equal(projection.mutationAllowed, false);
  });
});

test("task-abandon is append-only and refuses repeated abandonment", async () => {
  await withRecoveryTarget(async (target) => {
    const { taskId } = await prepareActiveReviewingTask(target, "abandon-repeat");
    await runTaskAbandon({ target, packageRoot, taskId, acknowledgeAbandonment: true });
    const before = await readEvents(target, packageRoot, { taskId });
    await assert.rejects(
      () => runTaskAbandon({ target, packageRoot, taskId, acknowledgeAbandonment: true }),
      (error) => error.code === "E_TASK_ALREADY_ABANDONED",
    );
    const after = await readEvents(target, packageRoot, { taskId });
    assert.equal(after.filter((event) => event.event === "TASK_ABANDONED").length, 1);
    assert.equal(after.length, before.length);
  });
});

test("task-abandon refuses inconsistent ownership and COMPLETE tasks", async () => {
  await withRecoveryTarget(async (target) => {
    const { taskId } = await prepareActiveReviewingTask(target, "abandon-corrupt");
    await readTaskDescriptor(target, taskId, packageRoot);
    await writeFile(ensureWithin(target, taskArtifactPath(taskId, "descriptor")), "{\"taskId\":", "utf8");
    await assert.rejects(
      () => runTaskAbandon({ target, packageRoot, taskId, acknowledgeAbandonment: true }),
      (error) => error.code === "E_TASK_ABANDON_INCONSISTENT",
    );
  });

  await withRecoveryTarget(async (target) => {
    const { taskId } = await prepareActiveReviewingTask(target, "abandon-complete");
    const state = await readWorkState(target, { packageRoot, taskId });
    await writeWorkState(target, createWorkState({
      ...state,
      phase: "COMPLETE",
      previousPhase: "REVIEWING",
      verificationEvidence: [{ kind: "OBSERVED", source: "fixture", result: "passed" }],
      evidenceCoverage: [],
    }), { packageRoot, taskId });
    await assert.rejects(
      () => runTaskAbandon({ target, packageRoot, taskId, acknowledgeAbandonment: true }),
      (error) => ["E_TASK_ABANDON_INVALID_STATE", "E_TASK_ABANDON_INCONSISTENT"].includes(error.code),
    );
  });
});

test("task-abandon serializes concurrent callers to one abandonment event", async () => {
  await withRecoveryTarget(async (target) => {
    const { taskId } = await prepareActiveReviewingTask(target, "abandon-concurrent");
    const results = await Promise.allSettled([
      runTaskAbandon({ target, packageRoot, taskId, acknowledgeAbandonment: true }),
      runTaskAbandon({ target, packageRoot, taskId, acknowledgeAbandonment: true }),
    ]);
    assert.equal(results.filter((item) => item.status === "fulfilled").length, 1);
    assert.equal(results.filter((item) => item.status === "rejected").length, 1);
    assert.ok(["E_TASK_ALREADY_ABANDONED", "E_TASK_LOCKED", "E_TASK_ABANDON_UNSAFE"].includes(
      results.find((item) => item.status === "rejected").reason.code,
    ));
    const events = await readEvents(target, packageRoot, { taskId });
    assert.equal(events.filter((event) => event.event === "TASK_ABANDONED").length, 1);
  });
});

test("abandonment releases claims for a replacement task and supports canonical resume", async () => {
  await withRecoveryTarget(async (target) => {
    const { taskId } = await prepareActiveReviewingTask(target, "abandon-release");
    await runTaskAbandon({ target, packageRoot, taskId, acknowledgeAbandonment: true });
    const replacement = await runTaskCreate({
      target,
      packageRoot,
      taskId: "replacement-owner",
      claims: ["tests"],
      preset: "feature",
    });
    assert.deepEqual(replacement.writeClaims, ["tests"]);
  });

  await withRecoveryTarget(async (target) => {
    const { taskId } = await prepareActiveReviewingTask(target, "abandon-resume");
    await runTaskAbandon({ target, packageRoot, taskId, acknowledgeAbandonment: true });
    const resumed = await runTaskResume({ target, packageRoot, taskId });
    assert.equal(resumed.resumed, true);
    assert.equal(resumed.mutationAllowed, true);
    const projection = await resolveTaskClaimState(target, { taskId, packageRoot });
    assert.equal(projection.claimState, "ACTIVE");
    assert.equal(projection.mutationAllowed, true);
    const events = await readEvents(target, packageRoot, { taskId });
    assert.equal(events.filter((event) => event.event === "TASK_ABANDONED").length, 1);
    assert.equal(events.filter((event) => event.event === "TASK_RECOVERY_RESUMED").length, 1);
  });
});

test("task-recover remains unavailable for a fresh active task", async () => {
  await withRecoveryTarget(async (target) => {
    const { taskId } = await prepareActiveReviewingTask(target, "abandon-recover-guard");
    await assert.rejects(
      () => runTaskRecover({ target, packageRoot, taskId, acknowledgeRecovery: true }),
      (error) => error.code === "E_TASK_RECOVERY_UNSAFE" || error.code === "E_TASK_RECOVERY_OFFICIAL_PATH_AVAILABLE",
    );
  });
});
