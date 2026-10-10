import assert from "node:assert/strict";
import test from "node:test";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { executeForgeLoopCommand } from "../src/core/command-runtime.js";
import { createGitRepository } from "./helpers/git-fixture.js";
import { setupVerifyingTask } from "./helpers/durable-lifecycle.js";
import { proposeAction } from "../src/core/actions.js";
import { bindTaskWorkspace } from "../src/core/workspace-binding.js";
import { getPackageRoot } from "../src/core/templates.js";
import { removeTempTree } from "./helpers/rm-safe.js";
import { buildCanonicalDiagnosisProject } from "./helpers/canonical-diagnosis-fixture.js";



async function fixture(callback) {
  const f = await buildCanonicalDiagnosisProject();
  const db = new DatabaseSync(path.join(f.target, ".forgeloop/state.sqlite"));
  try { await callback({ target: f.target, db, taskId: f.taskId }); }
  finally { db.close(); await f.cleanup(); }
}
function snapshot(db) {
  const tables = db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
  return tables.map(({name}) => ({name, rows: db.prepare(`SELECT * FROM "${name.replaceAll('"','""')}"`).all().map(row=>JSON.stringify(row)).sort()}));
}
async function noMirrors(target) {
  const names = await readdir(path.join(target, ".forgeloop"));
  for (const name of ["task-state", "sessions", "session.json", ".txn"]) assert.equal(names.includes(name), false, name);
}

for (const command of ["record-continuity", "clear-continuity"]) test(`public ${command} rolls back with its transaction witness`, async () => {
  await fixture(async ({ target, db, taskId }) => {
    const record = () => executeForgeLoopCommand({ command: "record-continuity", projectPath: target, input: { taskId, focusId: "atomic", focusSummary: "retain selected task context" } });
    if (command === "clear-continuity") {
      const seeded = await record();
      assert.equal(seeded.ok, true, JSON.stringify(seeded));
    }
    const invoke = command === "record-continuity" ? record : () => executeForgeLoopCommand({ command, projectPath: target, input: { taskId } });
    const before = snapshot(db);
    db.exec("CREATE TRIGGER continuity_witness_fault BEFORE INSERT ON events WHEN NEW.event_type='TRANSACTION_COMMITTED' BEGIN SELECT RAISE(ABORT, 'CONTINUITY_WITNESS_FAULT'); END");
    try {
      const failed = await invoke();
      assert.equal(failed.ok, false, JSON.stringify(failed));
      assert.match(JSON.stringify(failed.error), /CONTINUITY_WITNESS_FAULT/);
      assert.deepEqual(snapshot(db), before);
      assert.equal(db.isTransaction, false);
    } finally { db.exec("DROP TRIGGER continuity_witness_fault"); }
    const count = db.prepare("SELECT COUNT(*) AS n FROM events WHERE event_type='TRANSACTION_COMMITTED'").get().n;
    const retried = await invoke();
    assert.equal(retried.ok, true, JSON.stringify(retried));
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM events WHERE event_type='TRANSACTION_COMMITTED'").get().n, count + 1);
    await noMirrors(target);
  });
});

test("public workspace binding rolls back artifact and event publication", async () => {
  const target = await createGitRepository("forgeloop-public-workspace-atomicity-");
  let db;
  try {
    await setupVerifyingTask(target, getPackageRoot(), { taskId: "workspace-atomicity" });
    db = new DatabaseSync(path.join(target, ".forgeloop/state.sqlite"));
    const invoke = () => executeForgeLoopCommand({ command: "workspace-bind", projectPath: target, input: { taskId: "workspace-atomicity" } });
    const before = snapshot(db);
    db.exec("CREATE TRIGGER workspace_fault BEFORE INSERT ON events WHEN NEW.event_type='WORKSPACE_BOUND' BEGIN SELECT RAISE(ABORT, 'WORKSPACE_PUBLIC_FAULT'); END");
    try {
      const failed = await invoke();
      assert.equal(failed.ok, false, JSON.stringify(failed));
      assert.match(JSON.stringify(failed.error), /WORKSPACE_PUBLIC_FAULT/);
      assert.deepEqual(snapshot(db), before);
    } finally { db.exec("DROP TRIGGER workspace_fault"); }
    const retried = await invoke();
    assert.equal(retried.ok, true, JSON.stringify(retried));
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM events WHERE event_type='WORKSPACE_BOUND'").get().n, 1);
    await noMirrors(target);
  } finally { db?.close(); await removeTempTree(target); }
});

