import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { createGitRepository } from "./helpers/git-fixture.js";
import { removeTempTree } from "./helpers/rm-safe.js";
import { setupVerifyingTask } from "./helpers/durable-lifecycle.js";
import { getPackageRoot } from "../src/core/templates.js";
import { recordTerminalResult } from "../src/core/completion-artifacts.js";
import { runRecordTerminalResult } from "../src/commands/record-terminal-result.js";
import { taskArtifactPath } from "../src/core/task-paths.js";
import { openStorageDatabase } from "../src/storage/index.js";
import { withOperationalStore } from "../src/storage/unit-of-work.js";

function logicalTables(db) {
  return Object.fromEntries(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({ name }) => [
    name, db.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`).all().map(row => JSON.stringify(row)).sort(),
  ]));
}

for (const entry of ["command", "direct API", "direct canonical paths"]) for (const point of ["receipt", "event"]) {
  test(`terminal result ${entry} atomically aborts after ${point} staging and retries`, async () => {
    const target = await createGitRepository("forgeloop-terminal-atomic-");
    const packageRoot = getPackageRoot();
    const taskId = "terminal-atomic";
    const requirement = "Package is published to npm registry";
    let db;
    try {
      await setupVerifyingTask(target, packageRoot, { taskId, requirement });
      db = openStorageDatabase(path.join(target, ".forgeloop/state.sqlite"));
      const before = logicalTables(db);
      const input = { target, packageRoot, taskId, requirement: `required action satisfies ${requirement}`,
        type: "PUBLICATION", status: "published", source: "fixture observer", result: "Fixture publication observation" };
      if (entry === "direct canonical paths") {
        delete input.taskId;
        for (const kind of ["contract", "route", "state", "receipt", "events"]) input[`${kind}Path`] = taskArtifactPath(taskId, kind);
      }
      const record = entry === "command" ? runRecordTerminalResult : recordTerminalResult;
      await withOperationalStore({ db, target }, async source => {
        const prototype = Object.getPrototypeOf(source);
        const method = point === "receipt" ? "stageText" : "appendText";
        const original = prototype[method];
        let reached = false;
        prototype[method] = function(relativePath, text) {
          const result = original.call(this, relativePath, text);
          if (this.target === target && relativePath === taskArtifactPath(taskId, point === "receipt" ? "receipt" : "events")) {
            reached = true;
            throw new Error("injected terminal result staging failure");
          }
          return result;
        };
        try { await assert.rejects(record(input), /injected terminal result staging failure/); }
        finally { prototype[method] = original; }
        assert.equal(reached, true);
      });
      assert.deepEqual(logicalTables(db), before);
      const result = await record(input);
      assert.equal(result.receipt.publicationStatus, "published");
      const events = db.prepare("SELECT * FROM events WHERE task_id = ? AND event_type = 'TERMINAL_RESULT_RECORDED'").all(taskId);
      assert.equal(events.length, 1);
      assert.notDeepEqual(logicalTables(db), before);
    } finally { db?.close(); await removeTempTree(target); }
  });
}
