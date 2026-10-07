/**
 * Phase 2C: diagnosis -> DIAGNOSING->CORRECTING continuity through canonical
 * dispatch against one continuous SQLite database.
 *
 * Both commands run through `executeForgeLoopCommand` with canonical project storage. No export, re-import, direct state patch, or
 * fixture rebuild happens between the two operations.
 */
import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";

import { executeForgeLoopCommand } from "../src/core/command-runtime.js";
import { validateLedgerEvents } from "../src/core/events.js";
import {
  listEvents,
  openStorageDatabase,
  checkStorageIntegrity,
} from "../src/storage/index.js";
import {
  TEST_TASK_ID,
  buildDiagnosisProject,
  cleanupDir,
  logicalSnapshot,
} from "./helpers/storage-fixtures.js";

import { buildCanonicalDiagnosisProject } from "./helpers/canonical-diagnosis-fixture.js";

const DIAGNOSIS_INPUT = Object.freeze({
  hypothesis: "Boundary case uses <= where < is required",
  failureClass: "VERIFICATION_FAILURE",
  evidenceRefs: ["check-auth-boundary"],
  settledBy: "pending-evidence",
  nextSafeAction: "Add the missing boundary case",
});

async function buildStore() {
  const { target, state: seedState } = await buildCanonicalDiagnosisProject({ taskId: TEST_TASK_ID });
  const databasePath = path.join(target, ".forgeloop/state.sqlite");
  const db = openStorageDatabase(databasePath, { readOnly: true });
  return { target, databasePath, db, seedRevision: seedState.revision };
}

const dispatch = (target, command, input) =>
  executeForgeLoopCommand({ command, projectPath: target, input });

test("C1: diagnosis then DIAGNOSING->CORRECTING advance in one continuous database", async () => {
  const { target, db, seedRevision } = await buildStore();
  try {
    const diagnosis = await dispatch(target, "record-diagnosis", {
      ...DIAGNOSIS_INPUT, taskId: TEST_TASK_ID,
    });
    assert.equal(diagnosis.ok, true, JSON.stringify(diagnosis.error));
    assert.equal(diagnosis.result.state.phase, "DIAGNOSING", "phase is unchanged by diagnosis");
    assert.equal(diagnosis.result.state.revision, seedRevision + 1);
    assert.equal(diagnosis.result.diagnosis.informationGain, "FIRST_DIAGNOSIS");

    // The advance consumes the committed diagnosis: its prerequisite is the
    // append-only record the first operation just wrote.
    const advance = await dispatch(target, "advance", {
      to: "CORRECTING", taskId: TEST_TASK_ID,
    });
    assert.equal(advance.ok, true, JSON.stringify(advance.error));
    assert.equal(advance.result.phase, "CORRECTING");
    assert.equal(advance.result.previousPhase, "DIAGNOSING");
    assert.equal(advance.result.revision, seedRevision + 2, "revision advanced exactly once more");

    const state = db.prepare("SELECT phase, revision FROM tasks WHERE task_id = ?").get(TEST_TASK_ID);
    assert.equal(state.phase, "CORRECTING");
    assert.equal(state.revision, seedRevision + 2);
    assert.equal(validateLedgerEvents(listEvents(db, TEST_TASK_ID)).valid, true, "ledger stays valid");
    assert.equal(checkStorageIntegrity(db).ok, true);
  } finally {
    db.close();
    await cleanupDir(target);
  }
});

test("C2: continuity survives reopening the connection between commands", async () => {
  const { target, databasePath, db, seedRevision } = await buildStore();
  try {
    assert.equal((await dispatch(target, "record-diagnosis", {
      ...DIAGNOSIS_INPUT, taskId: TEST_TASK_ID,
    })).ok, true);
    db.close();

    // A fresh inspection connection and another public dispatch: continuity must not depend on
    // an in-memory object retained by the first call.
    const reopened = openStorageDatabase(databasePath, { readOnly: true });
    try {
      const advance = await dispatch(target, "advance", { to: "CORRECTING", taskId: TEST_TASK_ID });
      assert.equal(advance.ok, true, JSON.stringify(advance.error));
      assert.equal(advance.result.phase, "CORRECTING");
      assert.equal(reopened.prepare("SELECT revision FROM tasks WHERE task_id = ?").get(TEST_TASK_ID).revision, seedRevision + 2);
    } finally {
      reopened.close();
    }
  } finally {
    await cleanupDir(target);
  }
});