for (const [command, event, input] of [
  ["verify-scope", "VERIFICATION_SCOPE_CAPTURED", { verificationScopeMode: "FULL" }],
  ["handoff-create", "HANDOFF_CREATED", { handoffNote: "public atomic handoff" }],
]) test(`public ${command} rolls back its artifact and ledger event`, async () => {
  const target = await createGitRepository("forgeloop-public-scope-handoff-");
  const taskId = "public-scope-handoff";
  let db;
  try {
    await setupVerifyingTask(target, getPackageRoot(), { taskId });
    await bindTaskWorkspace(target, { taskId, packageRoot: getPackageRoot() });
    db = new DatabaseSync(path.join(target, ".forgeloop/state.sqlite"));
    const invoke = () => executeForgeLoopCommand({ command, projectPath: target, input: { taskId, ...input } });
    const before = snapshot(db);
    db.exec(`CREATE TRIGGER wrapper_fault BEFORE INSERT ON events WHEN NEW.event_type='${event}' BEGIN SELECT RAISE(ABORT, 'PUBLIC_WRAPPER_FAULT'); END`);
    try {
      const failed = await invoke();
      assert.equal(failed.ok, false, JSON.stringify(failed));
      assert.match(JSON.stringify(failed.error), /PUBLIC_WRAPPER_FAULT/);
      assert.deepEqual(snapshot(db), before);
    } finally { db.exec("DROP TRIGGER wrapper_fault"); }
    const retried = await invoke();
    assert.equal(retried.ok, true, JSON.stringify(retried));
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM events WHERE event_type=?").get(event).n, 1);
    await noMirrors(target);
  } finally { db?.close(); await removeTempTree(target); }
});

test("public task creation rolls back descriptor claims and initial event together", async () => {
  await fixture(async ({ target, db }) => {
    const taskId = "new-atomic-task";
    const invoke = () => executeForgeLoopCommand({ command: "task-create", projectPath: target, input: { taskId, claims: ["independent-atomic-task"] } });
    const before = snapshot(db);
    db.exec("CREATE TRIGGER task_create_fault BEFORE INSERT ON events WHEN NEW.event_type='TASK_RECEIVED' BEGIN SELECT RAISE(ABORT, 'PUBLIC_TASK_CREATE_FAULT'); END");
    try {
      const failed = await invoke();
      assert.equal(failed.ok, false, JSON.stringify(failed));
      assert.match(JSON.stringify(failed.error), /PUBLIC_TASK_CREATE_FAULT/);
      assert.deepEqual(snapshot(db), before);
    } finally { db.exec("DROP TRIGGER task_create_fault"); }
    const retried = await invoke();
    assert.equal(retried.ok, true, JSON.stringify(retried));
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE task_id=?").get(taskId).n, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM events WHERE task_id=? AND event_type='TASK_RECEIVED'").get(taskId).n, 1);
    await noMirrors(target);
  });
});

test("public action cancellation rolls back indexed action and event together", async () => {
  await fixture(async ({ target, db, taskId }) => {
    await proposeAction(target, { packageRoot: getPackageRoot(), taskId, input: {
      actionId: "action-atomic-cancel", effectClass: "EXTERNAL_PUBLICATION", capability: "repository.push",
      target: "origin/topic", operation: "push branch", idempotencyKey: "atomic-cancel-key",
      requiredForCompletion: true, requirement: "publication", provenance: "HOST_REPORTED",
    } });
    const invoke = () => executeForgeLoopCommand({ command: "action-record", projectPath: target,
      input: { taskId, actionId: "action-atomic-cancel", actionState: "CANCELLED", actionProvenance: "CALLER_REPORTED" } });
    const before = snapshot(db);
    db.exec("CREATE TRIGGER action_cancel_fault BEFORE INSERT ON events WHEN NEW.event_type='ACTION_CANCELLED' BEGIN SELECT RAISE(ABORT, 'PUBLIC_CANCEL_FAULT'); END");
    try {
      const failed = await invoke();
      assert.equal(failed.ok, false, JSON.stringify(failed));
      assert.match(JSON.stringify(failed.error), /PUBLIC_CANCEL_FAULT/);
      assert.deepEqual(snapshot(db), before);
    } finally { db.exec("DROP TRIGGER action_cancel_fault"); }
    const retried = await invoke();
    assert.equal(retried.ok, true, JSON.stringify(retried));
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM events WHERE event_type='ACTION_CANCELLED'").get().n, 1);
    await noMirrors(target);
  });
});
