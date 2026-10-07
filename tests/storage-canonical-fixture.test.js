import { removeTempTree } from "./helpers/rm-safe.js";
import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdtemp } from "node:fs/promises";
import os from "node:os";
import { buildCanonicalDiagnosisProject } from "./helpers/canonical-diagnosis-fixture.js";
import { runRecordDiagnosis } from "../src/commands/record-diagnosis.js";
import { runAdvance } from "../src/commands/advance.js";
import { validateEventLedger } from "../src/core/events.js";

test("canonical fixture reaches DIAGNOSING and completes native diagnosis/advance", async () => {
  const fixture = await buildCanonicalDiagnosisProject();
  try {
    assert.equal(fixture.state.phase, "DIAGNOSING");
    await runRecordDiagnosis({ ...fixture, hypothesis: "Deterministic check fails by design", failureClass: "VERIFICATION_FAILURE", evidenceRefs: ["check-auth-boundary"], settledBy: "A passing check", nextSafeAction: "Correct the fixture check" });
    const next = await runAdvance({ ...fixture, to: "CORRECTING" });
    assert.equal(next.phase, "CORRECTING");
    assert.equal((await validateEventLedger(fixture.target, fixture.packageRoot, { taskId: fixture.taskId })).valid, true);
  } finally {
    await removeTempTree(fixture.target);
  }
});

test("canonical seed continues through public SQLite dispatch without operational mirrors", async () => {
  const fixture = await buildCanonicalDiagnosisProject();
  const { openStorageDatabase, findTaskById, listEvents, checkStorageIntegrity } = await import("../src/storage/index.js");
  const { executeForgeLoopCommand } = await import("../src/core/command-runtime.js");
  const path = await import("node:path");
  try {
    const diagnosis = await executeForgeLoopCommand({ command: "record-diagnosis", projectPath: fixture.target, input: { taskId: fixture.taskId, hypothesis: "Deterministic check fails by design", failureClass: "VERIFICATION_FAILURE", evidenceRefs: ["check-auth-boundary"], settledBy: "A passing check", nextSafeAction: "Correct the fixture check" } });
    assert.equal(diagnosis.ok, true, JSON.stringify(diagnosis));
    const next = await executeForgeLoopCommand({ command: "advance", projectPath: fixture.target, input: { taskId: fixture.taskId, to: "CORRECTING" } });
    assert.equal(next.ok, true, JSON.stringify(next));
    const db = openStorageDatabase(path.join(fixture.target, ".forgeloop/state.sqlite"), { readOnly: true });
    try {
      assert.equal(findTaskById(db, fixture.taskId).state.phase, "CORRECTING");
      assert.equal(checkStorageIntegrity(db).ok, true);
      assert.equal(listEvents(db, fixture.taskId).filter(event => event.event === "DIAGNOSIS_RECORDED").length, 1);
    } finally { db.close(); }
    const { readdir } = await import("node:fs/promises");
    await assert.rejects(readdir(path.join(fixture.target, ".forgeloop/task-state")), { code: "ENOENT" });
  } finally { await removeTempTree(fixture.target); }
});

test("missing persisted preflight rejects correction on direct API and public SQLite without mutation", async () => {
  const fixture = await buildCanonicalDiagnosisProject();
  const control = await buildCanonicalDiagnosisProject();
  const { openStorageDatabase, listEvents, findTaskById } = await import("../src/storage/index.js");
  const { executeForgeLoopCommand } = await import("../src/core/command-runtime.js");
  const { readWorkState } = await import("../src/core/work-state.js");
  const { readEvents } = await import("../src/core/events.js");
  const path = await import("node:path");
  let db = null;
  const request = { taskId: fixture.taskId, hypothesis: "Deterministic check fails by design", failureClass: "VERIFICATION_FAILURE", evidenceRefs: ["check-auth-boundary"], settledBy: "A passing check", nextSafeAction: "Correct the fixture check" };
  try {
    await runRecordDiagnosis({ ...control, ...request });
    const controlDb = openStorageDatabase(path.join(control.target, ".forgeloop/state.sqlite"));
    try { controlDb.prepare("DELETE FROM task_artifacts WHERE task_id = ? AND kind = 'preflight'").run(control.taskId); } finally { controlDb.close(); }
    const directBefore = { state: await readWorkState(control.target, control), events: await readEvents(control.target, control.packageRoot, { taskId: control.taskId }) };
    await assert.rejects(runAdvance({ ...control, to: "CORRECTING" }), { code: "E_PREFLIGHT_NOT_READY" });
    assert.deepEqual({ state: await readWorkState(control.target, control), events: await readEvents(control.target, control.packageRoot, { taskId: control.taskId }) }, directBefore);
    const diagnosed = await executeForgeLoopCommand({ command: "record-diagnosis", projectPath: fixture.target, input: request });
    assert.equal(diagnosed.ok, true, JSON.stringify(diagnosed));
    db = openStorageDatabase(path.join(fixture.target, ".forgeloop/state.sqlite"));
    db.prepare("DELETE FROM task_artifacts WHERE task_id = ? AND kind = 'preflight'").run(fixture.taskId);
    const before = { state: findTaskById(db, fixture.taskId).state, events: listEvents(db, fixture.taskId) };
    const rejected = await executeForgeLoopCommand({ command: "advance", projectPath: fixture.target, input: { taskId: fixture.taskId, to: "CORRECTING" } });
    assert.equal(rejected.ok, false);
    assert.equal(rejected.error.code, "E_PREFLIGHT_NOT_READY", JSON.stringify(rejected));
    assert.deepEqual({ state: findTaskById(db, fixture.taskId).state, events: listEvents(db, fixture.taskId) }, before);
  } finally {
    db?.close();
    await removeTempTree(fixture.target);
    await removeTempTree(control.target);
  }
});

