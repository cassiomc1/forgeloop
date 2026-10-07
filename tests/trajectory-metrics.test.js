import { ensureFixtureTask } from "./helpers/native-storage-fixture.js";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { removeTempTree } from "./helpers/rm-safe.js";
import { getPackageRoot } from "../src/core/templates.js";
import { appendProtocolEvent } from "../src/core/events.js";
import { createWorkState, writeWorkState } from "../src/core/work-state.js";
import { createEvidence } from "../src/core/evidence.js";
import { proposeAction, transitionAction, transitionAuthorizedAction, readAction } from "../src/core/actions.js";
import { buildTrajectoryMetrics } from "../src/core/trajectory-metrics.js";
import { providerUsage } from "../src/core/usage.js";
import { openStorageDatabase } from "../src/storage/index.js";
import { buildEfficiencyReport } from "../src/core/efficiency.js";
import { createContract, writeContract } from "../src/core/contract.js";

const packageRoot = getPackageRoot();

async function withTarget(run) {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-trajectory-metrics-"));
  try {
    await run(target);
  } finally {
    await removeTempTree(target);
  }
}

async function seedTask(target, taskId = "task-metrics") {
  await ensureFixtureTask(target, taskId, packageRoot);
  const fingerprint = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  const state = createWorkState({
    taskId,
    contractFingerprint: fingerprint,
    routeFingerprint: fingerprint,
    repositoryFingerprint: { branch: null, head: null },
    phase: "COMPLETE",
    completedSteps: ["contract", "route", "implementation", "verification"],
    pendingSteps: [],
    verificationCycle: 2,
    checks: [{ id: "tests", requirement: "tests", status: "passed", evidenceKind: "OBSERVED" }],
    verificationEvidence: [createEvidence({ kind: "OBSERVED", source: "tests", result: "passed" })],
  });
  await writeWorkState(target, state, { packageRoot, taskId });
  for (const entry of [
    ["TASK_RECEIVED"],
    ["CONTRACT_VALIDATED"],
    ["ROUTE_VALIDATED"],
    ["EXECUTION_STARTED"],
    ["VERIFICATION_STARTED", { verificationCycle: 1 }],
    ["VERIFICATION_RECORDED", { id: "tests", requirement: "tests", status: "passed", exitCode: 0, verificationCycle: 1 }],
    ["VERIFICATION_STARTED", { verificationCycle: 2 }],
    ["VERIFICATION_RECORDED", { id: "tests", requirement: "tests", status: "passed", exitCode: 0, verificationCycle: 2 }],
    ["COMPLETION_VALIDATED"],
  ]) {
    await appendProtocolEvent(target, {
      taskId,
      event: entry[0],
      ...(entry[1] ? { details: entry[1] } : {}),
    }, packageRoot, { taskId });
  }
}

test("trajectory metrics are deterministic canonical projections and preserve unknown usage", async () => {
  await withTarget(async (target) => {
    await seedTask(target);
    await proposeAction(target, {
      packageRoot,
      taskId: "task-metrics",
      input: {
        actionId: "action-metrics",
        effectClass: "EXTERNAL_PUBLICATION",
        capability: "repository.push",
        operation: "push release",
        target: "origin/release",
        idempotencyKey: "task-metrics:push:v1",
        requiredForCompletion: true,
        requirement: "publication",
        provenance: "HOST_REPORTED",
      },
    });
    const action = await readAction(target, {
      packageRoot,
      taskId: "task-metrics",
      actionId: "action-metrics",
    });
    await transitionAuthorizedAction(target, {
      packageRoot,
      taskId: "task-metrics",
      actionId: "action-metrics",
      expectedRevision: 0,
      expectedFingerprint: action.actionFingerprint,
      details: {
        actionFingerprint: action.actionFingerprint,
        capabilityDecision: "ALLOW",
        capabilityPolicyFingerprint: "a".repeat(64),
        policyLockDigest: `sha256:${"b".repeat(64)}`,
        taskPolicyDigest: `sha256:${"c".repeat(64)}`,
      },
    });
    await transitionAction(target, {
      packageRoot,
      taskId: "task-metrics",
      actionId: "action-metrics",
      to: "STARTED",
    });
    await transitionAction(target, {
      packageRoot,
      taskId: "task-metrics",
      actionId: "action-metrics",
      to: "COMMIT_UNKNOWN",
    });
    const { reconcileAction } = await import("../src/core/action-reconciliation.js");
    await reconcileAction({
      target,
      packageRoot,
      taskId: "task-metrics",
      actionId: "action-metrics",
      outcome: "UNKNOWN",
      evidenceRefs: ["observation-unknown"],
      provenance: "EXTERNAL_OBSERVED",
    });
    const first = await buildTrajectoryMetrics({ target, packageRoot, taskId: "task-metrics" });
    const second = await buildTrajectoryMetrics({ target, packageRoot, taskId: "task-metrics" });

    assert.deepEqual({ ...first, timing: { ...first.timing, firstEventAt: null, lastEventAt: null } },
      { ...second, timing: { ...second.timing, firstEventAt: null, lastEventAt: null } });
    assert.equal(first.trajectory.verificationCycles, 2);
    assert.equal(first.actions.total, 1);
    assert.equal(first.actions.ambiguous, 1);
    assert.equal(first.actions.reconciliations, 1);
    assert.equal(first.usage.inputTokens, null);
    assert.equal(first.usage.outputTokens, null);
    assert.equal(first.usage.cacheReadTokens, null);
    assert.equal(first.usage.cacheWriteTokens, null);
    assert.equal(first.usage.totalTokens, null);
    assert.equal(first.usage.costUsd, null);
    assert.equal(first.usage.model, null);
    assert.equal(first.usage.provider, null);
    assert.equal(first.usage.source, "UNKNOWN");
    assert.equal(first.comparableSteps, 5);
  });
});

