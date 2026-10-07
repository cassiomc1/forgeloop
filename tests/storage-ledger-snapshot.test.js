import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { openStorageDatabase, runInTransaction, upsertTask, appendEvent } from "../src/storage/index.js";
import { createTaskDescriptor } from "../src/core/task-descriptor.js";
import { buildProtocolEvent, validateLedgerEvents } from "../src/core/events.js";
import { withLedgerEventSnapshot, withDetachedLedgerSnapshot } from "../src/storage/ledger-event-snapshot.js";
import { ledgerEntriesOfTypes, ledgerTypeSummary } from "../src/core/ledger-event-collection.js";

function fixture() {
  const directory = mkdtempSync(path.join(os.tmpdir(), "forgeloop-ledger-snapshot-"));
  const filename = path.join(directory, "state.sqlite");
  const db = openStorageDatabase(filename);
  const event = buildProtocolEvent({ taskId: "snapshot", event: "TASK_RECEIVED" }, { checkpoint: { seq: 0, lastHash: null } });
  runInTransaction(db, () => {
    upsertTask(db, { taskId: "snapshot", descriptor: createTaskDescriptor({ taskId: "snapshot" }) });
    appendEvent(db, { taskId: "snapshot", event });
  });
  return { db, filename, event, close() { db.close(); rmSync(directory, { recursive: true, force: true }); } };
}

test("empty owned ledger scans avoid range queries while preserving full-scan proof and expiry", async () => {
  const f = fixture();
  let retained;
  const digests = [];
  try {
    await withDetachedLedgerSnapshot(f.db, "absent-task", async (events, snapshot) => {
      const originalPrepare = snapshot.prepare;
      let queries = 0;
      snapshot.prepare = function(...args) { queries++; return originalPrepare.apply(this, args); };
      try {
        retained = events;
        assert.deepEqual([...events], []);
        assert.deepEqual([...ledgerEntriesOfTypes(events, ["TASK_RECEIVED", "OBSERVATION"])], []);
        assert.equal(queries, 0);
      } finally { snapshot.prepare = originalPrepare; }
    }, { onFullScan: digest => digests.push(digest) });
    assert.deepEqual(digests, [createHash("sha256").digest("hex")]);
    assert.throws(() => [...retained], { code: "E_STORAGE_TRANSACTION_EXPIRED" });
    assert.throws(() => [...ledgerEntriesOfTypes(retained, ["OBSERVATION"])], { code: "E_STORAGE_TRANSACTION_EXPIRED" });
  } finally { f.close(); }
});

test("snapshot stays stable across a concurrent WAL append and expires all retained views", () => {
  const f = fixture();
  const writer = openStorageDatabase(f.filename);
  let retained;
  let cursor;
  try {
    withLedgerEventSnapshot(f.db, "snapshot", (events) => {
      retained = events.slice();
      cursor = events.values();
      assert.equal(cursor.next().value.hash, f.event.hash);
      const next = buildProtocolEvent({ taskId: "snapshot", event: "OBSERVATION", details: { message: "concurrent" } }, { checkpoint: { seq: 1, lastHash: f.event.hash } });
      runInTransaction(writer, () => appendEvent(writer, { taskId: "snapshot", event: next }));
      assert.equal(events.length, 1);
      for (const outer of events) {
        assert.deepEqual([...events.slice()], [outer]);
      }
      assert.deepEqual([...events], [f.event]);
      assert.deepEqual(validateLedgerEvents(events).errors, validateLedgerEvents([f.event]).errors);
    });
    assert.throws(() => cursor.next(), { code: "E_STORAGE_TRANSACTION_EXPIRED" });
    assert.throws(() => retained.at(0), { code: "E_STORAGE_TRANSACTION_EXPIRED" });
    assert.throws(() => [...retained], { code: "E_STORAGE_TRANSACTION_EXPIRED" });
    withLedgerEventSnapshot(f.db, "snapshot", (events) => assert.equal(events.length, 2));
  } finally { writer.close(); f.close(); }
});

