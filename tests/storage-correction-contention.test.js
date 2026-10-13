import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { buildCanonicalDiagnosisProject } from "./helpers/canonical-diagnosis-fixture.js";
import { createBarrier, spawnWorker, cleanupDir, logicalSnapshot } from "./helpers/storage-fixtures.js";
import { openStorageDatabase, checkStorageIntegrity, listEvents } from "../src/storage/index.js";
import { executeForgeLoopCommand } from "../src/core/command-runtime.js";
import { validateLedgerEvents } from "../src/core/events.js";

test("independent correction writers accept exactly one phase transition", async () => {
  const fixture = await buildCanonicalDiagnosisProject();
  const databasePath = path.join(fixture.target, ".forgeloop/state.sqlite");
  let db;
  const barrier = createBarrier("correction-contention");
  let first, second;
  try {
    const diagnosis = await executeForgeLoopCommand({ command: "record-diagnosis", projectPath: fixture.target, input: { taskId: fixture.taskId, hypothesis: "Deterministic check fails by design", failureClass: "VERIFICATION_FAILURE", evidenceRefs: ["check-auth-boundary"], settledBy: "A passing check", nextSafeAction: "Correct the fixture check" } });
    assert.equal(diagnosis.ok, true);
    db = openStorageDatabase(databasePath, { readOnly: true });
    const before = logicalSnapshot(db, fixture.taskId);
    db.close();
    const config = { mode: "advance", target: fixture.target, databasePath, taskId: fixture.taskId, barrierDir: barrier.dir };
    first = spawnWorker({ ...config, workerId: "a" });
    second = spawnWorker({ ...config, workerId: "b" });
    await barrier.waitFor("ready-a", undefined, first);
    await barrier.waitFor("ready-b", undefined, second);
    barrier.signal("proceed");
    const results = await Promise.all([first.result(), second.result()]);
    assert.equal(results.filter(entry => entry.result?.ok).length, 1, JSON.stringify(results));
    const loser = results.find(entry => !entry.result?.ok);
    assert.equal(loser.result.code, "E_STATE_REVISION_CONFLICT", JSON.stringify(loser));
    const reopened = openStorageDatabase(databasePath);
    try {
      const after = logicalSnapshot(reopened, fixture.taskId);
      assert.equal(after.phase, "CORRECTING");
      assert.equal(after.revision, before.revision + 1);
      assert.equal(after.eventCount, before.eventCount + 1);
      assert.equal(checkStorageIntegrity(reopened).ok, true);
      assert.equal(validateLedgerEvents(listEvents(reopened, fixture.taskId)).valid, true);
    } finally { reopened.close(); }
  } finally {
    try { db?.close(); } catch { /* already closed before child writers */ }
    await first?.kill();
    await second?.kill();
    barrier.cleanup();
    await cleanupDir(fixture.target);
  }
});