test("trajectory metrics preserve trusted host usage and never promote actor usage", async () => {
  await withTarget(async (target) => {
    await seedTask(target, "task-host-usage");
    const calls = [];
    const metrics = await buildTrajectoryMetrics({
      target,
      packageRoot,
      taskId: "task-host-usage",
      runtimeContext: {
        usageProvider: {
          async getTaskUsage(input) {
            calls.push(input);
            return {
              inputTokens: 12,
              outputTokens: 4,
              cacheReadTokens: null,
              cacheWriteTokens: 2,
              totalTokens: 18,
              costUsd: null,
              model: "provider/model",
              provider: "provider",
              source: "HOST_REPORTED",
            };
          },
        },
      },
    });
    assert.deepEqual(metrics.usage, {
      inputTokens: 12,
      outputTokens: 4,
      cacheReadTokens: null,
      cacheWriteTokens: 2,
      totalTokens: 18,
      costUsd: null,
      model: "provider/model",
      provider: "provider",
      source: "HOST_REPORTED",
    });
    assert.deepEqual(calls, [{ projectPath: target, taskId: "task-host-usage" }]);
    assert.deepEqual(providerUsage(null), {
      inputTokens: null,
      outputTokens: null,
      cacheReadTokens: null,
      cacheWriteTokens: null,
      totalTokens: null,
      costUsd: null,
      model: null,
      provider: null,
      source: "UNKNOWN",
    });
    assert.throws(
      () => providerUsage({ source: "ACTOR_REPORTED", totalTokens: 18 }),
      (error) => error.code === "E_USAGE_SOURCE_INVALID",
    );
  });
});

test("usage normalizer rejects negative and non-integer token values", () => {
  assert.throws(
    () => providerUsage({ source: "HOST_REPORTED", inputTokens: -1 }),
    (error) => error.code === "E_USAGE_INVALID",
  );
  assert.throws(
    () => providerUsage({ source: "HOST_REPORTED", outputTokens: 1.5 }),
    (error) => error.code === "E_USAGE_INVALID",
  );
});

test("native metrics retain action readiness across a concurrent provider callback write", async () => {
  await withTarget(async target => {
    const taskId = "task-metrics-snapshot";
    await seedTask(target, taskId);
    await proposeAction(target, { packageRoot, taskId, input: {
      actionId: "action-pending", effectClass: "EXTERNAL_PUBLICATION", capability: "repository.push",
      operation: "push", target: "origin/main", idempotencyKey: "metrics:pending",
      requiredForCompletion: true, requirement: "publication", provenance: "HOST_REPORTED",
    } });
    const before = await buildTrajectoryMetrics({ target, packageRoot, taskId });
    assert.equal(before.actions.unresolvedRequired, 1);
    const writer = openStorageDatabase(path.join(target, ".forgeloop/state.sqlite"));
    try {
      const metrics = await buildTrajectoryMetrics({ target, packageRoot, taskId, runtimeContext: {
        usageProvider: { async getTaskUsage() {
          writer.prepare("DELETE FROM actions WHERE task_id = ?").run(taskId);
          return null;
        } },
      } });
      assert.equal(metrics.actions.total, before.actions.total);
      assert.equal(metrics.actions.unresolvedRequired, before.actions.unresolvedRequired);
      const after = await buildTrajectoryMetrics({ target, packageRoot, taskId });
      assert.equal(after.actions.total, 0);
      assert.equal(after.actions.unresolvedRequired, 0);
    } finally { writer.close(); }
  });
});

test("native efficiency binds its contract and metrics to the same read snapshot", async () => {
  await withTarget(async target => {
    const taskId = "task-efficiency-snapshot";
    await seedTask(target, taskId);
    await writeContract(target, createContract({ taskId, objective: "Measure efficiency", deliverables: ["src"],
      verification: ["tests"], successCriteria: ["tests"] }), packageRoot, { taskId });
    const before = await buildEfficiencyReport({ target, packageRoot, taskId });
    assert.ok(before.comparison.metadata.promptSpecFingerprint);
    const writer = openStorageDatabase(path.join(target, ".forgeloop/state.sqlite"));
    try {
      const report = await buildEfficiencyReport({ target, packageRoot, taskId, runtimeContext: { usageProvider: {
        async getTaskUsage() { writer.prepare("DELETE FROM task_artifacts WHERE task_id = ? AND kind = 'contract'").run(taskId); return null; },
      } } });
      assert.equal(report.comparison.metadata.promptSpecFingerprint, before.comparison.metadata.promptSpecFingerprint);
      assert.equal((await buildEfficiencyReport({ target, packageRoot, taskId })).comparison.metadata.promptSpecFingerprint, null);
    } finally { writer.close(); }
  });
});
