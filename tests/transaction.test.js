import assert from "node:assert/strict";
import { access, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { withTaskTransaction, findIncompleteTransactions } from "../src/core/transaction.js";
import { appendProtocolEvent, readEvents } from "../src/core/events.js";
import { getPackageRoot } from "../src/core/templates.js";
import { runTaskCreate } from "../src/commands/task-create.js";
import { createWorkState, readWorkState, writeWorkState } from "../src/core/work-state.js";
import { taskArtifactPath } from "../src/core/task-paths.js";
import { openStorageDatabase } from "../src/storage/index.js";

const taskId = "native-transaction";
const packageRoot = getPackageRoot();
async function project(callback) {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-native-transaction-"));
  try {
    await runTaskCreate({ target, taskId, packageRoot, claims: [] });
    await callback(target);
    assert.deepEqual(await findIncompleteTransactions(target), []);
    await assert.rejects(access(path.join(target, ".forgeloop/.txn")), { code: "ENOENT" });
  } finally { await rm(target, { recursive: true, force: true }); }
}
function committedState(target) {
  const db = openStorageDatabase(path.join(target, ".forgeloop/state.sqlite"), { readOnly: true });
  try { return db.prepare("SELECT state_json FROM tasks WHERE task_id = ?").get(taskId).state_json; }
  finally { db.close(); }
}
const state = () => createWorkState({ taskId, phase: "RECEIVED", contractFingerprint: "0".repeat(64) });

test("nested native transaction reuses preparation and rejects another task", async () => {
  await project(async target => {
    await withTaskTransaction({ target, taskId }, async outer => {
      await withTaskTransaction({ target, taskId }, async inner => {
        assert.equal(inner, outer);
        await writeWorkState(target, state());
      });
      await assert.rejects(withTaskTransaction({ target, taskId: "another-task" }, () => null), { code: "E_TASK_CONTEXT_MISMATCH" });
    });
    assert.equal((await readWorkState(target, { taskId })).taskId, taskId);
  });
});

test("native state and ordered event writes remain invisible to independent readers until commit", async () => {
  await project(async target => {
    const before = await readEvents(target, packageRoot, { taskId });
    await withTaskTransaction({ target, taskId, packageRoot, operation: "atomic-control", recordCommitEvent: true }, async tx => {
      await writeWorkState(target, state());
      await appendProtocolEvent(target, { taskId, event: "OBSERVATION", details: { message: "first" } }, packageRoot, { taskId });
      await appendProtocolEvent(target, { taskId, event: "OBSERVATION", details: { message: "second" } }, packageRoot, { taskId });
      assert.equal(committedState(target), null);
      assert.equal(JSON.parse(await tx.readText(taskArtifactPath(taskId, "state"))).taskId, taskId);
    });
    assert.equal(JSON.parse(committedState(target)).taskId, taskId);
    const events = await readEvents(target, packageRoot, { taskId });
    assert.deepEqual(events.slice(before.length).map(event => event.event), ["OBSERVATION", "OBSERVATION", "TRANSACTION_COMMITTED"]);
    assert.ok(events.at(-1).details.transactionId.startsWith("txn-"));
  });
});

for (const fail of [false, true]) {
  test(`native staged deletion ${fail ? "rolls back" : "commits"} atomically`, async () => {
    await project(async target => {
      await writeWorkState(target, state());
      const operation = withTaskTransaction({ target, taskId }, async tx => {
        tx.stageDelete(taskArtifactPath(taskId, "state"));
        assert.equal(await tx.readText(taskArtifactPath(taskId, "state")), null);
        assert.ok(committedState(target));
        if (fail) throw new Error("injected deletion failure");
      });
      if (fail) await assert.rejects(operation, /injected deletion failure/); else await operation;
      assert.equal(committedState(target) === null, !fail);
    });
  });
}

test("callback failure persists neither state nor events and a later transaction succeeds", async () => {
  await project(async target => {
    const before = await readEvents(target, packageRoot, { taskId });
    await assert.rejects(withTaskTransaction({ target, taskId, packageRoot, recordCommitEvent: true }, async () => {
      await writeWorkState(target, state());
      await appendProtocolEvent(target, { taskId, event: "OBSERVATION", details: { message: "must roll back" } }, packageRoot, { taskId });
      throw new Error("injected callback failure");
    }), /injected callback failure/);
    assert.equal(committedState(target), null);
    assert.deepEqual(await readEvents(target, packageRoot, { taskId }), before);
    await writeWorkState(target, state());
    assert.ok(committedState(target));
  });
});
