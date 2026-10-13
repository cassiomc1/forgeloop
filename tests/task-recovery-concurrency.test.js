import assert from "node:assert/strict";
import { test } from "node:test";

import { runTaskCreate } from "../src/commands/task-create.js";
import { runTaskRecover } from "../src/commands/task-recover.js";
import { runTaskResume } from "../src/commands/task-resume.js";
import { discoverTasks } from "../src/core/task-discovery.js";
import { readEvents } from "../src/core/events.js";
import {
  packageRoot,
  setupAbandonedTask,
  withRecoveryTarget,
} from "./helpers/task-recovery-fixture.js";

test("concurrent task-create and task-recover never produce duplicate active ownership", async () => {
  await withRecoveryTarget(async (target) => {
    const { taskId } = await setupAbandonedTask(target, { taskId: "concurrent-old-owner" });
    await Promise.allSettled([
      runTaskRecover({ target, packageRoot, taskId, acknowledgeRecovery: true }),
      runTaskCreate({ target, packageRoot, taskId: "concurrent-new-owner", claims: ["tests"] }),
    ]);

    const tasks = await discoverTasks(target, packageRoot);
    const activeOwners = tasks.filter((task) => task.writeClaims?.includes("tests"));
    assert.ok(activeOwners.length <= 1, `active owners: ${activeOwners.map((task) => task.taskId).join(", ")}`);
  });
});

test("concurrent task-resume attempts reacquire released claims exactly once", async () => {
  await withRecoveryTarget(async (target) => {
    const { taskId } = await setupAbandonedTask(target, { taskId: "concurrent-resume" });
    await runTaskRecover({ target, packageRoot, taskId, acknowledgeRecovery: true });

    const outcomes = await Promise.allSettled([
      runTaskResume({ target, packageRoot, taskId }),
      runTaskResume({ target, packageRoot, taskId }),
    ]);
    assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);

    const task = (await discoverTasks(target, packageRoot)).find((candidate) => candidate.taskId === taskId);
    assert.deepEqual(task.writeClaims, ["tests"]);
    const resumeEvents = (await readEvents(target, packageRoot, { taskId }))
      .filter((event) => event.event === "TASK_RECOVERY_RESUMED");
    assert.equal(resumeEvents.length, 1);
  });
});

test("concurrent task-recover attempts produce one recovery without duplicate state or events", async () => {
  await withRecoveryTarget(async (target) => {
    const { taskId } = await setupAbandonedTask(target, { taskId: "concurrent-recover" });
    const outcomes = await Promise.allSettled([
      runTaskRecover({ target, packageRoot, taskId, acknowledgeRecovery: true }),
      runTaskRecover({ target, packageRoot, taskId, acknowledgeRecovery: true }),
    ]);

    assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
    const rejected = outcomes.find((outcome) => outcome.status === "rejected");
    assert.ok(
      ["E_TASK_ALREADY_RECOVERED", "E_TASK_LOCKED"].includes(rejected.reason.code),
      `unexpected concurrent recovery error: ${rejected.reason.stack}`,
    );
    const recoveryEvents = (await readEvents(target, packageRoot, { taskId }))
      .filter((event) => event.event === "OPERATOR_RECOVERY_RECORDED");
    assert.equal(recoveryEvents.length, 1);
  });
});
