/** Native SQL witnesses and transaction aborts through public diagnosis dispatch. */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { executeForgeLoopCommand } from "../../src/core/command-runtime.js";
import { openStorageDatabase, listEvents } from "../../src/storage/index.js";
import { cleanupDir, logicalSnapshot, TEST_TASK_ID } from "./storage-fixtures.js";
import { buildCanonicalDiagnosisProject } from "./canonical-diagnosis-fixture.js";

const [outPath, mode] = process.argv.slice(2);
const { target } = await buildCanonicalDiagnosisProject({ taskId: TEST_TASK_ID });
let db;
try {
  const databasePath = path.join(target, ".forgeloop/state.sqlite");
  db = openStorageDatabase(databasePath);
  const before = logicalSnapshot(db, TEST_TASK_ID);
  db.exec(`CREATE TABLE mutation_witness (id INTEGER PRIMARY KEY, step TEXT NOT NULL);
    CREATE TRIGGER state_witness AFTER UPDATE OF state_json ON tasks BEGIN
      INSERT INTO mutation_witness(step) VALUES ('state-written'); END;
    CREATE TRIGGER event_witness AFTER INSERT ON events BEGIN
      INSERT INTO mutation_witness(step) VALUES (NEW.event_type); END;`);
  const injected = mode.startsWith("inject-");
  if (injected) {
    const boundary = mode === "inject-after-state-write"
      ? "AFTER UPDATE OF state_json ON tasks"
      : "AFTER INSERT ON events WHEN NEW.event_type = 'DIAGNOSIS_RECORDED'";
    db.exec(`CREATE TRIGGER native_fault ${boundary} BEGIN SELECT RAISE(ABORT, 'NATIVE_DIAGNOSIS_FAULT'); END`);
  }
  const dispatch = () => executeForgeLoopCommand({ command: "record-diagnosis", projectPath: target, input: {
    taskId: TEST_TASK_ID, hypothesis: "Transaction context probe", failureClass: "VERIFICATION_FAILURE",
    evidenceRefs: ["check-auth-boundary"], settledBy: "pending-evidence", nextSafeAction: "Add the missing boundary case",
  } });
  const envelope = await dispatch();
  const inProcess = logicalSnapshot(db, TEST_TASK_ID);
  db.close();
  db = openStorageDatabase(databasePath);
  const reopened = logicalSnapshot(db, TEST_TASK_ID);
  const steps = db.prepare("SELECT step FROM mutation_witness ORDER BY id").all().map(row => row.step);
  const reopenedEventCount = listEvents(db, TEST_TASK_ID).length;
  let retry = null;
  if (injected) {
    db.exec("DROP TRIGGER native_fault");
    retry = await dispatch();
  }
  writeFileSync(outPath, JSON.stringify({ mode, ok: envelope.ok, errorCode: envelope.error?.code ?? null,
    errorMessage: envelope.error?.message ?? null, steps, before, inProcess, reopened, reopenedEventCount,
    retryOk: retry?.ok ?? null, retrySnapshot: injected ? logicalSnapshot(db, TEST_TASK_ID) : null }));
} finally {
  db?.close();
  await cleanupDir(target);
}
