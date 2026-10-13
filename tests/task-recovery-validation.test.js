import assert from "node:assert/strict";
import { readFixtureText, overwriteFixtureText } from "./helpers/native-storage-fixture.js";
import { test } from "node:test";

import { runTaskRecover } from "../src/commands/task-recover.js";
import { runTaskResume } from "../src/commands/task-resume.js";
import { runValidateProtocol } from "../src/commands/validate-protocol.js";
import { ensureWithin } from "../src/core/filesystem.js";
import { taskArtifactPath } from "../src/core/task-paths.js";
import { createTaskRecovery } from "../src/core/task-recovery.js";
import {
  packageRoot,
  setupAbandonedTask,
  withRecoveryTarget,
} from "./helpers/task-recovery-fixture.js";

function recoveryErrors(result) {
  return result.errors.filter((error) => error.code === "E_TASK_RECOVERY_INCONSISTENT");
}

test("validate-protocol verifies recovery artifact and ledger consistency", async () => {
  await withRecoveryTarget(async (target) => {
    const { taskId } = await setupAbandonedTask(target, { taskId: "validate-recovery" });
    await runTaskRecover({ target, packageRoot, taskId, acknowledgeRecovery: true });

    const valid = await runValidateProtocol({ target, packageRoot, taskId });
    assert.deepEqual(recoveryErrors(valid), []);

    const recoveryPath = ensureWithin(target, taskArtifactPath(taskId, "recovery"));
    const tampered = JSON.parse(await readFixtureText(target, recoveryPath));
    tampered.recoveryEventSeq += 1;
    await overwriteFixtureText(target, recoveryPath, `${JSON.stringify(tampered, null, 2)}\n`);

    const invalid = await runValidateProtocol({ target, packageRoot, taskId });
    assert.equal(invalid.status, "INVALID");
    assert.ok(recoveryErrors(invalid).length > 0);
  });
});

test("validate-protocol accepts a matched recovery and resume history without an active tombstone", async () => {
  await withRecoveryTarget(async (target) => {
    const { taskId } = await setupAbandonedTask(target, { taskId: "validate-resumed-recovery" });
    await runTaskRecover({ target, packageRoot, taskId, acknowledgeRecovery: true });
    await runTaskResume({ target, packageRoot, taskId });

    const result = await runValidateProtocol({ target, packageRoot, taskId });
    assert.deepEqual(recoveryErrors(result), []);
  });
});

test("HOST_ATTESTED recovery cannot be self-asserted without a host grant reference", () => {
  assert.throws(
    () => createTaskRecovery({
      taskId: "host-recovery",
      recoveredAt: "2026-08-22T12:00:00.000Z",
      recoveryId: "recovery-host-grant",
      recoveryEventSeq: 1,
      classificationAtRecovery: "STALE",
      reasonCodes: ["IDLE_BEYOND_THRESHOLD"],
      releasedClaims: ["src"],
      previousPhase: "PLANNED",
      previousRevision: 1,
      repositoryFingerprint: { branch: "main", head: null },
      authority: { kind: "HOST_ATTESTED" },
    }),
    (error) => error.code === "E_TASK_RECOVERY_AUTHORITY_INVALID",
  );
});
