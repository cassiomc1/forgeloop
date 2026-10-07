import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { buildCanonicalDiagnosisProject } from "./helpers/canonical-diagnosis-fixture.js";
import { recordDiagnosis } from "../src/core/diagnosis.js";
import { recordHypothesisDisposition } from "../src/core/diagnostic-record.js";
import { buildProtocolEvent, readEvents, validateEventLedger } from "../src/core/events.js";
import { projectHypothesisStates, getHypothesisState } from "../src/core/hypothesis-projection.js";
import { openStorageDatabase, runInTransaction, appendEvent } from "../src/storage/index.js";

function records(db, taskId) {
  return {
    task: db.prepare("SELECT * FROM tasks WHERE task_id = ?").get(taskId),
    artifacts: db.prepare("SELECT * FROM task_artifacts WHERE task_id = ? ORDER BY kind, artifact_id").all(taskId),
    events: db.prepare("SELECT * FROM events WHERE task_id = ? ORDER BY seq").all(taskId),
  };
}

test("direct disposition preserves an independent terminal event committed after status validation", async () => {
  const fixture = await buildCanonicalDiagnosisProject();
  const { target, packageRoot, taskId } = fixture;
  let db;
  try {
    await recordDiagnosis({ target, packageRoot, taskId,
      hypothesis: "Fixture failure is deliberate", failureClass: "VERIFICATION_FAILURE",
      evidenceRefs: ["check-auth-boundary"], settledBy: "Corrected fixture passes",
      nextSafeAction: "Correct fixture exit status" });
    const input = { target, packageRoot, taskId, hypothesisRef: "h-legacy",
      status: "WEAKENED", reason: "Ordinary disposition succeeds", evidenceRefs: ["check-auth-boundary"] };
    assert.equal((await recordHypothesisDisposition(input)).disposition.status, "WEAKENED");
    db = openStorageDatabase(path.join(target, ".forgeloop/state.sqlite"));
    let independent = null;
    const evidenceRefs = ["check-auth-boundary"];
    // A deterministic barrier during evidence validation simulates a second
    // connection committing after the original status projection was checked.
    evidenceRefs[Symbol.iterator] = function* () {
      if (!independent) {
        const last = db.prepare("SELECT seq, hash FROM events WHERE task_id = ? ORDER BY seq DESC LIMIT 1").get(taskId);
        const event = buildProtocolEvent({ taskId, event: "HYPOTHESIS_DISPOSITION_RECORDED",
          details: { schemaVersion: 1, verificationCycle: 1, hypothesisRef: "h-legacy",
            status: "FALSIFIED", evidenceRefs: ["check-auth-boundary"], reason: "Independent observation falsifies the hypothesis" } },
        { checkpoint: { seq: last.seq, lastHash: last.hash } });
        runInTransaction(db, () => appendEvent(db, { taskId, event }));
        independent = records(db, taskId);
      }
      yield "check-auth-boundary";
    };
    await assert.rejects(recordHypothesisDisposition({ ...input, status: "SUPPORTED", evidenceRefs }), { code: "E_STATE_REVISION_CONFLICT" });
    assert.ok(independent, "Independent terminal publication must occur before the stale write is rejected");
    assert.deepEqual(records(db, taskId), independent);
    assert.equal((await validateEventLedger(target, packageRoot, { taskId })).valid, true);
    const projection = projectHypothesisStates(await readEvents(target, packageRoot, { taskId }), { taskId });
    assert.equal(projection.invalidTransitions.length, 0);
    assert.equal(getHypothesisState(projection, "h-legacy").currentStatus, "FALSIFIED");
    await assert.rejects(recordHypothesisDisposition({ ...input, status: "SUPPORTED" }), { code: "E_HYPOTHESIS_DISPOSITION_INVALID" });
    assert.deepEqual(records(db, taskId), independent);
  } finally { db?.close(); await fixture.cleanup(); }
});
