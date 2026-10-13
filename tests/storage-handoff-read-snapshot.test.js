import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { createGitRepository } from "./helpers/git-fixture.js";
import { removeTempTree } from "./helpers/rm-safe.js";
import { setupVerifyingTask } from "./helpers/durable-lifecycle.js";
import { getPackageRoot } from "../src/core/templates.js";
import { listCanonicalHandoffs } from "../src/core/handoff.js";
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


test("direct canonical handoff list retains one snapshot across an independent artifact deletion", async () => {
  const target = await createGitRepository("forgeloop-direct-handoff-list-");
  const packageRoot = getPackageRoot(), taskId = "direct-handoff-list";
  let db, writer;
  try {
    await setupVerifyingTask(target, packageRoot, { taskId });
    const first = await runHandoffCreate({ target, packageRoot, taskId, handoffId: "snapshot-first" });
    const second = await runHandoffCreate({ target, packageRoot, taskId, handoffId: "snapshot-second" });
    const expected = await listCanonicalHandoffs(target, { taskId, packageRoot });
    assert.equal(expected.length, 2);
    const filename = path.join(target, ".forgeloop/state.sqlite");
    db = openStorageDatabase(filename);
    writer = openStorageDatabase(filename);
    await withOperationalStore({ db, target }, async source => {
      const prototype = Object.getPrototypeOf(source), original = prototype.readText;
      let changed = false;
      prototype.readText = function(relativePath) {
        const value = original.call(this, relativePath);
        if (!changed && this.target === target && relativePath.includes("/handoffs/")) {
          changed = true;
          const removedId = JSON.parse(value).handoffId === first.handoff.handoffId ? second.handoff.handoffId : first.handoff.handoffId;
          runInTransaction(writer, () => {
            const result = writer.prepare("DELETE FROM task_artifacts WHERE task_id = ? AND kind = 'handoff' AND artifact_id = ?").run(taskId, removedId);
            assert.equal(Number(result.changes), 1);
          });
        }
        return value;
      };
      try {
        assert.deepEqual(await listCanonicalHandoffs(target, { taskId, packageRoot }), expected);
        assert.equal(changed, true);
        assert.throws(() => source.commit(), { code: "E_STATE_REVISION_CONFLICT" });
      } finally { prototype.readText = original; }
    });
    assert.equal((await listCanonicalHandoffs(target, { taskId, packageRoot })).length, 1);
  } finally { writer?.close(); db?.close(); await removeTempTree(target); }
});
