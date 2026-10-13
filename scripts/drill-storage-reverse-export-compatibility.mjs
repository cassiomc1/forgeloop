/** Disposable exact-target reverse-export compatibility drill; never converts a user project. */
import assert from "node:assert/strict";
import { mkdtemp, cp, rm, rename, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { registerAttachment } from "../src/storage/attachment-references.js";
import { verifyAttachmentFile } from "../src/storage/attachment-files.js";
import os from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import { TEST_TASK_ID } from "../tests/helpers/storage-fixtures.js";
import { buildCanonicalDiagnosisProject } from "../tests/helpers/canonical-diagnosis-fixture.js";
import { executeForgeLoopCommand } from "../src/core/command-runtime.js";
import { openStorageDatabase } from "../src/storage/connection.js";
import { exportDatabase } from "../src/storage/exporter.js";
import { migrateProjectStorage } from "../src/storage/migration.js";
import { iterateAttachmentReferences } from "../src/storage/attachment-references.js";
import { logicalSnapshot } from "../src/storage/migration-candidate.js";
import { taskStorageKey } from "../src/core/task-identity.js";
import { canonicalFingerprint } from "../src/core/artifacts.js";
const legacyArgument = process.argv.find(value => value.startsWith("--legacy-root="))?.slice("--legacy-root=".length);
assert.ok(legacyArgument, "Provide a clean pinned legacy checkout with --legacy-root=/absolute/path");
const legacy = path.resolve(legacyArgument);
const currentRoot = path.resolve(import.meta.dirname, "..");
assert.equal(execFileSync("git", ["-C", legacy, "status", "--porcelain", "--untracked-files=no"], { encoding: "utf8" }).trim(), "", "Legacy checkout must have no tracked changes");
assert.equal(execFileSync("git",["-C",legacy,"rev-parse","HEAD"],{encoding:"utf8"}).trim(),"ee9ce11123d4e728d3dbc92f5d62d4bf41bb79c5");
const gitOption = process.argv.find(value => value.startsWith("--git="))?.slice("--git=".length) ?? "false";
assert.ok(["true", "false"].includes(gitOption), "--git must be true or false");
const attachmentsOption = process.argv.find(value => value.startsWith("--attachments="))?.slice("--attachments=".length) ?? "false";
assert.ok(["true", "false"].includes(attachmentsOption), "--attachments must be true or false");
const linkedOption = process.argv.find(value => value.startsWith("--linked-worktree="))?.slice("--linked-worktree=".length) ?? "false";
assert.ok(["true", "false"].includes(linkedOption), "--linked-worktree must be true or false");
const reimportOption = process.argv.find(value => value.startsWith("--reimport="))?.slice("--reimport=".length) ?? "false";
assert.ok(["true", "false"].includes(reimportOption), "--reimport must be true or false");
const attachmentBytes = Buffer.from([0, 255, 13, 10, 128, 65, 0]);
let attachment;
const { target, cleanup }=await buildCanonicalDiagnosisProject({taskId:TEST_TASK_ID, git: gitOption === "true", linkedWorktree: linkedOption === "true"});
const exported=await mkdtemp(path.join(os.tmpdir(),"forgeloop-reverse-export-compatibility-"));
const retained=await mkdtemp(path.join(os.tmpdir(),"forgeloop-native-reverse-export-retained-"));
let db;const output={legacyRevision:"ee9ce11123d4e728d3dbc92f5d62d4bf41bb79c5",scope:"Disposable offline same-project-path reverse export after canonical native task creation; retained native layout and pinned legacy read validation; no production conversion or universal downgrade claim"};
try {
 const created=await executeForgeLoopCommand({command:"task-create",projectPath:target,input:{taskId:"native-reverse-export-write",claims:[]}});
 assert.equal(created.ok,true,JSON.stringify(created));
 if (attachmentsOption === "true") {
  db=openStorageDatabase(path.join(target,".forgeloop/state.sqlite"));
  attachment=await registerAttachment(db,target,{taskId:TEST_TASK_ID,referenceId:"reverse-export-binary",readable:Readable.from([attachmentBytes])});
  db.close(); db=null;
 }
 db=openStorageDatabase(path.join(target,".forgeloop/state.sqlite"),{readOnly:true});
 assert.equal(db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE task_id=?").get("native-reverse-export-write").n,1);
 if (gitOption === "true") {
  const record=db.prepare("SELECT payload_json FROM task_artifacts WHERE task_id=? AND kind='workspaceBinding'").get(TEST_TASK_ID);
  assert.ok(record,"Git fixture must have a real canonical workspace binding");
  output.workspaceBinding=JSON.parse(record.payload_json);
 }
 const before=canonicalFingerprint(logicalSnapshot(db));
 output.nativeValidation=await executeForgeLoopCommand({command:"validate-protocol",projectPath:target,input:{taskId:TEST_TASK_ID}});
 await exportDatabase(db,exported,{attachmentRoot:target});
 if (attachment) {
  const index=JSON.parse(await readFile(path.join(exported,"export-index.json"),"utf8"));
  assert.deepEqual(index.attachments,[attachment]);
  await verifyAttachmentFile(exported,attachment);
  assert.deepEqual(await readFile(path.join(exported,attachment.path)),attachmentBytes);
 }
 if (existsSync(path.join(target,".git"))) await cp(path.join(target,".git"),path.join(exported,".git"),{recursive:true});
 output.linkedWorktree=linkedOption === "true";
 output.gitFixture=existsSync(path.join(target,".git"));
 assert.equal(existsSync(path.join(exported,".forgeloop/state.sqlite")),false);
 db.close(); db=null;
 await rename(path.join(target,".forgeloop"),path.join(retained,".forgeloop"));
 await cp(path.join(exported,".forgeloop"),path.join(target,".forgeloop"),{recursive:true});
 if (reimportOption === "true") await cp(path.join(exported,"export-index.json"),path.join(target,"export-index.json"));
 const legacyTarget=target;
 output.retainedNativeLayout=true;output.sameProjectPath=true;
 assert.equal(output.nativeValidation.result.status,"VALID",JSON.stringify(output.nativeValidation));
 output.commands=[];
 for(const args of [["task-list","--json"],["status","--task",TEST_TASK_ID,"--json"],["validate-protocol","--task",TEST_TASK_ID,"--json"]]) {
  const r=spawnSync(process.execPath,[path.join(legacy,"src/cli.js"),...args,"--path",legacyTarget],{encoding:"utf8",timeout:60000});
  output.commands.push({args,exit:r.status,stdout:r.stdout,stderr:r.stderr});
 }
 if (gitOption === "true") {
  const checked=spawnSync(process.execPath,[path.join(legacy,"src/cli.js"),"workspace-bind","--path",target,"--task",TEST_TASK_ID,"--json"],{encoding:"utf8",timeout:60000});
  output.legacyWorkspaceCheck={exit:checked.status,stdout:checked.stdout,stderr:checked.stderr};
  assert.equal(checked.status,0,checked.stdout||checked.stderr);
  assert.equal(JSON.parse(checked.stdout).alreadyBound,true);
 }
 const legacyWrite=spawnSync(process.execPath,[path.join(legacy,"src/cli.js"),"task-create","--path",target,"--task","legacy-after-reverse-export","--json"],{encoding:"utf8",timeout:60000});
 output.legacyWrite={exit:legacyWrite.status,stdout:legacyWrite.stdout,stderr:legacyWrite.stderr};
 const currentWrite=spawnSync(process.execPath,[path.join(currentRoot,"src/cli.js"),"task-create","--path",target,"--task","native-denied-on-legacy-export","--json"],{encoding:"utf8",timeout:60000});
 output.currentWriteOnLegacy={exit:currentWrite.status,stdout:currentWrite.stdout,stderr:currentWrite.stderr,nativeDatabaseAllocated:existsSync(path.join(target,".forgeloop/state.sqlite"))};
 db=openStorageDatabase(path.join(retained,".forgeloop/state.sqlite"),{readOnly:true});
 const postLegacyRead=spawnSync(process.execPath,[path.join(legacy,"src/cli.js"),"task-list","--path",target,"--json"],{encoding:"utf8",timeout:60000});
 assert.equal(postLegacyRead.status,0,postLegacyRead.stderr);
 const ids=JSON.parse(postLegacyRead.stdout).tasks.map(task=>task.taskId);
 for(const id of [TEST_TASK_ID,"native-reverse-export-write","legacy-after-reverse-export"]) assert.ok(ids.includes(id),`Legacy catalog is missing ${id}`);
 output.legacyTaskIdsAfterWrite=ids;
 assert.equal(output.legacyWrite.exit,0,output.legacyWrite.stderr);
 assert.equal(output.currentWriteOnLegacy.exit,1);
 assert.equal(JSON.parse(output.currentWriteOnLegacy.stdout).error.code,"E_STORAGE_MIGRATION_REQUIRED");
 assert.equal(output.currentWriteOnLegacy.nativeDatabaseAllocated,false);
 for(const result of output.commands) assert.equal(result.exit,0,result.stdout||result.stderr);
 assert.equal(JSON.parse(output.commands[2].stdout).status,"VALID");
 assert.equal(db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE task_id=?").get("legacy-after-reverse-export").n,0);
 if (attachment) {
  for (const root of [target,exported,retained]) {
   await verifyAttachmentFile(root,attachment);
   assert.deepEqual(await readFile(path.join(root,attachment.path)),attachmentBytes);
  }
  output.attachmentPreservation={reference:attachment,exportIndexMatched:true,exportedActiveAndRetainedBytesMatched:true,checkedAfterLegacyWrite:true,legacyAttachmentApiVerified:false,reimportAfterLegacyWriteVerified:false};
 }
 output.sourceFingerprintBefore=before;output.sourceFingerprintAfter=canonicalFingerprint(logicalSnapshot(db));assert.equal(output.sourceFingerprintAfter,before);
 output.nativeWriteRetained=output.commands[0].exit===0&&output.commands[0].stdout.includes("native-reverse-export-write");
 if (reimportOption === "true") {
  db.close();db=null;
  const migration=await migrateProjectStorage(target,{destination:"reverse-export-reimport-retained",writersQuiesced:true});
  assert.equal(migration.currentStateVerified,true);
  const validation=await executeForgeLoopCommand({command:"validate-protocol",projectPath:target,input:{taskId:TEST_TASK_ID}});
  assert.equal(validation.result.status,"VALID");
  const reimported=openStorageDatabase(path.join(target,".forgeloop/state.sqlite"),{readOnly:true});
  try {
   for(const id of ids) assert.equal(reimported.prepare("SELECT COUNT(*) AS n FROM tasks WHERE task_id=?").get(id).n,1);
   if (attachment) {
    assert.deepEqual([...iterateAttachmentReferences(reimported)],[attachment]);
    await verifyAttachmentFile(target,attachment);
    assert.deepEqual(await readFile(path.join(target,attachment.path)),attachmentBytes);
    output.attachmentPreservation.reimportAfterLegacyWriteVerified=true;
   }
  } finally {reimported.close();}
  output.reimport={migration,validation,legacyCreatedTaskPreserved:true,portableIndexRetained:true};
 }
 console.log(JSON.stringify(output,null,2));
} catch (error) {
 if (reimportOption === "true") {
  const relative=`.forgeloop/task-state/${taskStorageKey(TEST_TASK_ID)}/export-manifest.json`;
  const manifests={};
  for (const kind of ["source","parity-export"]) {
   try {manifests[kind]=JSON.parse(await readFile(path.join(target,"reverse-export-reimport-retained",kind,relative),"utf8"));} catch { /* Preserve primary diagnostic. */ }
  }
  console.error(JSON.stringify({code:error.code,message:error.message,manifests}));
 }
 throw error;
} finally {db?.close();await cleanup();await rm(exported,{recursive:true,force:true,maxRetries:10,retryDelay:100});await rm(retained,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
