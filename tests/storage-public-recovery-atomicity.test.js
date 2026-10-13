import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { executeForgeLoopCommand } from "../src/core/command-runtime.js";
import { discoverTasks } from "../src/core/task-discovery.js";
import { readTaskRecovery } from "../src/core/task-recovery.js";
import { readWorkState } from "../src/core/work-state.js";
import { openStorageDatabase } from "../src/storage/index.js";
import { packageRoot, setupAbandonedTask, withRecoveryTarget } from "./helpers/task-recovery-fixture.js";

function snapshot(db) {
  return db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all().map(({ name }) => ({
      name,
      rows: db.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`)
        .all().map(row => JSON.stringify(row)).sort(),
    }));
}

for (const command of ["task-recover", "task-resume"]) {
  test(`public ${command} rolls back ownership and artifacts when its event insert fails`, async () => {
    await withRecoveryTarget(async target => {
      const { taskId } = await setupAbandonedTask(target, { taskId: `atomic-${command}` });
      const recover = () => executeForgeLoopCommand({
        command: "task-recover", projectPath: target, input: { taskId, acknowledgeRecovery: true },
      });
      if (command === "task-resume") {
        const recovered = await recover();
        assert.equal(recovered.ok, true, JSON.stringify(recovered));
      }
      const event = command === "task-recover" ? "OPERATOR_RECOVERY_RECORDED" : "TASK_RECOVERY_RESUMED";
      const invoke = command === "task-recover" ? recover : () => executeForgeLoopCommand({
        command, projectPath: target, input: { taskId, claims: ["src"] },
      });
      const db = openStorageDatabase(path.join(target, ".forgeloop/state.sqlite"));
      try {
        const state = await readWorkState(target, { packageRoot, taskId });
        const before = snapshot(db);
        db.exec(`CREATE TRIGGER public_recovery_fault AFTER INSERT ON events
          WHEN NEW.event_type = '${event}'
          BEGIN SELECT RAISE(ABORT, 'PUBLIC_RECOVERY_EVENT_FAULT'); END`);
        try {
          const failed = await invoke();
          assert.equal(failed.ok, false, JSON.stringify(failed));
          assert.match(JSON.stringify(failed.error), /PUBLIC_RECOVERY_EVENT_FAULT/);
          assert.deepEqual(snapshot(db), before);
          assert.equal(db.isTransaction, false);
        } finally { db.exec("DROP TRIGGER public_recovery_fault"); }

        const retried = await invoke();
        assert.equal(retried.ok, true, JSON.stringify(retried));
        assert.deepEqual(await readWorkState(target, { packageRoot, taskId }), state);
        const task = (await discoverTasks(target, packageRoot)).find(item => item.taskId === taskId);
        const recovery = await readTaskRecovery(target, { packageRoot, taskId });
        if (command === "task-recover") {
          assert.equal(retried.result.claimsReleased, true);
          assert.deepEqual(task.writeClaims, []);
          assert.equal(task.mutationAllowed, false);
          assert.equal(recovery.value.recoveryId, retried.result.recoveryId);
        } else {
          assert.deepEqual(retried.result.reacquiredClaims, ["src"]);
          assert.deepEqual(task.writeClaims, ["src"]);
          assert.equal(task.mutationAllowed, true);
          assert.equal(recovery, null);
        }
        assert.equal(db.prepare("SELECT COUNT(*) AS count FROM events WHERE task_id = ? AND event_type = ?")
          .get(taskId, event).count, 1);
      } finally { db.close(); }
    });
  });
}