test("C3: the advance rejects a wrong source phase without mutating", async () => {
  const { target, db } = await buildStore();
  try {
    const before = logicalSnapshot(db, TEST_TASK_ID);
    // The task is still DIAGNOSING, so requesting VERIFYING is an unsupported
    // edge in this context and must not be attempted.
    const advance = await dispatch(target, "advance", { to: "VERIFYING", taskId: TEST_TASK_ID });
    assert.equal(advance.ok, false);
    assert.equal(advance.error.code, "E_PHASE_TRANSITION_INVALID");
    assert.deepEqual(logicalSnapshot(db, TEST_TASK_ID), before, "no mutation and no fallback");
  } finally {
    db.close();
    await cleanupDir(target);
  }
});

test("C4: the advance without a recorded diagnosis rejects with the shared rule code", async () => {
  const { target, db } = await buildStore();
  try {
    const before = logicalSnapshot(db, TEST_TASK_ID);
    // No diagnosis has been recorded, so the shared prerequisite must reject.
    const advance = await dispatch(target, "advance", { to: "CORRECTING", taskId: TEST_TASK_ID });
    assert.equal(advance.ok, false);
    assert.equal(advance.error.code, "E_DIAGNOSIS_REQUIRED");
    assert.deepEqual(logicalSnapshot(db, TEST_TASK_ID), before, "the committed diagnosis baseline is untouched");
  } finally {
    db.close();
    await cleanupDir(target);
  }
});

test("C5: a successful advance adds one event after the committed diagnosis", async () => {
  const { target, db } = await buildStore();
  try {
    await dispatch(target, "record-diagnosis", { ...DIAGNOSIS_INPUT, taskId: TEST_TASK_ID });
    const postDiagnosis = logicalSnapshot(db, TEST_TASK_ID);
    const advance = await dispatch(target, "advance", { to: "CORRECTING", taskId: TEST_TASK_ID });
    assert.equal(advance.ok, true);
    const after = logicalSnapshot(db, TEST_TASK_ID);
    assert.equal(after.eventCount, postDiagnosis.eventCount + 1, "canonical advance commit witness");
    assert.equal(validateLedgerEvents(listEvents(db, TEST_TASK_ID)).valid, true);
  } finally {
    db.close();
    await cleanupDir(target);
  }
});

test("C6: default context refuses unconverted legacy mutation without allocating SQLite", async () => {
  const target = await buildDiagnosisProject({ unrelated: 0, legacy: true });
  try {
    const { readWorkState } = await import("../src/core/work-state.js");
    const { readEvents, readPortableEvents } = await import("../src/core/events.js");
    const { getPackageRoot } = await import("../src/core/templates.js");
    const packageRoot = getPackageRoot();
    const snapshot = async () => ({ state: await readWorkState(target, { packageRoot, taskId: TEST_TASK_ID }), events: await readPortableEvents(target, packageRoot, { taskId: TEST_TASK_ID }) });
    await assert.rejects(readEvents(target, packageRoot, { taskId: TEST_TASK_ID }), { code: "E_STORAGE_MIGRATION_REQUIRED" });
    const { inventoryLegacySource } = await import("../src/storage/migration-source.js");
    const sourceBefore = await inventoryLegacySource(target);
    const before = await snapshot();
    const diagnosis = await dispatch(target, "record-diagnosis", {
      ...DIAGNOSIS_INPUT, taskId: TEST_TASK_ID,
    });
    assert.equal(diagnosis.ok, false, JSON.stringify(diagnosis));
    assert.equal(diagnosis.error.code, "E_STORAGE_MIGRATION_REQUIRED");
    assert.deepEqual(await snapshot(), before);
    assert.deepEqual(await inventoryLegacySource(target), sourceBefore);
    const { existsSync } = await import("node:fs");
    assert.equal(existsSync(path.join(target, ".forgeloop", "state.sqlite")), false);
  } finally {
    await cleanupDir(target);
  }
});
