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
 * Work package B: independent-process contention.
 *
 * Every writer here is a genuinely separate OS process with its own SQLite
 * connection against the same disposable database. In-process calls sharing a
 * connection do not satisfy this gate; the earlier Phase 2A tests complement
 * these rather than replacing them.
 *
 * Synchronization uses marker-file barriers that the workers block on, so the
 * ordering is observed rather than assumed.
 */

/** Build a native project plus a disposable database, then return paths. */
async function buildDatabase(label) {
  const { target } = await buildCanonicalDiagnosisProject({ taskId: TEST_TASK_ID });
  const databasePath = path.join(target, ".forgeloop/state.sqlite");
  const db = openStorageDatabase(databasePath);
  const baseline = logicalSnapshot(db, TEST_TASK_ID);
  db.close();
  return { target, databasePath, baseline, barrier: createBarrier(label) };
}

function writerConfig(databasePath, barrierDir, overrides = {}) {
  return {
    mode: "writer",
    databasePath,
    taskId: TEST_TASK_ID,
    hypothesis: "A hypothesis for the diagnosis",
    barrierDir,
    now: FIXED_AT,
    ...overrides,
  };
}

/** Reopen the database and assert both structure and domain validity. */
function assertValidDatabase(databasePath, label) {
  const db = openStorageDatabase(databasePath);
  try {
    const integrity = checkStorageIntegrity(db);
    assert.equal(integrity.ok, true, `${label}: structural integrity`);
    const events = listEvents(db, TEST_TASK_ID);
    const ledger = validateLedgerEvents(events);
    assert.equal(ledger.valid, true, `${label}: ledger semantics: ${JSON.stringify(ledger.errors)}`);
    // Sequences are unique and contiguous, and each hash matches its content.
    events.forEach((event, index) => {
      assert.equal(event.seq, index + 1, `${label}: contiguous sequence`);
      assert.equal(event.hash, eventHash(event), `${label}: event ${event.seq} hash`);
    });
    return { events, snapshot: logicalSnapshot(db, TEST_TASK_ID) };
  } finally {
    db.close();
  }
}

test("B1: two processes, same expected revision - exactly one mutation succeeds", async () => {
  const { target, databasePath, baseline, barrier } = await buildDatabase("b1");
  const first = spawnWorker(writerConfig(databasePath, barrier.dir, { workerId: "a", prepareBarrier: true, hypothesis: "First competing diagnosis" }));
  const second = spawnWorker(writerConfig(databasePath, barrier.dir, { workerId: "b", prepareBarrier: true, hypothesis: "Second competing diagnosis" }));
  try {
    // Explicit barrier: both workers are confirmed ready before either proceeds.
    await barrier.waitFor("ready-a", 30000, first);
    await barrier.waitFor("ready-b", 30000, second);
    barrier.signal("proceed");

    await barrier.waitFor("prepared-a", 30000, first);
    await barrier.waitFor("prepared-b", 30000, second);
    barrier.signal("release-prepared");
    const [left, right] = await Promise.all([first.result(), second.result()]);
    const winners = [left, right].filter((entry) => entry.result?.ok);
    const losers = [left, right].filter((entry) => entry.result && entry.result.ok === false);

    assert.equal(winners.length, 1, `exactly one winner, got ${JSON.stringify([left.result, right.result])}`);
    assert.equal(losers.length, 1, "the other process must be rejected");
    // The loser observes a domain conflict, not a storage fault.
    assert.equal(losers[0].result.code, "E_STATE_REVISION_CONFLICT", JSON.stringify(losers[0].result));

    // Final state changed only as much as the winning operation required.
    const { events, snapshot } = assertValidDatabase(databasePath, "B1");
    assert.equal(snapshot.revision, baseline.revision + 1, "revision advanced exactly once");
    assert.equal(events.length, baseline.eventCount + 2, "exactly one event appended");
    assert.equal(snapshot.head.hash, events.at(-1).hash, "ledger head matches the last event");

    // No orphan event: the committed event describes the winning mutation only.
    const appended = events.at(-2);
    assert.equal(appended.event, "DIAGNOSIS_RECORDED");
    const hypotheses = ["First competing diagnosis", "Second competing diagnosis"];
    const described = hypotheses.find((text) => appended.details.hypothesis.trim() === text);
    assert.ok(described, `committed event must describe one mutation, got ${appended.details.hypothesis}`);
  } finally {
    barrier.cleanup();
    await cleanupDir(target);
  }
});

test("B2: a fresh connection observes the same valid state/ledger relationship", async () => {
  const { target, databasePath, baseline, barrier } = await buildDatabase("b2");
  const writer = spawnWorker(writerConfig(databasePath, barrier.dir, { workerId: "a", hypothesis: "Only diagnosis" }));
  try {
    await barrier.waitFor("ready-a");
    barrier.signal("proceed");
    const outcome = await writer.result();
    assert.equal(outcome.result.ok, true, `writer failed: ${JSON.stringify(outcome)}`);

    const reopened = assertValidDatabase(databasePath, "B2");
    assert.equal(reopened.snapshot.revision, baseline.revision + 1);
    assert.equal(reopened.events.at(-2).hash, outcome.result.hash, "committed hash is durable");
  } finally {
    barrier.cleanup();
    await cleanupDir(target);
  }
});

