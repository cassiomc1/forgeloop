import { withProjectStorage } from "../src/storage/project-boundary.js";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { test } from "node:test";

import {
  packageRoot,
  setupAbandonedTask,
  withRecoveryTarget,
} from "./helpers/task-recovery-fixture.js";

const cliPath = path.join(packageRoot, "src", "cli.js");

function runCli(target, ...args) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: target,
    encoding: "utf8",
    env: { ...process.env, FORGELOOP_TASK: "" },
  });
}

test("task-recover and task-resume expose the durable recovery lifecycle through CLI JSON", async () => {
  await withRecoveryTarget(async (target) => {
    const { taskId } = await withProjectStorage(target, () => setupAbandonedTask(target, { taskId: "cli-recovery" }));
    const recovered = runCli(
      target,
      "task-recover",
      "--task",
      taskId,
      "--acknowledge-recovery",
      "--json",
    );
    assert.equal(recovered.status, 0, recovered.stderr);
    assert.equal(JSON.parse(recovered.stdout).authority.kind, "CALLER_ACKNOWLEDGED");

    const resumed = runCli(target, "task-resume", "--task", taskId, "--json");
    assert.equal(resumed.status, 0, resumed.stderr);
    assert.deepEqual(JSON.parse(resumed.stdout).reacquiredClaims, ["tests"]);
  });
});

test("deprecated operator authorization is only a caller-acknowledgement alias", async () => {
  await withRecoveryTarget(async (target) => {
    const { taskId } = await withProjectStorage(target, () => setupAbandonedTask(target, { taskId: "cli-recovery-alias" }));
    const recovered = runCli(
      target,
      "task-recover",
      "--task",
      taskId,
      "--operator-authorized",
      "--json",
    );
    assert.equal(recovered.status, 0, recovered.stderr);
    assert.match(recovered.stderr, /not host attestation/i);
    assert.equal(JSON.parse(recovered.stdout).authority.kind, "CALLER_ACKNOWLEDGED");
  });
});
