import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { createGitRepository } from "./helpers/git-fixture.js";
import { removeTempTree } from "./helpers/rm-safe.js";
import { setupVerifyingTask } from "./helpers/durable-lifecycle.js";
import { getPackageRoot } from "../src/core/templates.js";
import { runHandoffCreate } from "../src/commands/handoff-create.js";
import { runHandoffShow } from "../src/commands/handoff-show.js";
import { runHandoffList } from "../src/commands/handoff-list.js";
import { readForgeLoopIntegrationResource } from "../src/integration.js";
import { openStorageDatabase } from "../src/storage/connection.js";
import { withOperationalStore } from "../src/storage/unit-of-work.js";
import { runInTransaction } from "../src/storage/transaction.js";

for (const surface of ["show", "list", "resource"]) {
  test(`handoff ${surface} projects artifact and acceptance from one snapshot across independent ledger writes`, async () => {
    const target = await createGitRepository("forgeloop-handoff-read-snapshot-");
    const packageRoot = getPackageRoot(), taskId = "handoff-snapshot";
    let db, writer;
    try {
      await setupVerifyingTask(target, packageRoot, { taskId });
      const created = await runHandoffCreate({ target, packageRoot, taskId, handoffId: "snapshot-envelope" });
      const filename = path.join(target, ".forgeloop/state.sqlite");
      db = openStorageDatabase(filename);
      writer = openStorageDatabase(filename);
      await withOperationalStore({ db, target }, async source => {
        const prototype = Object.getPrototypeOf(source), original = prototype.readText;
        let changed = false;
        prototype.readText = function (relativePath) {
          const value = original.call(this, relativePath);
          if (!changed && this.target === target && relativePath.includes("/handoffs/")) {
            changed = true;
            assert.notEqual(this.db, db, "handoff projection must own a readonly copy");
            runInTransaction(writer, () => writer.prepare("UPDATE events SET event_json = '{}' WHERE task_id = ? AND seq = 1").run(taskId));
          }
          return value;
        };
        try {
          const options = { target, packageRoot, taskId, handoffId: created.handoff.handoffId };
          const result = surface === "show" ? await runHandoffShow(options)
            : surface === "list" ? await runHandoffList(options)
              : (await readForgeLoopIntegrationResource("task/handoffs", { projectPath: target, taskId, packageRoot })).data;
          const handoff = surface === "show" ? result : result.handoffs[0];
          assert.equal(handoff.acceptance.status, "OPEN");
          assert.equal(changed, true, "independent writer must commit between component reads");
          assert.equal(writer.prepare("SELECT event_json FROM events WHERE task_id = ? AND seq = 1").get(taskId).event_json, "{}");
        } finally { prototype.readText = original; }
      });
    } finally { writer?.close(); db?.close(); await removeTempTree(target); }
  });
}
