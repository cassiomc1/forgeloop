import assert from "node:assert/strict";
import { cp, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { exportLegacyFixture } from "./helpers/storage-fixtures.js";
import { buildCanonicalDiagnosisProject } from "./helpers/canonical-diagnosis-fixture.js";
import { runRecordDiagnosis } from "../src/commands/record-diagnosis.js";
import { executeForgeLoopCommand } from "../src/core/command-runtime.js";
import { appendProtocolEvent, eventHash } from "../src/core/events.js";
import { getPackageRoot } from "../src/core/templates.js";
import { createTaskDescriptor, writeTaskDescriptor } from "../src/core/task-descriptor.js";
import { createWorkState, writeWorkState } from "../src/core/work-state.js";
import { canonicalFingerprint } from "../src/core/artifacts.js";
import {
  findTaskById,
  importProjectState,
  listEvents,
  openStorageDatabase,
  runInTransaction,
  appendEvent,
  countEvents,
  readLedgerHead,
} from "../src/storage/index.js";

const packageRoot = getPackageRoot();
const TASK_ID = "task-phase2a-differential";
/** Fixed timestamp so both fixtures produce an identical prior hash chain. */
const FIXED_AT = "2026-09-11T00:00:00.000Z";

/**
 * Build deterministic native evidence and explicitly export a disposable
 * legacy source for low-level importer and transaction tests. Public command
 * parity below compares direct API invocation with canonical dispatch on
 * independent copies of the same native lifecycle seed.
 */
async function createFilesystemFixture() {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-diag-fs-"));
  // A task descriptor is required: a namespace without task.json is classified
  // as a corrupt task namespace and is not imported.
  await writeTaskDescriptor(
    target,
    createTaskDescriptor({
      taskId: TASK_ID,
      writeClaims: [],
      createdAt: "2026-09-11T00:00:00.000Z",
      updatedAt: "2026-09-11T00:00:00.000Z",
    }),
    packageRoot,
  );
  // Prior events are stamped with a fixed time so both fixtures produce an
  // identical hash chain. Without this the earlier `at` values differ and the
  // `previousHash` of the appended event is not comparable across fixtures.
  const milestones = [
    ["TASK_RECEIVED", undefined],
    ["CONTRACT_VALIDATED", undefined],
    ["ROUTE_VALIDATED", undefined],
    ["PREFLIGHT_READY", undefined],
    ["EXECUTION_STARTED", undefined],
    ["VERIFICATION_STARTED", { verificationCycle: 1 }],
  ];
  for (const [event, details] of milestones) {
    await appendProtocolEvent(
      target,
      { taskId: TASK_ID, event, details, at: FIXED_AT },
      packageRoot,
      { taskId: TASK_ID },
    );
  }
  await writeWorkState(target, buildState(), { packageRoot, taskId: TASK_ID });
  await exportLegacyFixture(target);
  return target;
}

function buildState(overrides = {}) {
  return createWorkState({
    taskId: TASK_ID,
    contractFingerprint: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    routeFingerprint: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    repositoryFingerprint: { branch: null, head: null },
    phase: "DIAGNOSING",
    completedSteps: ["contract", "route", "implementation"],
    pendingSteps: ["verification"],
    verificationCycle: 1,
    checks: [
      {
        id: "check-auth-boundary",
        requirement: "auth",
        status: "failed",
        evidenceKind: "OBSERVED",
        result: "expected 401 but got 200",
        details: { verificationCycle: 1 },
      },
      {
        id: "check-auth-syntax",
        requirement: "syntax",
        status: "passed",
        evidenceKind: "OBSERVED",
        result: "syntax valid",
        details: { verificationCycle: 1 },
      },
    ],
    ...overrides,
  });
}

/** Import a filesystem fixture into a store, producing the paired SQLite path. */
async function createStoreFixture() {
  const source = await createFilesystemFixture();
  const { db, report } = await importProjectState(source, path.join(source, "state.sqlite"));
  return { source, db, report };
}

const REQUEST = {
  taskId: TASK_ID,
  hypothesis: "Comparison operator <= instead of <",
  failureClass: "VERIFICATION_FAILURE",
  evidenceRefs: ["check-auth-boundary"],
  settledBy: "pending-evidence",
  nextSafeAction: "Add the missing boundary case",
};

async function cleanup(...paths) {
  for (const target of paths) await rm(target, { recursive: true, force: true });
}


test("both paths produce an identical domain result for a valid transition", async () => {
  const { target: source } = await buildCanonicalDiagnosisProject({ taskId: TASK_ID });
  const fsTarget = await mkdtemp(path.join(os.tmpdir(), "forgeloop-diagnosis-control-"));
  await cp(source, fsTarget, { recursive: true });
  let db;
  try {
    const fsResult = await runRecordDiagnosis({ target: fsTarget, packageRoot, ...REQUEST });
    const envelope = await executeForgeLoopCommand({ command: "record-diagnosis", projectPath: source, input: REQUEST });
    assert.equal(envelope.ok, true, JSON.stringify(envelope));
    const storeResult = envelope.result;
    db = openStorageDatabase(path.join(source, ".forgeloop/state.sqlite"), { readOnly: true });

    const left = summarize(fsResult);
    const right = summarize(storeResult);

    // Both inherit the exact same seed chain. Normalize the new event time
    // and recompute its canonical hash from the actual returned event.
    const normalize = (event) => ({ ...event, at: "<controlled>" });
    assert.equal(right.eventSeq, left.eventSeq);
    assert.equal(right.eventType, left.eventType);
    assert.equal(right.previousHash, left.previousHash, "chain position must match");
    assert.equal(
      eventHash(normalize(right.event)),
      eventHash(normalize(left.event)),
      "canonical event hash must match the direct API once time is controlled",
    );
    assert.deepEqual(right.details, left.details, "diagnosis details must match");
    assert.equal(right.revision, left.revision);
    assert.equal(right.diagnosedHypothesis, left.diagnosedHypothesis);
    assert.equal(right.idempotent, left.idempotent);
    assert.equal(right.idempotent, false);
    const committed = listEvents(db, TASK_ID).at(-2);
    assert.deepEqual(committed, storeResult.event, "returned diagnosis is the persisted native event");
    assert.equal(committed.hash, eventHash(committed));
    assert.equal(listEvents(db, TASK_ID).at(-1).event, "TRANSACTION_COMMITTED");

  } finally {
    db?.close();
    await cleanup(fsTarget, source);
  }
});

async function createCanonicalStoreFixture({ readOnly = true, includePassingCheck = false } = {}) {
  const { target: source } = await buildCanonicalDiagnosisProject({ taskId: TASK_ID, includePassingCheck });
  try {
    return { source, db: openStorageDatabase(path.join(source, ".forgeloop/state.sqlite"), { readOnly }) };
  } catch (error) { await cleanup(source); throw error; }
}

async function diagnoseCanonical(source, input = REQUEST) {
  const result = await executeForgeLoopCommand({ command: "record-diagnosis", projectPath: source, input });
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.result;
}

test("the committed event is canonical: hash matches its own content and chain", async () => {
  const { source, db } = await createCanonicalStoreFixture();
  try {
    const result = await diagnoseCanonical(source);
    const events = listEvents(db, TASK_ID);
    const appended = events.at(-2);
    const witness = events.at(-1);
    assert.equal(appended.event, "DIAGNOSIS_RECORDED");
    assert.deepEqual(appended, result.event);
    assert.equal(appended.hash, eventHash(appended));
    assert.equal(appended.previousHash, events.at(-3).hash);
    assert.equal(witness.event, "TRANSACTION_COMMITTED");
    assert.equal(witness.previousHash, appended.hash);
    assert.equal(witness.hash, eventHash(witness));
    assert.deepEqual(readLedgerHead(db, TASK_ID), { seq: witness.seq, hash: witness.hash });
  } finally {
    db.close();
    await cleanup(source);
  }
});

test("state revision and event are committed together", async () => {
  const { source, db } = await createCanonicalStoreFixture();
  try {
    const before = findTaskById(db, TASK_ID).state.revision;
    const beforeEvents = countEvents(db, TASK_ID);
    const result = await diagnoseCanonical(source);
    const after = findTaskById(db, TASK_ID);
    assert.equal(after.state.revision, before + 1);
    assert.equal(countEvents(db, TASK_ID), beforeEvents + 2);
    assert.deepEqual(after.state, result.state);
    assert.equal(listEvents(db, TASK_ID).at(-2).hash, result.event.hash);
  } finally {
    db.close();
    await cleanup(source);
  }
});

/* --------------------------------------------------------- rejection parity */

test("rejects a non-DIAGNOSING phase with the same error code and no write", async () => {
  const { target: source, state: seed } = await buildCanonicalDiagnosisProject({ taskId: TASK_ID });
  const fsTarget = await mkdtemp(path.join(os.tmpdir(), "forgeloop-diagnosis-phase-control-"));
  await cp(source, fsTarget, { recursive: true });
  let db;
  try {
    // Owned fixtures return to a schema-valid source phase; no live project
    // lifecycle state is patched by this rejection test.
    const state = { ...seed, phase: "VERIFYING", previousPhase: "EXECUTING" };
    await writeWorkState(fsTarget, state, { packageRoot, taskId: TASK_ID });
    db = openStorageDatabase(path.join(source, ".forgeloop/state.sqlite"));
    db.prepare("UPDATE tasks SET phase = ?, state_json = ? WHERE task_id = ?").run("VERIFYING", JSON.stringify(state), TASK_ID);
    const before = { state: findTaskById(db, TASK_ID).state, events: listEvents(db, TASK_ID) };
    const { readWorkState } = await import("../src/core/work-state.js");
    const { readEvents } = await import("../src/core/events.js");
    const snapshotControl = async () => ({ state: await readWorkState(fsTarget, { packageRoot, taskId: TASK_ID }), events: await readEvents(fsTarget, packageRoot, { taskId: TASK_ID }) });
    const controlBefore = await snapshotControl();
    await assert.rejects(runRecordDiagnosis({ target: fsTarget, packageRoot, ...REQUEST }), { code: "E_PHASE_PREREQUISITE_MISSING" });
    const result = await executeForgeLoopCommand({ command: "record-diagnosis", projectPath: source, input: REQUEST });
    assert.equal(result.ok, false, JSON.stringify(result));
    assert.equal(result.error.code, "E_PHASE_PREREQUISITE_MISSING");
    assert.deepEqual({ state: findTaskById(db, TASK_ID).state, events: listEvents(db, TASK_ID) }, before);
    assert.deepEqual(await snapshotControl(), controlBefore);
  } finally {
    db?.close();
    await cleanup(fsTarget, source);
  }
});

test("rejects evidence that does not match a current-cycle check", async () => {
  const { target: source } = await buildCanonicalDiagnosisProject({ taskId: TASK_ID });
  const fsTarget = await mkdtemp(path.join(os.tmpdir(), "forgeloop-diagnosis-rejection-control-"));
  await cp(source, fsTarget, { recursive: true });
  let db;
  try {
    db = openStorageDatabase(path.join(source, ".forgeloop/state.sqlite"), { readOnly: true });
    const before = { state: findTaskById(db, TASK_ID).state, events: listEvents(db, TASK_ID) };
    const { readWorkState } = await import("../src/core/work-state.js");
    const { readEvents } = await import("../src/core/events.js");
    const snapshotControl = async () => ({ state: await readWorkState(fsTarget, { packageRoot, taskId: TASK_ID }), events: await readEvents(fsTarget, packageRoot, { taskId: TASK_ID }) });
    const controlBefore = await snapshotControl();
    const badRequest = { ...REQUEST, evidenceRefs: ["check-does-not-exist"] };
    await assert.rejects(runRecordDiagnosis({ target: fsTarget, packageRoot, ...badRequest }), { code: "E_DIAGNOSIS_EVIDENCE_INVALID" });
    const result = await executeForgeLoopCommand({ command: "record-diagnosis", projectPath: source, input: badRequest });
    assert.equal(result.ok, false, JSON.stringify(result));
    assert.equal(result.error.code, "E_DIAGNOSIS_EVIDENCE_INVALID");
    assert.deepEqual({ state: findTaskById(db, TASK_ID).state, events: listEvents(db, TASK_ID) }, before);
    assert.deepEqual(await snapshotControl(), controlBefore);
  } finally {
    db?.close();
    await cleanup(fsTarget, source);
  }
});

test("rejects evidence that references only passing checks", async () => {
  const { source, db } = await createCanonicalStoreFixture({ includePassingCheck: true });
  try {
    const state = findTaskById(db, TASK_ID).state;
    assert.equal(state.checks.find(check => check.id === "check-auth-syntax").status, "passed");
    assert.equal(state.checks.find(check => check.id === "check-auth-boundary").status, "failed");
    const before = rawDiagnosisSnapshot(db);
    const result = await executeForgeLoopCommand({ command: "record-diagnosis", projectPath: source, input: { ...REQUEST, evidenceRefs: ["check-auth-syntax"] } });
    assert.equal(result.ok, false, JSON.stringify(result));
    assert.equal(result.error.code, "E_DIAGNOSIS_EVIDENCE_INVALID");
    assert.deepEqual(rawDiagnosisSnapshot(db), before);
  } finally {
    db.close();
    await cleanup(source);
  }
});

function rawDiagnosisSnapshot(db) {
  return {
    task: db.prepare("SELECT * FROM tasks WHERE task_id = ?").get(TASK_ID),
    events: db.prepare("SELECT * FROM events WHERE task_id = ? ORDER BY seq").all(TASK_ID),
    claims: db.prepare("SELECT * FROM claims WHERE task_id = ? ORDER BY claim_norm").all(TASK_ID),
    artifacts: db.prepare("SELECT * FROM task_artifacts WHERE task_id = ? ORDER BY kind, artifact_id").all(TASK_ID),
  };
}

test("rejects an invalid verification cycle", async () => {
  const { source, db } = await createCanonicalStoreFixture({ readOnly: false });
  try {
    await diagnoseCanonical(source);
    const state = { ...findTaskById(db, TASK_ID).state, verificationCycle: 0 };
    db.prepare("UPDATE tasks SET state_json = ? WHERE task_id = ?").run(JSON.stringify(state), TASK_ID);
    const before = rawDiagnosisSnapshot(db);
    const result = await executeForgeLoopCommand({ command: "record-diagnosis", projectPath: source, input: REQUEST });
    assert.equal(result.ok, false, JSON.stringify(result));
    assert.equal(result.error.code, "E_TASK_CLAIM_OWNERSHIP_INCONSISTENT", JSON.stringify(result));
    assert.deepEqual(rawDiagnosisSnapshot(db), before);
  } finally {
    db.close();
    await cleanup(source);
  }
});

test("a tampered ledger fails closed without promoting ownership", async () => {
  const { source, db } = await createCanonicalStoreFixture({ readOnly: false });
  try {
    await diagnoseCanonical(source);
    const event = listEvents(db, TASK_ID).at(-1);
    db.prepare("UPDATE events SET event_json = ? WHERE task_id = ? AND seq = ?")
      .run(JSON.stringify({ ...event, hash: "0".repeat(64) }), TASK_ID, event.seq);
    const before = rawDiagnosisSnapshot(db);
    const result = await executeForgeLoopCommand({ command: "record-diagnosis", projectPath: source, input: REQUEST });
    assert.equal(result.ok, false, JSON.stringify(result));
    assert.equal(result.error.code, "E_TASK_CLAIM_OWNERSHIP_INCONSISTENT", JSON.stringify(result));
    assert.deepEqual(rawDiagnosisSnapshot(db), before, "claims, artifacts, state and ledger stay unchanged");
  } finally {
    db.close();
    await cleanup(source);
  }
});

test("the idempotent path adds only a commit witness without duplicate diagnosis", async () => {
  const { source, db } = await createCanonicalStoreFixture();
  try {
    const first = await diagnoseCanonical(source);
    const eventsAfterFirst = countEvents(db, TASK_ID);
    const second = await diagnoseCanonical(source);
    assert.equal(second.idempotent, true);
    assert.equal(first.idempotent, false);
    assert.equal(countEvents(db, TASK_ID), eventsAfterFirst + 1);
    assert.equal(listEvents(db, TASK_ID).filter(event => event.event === "DIAGNOSIS_RECORDED").length, 1);
    assert.equal(second.event.hash, first.event.hash);
    assert.equal(findTaskById(db, TASK_ID).state.revision, first.state.revision + 1);
    assert.equal(listEvents(db, TASK_ID).at(-1).event, "TRANSACTION_COMMITTED");
  } finally {
    db.close();
    await cleanup(source);
  }
});

/** Reduce either implementation's result to comparable public facts. */
function summarize(result) {
  return {
    idempotent: result.idempotent,
    event: result.event,
    eventType: result.event.event,
    eventSeq: result.event.seq,
    previousHash: result.event.previousHash,
    hash: result.event.hash,
    details: result.diagnosis,
    revision: result.state.revision,
    diagnosedHypothesis: result.state.diagnosedHypothesis,
  };
}

/* -------------------------------------------- failure, concurrency, durability */

test("a failure after the state update leaves the original snapshot on reopen", async () => {
  const { source, db } = await createStoreFixture();
  const databasePath = path.join(source, "state.sqlite");
  const before = findTaskById(db, TASK_ID);
  const beforeEvents = countEvents(db, TASK_ID);
  db.close();

  // Simulate a crash between the conditional state update and the event insert
  // by driving the two steps in one transaction that never commits.
  const reopened = openStorageDatabase(databasePath);
  try {
    assert.throws(() => {
      runInTransaction(reopened, () => {
        reopened.prepare("UPDATE tasks SET revision = 99, phase = 'CORRUPTED' WHERE task_id = ?").run(TASK_ID);
        throw new Error("simulated crash before event insert");
      });
    }, /simulated crash before event insert/);
  } finally {
    reopened.close();
  }

  const after = openStorageDatabase(databasePath);
  try {
    const task = findTaskById(after, TASK_ID);
    assert.equal(task.state.revision, before.state.revision, "revision must be unchanged");
    assert.equal(task.phase, before.phase, "phase must be unchanged");
    assert.equal(countEvents(after, TASK_ID), beforeEvents, "no event may be persisted");
  } finally {
    after.close();
    await cleanup(source);
  }
});

test("a failure after the event insert but before commit persists neither", async () => {
  const { source, db } = await createStoreFixture();
  const databasePath = path.join(source, "state.sqlite");
  const beforeEvents = countEvents(db, TASK_ID);
  db.close();

  const reopened = openStorageDatabase(databasePath);
  try {
    assert.throws(() => {
      runInTransaction(reopened, () => {
        const head = reopened.prepare("SELECT seq, hash FROM events WHERE task_id = ? ORDER BY seq DESC LIMIT 1").get(TASK_ID);
        appendEvent(reopened, {
          taskId: TASK_ID,
          event: {
            seq: head.seq + 1,
            event: "DIAGNOSIS_RECORDED",
            taskId: TASK_ID,
            at: FIXED_AT,
            previousHash: head.hash,
            hash: "0".repeat(64),
          },
        });
        reopened.prepare("UPDATE tasks SET revision = revision + 1 WHERE task_id = ?").run(TASK_ID);
        throw new Error("simulated crash before commit");
      });
    }, /simulated crash before commit/);
  } finally {
    reopened.close();
  }

  const after = openStorageDatabase(databasePath);
  try {
    assert.equal(countEvents(after, TASK_ID), beforeEvents, "event must not survive");
    assert.equal(findTaskById(after, TASK_ID).state.revision, 0, "revision must not survive");
  } finally {
    after.close();
    await cleanup(source);
  }
});

test("two sequential mutations each apply exactly once with no lost update", async () => {
  const { source, db } = await createCanonicalStoreFixture();
  try {
    const first = await diagnoseCanonical(source);
    const afterFirst = findTaskById(db, TASK_ID);
    const eventsAfterFirst = countEvents(db, TASK_ID);
    const firstWitness = listEvents(db, TASK_ID).at(-1);
    const second = await diagnoseCanonical(source, { ...REQUEST, hypothesis: "A materially different hypothesis about the failure" });
    const afterSecond = findTaskById(db, TASK_ID);
    assert.equal(second.idempotent, false);
    assert.equal(afterSecond.state.revision, afterFirst.state.revision + 1);
    assert.equal(countEvents(db, TASK_ID), eventsAfterFirst + 2);
    assert.equal(second.event.seq, first.event.seq + 2);
    assert.equal(second.event.previousHash, firstWitness.hash);
    assert.equal(listEvents(db, TASK_ID).at(-1).previousHash, second.event.hash);
  } finally {
    db.close();
    await cleanup(source);
  }
});

test("a conditional update against a stale expected revision affects no row", async () => {
  const { source, db } = await createStoreFixture();
  try {
    const { mutateTaskState } = await import("../src/storage/repository.js");
    const { createWorkState } = await import("../src/core/work-state.js");
    const current = findTaskById(db, TASK_ID).state;
    // DIAGNOSING -> VERIFYING is a valid transition and does not require the
    // diagnosed-hypothesis invariant that CORRECTING enforces.
    const next = createWorkState({
      ...current,
      phase: "VERIFYING",
      revision: current.revision + 1,
      diagnosedHypothesis: "A recorded hypothesis",
    });

    // Correct revision succeeds.
    const applied = runInTransaction(db, () => mutateTaskState(db, {
      taskId: TASK_ID,
      expectedRevision: current.revision,
      state: next,
    }));
    assert.equal(applied, true);

    // Replaying the same expected revision is rejected and writes nothing.
    const replayed = runInTransaction(db, () => mutateTaskState(db, {
      taskId: TASK_ID,
      expectedRevision: current.revision,
      state: { ...next, phase: "VERIFYING", revision: current.revision + 2 },
    }));
    assert.equal(replayed, false, "stale revision must not update");
    assert.equal(findTaskById(db, TASK_ID).phase, "VERIFYING");
    assert.equal(findTaskById(db, TASK_ID).state.revision, current.revision + 1);

  } finally {
    db.close();
    await cleanup(source);
  }
});

test("a nested failure poisons the outer transaction even when the error is caught", async () => {
  const { source, db } = await createStoreFixture();
  try {
    const beforeEvents = countEvents(db, TASK_ID);
    assert.throws(() => {
      runInTransaction(db, () => {
        appendEvent(db, {
          taskId: TASK_ID,
          event: {
            seq: 7,
            event: "DIAGNOSIS_RECORDED",
            taskId: TASK_ID,
            at: FIXED_AT,
            previousHash: "0".repeat(64),
            hash: "0".repeat(64),
          },
        });
        try {
          runInTransaction(db, () => { throw new Error("nested failure"); });
        } catch {
          // The outer callback swallows the nested error. The transaction is
          // still rollback-only, so it must refuse to commit.
        }
      });
    }, /rollback-only/);
    assert.equal(countEvents(db, TASK_ID), beforeEvents, "partial nested work must not commit");
  } finally {
    db.close();
    await cleanup(source);
  }
});

test("a write from a late async continuation is rejected", async () => {
  const { source, db } = await createStoreFixture();
  try {
    const beforeEvents = countEvents(db, TASK_ID);
    let scheduled = null;
    assert.throws(() => {
      runInTransaction(db, () => {
        // A continuation scheduled here outlives the transaction.
        scheduled = Promise.resolve().then(() => {
          appendEvent(db, {
            taskId: TASK_ID,
            event: {
              seq: 7,
              event: "DIAGNOSIS_RECORDED",
              taskId: TASK_ID,
              at: FIXED_AT,
              previousHash: "0".repeat(64),
              hash: "0".repeat(64),
            },
          });
        });
        return scheduled;
      });
    }, (error) => error.code === "E_STORAGE_ASYNC_TRANSACTION");

    const outcome = await scheduled.then(() => "persisted", (error) => error.code ?? "rejected");
    assert.equal(outcome, "E_STORAGE_TRANSACTION_EXPIRED", "late write must be rejected");
    assert.equal(countEvents(db, TASK_ID), beforeEvents, "expired-context write must not persist");
  } finally {
    db.close();
    await cleanup(source);
  }
});

test("an async callback is rejected before it is invoked", async () => {
  const { source, db } = await createStoreFixture();
  try {
    let invoked = false;
    assert.throws(
      () => runInTransaction(db, async () => { invoked = true; }),
      (error) => error.code === "E_STORAGE_ASYNC_TRANSACTION",
    );
    assert.equal(invoked, false, "the callback must not run at all");
  } finally {
    db.close();
    await cleanup(source);
  }
});

test("a transaction refuses to join a transaction bound to another project", async () => {
  const { source, db } = await createStoreFixture();
  try {
    assert.throws(() => {
      runInTransaction(db, () => {
        runInTransaction(db, () => {}, { project: "some-other-project" });
      }, { project: TASK_ID });
    }, /different project/);
  } finally {
    db.close();
    await cleanup(source);
  }
});

test("state and event identity survive an export and re-import round trip", async () => {
  const { exportDatabase } = await import("../src/storage/index.js");
  const { source, db } = await createCanonicalStoreFixture();
  try {
    const result = await diagnoseCanonical(source);
    const bundle = path.join(source, "bundle");
    await exportDatabase(db, bundle, { attachmentRoot: source });
    const stateFingerprint = canonicalFingerprint(findTaskById(db, TASK_ID).state);
    const eventsBefore = listEvents(db, TASK_ID);
    const { db: reimported } = await importProjectState(bundle, path.join(source, "round2.sqlite"));
    try {
      assert.equal(canonicalFingerprint(findTaskById(reimported, TASK_ID).state), stateFingerprint);
      assert.deepEqual(listEvents(reimported, TASK_ID), eventsBefore);
      assert.equal(listEvents(reimported, TASK_ID).at(-2).hash, result.event.hash);
      assert.equal(listEvents(reimported, TASK_ID).at(-1).event, "TRANSACTION_COMMITTED");
    } finally { reimported.close(); }
  } finally {
    db.close();
    await cleanup(source);
  }
});
