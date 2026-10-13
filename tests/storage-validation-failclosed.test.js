import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { executeForgeLoopCommand } from "../src/core/command-runtime.js";
import { openStorageDatabase, listEvents } from "../src/storage/index.js";
import { validateLedgerEvents } from "../src/core/events.js";
import { TEST_TASK_ID, addSemanticDecision, cleanupDir, logicalSnapshot } from "./helpers/storage-fixtures.js";
import { buildCanonicalDiagnosisProject } from "./helpers/canonical-diagnosis-fixture.js";

const REQUEST = { taskId: TEST_TASK_ID, hypothesis: "Comparison operator <= instead of <", failureClass: "VERIFICATION_FAILURE",
  evidenceRefs: ["check-auth-boundary"], settledBy: "pending-evidence", nextSafeAction: "Add the missing boundary case" };
const diagnose = target => executeForgeLoopCommand({ command: "record-diagnosis", projectPath: target, input: REQUEST });

async function withDecisionProject({ extraDecision = true } = {}, run) {
  const { target } = await buildCanonicalDiagnosisProject({ taskId: TEST_TASK_ID });
  let db;
  try {
    if (extraDecision) await addSemanticDecision(target, { taskId: TEST_TASK_ID });
    // The canonical lifecycle fixture now creates SQLite directly. Legacy
    // conversion remains covered by the dedicated migration suites.
    const databasePath = path.join(target, ".forgeloop/state.sqlite");
    db = openStorageDatabase(databasePath);
    return await run({ target, db, databasePath });
  } finally {
    db?.close();
    await cleanupDir(target);
  }
}

for (const extraDecision of [false, true]) {
  test(`valid canonical decision evidence permits diagnosis (extra decision: ${extraDecision})`, async () => {
    await withDecisionProject({ extraDecision }, async ({ target, db }) => {
      const before = logicalSnapshot(db, TEST_TASK_ID);
      const result = await diagnose(target);
      assert.equal(result.ok, true, JSON.stringify(result));
      const after = logicalSnapshot(db, TEST_TASK_ID);
      assert.equal(after.revision, before.revision + 1);
      assert.equal(after.eventCount, before.eventCount + 2);
    });
  });
}

function removeDecision(db) {
  db.prepare("DELETE FROM task_artifacts WHERE task_id = ? AND kind = 'decision' AND artifact_id = 'decision-1'").run(TEST_TASK_ID);
}
async function rejectsUnchanged(target, db) {
  const before = logicalSnapshot(db, TEST_TASK_ID);
  const result = await diagnose(target);
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(typeof result.error.code, "string");
  assert.deepEqual(logicalSnapshot(db, TEST_TASK_ID), before);
  return before;
}

test("unavailable decision evidence rejects public diagnosis without mutation", async () => {
  await withDecisionProject({}, async ({ target, db }) => {
    removeDecision(db);
    await rejectsUnchanged(target, db);
  });
});

for (const corruption of ["tampered", "missing", "malformed"]) {
  test(`${corruption} mandatory decision artifact fails closed`, async () => {
    await withDecisionProject({}, async ({ target, db }) => {
      if (corruption === "missing") removeDecision(db);
      else {
        const row = db.prepare("SELECT payload_json FROM task_artifacts WHERE task_id = ? AND kind = 'decision' AND artifact_id = 'decision-1'").get(TEST_TASK_ID);
        const payload = corruption === "malformed" ? "{ not json" : JSON.stringify({ ...JSON.parse(row.payload_json), stateFingerprint: "3".repeat(64) });
        db.prepare("UPDATE task_artifacts SET payload_json = ? WHERE task_id = ? AND kind = 'decision' AND artifact_id = 'decision-1'").run(payload, TEST_TASK_ID);
      }
      await rejectsUnchanged(target, db);
    });
  });
}

test("valid ledger cannot authorize diagnosis with unavailable required decision evidence", async () => {
  await withDecisionProject({}, async ({ target, db }) => {
    removeDecision(db);
    assert.equal(validateLedgerEvents(listEvents(db, TEST_TASK_ID)).valid, true);
    await rejectsUnchanged(target, db);
  });
});

test("reopened connection retains the snapshot after unavailable validation rejection", async () => {
  await withDecisionProject({}, async ({ target, db, databasePath }) => {
    removeDecision(db);
    const before = await rejectsUnchanged(target, db);
    const reopened = openStorageDatabase(databasePath, { readOnly: true });
    try { assert.deepEqual(logicalSnapshot(reopened, TEST_TASK_ID), before); }
    finally { reopened.close(); }
  });
});
