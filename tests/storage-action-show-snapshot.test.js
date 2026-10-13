import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { removeTempTree } from "./helpers/rm-safe.js";
import { executeForgeLoopCommand } from "../src/core/command-runtime.js";
import { proposeAction } from "../src/core/actions.js";
import { runActionShow } from "../src/commands/action-show.js";
import { getPackageRoot } from "../src/core/templates.js";
import { openStorageDatabase } from "../src/storage/connection.js";
import { withOperationalStore } from "../src/storage/unit-of-work.js";
import { runInTransaction } from "../src/storage/transaction.js";
import { withTaskTransaction } from "../src/core/transaction.js";

// A raw independent tamper after descriptor admission tests a read boundary;
// it is not represented as a valid action transition or a trusted publisher.
for (const surface of ["direct", "command"]) {
  test(`action-show ${surface} retains admitted action bytes across an independent indexed-field tamper`, async () => {
    const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-action-show-snapshot-"));
    const packageRoot = getPackageRoot(), taskId = "action-show-snapshot", actionId = "action-read";
    let db, writer;
    try {
      const created = await executeForgeLoopCommand({ command: "task-create", projectPath: target, input: { taskId, claims: [] } });
      assert.equal(created.ok, true, JSON.stringify(created));
      await proposeAction(target, { packageRoot, taskId, input: {
        actionId, effectClass: "READ_ONLY", capability: "filesystem.read", operation: "inspect", target: "src",
        requiredForCompletion: false, requirement: null, provenance: "CALLER_REPORTED",
      } });
      const invoke = () => surface === "direct"
        ? runActionShow({ target, packageRoot, taskId, actionId })
        : executeForgeLoopCommand({ command: "action-show", projectPath: target, input: { taskId, actionId } });
      const expected = await invoke();
      if (surface === "command") assert.equal(expected.ok, true, JSON.stringify(expected));
      const filename = path.join(target, ".forgeloop/state.sqlite");
      db = openStorageDatabase(filename); writer = openStorageDatabase(filename);
      await withOperationalStore({ db, target }, async source => {
        const prototype = Object.getPrototypeOf(source), original = prototype.readText;
        let changed = false;
        prototype.readText = function(relativePath) {
          const value = original.call(this, relativePath);
          if (!changed && this.target === target && relativePath.endsWith("/task.json")) {
            changed = true;
            runInTransaction(writer, () => {
              assert.equal(writer.prepare("UPDATE actions SET revision = 99 WHERE task_id = ? AND action_id = ?").run(taskId, actionId).changes, 1);
            });
          }
          return value;
        };
        try {
          assert.deepEqual(await invoke(), expected);
          assert.equal(changed, true, "the independent tamper must occur after descriptor bytes are admitted");
          assert.equal(writer.prepare("SELECT revision FROM actions WHERE task_id = ? AND action_id = ?").get(taskId, actionId).revision, 99);
          assert.equal(db.isTransaction, false);
          assert.equal(writer.isTransaction, false);
        } finally { prototype.readText = original; }
      });
      // A subsequent request must observe the corrupt live row and reject;
      // preserving the earlier projection must not turn off record validation.
      if (surface === "direct") await assert.rejects(invoke(), { code: "E_STORAGE_PAYLOAD_MISMATCH" });
      else {
        const rejected = await invoke();
        assert.equal(rejected.ok, false);
        assert.equal(rejected.error.code, "E_STORAGE_PAYLOAD_MISMATCH");
      }
    } finally { writer?.close(); db?.close(); await removeTempTree(target); }
  });
}

for (const surface of ["direct", "command"]) {
  test(`action-show ${surface} reads a prepared action without publishing it`, async () => {
    const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-action-show-prepared-"));
    const packageRoot = getPackageRoot(), taskId = "action-show-prepared", actionId = "action-prepared";
    let observer;
    try {
      const created = await executeForgeLoopCommand({ command: "task-create", projectPath: target, input: { taskId, claims: [] } });
      assert.equal(created.ok, true, JSON.stringify(created));
      observer = openStorageDatabase(path.join(target, ".forgeloop/state.sqlite"));
      const count = () => observer.prepare("SELECT COUNT(*) AS n FROM actions WHERE task_id = ? AND action_id = ?").get(taskId, actionId).n;
      await withTaskTransaction({ target, taskId, packageRoot, operation: "action-show-prepared-read" }, async () => {
        const proposed = await proposeAction(target, { packageRoot, taskId, input: {
          actionId, effectClass: "READ_ONLY", capability: "filesystem.read", operation: "inspect", target: "src",
          requiredForCompletion: false, requirement: null, provenance: "CALLER_REPORTED",
        } });
        assert.equal(count(), 0, "prepared action must remain outside committed storage");
        const result = surface === "direct"
          ? await runActionShow({ target, packageRoot, taskId, actionId })
          : await executeForgeLoopCommand({ command: "action-show", projectPath: target, input: { taskId, actionId } });
        if (surface === "command") assert.equal(result.ok, true, JSON.stringify(result));
        assert.deepEqual(surface === "command" ? result.result : result, proposed.action);
        assert.equal(count(), 0, "action-show must not publish prepared work");
      });
      assert.equal(count(), 1, "only the enclosing transaction publishes the action");
    } finally { observer?.close(); await removeTempTree(target); }
  });
}
