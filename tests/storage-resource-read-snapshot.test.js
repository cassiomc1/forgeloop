import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { createGitRepository } from "./helpers/git-fixture.js";
import { removeTempTree } from "./helpers/rm-safe.js";
import { setupVerifyingTask } from "./helpers/durable-lifecycle.js";
import { getPackageRoot } from "../src/core/templates.js";
import { writeJsonArtifact } from "../src/core/artifacts.js";
import { taskDirectory } from "../src/core/task-paths.js";
import { readForgeLoopIntegrationResource } from "../src/integration.js";
import { openStorageDatabase } from "../src/storage/connection.js";
import { withOperationalStore } from "../src/storage/unit-of-work.js";
import { runInTransaction } from "../src/storage/transaction.js";
import { withTaskTransaction } from "../src/core/transaction.js";

test("public decision resource owns one catalog/payload snapshot across an independent deletion", async () => {
  const target = await createGitRepository("forgeloop-resource-snapshot-");
  const packageRoot = getPackageRoot(), taskId = "resource-snapshot";
  let db, writer;
  try {
    await setupVerifyingTask(target, packageRoot, { taskId });
    const fixture = JSON.parse(await readFile(path.join(packageRoot, "tests/fixtures/schemas/semantic-decision/valid.json"), "utf8"));
    const decisions = ["decision-a", "decision-b"].map(decisionId => ({ ...fixture, taskId, decisionId }));
    for (const decision of decisions) await writeJsonArtifact(target, `${taskDirectory(taskId)}/decisions/${decision.decisionId}.json`, decision, "semantic-decision", packageRoot, { taskId });
    const filename = path.join(target, ".forgeloop/state.sqlite");
    db = openStorageDatabase(filename); writer = openStorageDatabase(filename);
    const expected = writer.prepare("SELECT payload_json FROM task_artifacts WHERE task_id = ? AND kind = 'decision' ORDER BY artifact_id")
      .all(taskId).map(row => JSON.parse(row.payload_json));
    assert.ok(expected.some(value => value.decisionId === "decision-b"));
    await withOperationalStore({ db, target }, async source => {
      const prototype = Object.getPrototypeOf(source), original = prototype.listArtifactNames;
      let changed = false;
      prototype.listArtifactNames = function (selectedTask, collection) {
        const names = original.call(this, selectedTask, collection);
        if (!changed && this.target === target && selectedTask === taskId && collection === "decisions") {
          changed = true;
          assert.equal(this.db.isTransaction, true, "catalog and bytes must share one synchronous read snapshot");
          runInTransaction(writer, () => {
            const removed = writer.prepare("DELETE FROM task_artifacts WHERE task_id = ? AND kind = 'decision' AND artifact_id = 'decision-b'").run(taskId);
            assert.equal(removed.changes, 1);
          });
        }
        return names;
      };
      try {
        const result = await readForgeLoopIntegrationResource("task/decisions", { projectPath: target, taskId, packageRoot });
        assert.equal(changed, true);
        assert.deepEqual(result.data.decisions, expected);
        assert.equal(db.isTransaction, false, "schema validation must finish outside the native transaction");
        assert.equal(writer.prepare("SELECT COUNT(*) AS n FROM task_artifacts WHERE task_id = ? AND kind = 'decision'").get(taskId).n, expected.length - 1);
        assert.throws(() => source.commit(), { code: "E_STATE_REVISION_CONFLICT" }, "captured observations must still reject a later changed catalog");
      } finally { prototype.listArtifactNames = original; }
    });
  } finally { writer?.close(); db?.close(); await removeTempTree(target); }
});

test("task resource keeps staged decision observations inside a prepared operation", async () => {
  const target = await createGitRepository("forgeloop-resource-prepared-");
  const packageRoot = getPackageRoot(), taskId = "resource-prepared";
  let observer;
  try {
    await setupVerifyingTask(target, packageRoot, { taskId });
    const fixture = JSON.parse(await readFile(path.join(packageRoot, "tests/fixtures/schemas/semantic-decision/valid.json"), "utf8"));
    const decision = { ...fixture, taskId, decisionId: "staged-decision" };
    observer = openStorageDatabase(path.join(target, ".forgeloop/state.sqlite"));
    const count = () => observer.prepare("SELECT COUNT(*) AS n FROM task_artifacts WHERE task_id = ? AND kind = 'decision' AND artifact_id = 'staged-decision'").get(taskId).n;
    await withTaskTransaction({ target, taskId, packageRoot, operation: "resource-staged-read" }, async () => {
      await writeJsonArtifact(target, `${taskDirectory(taskId)}/decisions/staged-decision.json`, decision, "semantic-decision", packageRoot, { taskId });
      assert.equal(count(), 0, "prepared decision must not be committed yet");
      const resource = await readForgeLoopIntegrationResource("task/decisions", { projectPath: target, taskId, packageRoot });
      assert.deepEqual(resource.data.decisions.find(value => value.decisionId === decision.decisionId), decision);
      assert.equal(count(), 0, "resource must not commit prepared records");
    });
    assert.equal(count(), 1);
  } finally { observer?.close(); await removeTempTree(target); }
});


test("decision capture preserves schema-first failure order and closes its read transaction", async () => {
  const target = await createGitRepository("forgeloop-resource-error-order-");
  const packageRoot = getPackageRoot(), taskId = "resource-error-order";
  let db;
  try {
    await setupVerifyingTask(target, packageRoot, { taskId });
    db = openStorageDatabase(path.join(target, ".forgeloop/state.sqlite"));
    await withOperationalStore({ db, target }, async source => {
      const originalNames = source.listArtifactNames, originalRead = source.readText;
      source.listArtifactNames = () => ["decision-a.json", "decision-b.json"];
      source.readText = relativePath => {
        assert.equal(db.isTransaction, true);
        if (relativePath.endsWith("decision-a.json")) return "{}";
        const error = new Error("later record corruption");
        error.code = "E_STORAGE_ARTIFACT_INVALID";
        throw error;
      };
      try {
        await assert.rejects(readForgeLoopIntegrationResource("task/decisions", { projectPath: target, taskId, packageRoot }), error => {
          assert.equal(error.code, "ARTIFACT_INVALID");
          assert.match(error.message, /decision-a\.json/);
          assert.equal(db.isTransaction, false);
          return true;
        });
      } finally { source.listArtifactNames = originalNames; source.readText = originalRead; }
      db.exec("BEGIN");
      try {
        await assert.rejects(readForgeLoopIntegrationResource("task/decisions", { projectPath: target, taskId, packageRoot }), { code: "E_STORAGE_SNAPSHOT_TRANSACTION" });
        assert.equal(db.isTransaction, true, "caller-owned transaction must be retained");
      } finally { db.exec("ROLLBACK"); }
    });
  } finally { db?.close(); await removeTempTree(target); }
});
