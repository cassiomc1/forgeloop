import assert from "node:assert/strict";
import { readFixtureText, overwriteFixtureText } from "./helpers/native-storage-fixture.js";
import { test } from "node:test";

import { runTaskRecover } from "../src/commands/task-recover.js";
import { ensureWithin } from "../src/core/filesystem.js";
import { getNextAction, NEXT_ACTIONS } from "../src/core/next-action.js";
import { taskArtifactPath } from "../src/core/task-paths.js";
import {
  packageRoot,
  setupAbandonedTask,
  setupRecoverableTask,
  withRecoveryTarget,
} from "./helpers/task-recovery-fixture.js";

test("next routes abandoned tasks to caller-acknowledged recovery", async () => {
  await withRecoveryTarget(async (target) => {
    const { taskId } = await setupAbandonedTask(target, { taskId: "next-recover" });
    const next = await getNextAction({ target, packageRoot, taskId });

    assert.equal(next.nextAction, NEXT_ACTIONS.RECOVER_TASK);
    assert.equal(next.commandSpecs[0].commandId, "task-recover");
    assert.ok(next.commandSpecs[0].requiredInputs.some((input) => input.name === "acknowledgeRecovery"));
  });
});

test("next routes active recovered state to task-resume", async () => {
  await withRecoveryTarget(async (target) => {
    const { taskId } = await setupAbandonedTask(target, { taskId: "next-resume" });
    await runTaskRecover({ target, packageRoot, taskId, acknowledgeRecovery: true });
    const next = await getNextAction({ target, packageRoot, taskId });

    assert.equal(next.nextAction, NEXT_ACTIONS.RESUME_RECOVERED_TASK);
    assert.deepEqual(next.commandSpecs[0].argv, ["task-resume", `--task=${taskId}`, "--json"]);
  });
});

test("next preserves the canonical reconciliation path for RECOVERABLE tasks", async () => {
  await withRecoveryTarget(async (target) => {
    const { taskId } = await setupRecoverableTask(target, { taskId: "next-reconcile" });
    const next = await getNextAction({ target, packageRoot, taskId });

    assert.equal(next.nextAction, NEXT_ACTIONS.RECONCILE_CLOSURE);
    assert.equal(next.commandSpecs[0].commandId, "reconcile-closure");
  });
});

test("next fails closed on recovery artifact and ledger mismatch", async () => {
  await withRecoveryTarget(async (target) => {
    const { taskId } = await setupAbandonedTask(target, { taskId: "next-inconsistent" });
    await runTaskRecover({ target, packageRoot, taskId, acknowledgeRecovery: true });
    const recoveryPath = ensureWithin(target, taskArtifactPath(taskId, "recovery"));
    const recovery = JSON.parse(await readFixtureText(target, recoveryPath));
    recovery.recoveryEventSeq += 1;
    await overwriteFixtureText(target, recoveryPath, `${JSON.stringify(recovery, null, 2)}\n`);

    const next = await getNextAction({ target, packageRoot, taskId });
    assert.equal(next.nextAction, NEXT_ACTIONS.RESOLVE_RECOVERY_INCONSISTENCY);
    assert.ok(next.reasonCodes.includes("E_TASK_RECOVERY_INCONSISTENT"));
  });
});
