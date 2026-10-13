import assert from "node:assert/strict";
import { readFixtureText, overwriteFixtureText } from "./helpers/native-storage-fixture.js";
import { test } from "node:test";

import { runAudit } from "../src/commands/audit.js";
import { inspectTarget } from "../src/commands/inspect.js";
import { runStatus } from "../src/commands/status.js";
import { runTaskList } from "../src/commands/task-list.js";
import { runTaskRecover } from "../src/commands/task-recover.js";
import { runTaskScope } from "../src/commands/task-scope.js";
import { runTaskShow } from "../src/commands/task-show.js";
import { inspectTaskConflictState } from "../src/core/task-conflict-inspection.js";
import { exportTaskBundle } from "../src/core/bundles.js";
import { ensureWithin } from "../src/core/filesystem.js";
import { getNextAction, NEXT_ACTIONS } from "../src/core/next-action.js";
import { taskArtifactPath } from "../src/core/task-paths.js";
import {
  packageRoot,
  setupAbandonedTask,
  withRecoveryTarget,
} from "./helpers/task-recovery-fixture.js";

function assertInconsistentProjection(projection) {
  assert.equal(projection.claimState, "INCONSISTENT");
  assert.equal(projection.mutationAllowed, false);
  assert.deepEqual(projection.historicalWriteClaims, ["src", "tests"]);
  assert.deepEqual(projection.effectiveWriteClaims, ["src", "tests"]);
  assert.equal(projection.ownershipValid, false);
  assert.ok(projection.ownershipErrors.some((error) => error.code === "E_TASK_RECOVERY_INCONSISTENT"));
}

test("descriptor tampering during recovery converges across every ownership surface", async () => {
  await withRecoveryTarget(async (target) => {
    const { taskId } = await setupAbandonedTask(target, { taskId: "tampered-owner-surfaces" });
    await runTaskRecover({ target, packageRoot, taskId, acknowledgeRecovery: true });
    const descriptorPath = ensureWithin(target, taskArtifactPath(taskId, "descriptor"));
    const descriptor = JSON.parse(await readFixtureText(target, descriptorPath));
    await overwriteFixtureText(target, descriptorPath, `${JSON.stringify({ ...descriptor, writeClaims: ["src"] }, null, 2)}\n`);

    const listed = (await runTaskList({ target, packageRoot })).tasks.find((task) => task.taskId === taskId);
    const shown = await runTaskShow({ target, packageRoot, taskId });
    const status = await runStatus({ target, packageRoot, taskId });
    for (const projection of [listed, shown, status]) assertInconsistentProjection(projection);

    const audit = await runAudit({ target, packageRoot, taskId });
    assert.equal(audit.claims.state, "INCONSISTENT");
    assert.equal(audit.claims.ownershipValid, false);
    assert.deepEqual(audit.claims.effective, ["src", "tests"]);

    const inspectionReport = await inspectTarget({ target, packageRoot, taskId });
    assert.equal(inspectionReport.claims.state, "INCONSISTENT");
    assert.equal(inspectionReport.claims.ownershipValid, false);
    assert.deepEqual(inspectionReport.claims.effective, ["src", "tests"]);

    const conflict = await inspectTaskConflictState(target, { taskId, packageRoot });
    assert.equal(conflict.classification, "INCONSISTENT");
    assert.equal(conflict.evidence.claimState, "INCONSISTENT");

    const next = await getNextAction({ target, packageRoot, taskId });
    assert.equal(next.nextAction, NEXT_ACTIONS.RESOLVE_RECOVERY_INCONSISTENCY);

    await assert.rejects(
      () => runTaskScope({ target, packageRoot, taskId, claims: ["docs"] }),
      (error) => error.code === "E_TASK_CLAIM_OWNERSHIP_INCONSISTENT",
    );
    await assert.rejects(
      () => exportTaskBundle(target, taskId, packageRoot),
      (error) => error.code === "E_TASK_CLAIM_OWNERSHIP_INCONSISTENT",
    );
  });
});
