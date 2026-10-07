import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { LedgerEventCollection, ledgerEventAtIs, isLedgerEventCollection } from "../src/core/ledger-event-collection.js";
import { eventHash, readEvents, validateLedgerEvents, validateStateLedgerCoherence } from "../src/core/events.js";
import { readWorkState } from "../src/core/work-state.js";
import { setupVerifyingTask } from "./helpers/durable-lifecycle.js";
import { getPackageRoot } from "../src/core/templates.js";
import { decodedLedgerSource as decodedSource } from "./helpers/ledger-event-collection.js";


function result(events) {
  const { valid, errors } = validateLedgerEvents(events);
  return { valid, errors };
}

test("on-demand source preserves complete lifecycle validation and corruption verdicts", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-ledger-collection-"));
  const packageRoot = getPackageRoot();
  const taskId = "ledger-collection";
  try {
    await setupVerifyingTask(target, packageRoot, { taskId, capabilityPolicy: null });
    const events = await readEvents(target, packageRoot, { taskId });
    const state = await readWorkState(target, { packageRoot, taskId });
    assert.equal(result(events).valid, true);
    assert.deepEqual(result(decodedSource(events)), result(events));
    assert.deepEqual(validateStateLedgerCoherence(state, decodedSource(events)), validateStateLedgerCoherence(state, events));
    // Every original position participates; no tail/cursor acceptance shortcut.
    for (let index = 0; index < events.length; index += 1) {
      const tampered = structuredClone(events);
      tampered[index].hash = "f".repeat(64);
      assert.equal(result(tampered).valid, false);
      assert.deepEqual(result(decodedSource(tampered)), result(tampered));
    }
    for (const kind of ["GATE_REVALIDATED", "CONTRACT_REVISED", "CHECKPOINT_REVALIDATED", "SEMANTIC_DECISION_RECORDED", "LEGACY_RECOVERY_MIGRATION_RECORDED", "CONTRACT_BOOTSTRAP_REPAIR_RECORDED"]) {
      const damaged = structuredClone(events);
      const last = damaged.at(-1);
      const event = { ...last, seq: last.seq + 1, previousHash: last.hash, event: kind, details: {} };
      event.hash = eventHash(event);
      damaged.push(event);
      assert.deepEqual(result(decodedSource(damaged)), result(damaged));
    }
  } finally { await rm(target, { recursive: true, force: true }); }
});

test("historical views retain private source positions and reject copied/foreign identity", () => {
  const original = [{ seq: 1 }, { seq: 2 }, { seq: 3 }];
  const source = decodedSource(original);
  const event = source.find(candidate => candidate.seq === 2);
  assert.equal(Array.isArray(source), false);
  assert.equal(isLedgerEventCollection({ ...source }), false);
  assert.equal(source.indexOf(event), 1);
  assert.equal(source.indexOf(structuredClone(event)), -1);
  assert.equal(ledgerEventAtIs(source, 1, event), true);
  assert.equal(ledgerEventAtIs(source.slice(1), 0, event), true);
  assert.equal(ledgerEventAtIs(source.slice(2), 0, event), false);
  assert.equal(source.slice(1).indexOf(event), 0);
  assert.deepEqual([...source.slice(-2)], original.slice(-2));
  assert.throws(() => new LedgerEventCollection({}, { source: {}, start: 0, end: 1 }), { code: "E_LEDGER_SOURCE_INVALID" });
  assert.throws(() => { source.length = 0; }, TypeError);
});

test("truncated/overlong sources and reused position identity fail closed", () => {
  const truncated = new LedgerEventCollection({ length: 2, readAt: () => ({}), *iterateRange() { yield {}; } });
  assert.throws(() => [...truncated], { code: "E_LEDGER_SOURCE_INVALID" });
  const overlong = new LedgerEventCollection({ length: 1, readAt: () => ({}), *iterateRange() { yield {}; yield {}; } });
  assert.throws(() => [...overlong], { code: "E_LEDGER_SOURCE_INVALID" });
  const reused = {};
  const repeated = new LedgerEventCollection({ length: 2, readAt: () => reused });
  assert.throws(() => [...repeated], { code: "E_LEDGER_SOURCE_INVALID" });
});

test("typed source readers reject reordered, foreign-type and invalid positions", () => {
  for (const rows of [
    [{ index: 1, event: { event: "A" } }, { index: 0, event: { event: "A" } }],
    [{ index: 0, event: { event: "B" } }],
    [{ index: 2, event: { event: "A" } }],
    [{ index: 0.5, event: { event: "A" } }],
  ]) {
    const events = new LedgerEventCollection({ length: 2, readAt: () => ({}), *iterateTypes() { yield* rows; } });
    assert.throws(() => [...events.entriesOfTypes(["A"])], { code: "E_LEDGER_SOURCE_INVALID" });
  }
});
