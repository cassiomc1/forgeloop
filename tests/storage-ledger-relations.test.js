import assert from "node:assert/strict";
import test from "node:test";
import { stat } from "node:fs/promises";
import { setImmediate } from "node:timers/promises";
import { withSpilledLedgerRelations, withSpilledLedgerRelationsSync } from "../src/storage/ledger-relations.js";
import { ledgerRelationMap, ledgerRelationSet, ledgerGroupedSet } from "../src/core/ledger-relations.js";
import { buildProtocolEvent, validateLedgerEvents } from "../src/core/events.js";
import { decodedLedgerSource } from "./helpers/ledger-event-collection.js";

test("relation maps preserve primitive metadata, insertion order and deletion across spill", async () => {
  assert.ok(ledgerRelationMap() instanceof Map);
  assert.ok(ledgerRelationSet() instanceof Set);
  let retained;
  let cursor;
  let filename;
  await withSpilledLedgerRelations(async owner => {
    retained = ledgerRelationMap();
    const expected = new Map();
    for (let index = 0; index < 1000; index += 1) {
      const key = index % 2 ? `key-${index}` : index;
      const value = index % 3 ? index : undefined;
      expected.set(key, value);
      retained.set(key, value);
    }
    assert.equal(retained.spilled, true);
    for (const [key, value] of expected) {
      assert.equal(retained.has(key), true);
      assert.equal(retained.get(key), value);
    }
    assert.equal(retained.has("absent"), false);
    assert.equal(retained.get("absent"), undefined);
    assert.equal(retained.delete("absent"), false);
    expected.set("key-1", null); retained.set("key-1", null);
    expected.delete(2); assert.equal(retained.delete(2), true);
    expected.set(2, "reinserted"); retained.set(2, "reinserted");
    await setImmediate();
    assert.equal(retained.size, expected.size);
    assert.deepEqual([...retained], [...expected]);
    filename = owner.database().prepare("PRAGMA database_list").all().find(row => row.name === "main").file;
    cursor = retained.entries();
    cursor.next();
  });
  assert.throws(() => retained.get(2), { code: "E_LEDGER_RELATION_INVALID" });
  assert.throws(() => cursor.next(), { code: "E_LEDGER_RELATION_INVALID" });
  await assert.rejects(stat(filename), { code: "ENOENT" });
});

test("synchronous relation guards spill and expire without accepting async callbacks", () => {
  let retained;
  withSpilledLedgerRelationsSync(() => {
    retained = ledgerRelationSet();
    for (let index = 0; index < 1000; index += 1) retained.add(index);
    assert.equal(retained.spilled, true);
    assert.equal(retained.size, 1000);
  });
  assert.throws(() => retained.has(0), { code: "E_LEDGER_RELATION_INVALID" });
  assert.throws(() => withSpilledLedgerRelationsSync(async () => {}), { code: "E_STORAGE_ASYNC_TRANSACTION" });
  assert.throws(() => withSpilledLedgerRelationsSync(() => Promise.resolve()), { code: "E_STORAGE_ASYNC_TRANSACTION" });
});

test("sets spill bounded relation keys and nested owners do not share backing or lifetime", async () => {
  await withSpilledLedgerRelations(async () => {
    const parent = ledgerRelationSet();
    for (let index = 0; index < 1000; index += 1) parent.add(`recovery-${index}`);
    assert.equal(parent.spilled, true);
    assert.equal(parent.size, 1000);
    let child;
    await withSpilledLedgerRelations(async () => {
      child = ledgerRelationSet();
      child.add("child");
      assert.equal(child.has("recovery-0"), false);
      assert.equal(parent.has("child"), false);
      await setImmediate();
    });
    assert.throws(() => child.has("child"), { code: "E_LEDGER_RELATION_INVALID" });
    assert.equal(parent.has("recovery-999"), true);
    assert.equal(parent.delete("recovery-999"), true);
    assert.equal(parent.size, 999);
  });
});

