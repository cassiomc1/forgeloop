import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";

import { openStorageDatabase, listEvents, checkStorageIntegrity } from "../src/storage/index.js";
import { buildCanonicalDiagnosisProject } from "./helpers/canonical-diagnosis-fixture.js";
import { validateLedgerEvents, eventHash } from "../src/core/events.js";
import {
  FIXED_AT,
  TEST_TASK_ID,
  cleanupDir,
  createBarrier,
  logicalSnapshot,
  spawnWorker,
} from "./helpers/storage-fixtures.js";

/**
 * Work package C: controlled process interruption.
 *
 * A parent process terminates a child writer at known execution boundaries and
 * then reopens the database from a new connection to observe the result.
 *
 * These tests never touch the repository's active protocol state; every fixture
 * is disposable. They establish process-crash recovery in the tested
 * environment. They are not a proof of power-loss durability, and no test here
 * requires one particular outcome for an uncontrolled commit window.
 */

async function buildDatabase(label) {
  const { target } = await buildCanonicalDiagnosisProject({ taskId: TEST_TASK_ID });
  const databasePath = path.join(target, ".forgeloop/state.sqlite");
  const db = openStorageDatabase(databasePath);
  const before = logicalSnapshot(db, TEST_TASK_ID);
  db.close();
  return { target, databasePath, before, barrier: createBarrier(label) };
}

/** Reopen and assert both SQLite structure and ForgeLoop domain semantics. */
function inspect(databasePath) {
  const db = openStorageDatabase(databasePath);
  try {
    const integrity = checkStorageIntegrity(db);
    const events = listEvents(db, TEST_TASK_ID);
    const ledger = validateLedgerEvents(events);
    return {
      integrity,
      ledgerValid: ledger.valid,
      ledgerErrors: ledger.errors,
      events,
      snapshot: logicalSnapshot(db, TEST_TASK_ID),
    };
  } finally {
    db.close();
  }
}

/** Assert a complete, unmodified logical snapshot. */
function assertOriginalSnapshot(state, before, label) {
  assert.equal(state.integrity.ok, true, `${label}: structural integrity`);
  assert.equal(state.ledgerValid, true, `${label}: ledger semantics ${JSON.stringify(state.ledgerErrors)}`);
  assert.deepEqual(state.snapshot, before, `${label}: logical snapshot must be unchanged`);
  state.events.forEach((event, index) => {
    assert.equal(event.seq, index + 1, `${label}: contiguous sequence`);
    assert.equal(event.hash, eventHash(event), `${label}: event ${event.seq} hash`);
  });
}

test("C1: interruption before commit rolls back the state and event together", async () => {
  const { target, databasePath, before, barrier } = await buildDatabase("c1");
  const writer = spawnWorker({
    mode: "writer",
    databasePath,
    taskId: TEST_TASK_ID,
    hypothesis: "Interrupted diagnosis",
    barrierDir: barrier.dir,
    now: FIXED_AT,
    workerId: "a",
    boundary: "before-commit",
  });
  try {
    await barrier.waitFor("ready-a");
    barrier.signal("proceed");
    // The worker reaches the controlled pre-commit boundary and blocks with the
    // mutation applied but not committed.
    await barrier.waitFor("pre-commit");
    const exit = await writer.kill("SIGKILL");
    assert.ok(exit.signalName || exit.code !== 0, "the writer must not exit cleanly");
  } finally {
    barrier.cleanup();
  }

  try {
    assertOriginalSnapshot(inspect(databasePath), before, "C1");
  } finally {
    await cleanupDir(target);
  }
});

test("C2: interruption after a confirmed commit keeps the complete committed snapshot", async () => {
  const { target, databasePath, before, barrier } = await buildDatabase("c2");
  const writer = spawnWorker({
    mode: "writer",
    databasePath,
    taskId: TEST_TASK_ID,
    hypothesis: "Committed then interrupted",
    barrierDir: barrier.dir,
    now: FIXED_AT,
    workerId: "a",
    boundary: "after-commit",
  });
  try {
    await barrier.waitFor("ready-a");
    barrier.signal("proceed");
    // The worker acknowledges that COMMIT returned, then blocks before
    // delivering its response: a confirmed commit, not a guessed timing window.
    await barrier.waitFor("commit-ack");
    const exit = await writer.kill("SIGKILL");
    assert.ok(exit.signalName || exit.code !== 0, "the writer must not exit cleanly");
  } finally {
    barrier.cleanup();
  }

  try {
    const state = inspect(databasePath);
    assert.equal(state.integrity.ok, true, "C2: structural integrity");
    assert.equal(state.ledgerValid, true, `C2: ledger semantics ${JSON.stringify(state.ledgerErrors)}`);
    assert.equal(state.snapshot.revision, before.revision + 1, "committed revision is retained");
    assert.equal(state.events.length, before.eventCount + 2, "committed event is retained");
    assert.equal(state.events.at(-2).event, "DIAGNOSIS_RECORDED");
    assert.equal(state.events.at(-1).hash, eventHash(state.events.at(-1)));
  } finally {
    await cleanupDir(target);
  }
});

