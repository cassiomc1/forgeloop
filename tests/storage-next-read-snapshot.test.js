import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { createGitRepository } from "./helpers/git-fixture.js";
import { removeTempTree } from "./helpers/rm-safe.js";
import { setupVerifyingTask } from "./helpers/durable-lifecycle.js";
import { getPackageRoot } from "../src/core/templates.js";
import { getNextAction } from "../src/core/next-action.js";
import { runNext } from "../src/commands/next.js";
import { openStorageDatabase } from "../src/storage/connection.js";
import { withOperationalStore } from "../src/storage/unit-of-work.js";
import { runInTransaction } from "../src/storage/transaction.js";

for (const surface of ["direct", "command", "compact"]) {
  test(`next ${surface} keeps state, route and optional profile in one snapshot during an independent route write`, async () => {
    const target = await createGitRepository("forgeloop-next-read-snapshot-");
    const packageRoot = getPackageRoot(), taskId = "next-snapshot";
    let db, writer;
    try {
      await setupVerifyingTask(target, packageRoot, { taskId });
      const filename = path.join(target, ".forgeloop/state.sqlite");
      db = openStorageDatabase(filename); writer = openStorageDatabase(filename);
      const options = { target, packageRoot, taskId, compact: surface === "compact" };
      const invoke = () => surface === "direct" ? getNextAction(options) : runNext(options);
      const expected = await invoke();
      await withOperationalStore({ db, target }, async source => {
        const prototype = Object.getPrototypeOf(source), original = prototype.readText;
        let changed = false;
        prototype.readText = function(relativePath) {
          const value = original.call(this, relativePath);
          if (!changed && this.target === target && relativePath.endsWith("/work-state.json")) {
            changed = true;
            assert.notEqual(this.db, db, "next projection must own a readonly committed copy");
            runInTransaction(writer, () => {
              assert.equal(writer.prepare("UPDATE task_artifacts SET payload_json = '{}' WHERE task_id = ? AND kind = 'route'").run(taskId).changes, 1);
            });
          }
          return value;
        };
        try {
          const result = await invoke();
          assert.equal(changed, true);
          assert.deepEqual(result, expected);
          assert.equal(writer.prepare("SELECT payload_json FROM task_artifacts WHERE task_id = ? AND kind = 'route'").get(taskId).payload_json, "{}");
        } finally { prototype.readText = original; }
      });
    } finally { writer?.close(); db?.close(); await removeTempTree(target); }
  });
}