test("snapshot joins caller transaction without committing it and rejects asynchronous callbacks", () => {
  const f = fixture();
  try {
    f.db.exec("BEGIN");
    withLedgerEventSnapshot(f.db, "snapshot", (events) => assert.equal(events.at(0).hash, f.event.hash));
    assert.equal(f.db.isTransaction, true);
    f.db.exec("ROLLBACK");
    assert.throws(() => withLedgerEventSnapshot(f.db, "snapshot", async () => {}), { code: "E_STORAGE_ASYNC_TRANSACTION" });
    assert.throws(() => withLedgerEventSnapshot(f.db, "snapshot", () => Promise.resolve()), { code: "E_STORAGE_ASYNC_TRANSACTION" });
    assert.equal(f.db.isTransaction, false);
  } finally { f.close(); }
});

test("snapshot rejects indexed payload tampering instead of accepting the fast access path", () => {
  const f = fixture();
  try {
    f.db.prepare("UPDATE events SET hash = ? WHERE task_id = ?").run("tampered", "snapshot");
    assert.throws(() => withLedgerEventSnapshot(f.db, "snapshot", (events) => [...events]), { code: "E_STORAGE_PAYLOAD_MISMATCH" });
    assert.equal(f.db.isTransaction, false);
  } finally { f.close(); }
});


test("noncontiguous indexed sequences preserve positions and fail canonical chronology", () => {
  const f = fixture();
  try {
    const event = buildProtocolEvent({ taskId: "snapshot", event: "OBSERVATION", details: { message: "gap" } }, { checkpoint: { seq: 2, lastHash: f.event.hash } });
    appendEvent(f.db, { taskId: "snapshot", event });
    withLedgerEventSnapshot(f.db, "snapshot", (events) => {
      assert.equal(events.at(1).seq, 3);
      assert.deepEqual([...events.slice(1)], [event]);
      assert.deepEqual(validateLedgerEvents(events).errors, validateLedgerEvents([f.event, event]).errors);
      assert.equal(validateLedgerEvents(events).valid, false);
    });
  } finally { f.close(); }
});

test("typed selectors cannot hide indexed tampering before a complete canonical scan", () => {
  const f = fixture();
  try {
    f.db.prepare("UPDATE events SET event_type = ? WHERE task_id = ?").run("OBSERVATION", "snapshot");
    assert.throws(() => withLedgerEventSnapshot(f.db, "snapshot", events => [...ledgerEntriesOfTypes(events, ["TASK_RECEIVED"])]), { code: "E_STORAGE_PAYLOAD_MISMATCH" });
  } finally { f.close(); }
});

test("typed selectors retain original/view positions and use the existing event-type index", () => {
  const f = fixture();
  try {
    const event = buildProtocolEvent({ taskId: "snapshot", event: "OBSERVATION", details: { message: "typed view" } }, { checkpoint: { seq: 1, lastHash: f.event.hash } });
    appendEvent(f.db, { taskId: "snapshot", event });
    withLedgerEventSnapshot(f.db, "snapshot", events => {
      assert.deepEqual([...events], [f.event, event]);
      const [[index, selected]] = [...ledgerEntriesOfTypes(events, ["OBSERVATION"])];
      assert.equal(index, 1);
      assert.equal(events.indexOf(selected), 1);
      assert.equal(events.slice(1).indexOf(selected), 0);
      assert.deepEqual([...ledgerEntriesOfTypes(events.slice(1), ["OBSERVATION"])], [[0, event]]);
      assert.deepEqual(ledgerTypeSummary(events, "OBSERVATION"), { count: 1, first: event, latest: event });
    });
    const plan = f.db.prepare("EXPLAIN QUERY PLAN SELECT * FROM events INDEXED BY events_type_idx WHERE task_id = ? AND seq > ? AND seq <= ? AND event_type IN (?) ORDER BY seq").all("snapshot", 0, 2, "OBSERVATION");
    assert.ok(plan.some(row => row.detail.includes("events_type_idx")), JSON.stringify(plan));
  } finally { f.close(); }
});