test("C3: a later writer recovers cleanly after an interrupted attempt", async () => {
  const { target, databasePath, before, barrier } = await buildDatabase("c3");
  const first = spawnWorker({
    mode: "writer",
    databasePath,
    taskId: TEST_TASK_ID,
    hypothesis: "Interrupted diagnosis",
    barrierDir: barrier.dir,
    now: FIXED_AT,
    workerId: "a",
    boundary: "before-commit",
  });
  try {
    await barrier.waitFor("ready-a");
    barrier.signal("proceed");
    await barrier.waitFor("pre-commit");
    await first.kill("SIGKILL");
  } finally {
    barrier.cleanup();
  }

  // A subsequent writer in a fresh process must see the original revision and
  // commit normally.
  const second = createBarrier("c3b");
  const next = spawnWorker({
    mode: "writer",
    databasePath,
    taskId: TEST_TASK_ID,
    hypothesis: "Diagnosis after recovery",
    barrierDir: second.dir,
    now: FIXED_AT,
    workerId: "b",
  });
  try {
    await second.waitFor("ready-b");
    second.signal("proceed");
    const outcome = await next.result();
    assert.equal(outcome.result.ok, true, `writer after recovery failed: ${JSON.stringify(outcome.result)}`);
    assert.equal(outcome.result.revision, before.revision + 1, "the recovered writer commits from the original revision");
    assert.equal(outcome.result.eventCount, before.eventCount + 2, "exactly one event exists after recovery");
  } finally {
    second.cleanup();
  }

  try {
    const state = inspect(databasePath);
    assert.equal(state.integrity.ok, true);
    assert.equal(state.ledgerValid, true, `C3: ledger semantics ${JSON.stringify(state.ledgerErrors)}`);
    assert.equal(state.snapshot.revision, before.revision + 1);
    assert.equal(state.events.length, before.eventCount + 2);
    // The interrupted attempt left nothing behind.
    assert.equal(
      state.events.filter((event) => event.event === "DIAGNOSIS_RECORDED").length,
      1,
      "only the recovered mutation may be present",
    );
  } finally {
    await cleanupDir(target);
  }
});

test("C4: a reopened database passes structural and domain validation", async () => {
  const { target, databasePath, before, barrier } = await buildDatabase("c4");
  const writer = spawnWorker({
    mode: "writer",
    databasePath,
    taskId: TEST_TASK_ID,
    hypothesis: "Validated diagnosis",
    barrierDir: barrier.dir,
    now: FIXED_AT,
    workerId: "a",
    boundary: "after-commit",
  });
  try {
    await barrier.waitFor("ready-a");
    barrier.signal("proceed");
    await barrier.waitFor("commit-ack");
    await writer.kill("SIGKILL");
  } finally {
    barrier.cleanup();
  }

  try {

    // Reopen from a brand new connection and validate semantics, not just bytes.
    const state = inspect(databasePath);
    assert.equal(state.integrity.ok, true, "C4: integrity_check and foreign_key_check");
    assert.equal(state.ledgerValid, true, `C4: ${JSON.stringify(state.ledgerErrors)}`);
    assert.equal(state.events.length, before.eventCount + 2);
    state.events.forEach((event, index) => {
      assert.equal(event.seq, index + 1, "C4: contiguous sequence after reopen");
      assert.equal(event.hash, eventHash(event), "C4: hash matches content after reopen");
    });
  } finally {
    await cleanupDir(target);
  }
});

test("C1b: interruption after the state update but before the event insert rolls back both", async () => {
  const { target, databasePath, before, barrier } = await buildDatabase("c1b");
  const writer = spawnWorker({
    mode: "writer",
    databasePath,
    taskId: TEST_TASK_ID,
    hypothesis: "Interrupted before event",
    barrierDir: barrier.dir,
    now: FIXED_AT,
    workerId: "a",
    boundary: "before-event",
  });
  try {
    await barrier.waitFor("ready-a");
    barrier.signal("proceed");
    // The conditional state update has executed inside the open transaction;
    // the worker blocks immediately before the ledger insert.
    await barrier.waitFor("state-updated");
    const exit = await writer.kill("SIGKILL");
    assert.ok(exit.signalName || exit.code !== 0, "the writer must not exit cleanly");
  } finally {
    barrier.cleanup();
  }

  try {
    // Neither the state revision nor the event may survive.
    assertOriginalSnapshot(inspect(databasePath), before, "C1b");
  } finally {
    await cleanupDir(target);
  }
});
