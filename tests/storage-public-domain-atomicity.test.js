import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readdir, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { executeForgeLoopCommand } from "../src/core/command-runtime.js";
import { removeTempTree } from "./helpers/rm-safe.js";

import { installTestSemanticProvider, clearTestSemanticProvider } from "../src/core/decision/test-provider.js";

const taskId = "artifact-domain-atomicity";
async function fixture(callback) {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-domain-atomicity-"));
  let db;
  try {
    const created = await executeForgeLoopCommand({ command: "task-create", projectPath: target, input: { taskId, claims: [] } });
    assert.equal(created.ok, true, JSON.stringify(created));
    db = new DatabaseSync(path.join(target, ".forgeloop/state.sqlite"));
    await callback({ target, db });
  } finally { db?.close(); await removeTempTree(target); }
}
function snapshot(db) {
  const tables = db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
  return tables.map(({name}) => ({name, rows: db.prepare(`SELECT * FROM "${name.replaceAll('"','""')}"`).all().map(row=>JSON.stringify(row)).sort()}));
}
async function noMirrors(target) {
  const names = await readdir(path.join(target, ".forgeloop"));
  for (const name of ["task-state", "sessions", "session.json", ".txn"]) assert.equal(names.includes(name), false, name);
}
test("public activation rolls back session row when active pointer publication fails", async () => {
  await fixture(async ({target, db}) => {
    const invoke = () => executeForgeLoopCommand({command:"activate", projectPath:target, input:{}});
    const initial = await invoke(); assert.equal(initial.ok,true,JSON.stringify(initial));
    const before = snapshot(db);
    db.exec("CREATE TRIGGER domain_session_fault AFTER UPDATE OF active_session_id ON storage_meta WHEN NEW.active_session_id IS NOT OLD.active_session_id BEGIN SELECT RAISE(ABORT, 'DOMAIN_SESSION_FAULT'); END");
    try {
      const failed = await invoke(); assert.equal(failed.ok,false,JSON.stringify(failed));
      assert.match(JSON.stringify(failed.error),/DOMAIN_SESSION_FAULT/);
      assert.deepEqual(snapshot(db),before); assert.equal(db.isTransaction,false); await noMirrors(target);
    } finally { db.exec("DROP TRIGGER domain_session_fault"); }
    const retried = await invoke(); assert.equal(retried.ok,true,JSON.stringify(retried));
    const pointer = db.prepare("SELECT active_session_id FROM storage_meta WHERE id=1").get().active_session_id;
    assert.equal(pointer,retried.result.sessionId);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM sessions").get().count,2);
    await noMirrors(target);
  });
});
test("public usage record rolls back artifact when its event publication fails", async () => {
  await fixture(async ({target, db}) => {
    const invoke = () => executeForgeLoopCommand({command:"usage-record", projectPath:target, input:{taskId,usageInputTokens:10,usageOutputTokens:4,usageTotalTokens:14,usageSource:"ACTOR_REPORTED"}});
    const before = snapshot(db);
    db.exec("CREATE TRIGGER domain_usage_fault AFTER INSERT ON events WHEN NEW.event_type='USAGE_RECORDED' BEGIN SELECT RAISE(ABORT, 'DOMAIN_USAGE_FAULT'); END");
    try {
      const failed = await invoke(); assert.equal(failed.ok,false,JSON.stringify(failed));
      assert.match(JSON.stringify(failed.error),/DOMAIN_USAGE_FAULT/);
      assert.deepEqual(snapshot(db),before); assert.equal(db.isTransaction,false); await noMirrors(target);
    } finally { db.exec("DROP TRIGGER domain_usage_fault"); }
    const retried = await invoke(); assert.equal(retried.ok,true,JSON.stringify(retried));
    assert.equal(retried.result.usage.totalTokens,14);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM events WHERE event_type='USAGE_RECORDED'").get().count,1);
    await noMirrors(target);
  });
});

test("public test utility retains canonical payload and rolls back final artifact publication", async () => {
  await fixture(async ({target, db}) => {
    await mkdir(path.join(target,"tests"));
    await writeFile(path.join(target,"tests/sample.test.js"),"import test from 'node:test'; test('sample', () => {});\n");
    installTestSemanticProvider();
    try {
      const invoke=()=>executeForgeLoopCommand({command:"test-utility",projectPath:target,input:{taskId}});
      const initial=await invoke(); assert.equal(initial.ok,true,JSON.stringify(initial));
      assert.equal(initial.result.artifact.tests.length,1);
      assert.equal(initial.result.artifact.decisionIds.length,1);
      const retained=()=>db.prepare("SELECT payload_json FROM task_artifacts WHERE task_id=? AND kind='testUtility' AND artifact_id='current'").get(taskId);
      assert.deepEqual(JSON.parse(retained().payload_json),initial.result.artifact);
      const before=snapshot(db);
      db.exec("CREATE TRIGGER domain_utility_fault BEFORE INSERT ON task_artifacts WHEN NEW.kind='testUtility' BEGIN SELECT RAISE(ABORT, 'DOMAIN_UTILITY_FAULT'); END");
      try {
        const failed=await invoke(); assert.equal(failed.ok,false,JSON.stringify(failed));
        assert.match(JSON.stringify(failed.error),/DOMAIN_UTILITY_FAULT/);
        assert.deepEqual(snapshot(db),before); assert.equal(db.isTransaction,false); await noMirrors(target);
      } finally { db.exec("DROP TRIGGER domain_utility_fault"); }
      const retry=await invoke(); assert.equal(retry.ok,true,JSON.stringify(retry));
      assert.deepEqual(JSON.parse(retained().payload_json),retry.result.artifact);
      await noMirrors(target);
    } finally { clearTestSemanticProvider(); }
  });
});
