import { removeTempTree } from "./helpers/rm-safe.js";
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { executeForgeLoopCommand } from "../src/core/command-runtime.js";
import { readTaskDescriptor, writeTaskDescriptor } from "../src/core/task-descriptor.js";
import { createWorkState, readWorkState, writeWorkState, clearWorkState } from "../src/core/work-state.js";
import { readJsonArtifact, readPortableJsonArtifact, writeJsonArtifact, ARTIFACT_PATHS } from "../src/core/artifacts.js";
import { clearContinuity } from "../src/core/continuity.js";
import { taskArtifactPath } from "../src/core/task-paths.js";
import { getPackageRoot } from "../src/core/templates.js";

const taskId = "direct-artifacts";
const packageRoot = getPackageRoot();
async function project(callback) {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-direct-artifacts-"));
  try {
    const created = await executeForgeLoopCommand({ command: "task-create", projectPath: target, input: { taskId, claims: [] } });
    assert.equal(created.ok, true, JSON.stringify(created));
    await callback(target);
  } finally { await removeTempTree(target); }
}

const state = () => createWorkState({ taskId, phase: "RECEIVED", contractFingerprint: "0".repeat(64), lastUpdated: "2026-10-02T12:00:00.000Z" });

test("direct native artifact reads and writes resolve canonical authority without filesystem mirrors", async () => {
  await project(async target => {
    const descriptor = (await readTaskDescriptor(target, taskId, packageRoot)).value;
    const changed = { ...descriptor, updatedAt: "2026-10-02T12:00:00.000Z" };
    await writeTaskDescriptor(target, changed, packageRoot);
    assert.deepEqual((await readJsonArtifact(target, taskArtifactPath(taskId, "descriptor"), "task-descriptor", packageRoot)).value, changed);
    await writeWorkState(target, state(), { packageRoot });
    assert.deepEqual(await readWorkState(target, { packageRoot, taskId }), state());
    await writeWorkState(target, { ...state(), revision: 1 }, { packageRoot, dryRun: true });
    assert.equal((await readWorkState(target, { packageRoot, taskId })).revision, 0);
    assert.equal((await clearWorkState(target, { packageRoot, taskId })).removed, true);
    assert.equal(await readWorkState(target, { packageRoot, taskId }), null);
    assert.equal((await clearWorkState(target, { packageRoot, taskId })).removed, false);
    await assert.rejects(readdir(path.join(target, ".forgeloop/task-state")), { code: "ENOENT" });
    await assert.rejects(readFile(path.join(target, ARTIFACT_PATHS.state)), { code: "ENOENT" });
    await assert.rejects(readdir(path.join(target, ".forgeloop/.txn")), { code: "ENOENT" });
  });
});

test("native persistence refuses singleton aliases while project configuration stays filesystem-owned", async () => {
  await project(async target => {
    await assert.rejects(writeWorkState(target, state(), { packageRoot, statePath: ARTIFACT_PATHS.state }), { code: "E_STORAGE_OPERATION_UNSUPPORTED" });
    await assert.rejects(writeJsonArtifact(target, ARTIFACT_PATHS.state, state(), "work-state", packageRoot), { code: "E_STORAGE_OPERATION_UNSUPPORTED" });
    for (const relative of [".forgeloop/../.forgeloop/work-state.json", ".forgeloop\\work-state.json", ".forgeloop/task-state/invalid/work-state.json", ".forgeloop/state.sqlite", ".forgeloop/state.sqlite-wal", ".forgeloop/storage-version.json", ".FORGELOOP/WORK-STATE.JSON", ".forgeloop/work-state.json.", ".forgeloop/state.sqlite:stream"]) {
      await assert.rejects(writeJsonArtifact(target, relative, state(), "work-state", packageRoot), { code: "E_STORAGE_OPERATION_UNSUPPORTED" });
    }
    await assert.rejects(clearWorkState(target, { packageRoot }), { code: "E_STORAGE_OPERATION_UNSUPPORTED" });
    await assert.rejects(clearContinuity(target, { packageRoot }), { code: "E_STORAGE_OPERATION_UNSUPPORTED" });
    const config = JSON.parse(await readFile(path.join(packageRoot, "tests/fixtures/schemas/config/valid.json"), "utf8"));
    await writeJsonArtifact(target, ARTIFACT_PATHS.config, config, "config", packageRoot);
    assert.deepEqual((await readJsonArtifact(target, ARTIFACT_PATHS.config, "config", packageRoot)).value, config);
    assert.deepEqual(JSON.parse(await readFile(path.join(target, ARTIFACT_PATHS.config), "utf8")), config);
    await assert.rejects(readFile(path.join(target, ARTIFACT_PATHS.state)), { code: "ENOENT" });
    await assert.rejects(readFile(path.join(target, ARTIFACT_PATHS.continuity)), { code: "ENOENT" });
  });
});

