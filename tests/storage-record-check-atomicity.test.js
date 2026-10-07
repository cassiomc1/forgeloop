import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { createGitRepository } from "./helpers/git-fixture.js";
import { removeTempTree } from "./helpers/rm-safe.js";
import { setupVerifyingTask } from "./helpers/durable-lifecycle.js";
import { getPackageRoot } from "../src/core/templates.js";
import { runRecordCheck } from "../src/commands/record-check.js";
import { prepareCompletion, recordCheck } from "../src/core/completion-artifacts.js";
import { taskArtifactPath } from "../src/core/task-paths.js";
import { openStorageDatabase } from "../src/storage/index.js";
import { withOperationalStore } from "../src/storage/unit-of-work.js";

function taskRecords(db, taskId) {
  return {
    task: db.prepare("SELECT * FROM tasks WHERE task_id = ?").get(taskId),
    artifacts: db.prepare("SELECT * FROM task_artifacts WHERE task_id = ? ORDER BY kind, artifact_id").all(taskId),
    events: db.prepare("SELECT * FROM events WHERE task_id = ? ORDER BY seq").all(taskId),
  };
}

for (const entry of ["command", "direct API"]) for (const point of ["receipt", "event"]) {
  test(`record-check ${entry} rolls back state, receipt and ledger after ${point} staging failure`, async () => {
    const target = await createGitRepository("forgeloop-record-check-atomic-");
    const packageRoot = getPackageRoot();
    const taskId = "atomic-check";
    let db;
    try {
      await setupVerifyingTask(target, packageRoot, { taskId, requirement: "tests" });
      db = openStorageDatabase(path.join(target, ".forgeloop/state.sqlite"));
      const before = taskRecords(db, taskId);
      const input = { target, packageRoot, taskId, id: "manual-check", kind: "manual-review",
        requirement: "tests", status: "not-run", evidenceKind: "NOT_VERIFIED", result: "not observed" };
      const record = entry === "command" ? runRecordCheck : recordCheck;
      await withOperationalStore({ db, target }, async source => {
        const prototype = Object.getPrototypeOf(source);
        const method = point === "receipt" ? "stageText" : "appendText";
        const originalStage = prototype[method];
        let reached = false;
        prototype[method] = function(relativePath, text) {
          const result = originalStage.call(this, relativePath, text);
          const fail = point === "receipt" ? relativePath === taskArtifactPath(taskId, "receipt")
            : relativePath === taskArtifactPath(taskId, "events");
          if (this.target === target && fail) { reached = true; throw new Error("injected check staging failure"); }
          return result;
        };
        try { await assert.rejects(record(input), /injected check staging failure/); }
        finally { prototype[method] = originalStage; }
        assert.equal(reached, true);
      });
      assert.deepEqual(taskRecords(db, taskId), before);
      const result = await record(input);
      assert.equal(result.check.id, input.id);
      const after = taskRecords(db, taskId);
      assert.notDeepEqual(after.task.state_json, before.task.state_json);
      assert.ok(after.events.length > before.events.length);
      assert.ok(after.events.some(row => row.event_type === "VERIFICATION_RECORDED"));
      assert.equal(after.events.at(-1).event_type, "TRANSACTION_COMMITTED");
    } finally { db?.close(); await removeTempTree(target); }
  });
}


for (const entry of ["command", "direct API"]) {
  test(`prepare-completion ${entry} rolls back receipt when commit witness staging fails`, async () => {
    const { runPrepareCompletion } = await import("../src/commands/prepare-completion.js");
    const target = await createGitRepository("forgeloop-prepare-atomic-");
    const packageRoot = getPackageRoot();
    const taskId = "prepare-atomic";
    let db;
    try {
      await setupVerifyingTask(target, packageRoot, { taskId, requirement: "tests" });
      db = openStorageDatabase(path.join(target, ".forgeloop/state.sqlite"));
      const before = taskRecords(db, taskId);
      const prepare = entry === "command" ? runPrepareCompletion : prepareCompletion;
      await withOperationalStore({ db, target }, async source => {
        const prototype = Object.getPrototypeOf(source);
        const append = prototype.appendText;
        let reached = false;
        prototype.appendText = function(relativePath, text) {
          const value = append.call(this, relativePath, text);
          if (this.target === target && relativePath === taskArtifactPath(taskId, "events")) {
            reached = true;
            throw new Error("injected preparation witness failure");
          }
          return value;
        };
        try { await assert.rejects(prepare({ target, packageRoot, taskId }), /injected preparation witness failure/); }
        finally { prototype.appendText = append; }
        assert.equal(reached, true);
      });
      assert.deepEqual(taskRecords(db, taskId), before);
      const result = await prepare({ target, packageRoot, taskId });
      assert.equal(result.receipt.taskId, taskId);
      assert.equal(taskRecords(db, taskId).events.at(-1).event_type, "TRANSACTION_COMMITTED");
    } finally { db?.close(); await removeTempTree(target); }
  });
}
