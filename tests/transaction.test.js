import { removeTempTree } from "./helpers/rm-safe.js";
import assert from "node:assert/strict";
import { access, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { withTaskTransaction, findIncompleteTransactions } from "../src/core/transaction.js";
import { appendProtocolEvent, readEvents } from "../src/core/events.js";
import { getPackageRoot } from "../src/core/templates.js";
import { runTaskCreate } from "../src/commands/task-create.js";
import { createWorkState, readWorkState, writeWorkState } from "../src/core/work-state.js";
import { readJsonArtifact, writeJsonArtifact } from "../src/core/artifacts.js";
import { taskGatePath } from "../src/core/task-paths.js";
import { taskArtifactPath } from "../src/core/task-paths.js";
import { findArtifact, listArtifacts, openStorageDatabase } from "../src/storage/index.js";

const taskId = "native-transaction";
const packageRoot = getPackageRoot();
async function project(callback) {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-native-transaction-"));
  try {
    await runTaskCreate({ target, taskId, packageRoot, claims: [] });
    await callback(target);
    assert.deepEqual(await findIncompleteTransactions(target), []);
    await assert.rejects(access(path.join(target, ".forgeloop/.txn")), { code: "ENOENT" });
  } finally { await removeTempTree(target); }
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


test("a task transaction cannot append another task's event", async () => {
  await project(async target => {
    const otherTaskId = "other-event-owner";
    await runTaskCreate({ target, taskId: otherTaskId, packageRoot, claims: [] });
    const before = await readEvents(target, packageRoot, { taskId: otherTaskId });
    await assert.rejects(withTaskTransaction({ target, taskId, packageRoot }, () =>
      appendProtocolEvent(target, { taskId: otherTaskId, event: "OBSERVATION", details: { message: "wrong transaction" } }, packageRoot, { taskId: otherTaskId })), { code: "E_TASK_CONTEXT_MISMATCH" });
    assert.deepEqual(await readEvents(target, packageRoot, { taskId: otherTaskId }), before);
  });
});


for (const operation of ["replace", "delete"]) test(`a task transaction cannot ${operation} another task's state`, async () => {
  await project(async target => {
    const otherTaskId = "other-state-owner";
    await runTaskCreate({ target, taskId: otherTaskId, packageRoot, claims: [] });
    const otherState = createWorkState({ taskId: otherTaskId, phase: "RECEIVED", contractFingerprint: "0".repeat(64) });
    await writeWorkState(target, otherState, { packageRoot, taskId: otherTaskId });
    const before = await readWorkState(target, { packageRoot, taskId: otherTaskId });
    await assert.rejects(withTaskTransaction({ target, taskId, packageRoot }, tx => {
      const filename = taskArtifactPath(otherTaskId, "state");
      return operation === "delete" ? tx.stageDelete(filename) : tx.stageText(filename, JSON.stringify({ ...otherState, revision: 1 }));
    }), { code: "E_TASK_CONTEXT_MISMATCH" });
    assert.deepEqual(await readWorkState(target, { packageRoot, taskId: otherTaskId }), before);
  });
});


test("native generic artifact writes reject a payload belonging to another task", async () => {
  await project(async target => {
    const gate = { schemaVersion: 1, protocolVersion: 1, taskId: "another-payload-owner", gate: "test", status: "satisfied", requiredBy: [], artifacts: [], decisions: [], unknowns: [], approvedAssumptions: [], evidence: [] };
    const before = await readEvents(target, packageRoot, { taskId });
    await assert.rejects(writeJsonArtifact(target, taskGatePath(taskId, "test"), gate, "gate", packageRoot, { taskId }), { code: "E_STORAGE_PAYLOAD_MISMATCH" });
    const db = openStorageDatabase(path.join(target, ".forgeloop/state.sqlite"), { readOnly: true });
    try { assert.equal(db.prepare("SELECT COUNT(*) AS count FROM task_artifacts WHERE task_id = ? AND kind = 'gate'").get(taskId).count, 0); }
    finally { db.close(); }
    assert.deepEqual(await readEvents(target, packageRoot, { taskId }), before);
    await writeJsonArtifact(target, taskGatePath(taskId, "test"), { ...gate, taskId }, "gate", packageRoot, { taskId });
  });
});


test("generic artifact readers reject a rebound indexed task owner", async () => {
  await project(async target => {
    const otherTaskId = "rebound-artifact-owner";
    await runTaskCreate({ target, taskId: otherTaskId, packageRoot, claims: [] });
    const gate = { schemaVersion: 1, protocolVersion: 1, taskId, gate: "test", status: "satisfied", requiredBy: [], artifacts: [], decisions: [], unknowns: [], approvedAssumptions: [], evidence: [] };
    await writeJsonArtifact(target, taskGatePath(taskId, "test"), gate, "gate", packageRoot, { taskId });
    const db = openStorageDatabase(path.join(target, ".forgeloop/state.sqlite"));
    try {
      assert.equal(db.prepare("UPDATE task_artifacts SET task_id = ? WHERE task_id = ? AND kind = 'gate'").run(otherTaskId, taskId).changes, 1);
      assert.throws(() => findArtifact(db, otherTaskId, "gate", "test"), { code: "E_STORAGE_PAYLOAD_MISMATCH" });
      assert.throws(() => listArtifacts(db, otherTaskId, "gate"), { code: "E_STORAGE_PAYLOAD_MISMATCH" });
    } finally { db.close(); }
    await assert.rejects(readJsonArtifact(target, taskGatePath(otherTaskId, "test"), "gate", packageRoot), { code: "E_STORAGE_PAYLOAD_MISMATCH" });
  });
});
