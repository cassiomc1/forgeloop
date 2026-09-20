import assert from "node:assert/strict";
import { test } from "node:test";

import { readForgeLoopIntegrationResource } from "../src/integration.js";
import { runComplete } from "../src/commands/complete.js";
import { runAdvance } from "../src/commands/advance.js";
import { recordCheck } from "../src/core/completion-artifacts.js";
import { packageRoot, setupAbandonedTask, withRecoveryTarget } from "./helpers/task-recovery-fixture.js";
import { setupVerifyingTask } from "./helpers/durable-lifecycle.js";

function resource(target, taskId, options = {}) {
  return readForgeLoopIntegrationResource("task/audit-view", {
    projectPath: target,
    packageRoot,
    taskId,
    ...options,
  });
}

test("task/audit-view is a deterministic bounded read-only projection", async () => {
  await withRecoveryTarget(async (target) => {
    const taskId = "audit-ux-view";
    await setupVerifyingTask(target, packageRoot, { taskId, requirement: "tests" });
    let providerCalls = 0;
    const runtimeContext = {
      browserVerificationProviders: {
        forbidden: () => {
          providerCalls += 1;
          throw new Error("provider invocation is outside the audit-view contract");
        },
      },
    };
    const first = await resource(target, taskId, { runtimeContext, limit: 3 });
    const second = await resource(target, taskId, { runtimeContext, limit: 3 });
    assert.deepEqual(first.data, second.data);
    assert.equal(providerCalls, 0);
    assert.equal(first.data.readOnly, true);
    assert.deepEqual(first.data.authority, {
      readOnly: true,
      lifecycleAuthority: false,
      evidenceAuthority: false,
      completionAuthority: false,
      mutationAuthority: false,
      externalExecution: false,
    });
    assert.equal(first.data.lifecycle.phase, "VERIFYING");
    assert.equal(first.data.timeline.items.length, 3);
    assert.equal(first.data.timeline.truncated, true);
    assert.deepEqual(first.data.timeline.items.map((item) => item.id), ["event-12", "event-13", "event-14"]);
    assert.ok(first.data.timeline.items.every((item) => item.timestamp === null || typeof item.timestamp === "string"));
    assert.equal(Object.prototype.hasOwnProperty.call(first.data.timeline.items[0], "data"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(first.data.timeline.items[0], "source"), false);

    const serialized = JSON.stringify(first.data);
    assert.doesNotMatch(serialized, /\/Users\/|\/home\/|\/private\/|\/tmp\/|C:\\\\|TOKEN=|SECRET=/u);
    assert.doesNotMatch(serialized, /commandArgv|executable|shell|credentials|secrets/u);

    const checksOnly = await resource(target, taskId, { categories: ["CHECK"], limit: 10 });
    assert.deepEqual(checksOnly.data.timeline.items, []);
    const after = await resource(target, taskId, { afterSequence: 12, limit: 10 });
    assert.ok(after.data.timeline.items.every((item) => item.sequence > 12));
    const before = await resource(target, taskId, { beforeSequence: 13, limit: 10 });
    assert.ok(before.data.timeline.items.every((item) => item.sequence < 13));
    await assert.rejects(
      () => resource(target, taskId, { categories: ["../etc"] }),
      (error) => error.code === "E_AUDIT_UX_INPUT_INVALID",
    );
  });
});

test("task/audit-view projects canonical completion and released ownership", async () => {
  await withRecoveryTarget(async (target) => {
    const taskId = "audit-ux-complete";
    await setupVerifyingTask(target, packageRoot, { taskId, requirement: "tests" });
    await recordCheck({
      target,
      packageRoot,
      taskId,
      id: "tests",
      kind: "manual-review",
      requirement: "tests",
      status: "passed",
      evidenceKind: "OBSERVED",
      result: "tests passed",
      exitCode: 0,
    });
    await recordCheck({
      target,
      packageRoot,
      taskId,
      id: "required-action",
      kind: "manual-review",
      requirement: "required action satisfies tests",
      status: "passed",
      evidenceKind: "OBSERVED",
      result: "required action satisfied tests",
      exitCode: 0,
    });
    await runAdvance({ target, packageRoot, taskId, to: "REVIEWING" });
    const completion = await runComplete({ target, packageRoot, taskId });
    assert.equal(completion.status, "VALID");
    const view = await resource(target, taskId);
    assert.equal(view.data.completion.state, "COMPLETE");
    assert.equal(view.data.completion.valid, true);
    assert.equal(view.data.completion.claimsReleased, true);
    assert.equal(view.data.ownership.claimState, "RELEASED_BY_COMPLETION");
    assert.equal(view.data.ownership.ownershipValid, true);
    assert.equal(view.data.ownership.mutationAllowed, false);
    assert.equal(view.data.lifecycle.phase, "COMPLETE");
    assert.equal(view.data.lifecycle.terminal, true);
  });
});

test("task/audit-view remains useful and fail-closed for stale inconsistent state", async () => {
  await withRecoveryTarget(async (target) => {
    const taskId = "audit-ux-stale";
    await setupAbandonedTask(target, { taskId });
    const view = await resource(target, taskId);
    assert.equal(view.data.integrity.valid, false);
    assert.ok(view.data.integrity.reasonCodes.length > 0);
    assert.equal(view.data.ownership.claimState, "ACTIVE");
    assert.equal(view.data.ownership.ownershipValid, true);
    assert.equal(view.data.health.currentNextAction, "RECOVER_TASK");
  });
});

test("task/audit-view rejects missing and unknown subjects", async () => {
  await withRecoveryTarget(async (target) => {
    await assert.rejects(
      () => readForgeLoopIntegrationResource("task/audit-view", { projectPath: target, packageRoot }),
      (error) => error.code === "E_TASK_REQUIRED",
    );
    await assert.rejects(
      () => resource(target, "../escape"),
      (error) => error.code === "E_TASK_NOT_FOUND",
    );
  });
});