test("direct native artifact entry points refuse missing databases rather than returning filesystem absence or publishing aliases", async () => {
  await project(async target => {
    await rm(path.join(target, ".forgeloop/state.sqlite"));
    for (const operation of [
      () => readTaskDescriptor(target, taskId, packageRoot),
      () => readWorkState(target, { packageRoot, taskId }),
      () => writeWorkState(target, state(), { packageRoot }),
      () => writeJsonArtifact(target, taskArtifactPath(taskId, "state"), state(), "work-state", packageRoot),
      () => clearWorkState(target, { packageRoot, taskId }),
      () => clearContinuity(target, { packageRoot, taskId }),
    ]) await assert.rejects(operation(), { code: "E_STORAGE_MIGRATION_REQUIRED" });
    await assert.rejects(readdir(path.join(target, ".forgeloop/task-state")), { code: "ENOENT" });
    await assert.rejects(readFile(path.join(target, ".forgeloop/state.sqlite")), { code: "ENOENT" });
  });
});


for (const sidecar of ["state.sqlite-wal", "state.sqlite-shm"]) {
  test(`orphan ${sidecar} prevents direct artifact filesystem fallback`, async () => {
    const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-orphan-native-artifact-"));
    try {
      await mkdir(path.join(target, ".forgeloop"));
      const filename = path.join(target, ".forgeloop", sidecar);
      await writeFile(filename, "retained sidecar evidence");
      await assert.rejects(writeWorkState(target, state(), { packageRoot }), { code: "E_STORAGE_MIGRATION_REQUIRED" });
      await assert.rejects(readWorkState(target, { packageRoot, taskId }), { code: "E_STORAGE_MIGRATION_REQUIRED" });
      assert.equal(await readFile(filename, "utf8"), "retained sidecar evidence");
      assert.deepEqual(await readdir(path.join(target, ".forgeloop")), [sidecar]);
    } finally { await removeTempTree(target); }
  });
}


test("native route requires a task instead of publishing a singleton routing result", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-route-task-boundary-"));
  try {
    const result = await executeForgeLoopCommand({ command: "route", projectPath: target, input: { workType: "code" } });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "E_TASK_REQUIRED", JSON.stringify(result));
    await assert.rejects(readFile(path.join(target, ARTIFACT_PATHS.route)), { code: "ENOENT" });
    await assert.rejects(readdir(path.join(target, ".forgeloop/.txn")), { code: "ENOENT" });
  } finally { await removeTempTree(target); }
});


for (const readOnly of [true, false]) {
  test(`existing-only admission preserves database loss without bootstrap (readOnly=${readOnly})`, async () => {
    const { needsExistingProjectScope, withExistingProjectScope } = await import("../src/storage/existing-project-scope.js");
    const { openStorageDatabase } = await import("../src/storage/connection.js");
    const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-existing-admission-"));
    try {
      await mkdir(path.join(target, ".forgeloop"));
      const filename = path.join(target, ".forgeloop/state.sqlite");
      const db = openStorageDatabase(filename);
      db.close();
      assert.equal(await needsExistingProjectScope(target), true);
      // The existing database disappears between selection and admission.
      // No marker is present to provide the separate marker-based guard.
      await rm(filename);
      const before = await readdir(path.join(target, ".forgeloop"));
      let calls = 0;
      await assert.rejects(withExistingProjectScope(target, () => { calls += 1; }, { readOnly }), { code: "E_STORAGE_MIGRATION_REQUIRED" });
      assert.equal(calls, 0);
      assert.deepEqual(await readdir(path.join(target, ".forgeloop")), before);
      await assert.rejects(readFile(filename), { code: "ENOENT" });
    } finally { await removeTempTree(target); }
  });
}


test("operational JSON refuses legacy payload while explicit portable inspection validates unchanged bytes",async()=>{
 const target=await mkdtemp(path.join(os.tmpdir(),"forgeloop-json-reader-boundary-"));
 try{
  const {createTaskDescriptor}=await import("../src/core/task-descriptor.js");
  const relative=taskArtifactPath(taskId,"descriptor");const filename=path.join(target,relative);
  const descriptor=createTaskDescriptor({taskId});const bytes=Buffer.from(JSON.stringify(descriptor));
  await mkdir(path.dirname(filename),{recursive:true});await writeFile(filename,bytes);
  await assert.rejects(readJsonArtifact(target,relative,"task-descriptor",packageRoot),{code:"E_STORAGE_MIGRATION_REQUIRED"});
  assert.deepEqual((await readPortableJsonArtifact(target,relative,"task-descriptor",packageRoot)).value,descriptor);
  assert.deepEqual(await readFile(filename),bytes);
  await assert.rejects(readFile(path.join(target,".forgeloop/state.sqlite")),{code:"ENOENT"});
  await writeFile(filename,'{"taskId":"broken"}');
  await assert.rejects(readPortableJsonArtifact(target,relative,"task-descriptor",packageRoot),{code:"ARTIFACT_INVALID"});
  await assert.rejects(readPortableJsonArtifact(target,"../outside.json","task-descriptor",packageRoot),{code:"ARTIFACT_PATH_INVALID"});
 }finally{await removeTempTree(target);}
});


