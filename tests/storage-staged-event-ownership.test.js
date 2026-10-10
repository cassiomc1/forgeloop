import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { buildCanonicalDiagnosisProject } from "./helpers/canonical-diagnosis-fixture.js";
import { buildProtocolEvent, validateEventLedger } from "../src/core/events.js";
import { taskArtifactPath } from "../src/core/task-paths.js";
import { openStorageDatabase, appendEvent, runInTransaction } from "../src/storage/index.js";
import { withOperationalStore, withOperationalTransaction } from "../src/storage/unit-of-work.js";

const observation = (taskId, previous, index) => buildProtocolEvent({ taskId, event: "OBSERVATION", at: "2026-09-11T00:00:00.000Z", details: { index, nested: { value: "original" } } },
  { checkpoint: { seq: previous.seq, lastHash: previous.hash } });

test("staged event reads own their payloads and iterator membership survives later appends", async () => {
  const f = await buildCanonicalDiagnosisProject();
  const db = openStorageDatabase(path.join(f.target, ".forgeloop/state.sqlite"));
  try {
    const before = await validateEventLedger(f.target, f.packageRoot, { taskId: f.taskId });
    const ledgerPath = taskArtifactPath(f.taskId, "events");
    const rollback = new Error("ownership-control rollback");
    await withOperationalStore({ db, target: f.target }, async store => {
      await assert.rejects(withOperationalTransaction({ ...f, operation: "staged-event-ownership", recordCommitEvent: false }, async () => {
        let previous = before.events.at(-1);
        const expected = [];
        for (let index = 0; index < 64; index += 1) {
          const input = observation(f.taskId, previous, index);
          expected.push(structuredClone(input));
          store.appendEvent(input);
          previous = expected.at(-1);
          input.details.nested.value = "input mutation";
          const tail = store.readEvents(ledgerPath, 1);
          assert.deepEqual(tail, [previous]);
          tail[0].details.nested.value = "tail mutation";
          tail.push({ unwanted: true });
        }
        const full = store.readEvents(ledgerPath);
        assert.deepEqual(full.slice(before.events.length), expected);
        full.at(-1).details.nested.value = "full read mutation";
        const iterator = store.iterateEvents(ledgerPath);
        for (let index = 0; index < before.events.length; index += 1) iterator.next();
        const firstStaged = iterator.next().value;
        firstStaged.details.nested.value = "iterator mutation";
        const later = observation(f.taskId, previous, 64);
        store.appendEvent(later);
        assert.deepEqual([...iterator], expected.slice(1));
        assert.deepEqual(store.readEvents(ledgerPath, 2), [expected.at(-1), later]);
        throw rollback;
      }), error => error === rollback);
    });
    assert.deepEqual((await validateEventLedger(f.target, f.packageRoot, { taskId: f.taskId })).events, before.events);
  } finally { db.close(); await f.cleanup(); }
});

test("a staged tail still binds the persisted head and rejects a competing writer", async () => {
  const f = await buildCanonicalDiagnosisProject();
  const filename = path.join(f.target, ".forgeloop/state.sqlite");
  const db = openStorageDatabase(filename);
  const writer = openStorageDatabase(filename);
  try {
    const before = await validateEventLedger(f.target, f.packageRoot, { taskId: f.taskId });
    const head = before.events.at(-1);
    const external = observation(f.taskId, head, 999);
    await withOperationalStore({ db, target: f.target }, async store => {
      await assert.rejects(withOperationalTransaction({ ...f, operation: "staged-head-conflict", recordCommitEvent: false }, async () => {
        const staged = observation(f.taskId, head, 1);
        store.appendEvent(staged);
        assert.deepEqual(store.readEvents(taskArtifactPath(f.taskId, "events"), 1), [staged]);
        runInTransaction(writer, () => appendEvent(writer, { taskId: f.taskId, event: external }));
      }), { code: "E_STATE_REVISION_CONFLICT" });
    });
    assert.equal((await validateEventLedger(f.target, f.packageRoot, { taskId: f.taskId })).events.at(-1).hash, external.hash);
  } finally { writer.close(); db.close(); await f.cleanup(); }
});
