import assert from "node:assert/strict";
import { test } from "node:test";

import { packageRoot as fixturePackageRoot, setupAbandonedTask, withRecoveryTarget } from "../../../tests/helpers/task-recovery-fixture.js";
import { runTaskRecover } from "../../../src/commands/task-recover.js";
import { executeForgeLoopCommand } from "@cassiomc1/forgeloop/integration";


/**
 * Plan §71 scenario B through the integration runtime (which is exactly what
 * MCP tool calls execute): two concurrent task-resume invocations for the
 * same recovered task must produce exactly one winner; the project claims
 * lock and canonical revalidation serialize ownership transitions.
 */
test("concurrent task-resume invocations yield one winner and no duplicate ownership transition", async () => {
  await withRecoveryTarget(async (target) => {
    const { taskId } = await setupAbandonedTask(target, { taskId: "mcp-concurrent-resume" });
    await runTaskRecover({ target, fixturePackageRoot, taskId, acknowledgeRecovery: true });

    const [first, second] = await Promise.all([
      executeForgeLoopCommand({ command: "task-resume", projectPath: target, input: { taskId } }),
      executeForgeLoopCommand({ command: "task-resume", projectPath: target, input: { taskId } }),
    ]);

    const winners = [first, second].filter((envelope) => envelope.ok && envelope.result?.resumed === true);
    assert.equal(winners.length, 1, `expected exactly one resume winner, got ${winners.length}`);

    // The loser fails closed with a canonical error (locked or already resumed).
    const loser = [first, second].find((envelope) => envelope !== winners[0]);
    assert.equal(loser.ok, false);
    assert.match(loser.error.code ?? "", /E_TASK_LOCKED|E_TASK_NOT_RECOVERED|E_TASK_RECOVERY_INCONSISTENT|E_TASK_REQUIRED|E_STATE_REVISION_CONFLICT/);

    // Ownership ends ACTIVE exactly once with claims reacquired.
    const ownership = await executeForgeLoopCommand({
      command: "status",
      projectPath: target,
      input: { taskId },
    });
    assert.equal(ownership.result.claimState, "ACTIVE");
    assert.deepEqual(ownership.result.effectiveWriteClaims, ["tests"]);
  });
});

/**
 * Plan §71 scenario A through the integration runtime: resuming a recovered
 * task whose released claims are owned by another active task must fail with
 * E_TASK_SCOPE_CONFLICT and leave recovery intact.
 */
test("task-resume against conflicting active owner keeps the recovered state", async () => {
  await withRecoveryTarget(async (target) => {
    const { taskId } = await setupAbandonedTask(target, { taskId: "mcp-resume-conflict" });
    await runTaskRecover({ target, fixturePackageRoot, taskId, acknowledgeRecovery: true });

    // Another task acquires the released claims now that they are free.
    const created = await executeForgeLoopCommand({
      command: "task-create",
      projectPath: target,
      input: { taskId: "mcp-conflict-owner", claims: ["tests"] },
    });
    assert.equal(created.ok, true, JSON.stringify(created.error));

    const resumed = await executeForgeLoopCommand({
      command: "task-resume",
      projectPath: target,
      input: { taskId },
    });
    assert.equal(resumed.ok, false);
    assert.equal(resumed.error.code, "E_TASK_SCOPE_CONFLICT");

    // Recovery remains active and mutation authority is not restored.
    const ownership = await executeForgeLoopCommand({
      command: "status",
      projectPath: target,
      input: { taskId },
    });
    assert.equal(ownership.result.claimState, "RELEASED_BY_RECOVERY");
    assert.equal(ownership.result.mutationAllowed, false);
  });
});