test("large metadata spills by byte budget, callback failures clean owned scratch and expired cursors", async () => {
  let filename;
  let retained;
  await assert.rejects(withSpilledLedgerRelations(owner => {
    retained = ledgerRelationMap();
    retained.set("large", "x".repeat(70_000));
    assert.equal(retained.spilled, true);
    filename = owner.database().prepare("PRAGMA database_list").all().find(row => row.name === "main").file;
    assert.throws(() => retained.set("payload", { seq: 1 }), { code: "E_LEDGER_RELATION_INVALID" });
    throw new Error("intentional scratch failure");
  }), /intentional scratch failure/);
  await assert.rejects(stat(filename), { code: "ENOENT" });
  assert.throws(() => retained.size, { code: "E_LEDGER_RELATION_INVALID" });
  let cursor;
  await withSpilledLedgerRelations(() => {
    const map = ledgerRelationMap();
    map.set("first", 1).set("second", 2);
    cursor = map.entries();
    cursor.next();
  });
  assert.throws(() => cursor.next(), { code: "E_LEDGER_RELATION_INVALID" });
});

test("spilled canonical handoff relations preserve full validator errors and duplicate/digest authority", async () => {
  const events = [];
  const append = (event, details) => {
    const last = events.at(-1);
    events.push(buildProtocolEvent({ taskId: "relation-proof", event, ...(details ? { details } : {}) }, { checkpoint: { seq: last?.seq ?? 0, lastHash: last?.hash ?? null } }));
  };
  append("TASK_RECEIVED");
  for (let index = 0; index < 1000; index += 1) {
    append("HANDOFF_CREATED", { handoffId: `handoff-${index}`, artifact: `handoffs/${index}.json`, digest: "a".repeat(64) });
    append("HANDOFF_ACCEPTED", { handoffId: `handoff-${index}`, handoffDigest: "a".repeat(64), consumerId: "consumer" });
  }
  assert.equal(validateLedgerEvents(events).valid, true);
  for (const damaged of [false, true]) {
    if (damaged) {
      append("HANDOFF_ACCEPTED", { handoffId: "handoff-999", handoffDigest: "b".repeat(64), consumerId: "consumer" });
      append("HANDOFF_CREATED", { handoffId: "handoff-new", artifact: "new.json", digest: "a".repeat(64) });
      append("HANDOFF_ACCEPTED", { handoffId: "handoff-new", handoffDigest: "b".repeat(64), consumerId: "consumer" });
    }
    const expected = validateLedgerEvents(events);
    await withSpilledLedgerRelations(owner => {
      const maps = [];
      const create = owner.map;
      owner.map = () => { const map = create(); maps.push(map); return map; };
      const actual = validateLedgerEvents(decodedLedgerSource(events));
      assert.deepEqual({ valid: actual.valid, errors: actual.errors }, { valid: expected.valid, errors: expected.errors });
      assert.ok(maps.some(map => map.spilled));
      if (damaged) {
        assert.ok(actual.errors.some(error => error.code === "E_HANDOFF_ALREADY_ACCEPTED"));
        assert.ok(actual.errors.some(error => error.code === "E_HANDOFF_ACCEPTANCE_INCONSISTENT"));
      }
    });
  }
});

test("grouped membership spills primitive pairs and expires group cursors", () => {
  let retained;
  let cursor;
  withSpilledLedgerRelationsSync(() => {
    retained = ledgerGroupedSet();
    for (let index = 0; index < 1000; index++) {
      retained.add(index % 5, `member-${index}`);
      retained.add(index % 5, `member-${index}`);
    }
    assert.deepEqual([...retained.values(2)], Array.from({ length: 200 }, (_, index) => `member-${index * 5 + 2}`));
    assert.deepEqual([...retained.values(99)], []);
    cursor = retained.values(2);
    assert.equal(cursor.next().value, "member-2");
  });
  assert.throws(() => retained.add(2, "late"), { code: "E_LEDGER_RELATION_INVALID" });
  assert.throws(() => cursor.next(), { code: "E_LEDGER_RELATION_INVALID" });
  assert.throws(() => [...retained.values(2)], { code: "E_LEDGER_RELATION_INVALID" });
});