test("operational ledger readers refuse retained legacy bytes while explicit inspection preserves validation", async () => {
 const {readEvents,iterateEvents,readEventTail,readPortableEvents,readPortableEventTail,validateEventLedger,validatePortableEventLedger,eventHash}=await import("../src/core/events.js");
 const target=await mkdtemp(path.join(os.tmpdir(),"forgeloop-ledger-reader-boundary-"));
 try {
  const relative=taskArtifactPath(taskId,"events"),filename=path.join(target,relative);
  const event={seq:1,schemaVersion:1,protocolVersion:1,taskId,event:"OBSERVATION",at:"2026-10-06T12:00:00.000Z",previousHash:null};event.hash=eventHash(event);
  const bytes=Buffer.from(JSON.stringify(event)+"\n");await mkdir(path.dirname(filename),{recursive:true});await writeFile(filename,bytes);
  const options={taskId};
  await assert.rejects(readEvents(target,packageRoot,options),{code:"E_STORAGE_MIGRATION_REQUIRED"});
  await assert.rejects(readEventTail(target,packageRoot,options),{code:"E_STORAGE_MIGRATION_REQUIRED"});
  await assert.rejects(async()=>{for await(const ignored of iterateEvents(target,packageRoot,options)) void ignored;},{code:"E_STORAGE_MIGRATION_REQUIRED"});
  const refused=await validateEventLedger(target,packageRoot,options);assert.equal(refused.valid,false);assert.equal(refused.errors[0].code,"E_STORAGE_MIGRATION_REQUIRED");
  assert.deepEqual(await readPortableEvents(target,packageRoot,options),[event]);assert.deepEqual(await readPortableEventTail(target,packageRoot,options),[event]);
  assert.equal((await validatePortableEventLedger(target,packageRoot,options)).valid,true);
  await writeFile(filename,JSON.stringify({...event,hash:"f".repeat(64)})+"\n");assert.equal((await validatePortableEventLedger(target,packageRoot,options)).valid,false);
  await writeFile(filename,'{"seq":1}\n');await assert.rejects(readPortableEvents(target,packageRoot,options));
  await assert.rejects(readPortableEvents(target,packageRoot,{eventsPath:"../outside.ndjson"}),/Path escapes target directory/);
  await writeFile(filename,bytes);assert.deepEqual(await readFile(filename),bytes);
  await assert.rejects(readFile(path.join(target,".forgeloop/state.sqlite")),{code:"ENOENT"});
  await rm(filename);assert.deepEqual(await readEvents(target,packageRoot,options),[]);assert.deepEqual(await readEventTail(target,packageRoot,options),[]);
 } finally {await removeTempTree(target);}
});


test("canonical execution lookup rejects ambiguity and legacy filesystem records",async()=>{
 const {readExecutionArtifact}=await import("../src/core/execution.js");
 const {taskExecutionPath}=await import("../src/core/task-paths.js");
 const fixture=JSON.parse(await readFile(path.join(packageRoot,"tests/fixtures/schemas/execution/valid.json"),"utf8"));
 const executionId="exec-lookup-boundary";
 await project(async target=>{
  const execution={...fixture,taskId,executionId};
  await writeJsonArtifact(target,taskExecutionPath(taskId,executionId),execution,"execution",packageRoot);
  assert.deepEqual((await readExecutionArtifact({target,packageRoot,executionRef:executionId})).value,execution);
  const otherId="direct-artifacts-other";
  const created=await executeForgeLoopCommand({command:"task-create",projectPath:target,input:{taskId:otherId,claims:[]}});assert.equal(created.ok,true);
  await writeJsonArtifact(target,taskExecutionPath(otherId,executionId),{...execution,taskId:otherId},"execution",packageRoot);
  await assert.rejects(readExecutionArtifact({target,packageRoot,executionRef:executionId}),{code:"E_EXECUTION_REF_INVALID"});
  assert.deepEqual((await readExecutionArtifact({target,packageRoot,executionRef:executionId,taskId})).value,execution);
  await assert.rejects(readExecutionArtifact({target,packageRoot,executionRef:"../escape",taskId}),{code:"E_EXECUTION_REF_INVALID"});
 });
 const target=await mkdtemp(path.join(os.tmpdir(),"forgeloop-legacy-execution-refusal-"));
 try{
  const relative=taskExecutionPath(taskId,executionId),filename=path.join(target,relative),bytes=Buffer.from(JSON.stringify({...fixture,taskId,executionId}));
  await mkdir(path.dirname(filename),{recursive:true});await writeFile(filename,bytes);
  for(const selector of [undefined,taskId]) await assert.rejects(readExecutionArtifact({target,packageRoot,executionRef:executionId,taskId:selector}),{code:"E_EXECUTION_REF_INVALID"});
  assert.deepEqual(await readFile(filename),bytes);await assert.rejects(readFile(path.join(target,".forgeloop/state.sqlite")),{code:"ENOENT"});
 }finally{await removeTempTree(target);}
});