test("canonical decoder normalizes malformed and non-object stored event payloads", () => {
  const f = fixture();
  try {
    for (const payload of ["{", "null", "[]", "3", "{}"] ) {
      f.db.prepare("UPDATE events SET event_json = ? WHERE task_id = ?").run(payload, "snapshot");
      assert.throws(() => withLedgerEventSnapshot(f.db, "snapshot", events => [...events]), { code: "E_STORAGE_PAYLOAD_MISMATCH" });
    }
  } finally { f.close(); }
});

test("typed statement reuse preserves nested cursors, rebinding, early return and fresh snapshots", () => {
  const f = fixture();
  const originalPrepare = f.db.prepare;
  let preparations = 0;
  f.db.prepare = function(sql) {
    if (sql.includes("INDEXED BY events_type_idx")) preparations++;
    return originalPrepare.call(this, sql);
  };
  const observations = [];
  let checkpoint = { seq: 1, lastHash: f.event.hash };
  const appendObservation = () => {
    const event = buildProtocolEvent({ taskId: "snapshot", event: "OBSERVATION" }, { checkpoint });
    appendEvent(f.db, { taskId: "snapshot", event });
    observations.push(event);
    checkpoint = { seq: event.seq, lastHash: event.hash };
  };
  try {
    appendObservation(); appendObservation();
    withLedgerEventSnapshot(f.db, "snapshot", events => {
      assert.deepEqual([...events], [f.event, ...observations]);
      const outer = [];
      for (const [, event] of ledgerEntriesOfTypes(events, ["OBSERVATION"])) {
        outer.push(event);
        assert.deepEqual([...ledgerEntriesOfTypes(events, ["TASK_RECEIVED"])], [[0, f.event]]);
      }
      assert.deepEqual(outer, observations);
      assert.equal(preparations, 3, "Two nested scans independently borrow while the outer statement is active");
      for (const [, event] of ledgerEntriesOfTypes(events, ["OBSERVATION"])) { assert.equal(event.hash, observations[0].hash); break; }
      assert.deepEqual([...ledgerEntriesOfTypes(events, ["TASK_RECEIVED"])], [[0, f.event]]);
      assert.equal(preparations, 3, "Early return releases the original cached statement");
      assert.throws(() => {
        for (const [, event] of ledgerEntriesOfTypes(events, ["OBSERVATION"])) {
          assert.equal(event.event, "OBSERVATION");
          throw new Error("caller stopped");
        }
      }, /caller stopped/);
      assert.deepEqual([...ledgerEntriesOfTypes(events, ["TASK_RECEIVED"])], [[0, f.event]]);
      assert.equal(preparations, 3);
    });
    appendObservation();
    withLedgerEventSnapshot(f.db, "snapshot", events => {
      assert.equal([...events].length, 4);
      assert.deepEqual([...ledgerEntriesOfTypes(events, ["OBSERVATION"])].map(([, event]) => event), observations);
      assert.equal(preparations, 3, "A new snapshot reuses SQL, never old rows");
    });
  } finally { f.db.prepare = originalPrepare; f.close(); }
});

test("typed statement cache is bounded across differing query arities", () => {
  const f = fixture();
  const originalPrepare = f.db.prepare;
  let preparations = 0;
  f.db.prepare = function(sql) {
    if (sql.includes("INDEXED BY events_type_idx")) preparations++;
    return originalPrepare.call(this, sql);
  };
  try {
    withLedgerEventSnapshot(f.db, "snapshot", events => {
      assert.deepEqual([...events], [f.event]);
      for (let repetition = 0; repetition < 2; repetition++) {
        for (let arity = 1; arity <= 17; arity++) {
          const types = Array.from({ length: arity }, (_, index) => `absent-${index}`);
          assert.deepEqual([...ledgerEntriesOfTypes(events, types)], []);
        }
      }
      assert.equal(preparations, 18, "Sixteen arities are retained; the seventeenth is prepared per call");
    });
  } finally { f.db.prepare = originalPrepare; f.close(); }
});
