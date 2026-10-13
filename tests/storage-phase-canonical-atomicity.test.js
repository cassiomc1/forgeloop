import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { buildCanonicalDiagnosisProject } from "./helpers/canonical-diagnosis-fixture.js";
import { recordDiagnosis } from "../src/core/diagnosis.js";
import { advanceWorkState } from "../src/core/phase.js";
import { taskArtifactPath } from "../src/core/task-paths.js";
import { openStorageDatabase } from "../src/storage/index.js";

function records(db, taskId) {
  return {
    task: db.prepare("SELECT * FROM tasks WHERE task_id = ?").get(taskId),
    artifacts: db.prepare("SELECT * FROM task_artifacts WHERE task_id = ? ORDER BY kind, artifact_id").all(taskId),
    events: db.prepare("SELECT * FROM events WHERE task_id = ? ORDER BY seq").all(taskId),
  };
}

for (const entry of ["task ID", "canonical paths"]) {
  for (const [phase, point] of [["CORRECTING", "receipt"], ["VERIFYING", "receipt"], ["VERIFYING", "ledger"]]) {
    test(`direct phase ${phase} with ${entry} rolls back after ${point} publication failure`, async () => {
      const fixture = await buildCanonicalDiagnosisProject();
      const { target, packageRoot, taskId } = fixture;
      let db;
      try {
        await recordDiagnosis({ target, packageRoot, taskId,
          hypothesis: "Fixture command deliberately exits with failure", failureClass: "VERIFICATION_FAILURE",
          evidenceRefs: ["check-auth-boundary"], settledBy: "Successful fixture verification",
          nextSafeAction: "Run the corrected fixture verification" });
        if (phase === "VERIFYING") await advanceWorkState(target, "CORRECTING", { taskId, packageRoot });
        const options = { taskId, packageRoot };
        if (entry === "canonical paths") {
          delete options.taskId;
          for (const kind of ["contract", "route", "state", "receipt", "events"]) options[`${kind}Path`] = taskArtifactPath(taskId, kind);
        }
        db = openStorageDatabase(path.join(target, ".forgeloop/state.sqlite"));
        const before = records(db, taskId);
        db.exec(point === "receipt"
          ? "CREATE TRIGGER fail_phase_publication BEFORE UPDATE ON task_artifacts WHEN NEW.kind = 'receipt' BEGIN SELECT RAISE(ABORT, 'injected phase publication failure'); END"
          : "CREATE TRIGGER fail_phase_publication BEFORE INSERT ON events WHEN NEW.event_type = 'VERIFICATION_STARTED' BEGIN SELECT RAISE(ABORT, 'injected phase publication failure'); END");
        await assert.rejects(advanceWorkState(target, phase, options), /injected phase publication failure/);
        assert.deepEqual(records(db, taskId), before);
        db.exec("DROP TRIGGER fail_phase_publication");
        const result = await advanceWorkState(target, phase, options);
        assert.equal(result.phase, phase);
        const after = records(db, taskId);
        assert.equal(JSON.parse(after.task.state_json).phase, phase);
        assert.equal(after.events.at(-1).event_type, "TRANSACTION_COMMITTED");
        if (phase === "VERIFYING") assert.equal(after.events.filter(row => row.event_type === "VERIFICATION_STARTED").length, 2);
      } finally { db?.close(); await fixture.cleanup(); }
    });
  }
}