test("B3: idempotent diagnosis advances revision with only a commit witness", async () => {
  const { target, databasePath, baseline, barrier } = await buildDatabase("b3");
  const first = spawnWorker(writerConfig(databasePath, barrier.dir, { workerId: "a", hypothesis: "Repeated diagnosis" }));
  try {
    await barrier.waitFor("ready-a");
    barrier.signal("proceed");
    const one = await first.result();
    assert.equal(one.result.ok, true);
    assert.equal(one.result.idempotent, false, "the first call is a real mutation");

    // A separate process repeats the identical request.
    const repeatBarrier = createBarrier("b3b");
    const second = spawnWorker(writerConfig(databasePath, repeatBarrier.dir, { workerId: "b", hypothesis: "Repeated diagnosis" }));
    try {
      await repeatBarrier.waitFor("ready-b");
      repeatBarrier.signal("proceed");
      const two = await second.result();
      assert.equal(two.result.ok, true, `second call failed: ${JSON.stringify(two)}`);
      assert.equal(two.result.idempotent, true, "the repeat must take the idempotent branch");

      // Canonical repeat updates state and adds one witness without duplicate diagnosis.
      const { events, snapshot } = assertValidDatabase(databasePath, "B3");
      assert.equal(events.length, baseline.eventCount + 3, "repeat adds only command witness");
      assert.equal(events.filter(event => event.event === "DIAGNOSIS_RECORDED").length, 1);
      assert.equal(snapshot.revision, baseline.revision + 2, "revision advanced once more");
    } finally {
      repeatBarrier.cleanup();
    }
  } finally {
    barrier.cleanup();
    await cleanupDir(target);
  }
});

test("B4: an independent reader sees a coherent state/event pair", async () => {
  const { target, databasePath, baseline, barrier } = await buildDatabase("b4");
  const writer = spawnWorker(writerConfig(databasePath, barrier.dir, { workerId: "a", hypothesis: "Coherent reader" }));
  try {
    await barrier.waitFor("ready-a");
    barrier.signal("proceed");
    await writer.result();

    // State and ledger read together must describe the same commit: never a
    // mixed pre/post pair.
    const reader = openStorageDatabase(databasePath);
    try {
      const revision = reader.prepare("SELECT revision FROM tasks WHERE task_id = ?").get(TEST_TASK_ID).revision;
      const events = listEvents(reader, TEST_TASK_ID);
      const head = reader.prepare("SELECT seq, hash FROM events WHERE task_id = ? ORDER BY seq DESC LIMIT 1").get(TEST_TASK_ID);
      assert.equal(revision, baseline.revision + 1);
      assert.equal(events.length, baseline.eventCount + 2);
      assert.equal(head.seq, events.at(-1).seq, "head sequence matches last event");
      assert.equal(head.hash, events.at(-1).hash, "head hash matches last event");
    } finally {
      reader.close();
    }
  } finally {
    barrier.cleanup();
    await cleanupDir(target);
  }
});

test("B5: a busy timeout is reported as a timeout, not as a revision conflict", async () => {
  // Tested separately from the domain revision conflict so the two conditions
  // are never confused. A separate process holds the writer for longer than the
  // configured bounded wait; the waiter must time out without any partial write.
  const { target, databasePath, barrier } = await buildDatabase("b5");
  const holder = spawnWorker({
    mode: "hold-writer",
    databasePath,
    taskId: TEST_TASK_ID,
    hypothesis: "holder",
    barrierDir: barrier.dir,
    barrierTimeoutMs: 25_000,
  });
  const waiter = spawnWorker({
    ...writerConfig(databasePath, barrier.dir, { workerId: "b", hypothesis: "Timing out diagnosis" }),
    busyTimeoutMs: 750,
  });
  try {
    await barrier.waitFor("writer-held");
    barrier.signal("proceed");

    const outcome = await waiter.result();
    assert.equal(outcome.result.ok, false, "the waiter must not succeed while the writer is held");
    // The documented busy/timeout classification, not a domain conflict.
    assert.ok(
      ["E_STORAGE_BUSY", "E_STORAGE_INTERRUPTED"].includes(outcome.result.code),
      `expected a busy/timeout code, got ${outcome.result.code}`,
    );
    assert.notEqual(outcome.result.code, "E_STATE_REVISION_CONFLICT");
  } finally {
    barrier.signal("release-writer");
    await holder.result().catch(() => {});
    barrier.cleanup();
    await cleanupDir(target);
  }
});

test("B6: after the busy timeout, no partial mutation was persisted", async () => {
  const { target, databasePath, barrier } = await buildDatabase("b6");
  const before = (() => {
    const db = openStorageDatabase(databasePath);
    try {
      return logicalSnapshot(db, TEST_TASK_ID);
    } finally {
      db.close();
    }
  })();

  const holder = spawnWorker({
    mode: "hold-writer",
    databasePath,
    taskId: TEST_TASK_ID,
    hypothesis: "holder",
    barrierDir: barrier.dir,
    barrierTimeoutMs: 25_000,
  });
  const waiter = spawnWorker({
    ...writerConfig(databasePath, barrier.dir, { workerId: "b", hypothesis: "Timing out diagnosis" }),
    busyTimeoutMs: 750,
  });
  try {
    await barrier.waitFor("writer-held");
    barrier.signal("proceed");
    await waiter.result();
  } finally {
    barrier.signal("release-writer");
    await holder.result().catch(() => {});
    barrier.cleanup();
  }

  try {
    const db = openStorageDatabase(databasePath);
    try {
      assert.deepEqual(logicalSnapshot(db, TEST_TASK_ID), before, "timed-out writer left no change");
    } finally {
      db.close();
    }
  } finally {
    await cleanupDir(target);
  }
});