for (const fault of ["after-state-write", "after-event-write"]) {
  test(`canonical public advance rolls back native ${fault} and retains committed diagnosis`, async () => {
    const fixture = await buildCanonicalDiagnosisProject();
    const { openStorageDatabase, listEvents, listClaims, findArtifact, findTaskById, checkStorageIntegrity } = await import("../src/storage/index.js");
    const { executeForgeLoopCommand } = await import("../src/core/command-runtime.js");
    const path = await import("node:path");
    let db = null;
    try {
      const result = await executeForgeLoopCommand({ command: "record-diagnosis", projectPath: fixture.target, input: { taskId: fixture.taskId, hypothesis: "Deterministic check fails by design", failureClass: "VERIFICATION_FAILURE", evidenceRefs: ["check-auth-boundary"], settledBy: "A passing check", nextSafeAction: "Correct the fixture check" } });
      assert.equal(result.ok, true, JSON.stringify(result));
      db = openStorageDatabase(path.join(fixture.target, ".forgeloop/state.sqlite"));
      const snapshot = () => ({ state: findTaskById(db, fixture.taskId).state, events: listEvents(db, fixture.taskId), claims: listClaims(db, fixture.taskId), receipt: findArtifact(db, fixture.taskId, "receipt") });
      const before = snapshot();
      const boundary = fault === "after-state-write"
        ? "AFTER UPDATE ON tasks WHEN NEW.phase = 'CORRECTING'"
        : "AFTER INSERT ON events WHEN NEW.event_type = 'TRANSACTION_COMMITTED'";
      db.exec(`CREATE TRIGGER correction_fault ${boundary} BEGIN SELECT RAISE(ABORT, 'SQLITE_CORRECTION_FAULT'); END`);
      const input = { taskId: fixture.taskId, to: "CORRECTING" };
      const next = await executeForgeLoopCommand({ command: "advance", projectPath: fixture.target, input });
      assert.equal(next.ok, false);
      assert.match(next.error.message, /SQLITE_CORRECTION_FAULT/, JSON.stringify(next));
      assert.deepEqual(snapshot(), before);
      assert.equal(checkStorageIntegrity(db).ok, true);
      db.exec("DROP TRIGGER correction_fault");
      const corrected = await executeForgeLoopCommand({ command: "advance", projectPath: fixture.target, input });
      assert.equal(corrected.ok, true, JSON.stringify(corrected));
      assert.equal(findTaskById(db, fixture.taskId).state.phase, "CORRECTING");
    } finally {
      db?.close();
      await removeTempTree(fixture.target);
    }
  });
}

