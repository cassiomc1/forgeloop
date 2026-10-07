import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { rm } from "node:fs/promises";
import { createGitRepository } from "./helpers/git-fixture.js";
import { runTaskCreate } from "../src/commands/task-create.js";
import { runTaskScope } from "../src/commands/task-scope.js";
import { readTaskDescriptor } from "../src/core/task-descriptor.js";
import { getPackageRoot } from "../src/core/templates.js";
import { openStorageDatabase, runInTransaction, upsertTask } from "../src/storage/index.js";
import { withOperationalStore } from "../src/storage/unit-of-work.js";

async function fixture() {
  const target = await createGitRepository("forgeloop-storage-scope-");
  const context = { target, packageRoot: getPackageRoot(), taskId: "native-scope" };
  await runTaskCreate({ ...context, claims: [] });
  return context;
}

function updateDescriptor(writer, taskId, change) {
  const row = writer.prepare("SELECT descriptor_json, state_json FROM tasks WHERE task_id = ?").get(taskId);
  const descriptor = { ...JSON.parse(row.descriptor_json), ...change };
  runInTransaction(writer, () => upsertTask(writer, { taskId, descriptor, state: row.state_json ? JSON.parse(row.state_json) : null }));
}

test("read-only task-scope projects claims from one immutable descriptor snapshot", async () => {
  const f = await fixture();
  const filename = path.join(f.target, ".forgeloop/state.sqlite");
  const db = openStorageDatabase(filename);
  const writer = openStorageDatabase(filename);
  try {
    const expected = await runTaskScope(f);
    await withOperationalStore({ db, target: f.target }, async source => {
      const prototype = Object.getPrototypeOf(source);
      const originalRead = prototype.readText;
      let changed = false;
      prototype.readText = function(relativePath) {
        if (!changed && this.target === f.target && this.db !== db && relativePath.endsWith("/task.json")) {
          changed = true;
          updateDescriptor(writer, f.taskId, { writeClaims: ["src"] });
        }
        return originalRead.call(this, relativePath);
      };
      try {
        assert.deepEqual(await runTaskScope(f), expected);
        assert.equal(changed, true);
        assert.throws(() => source.commit(), { code: "E_STATE_REVISION_CONFLICT" });
      } finally { prototype.readText = originalRead; }
    });
    assert.deepEqual((await runTaskScope(f)).writeClaims, ["src"]);
  } finally { writer.close(); db.close(); await rm(f.target, { recursive: true, force: true }); }
});

test("task-scope update rereads its descriptor after entering the claims mutation scope", async () => {
  const f = await fixture();
  const writer = openStorageDatabase(path.join(f.target, ".forgeloop/state.sqlite"));
  // The direct API's early read scope closes before the mutation scope begins.
  // Each descriptor reader checks presence and reads JSON. Change it after
  // the second early reader has obtained its JSON, before mutation admission.
  let prototype;
  let originalRead;
  let reads = 0;
  try {
    await withOperationalStore({ db: writer, target: f.target }, source => {
      prototype = Object.getPrototypeOf(source);
      originalRead = prototype.readText;
    });
    prototype.readText = function(relativePath) {
      const result = originalRead.call(this, relativePath);
      if (this.target === f.target && relativePath.endsWith("/task.json")) {
        reads++;
        if (reads === 4) updateDescriptor(writer, f.taskId, { createdAt: "2030-01-01T00:00:00.000Z" });
      }
      return result;
    };
    const result = await runTaskScope({ ...f, claims: [] });
    assert.equal(result.updated, true);
    assert.ok(reads >= 5);
    assert.equal((await readTaskDescriptor(f.target, f.taskId, f.packageRoot)).value.createdAt, "2030-01-01T00:00:00.000Z");
  } finally {
    if (prototype) prototype.readText = originalRead;
    writer.close();
    await rm(f.target, { recursive: true, force: true });
  }
});
