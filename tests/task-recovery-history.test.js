import assert from "node:assert/strict";
import { test } from "node:test";

import {
  classifyRecoveryHistory,
  resolveRecoveryHistory,
  summarizeRecoveryHistory,
} from "../src/core/recovery-history.js";
import { decodedLedgerSource } from "./helpers/ledger-event-collection.js";
import { withSpilledLedgerRelations } from "../src/storage/ledger-relations.js";

function recovery(seq, recoveryId) {
  return {
    seq,
    event: "OPERATOR_RECOVERY_RECORDED",
    details: { recoveryId },
  };
}

function resume(seq, recoveryId) {
  return {
    seq,
    event: "TASK_RECOVERY_RESUMED",
    details: { recoveryId, reacquiredClaims: ["src"] },
  };
}

test("internal recovery summary preserves cycle decisions and errors beyond spill threshold", async () => {
  const events = [];
  for (let index = 0; index < 1000; index += 1) {
    events.push(recovery(events.length + 1, `recovery-${index}`));
    events.push(resume(events.length + 1, `recovery-${index}`));
  }
  for (const tail of [[], [recovery(2001, "recovery-active")], [recovery(2001, "recovery-999")], [resume(2001, "recovery-999")], [recovery(2001, "recovery-active"), recovery(2002, "recovery-conflict")]]) {
    const source = [...events, ...tail];
    const expected = classifyRecoveryHistory(source);
    await withSpilledLedgerRelations(owner => {
      const maps = [];
      const create = owner.map;
      owner.map = () => { const map = create(); maps.push(map); return map; };
      const observedIds = [];
      const actual = summarizeRecoveryHistory(decodedLedgerSource(source), cycle => observedIds.push(cycle.recoveryId));
      assert.deepEqual(actual, {
        activeRecoveryId: expected.activeRecoveryId,
        activeRecovery: expected.activeRecovery,
        completedRecoveryCount: expected.completedRecoveries.length,
        valid: expected.valid,
        errors: expected.errors,
      });
      assert.deepEqual(observedIds, expected.recoveries.map(cycle => cycle.recoveryId));
      assert.equal("recoveries" in actual, false);
      assert.equal("completedRecoveries" in actual, false);
      assert.ok(maps.some(map => map.spilled));
    });
  }
});

test("classifyRecoveryHistory reports one unresolved recovery cycle as active", () => {
  const event = recovery(7, "recovery-a");

  const result = classifyRecoveryHistory([event]);

  assert.equal(result.valid, true);
  assert.equal(result.activeRecoveryId, "recovery-a");
  assert.deepEqual(result.activeRecovery, { recoveryId: "recovery-a", event });
  assert.deepEqual(result.completedRecoveries, []);
  assert.deepEqual(result.errors, []);
});

test("classifyRecoveryHistory accepts two ordered recovery and resume cycles", () => {
  const events = [
    recovery(3, "recovery-a"),
    resume(4, "recovery-a"),
    recovery(8, "recovery-b"),
    resume(9, "recovery-b"),
  ];

  const result = classifyRecoveryHistory(events);

  assert.equal(result.valid, true);
  assert.equal(result.activeRecoveryId, null);
  assert.equal(result.recoveries.length, 2);
  assert.deepEqual(
    result.recoveries.map(({ recoveryId, recoveryEventSeq, resumedEventSeq, active }) => ({
      recoveryId,
      recoveryEventSeq,
      resumedEventSeq,
      active,
    })),
    [
      { recoveryId: "recovery-a", recoveryEventSeq: 3, resumedEventSeq: 4, active: false },
      { recoveryId: "recovery-b", recoveryEventSeq: 8, resumedEventSeq: 9, active: false },
    ],
  );
  assert.deepEqual(result.completedRecoveries.map((cycle) => cycle.recoveryId), ["recovery-a", "recovery-b"]);
});

test("resolveRecoveryHistory is the canonical compatibility alias", () => {
  assert.deepEqual(resolveRecoveryHistory([]), classifyRecoveryHistory([]));
});

for (const scenario of [
  {
    name: "recovery without recovery id",
    events: [{ event: "OPERATOR_RECOVERY_RECORDED", details: {} }],
    message: /has no recoveryId/i,
  },
  {
    name: "resume without sequence or recovery id",
    events: [{ event: "TASK_RECOVERY_RESUMED", details: {} }],
    message: /at seq unknown does not reference an active recovery/i,
  },
  {
    name: "resume without recovery",
    events: [resume(1, "recovery-a")],
    message: /does not reference an active recovery/i,
  },
  {
    name: "duplicate resume",
    events: [recovery(1, "recovery-a"), resume(2, "recovery-a"), resume(3, "recovery-a")],
    message: /already resumed|does not reference an active recovery/i,
  },
  {
    name: "second recovery while first remains active",
    events: [recovery(1, "recovery-a"), recovery(2, "recovery-b")],
    message: /while recovery recovery-a is unresolved/i,
  },
  {
    name: "reused recovery id",
    events: [recovery(1, "recovery-a"), resume(2, "recovery-a"), recovery(3, "recovery-a")],
    message: /reuses recovery id/i,
  },
  {
    name: "resume sequence before recovery sequence",
    events: [recovery(4, "recovery-a"), resume(3, "recovery-a")],
    message: /must be greater than recovery sequence/i,
  },
]) {
  test(`classifyRecoveryHistory rejects ${scenario.name}`, () => {
    const result = classifyRecoveryHistory(scenario.events);

    assert.equal(result.valid, false);
    assert.equal(result.activeRecoveryId, null);
    assert.ok(result.errors.some((error) => error.code === "E_TASK_RECOVERY_INCONSISTENT"));
    assert.ok(result.errors.some((error) => scenario.message.test(error.message)));
  });
}