test("canonical direct API/public SQLite sequence preserves state, receipt and event semantics", async () => {
  const fixture = await buildCanonicalDiagnosisProject();
  const storage = await import("../src/storage/index.js");
  const { executeForgeLoopCommand } = await import("../src/core/command-runtime.js");
  const { readEvents } = await import("../src/core/events.js");
  const { readJsonArtifact } = await import("../src/core/artifacts.js");
  const { readWorkState } = await import("../src/core/work-state.js");
  const { taskArtifactPath } = await import("../src/core/task-paths.js");
  const path = await import("node:path");
  const controlTarget = await mkdtemp(path.join(os.tmpdir(), "forgeloop-canonical-control-"));
  await cp(fixture.target, controlTarget, { recursive: true });
  const control = { ...fixture, target: controlTarget };
  const seedCount = (await readEvents(controlTarget, fixture.packageRoot, { taskId: fixture.taskId })).length;
  let db;
  const request = { taskId: fixture.taskId, hypothesis: "Deterministic check fails by design", failureClass: "VERIFICATION_FAILURE", evidenceRefs: ["check-auth-boundary"], settledBy: "A passing check", nextSafeAction: "Correct the fixture check" };
  try {
    for (const [command, input] of [["record-diagnosis", request], ["advance", { taskId: fixture.taskId, to: "CORRECTING" }]]) {
      const stored = await executeForgeLoopCommand({ command, projectPath: fixture.target, input });
      assert.equal(stored.ok, true, JSON.stringify(stored));
      if (command === "record-diagnosis") await runRecordDiagnosis({ ...control, ...input });
      else await runAdvance({ ...control, ...input });
    }
    db = storage.openStorageDatabase(path.join(fixture.target, ".forgeloop/state.sqlite"), { readOnly: true });
    const normalizeState = ({ lastUpdated, ...state }) => state;
    assert.deepEqual(normalizeState(storage.findTaskById(db, fixture.taskId).state), normalizeState(await readWorkState(controlTarget, control)));
    const storedReceipt = storage.findArtifact(db, fixture.taskId, "receipt");
    const directReceipt = (await readJsonArtifact(controlTarget, taskArtifactPath(fixture.taskId, "receipt"), "execution-receipt", fixture.packageRoot)).value;
    const normalizeReceipt = ({ stateFingerprint, ...receipt }) => receipt;
    assert.deepEqual(normalizeReceipt(storedReceipt), normalizeReceipt(directReceipt));
    const normalizeEvent = ({ at, hash, previousHash, details, ...event }) => {
      if (event.event === "TRANSACTION_COMMITTED") {
        const { transactionId, ...domainDetails } = details;
        return { ...event, details: domainDetails };
      }
      return { ...event, ...(details ? { details } : {}) };
    };
    const storedEvents = storage.listEvents(db, fixture.taskId).slice(seedCount);
    const directEvents = (await readEvents(controlTarget, fixture.packageRoot, { taskId: fixture.taskId })).slice(seedCount);
    assert.deepEqual(storedEvents.map(normalizeEvent), directEvents.map(normalizeEvent));
    assert.deepEqual(storedEvents.map(event => event.event), ["DIAGNOSIS_RECORDED", "TRANSACTION_COMMITTED", "TRANSACTION_COMMITTED"]);
  } finally {
    db?.close();
    await removeTempTree(controlTarget);
    await removeTempTree(fixture.target);
  }
});

test("canonical recovery rejects SQLite correction without mutating released claims", async () => {
  const fixture = await buildCanonicalDiagnosisProject();
  const storage = await import("../src/storage/index.js");
  const { executeForgeLoopCommand } = await import("../src/core/command-runtime.js");
  const { runTaskAbandon } = await import("../src/commands/task-abandon.js");
  const path = await import("node:path");
  let db;
  try {
    await runRecordDiagnosis({ ...fixture, hypothesis: "Deterministic check fails by design", failureClass: "VERIFICATION_FAILURE", evidenceRefs: ["check-auth-boundary"], settledBy: "A passing check", nextSafeAction: "Correct the fixture check" });
    await runTaskAbandon({ ...fixture, acknowledgeAbandonment: true });
    db = storage.openStorageDatabase(path.join(fixture.target, ".forgeloop/state.sqlite"), { readOnly: true });
    const snapshot = () => ({ state: storage.findTaskById(db, fixture.taskId).state, events: storage.listEvents(db, fixture.taskId), claims: storage.listClaims(db, fixture.taskId), recovery: storage.findArtifact(db, fixture.taskId, "recovery") });
    const before = snapshot();
    assert.ok(before.claims.length > 0);
    assert.ok(before.claims.every(claim => claim.reservation_state === "RELEASED"));
    const result = await executeForgeLoopCommand({ command: "advance", projectPath: fixture.target, input: { taskId: fixture.taskId, to: "CORRECTING" } });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "E_TASK_RECOVERED");
    const { withProjectStorage } = await import("../src/storage/project-boundary.js");
    await assert.rejects(withProjectStorage(fixture.target, () => runAdvance({ ...fixture, to: "CORRECTING" })), { code: result.error.code });
    assert.deepEqual(snapshot(), before);
  } finally {
    db?.close();
    await removeTempTree(fixture.target);
  }
});
