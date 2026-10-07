/** Disposable offline pre-write source rollback drill; no user conversion target. */
import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import { buildCanonicalDiagnosisProject } from "../tests/helpers/canonical-diagnosis-fixture.js";
import { TEST_TASK_ID } from "../tests/helpers/storage-fixtures.js";
import { openStorageDatabase } from "../src/storage/connection.js";
import { exportDatabase } from "../src/storage/exporter.js";
import { logicalSnapshot } from "../src/storage/migration-candidate.js";
import { canonicalFingerprint } from "../src/core/artifacts.js";
import { migrateProjectStorage } from "../src/storage/migration.js";
import { executeForgeLoopCommand } from "../src/core/command-runtime.js";
import { withStorageMaintenance } from "../src/storage/maintenance.js";
import { prepareMigrationSourceRollback } from "../src/storage/migration-rollback-preparation.js";
import { stageMigrationSourceRollback } from "../src/storage/migration-rollback-source-stage.js";
import { rollbackProjectStorage } from "../src/storage/migration-rollback.js";
import { publishMigrationSourceRollback } from "../src/storage/migration-rollback-publication.js";
const publicationOption=process.argv.find(value=>value.startsWith("--publication="))?.slice("--publication=".length) ?? "false";
assert.ok(["true","false"].includes(publicationOption));
const publication=publicationOption === "true";
const operatorOption=process.argv.find(value=>value.startsWith("--operator="))?.slice("--operator=".length) ?? "false";
assert.ok(["true","false"].includes(operatorOption));
const operator=operatorOption === "true";assert.ok(!operator || publication);
const cliOption=process.argv.find(value=>value.startsWith("--operator-cli="))?.slice("--operator-cli=".length) ?? "false";
assert.ok(["true","false"].includes(cliOption));const operatorCli=cliOption === "true";assert.ok(!operatorCli || operator);
function invokeRollbackCli(){return spawnSync(process.execPath,["src/cli.js","storage-rollback","--path",target,"--destination","rollback-migration-retained","--legacy-root",legacy,"--writers-quiesced","--native-writes-excluded","--json"],{encoding:"utf8",timeout:120000});}
const argument=process.argv.find(value=>value.startsWith("--legacy-root="))?.slice("--legacy-root=".length);
assert.ok(argument,"Provide a clean pinned legacy checkout with --legacy-root");
const legacy=path.resolve(argument);
function requireUnchangedNativeSnapshot(current, retained) {
 if (current !== retained) throw Object.assign(new Error("Accepted native changes forbid source rollback"), {code:"E_SOURCE_ROLLBACK_NATIVE_CHANGED"});
}
assert.equal(execFileSync("git",["-C",legacy,"rev-parse","HEAD"],{encoding:"utf8"}).trim(),"ee9ce11123d4e728d3dbc92f5d62d4bf41bb79c5");
assert.equal(execFileSync("git",["-C",legacy,"status","--porcelain","--untracked-files=no"],{encoding:"utf8"}).trim(),"");
const postwriteOption=process.argv.find(value=>value.startsWith("--postwrite-control="))?.slice("--postwrite-control=".length) ?? "false";
assert.ok(["true","false"].includes(postwriteOption));
const postwrite=postwriteOption === "true";
const {target,cleanup}=await buildCanonicalDiagnosisProject({taskId:TEST_TASK_ID,git:true,linkedWorktree:true});
const retained=await mkdtemp(path.join(os.tmpdir(),"forgeloop-prewrite-rollback-retained-"));
let db;
const runLegacy=()=>{
 const result=spawnSync(process.execPath,[path.join(legacy,"src/cli.js"),"validate-protocol","--path",target,"--task",TEST_TASK_ID,"--json"],{encoding:"utf8",timeout:60000});
 assert.equal(result.status,0,result.stdout||result.stderr);
 assert.equal(JSON.parse(result.stdout).status,"VALID");
 return {exit:result.status,stdout:result.stdout,stderr:result.stderr};
};
try {
 db=openStorageDatabase(path.join(target,".forgeloop/state.sqlite"),{readOnly:true});
 await exportDatabase(db,path.join(retained,"source"),{attachmentRoot:target});
 db.close();db=null;
 await rename(path.join(target,".forgeloop"),path.join(retained,"seed-native"));
 await cp(path.join(retained,"source/.forgeloop"),path.join(target,".forgeloop"),{recursive:true});
 const before=runLegacy();
 const migrated=await migrateProjectStorage(target,{destination:"rollback-migration-retained",writersQuiesced:true});
 assert.equal(migrated.currentStateVerified,true);
 const nativeValidation=await executeForgeLoopCommand({command:"validate-protocol",projectPath:target,input:{taskId:TEST_TASK_ID}});
 assert.equal(nativeValidation.result.status,"VALID");
 if (postwrite) {
  const written=await executeForgeLoopCommand({command:"task-create",projectPath:target,input:{taskId:"rollback-must-refuse-new-work",claims:[]}});
  assert.equal(written.ok,true,JSON.stringify(written));
 }
 const stagedPath=path.join(target,"rollback-migration-retained/publication/bundle/state.sqlite");
 db=openStorageDatabase(migrated.path,{readOnly:true});
 const original=openStorageDatabase(stagedPath,{readOnly:true});
 let fingerprint;
 try {
  fingerprint=canonicalFingerprint(logicalSnapshot(db));
  const retainedFingerprint=canonicalFingerprint(logicalSnapshot(original));
  if (postwrite) assert.throws(()=>requireUnchangedNativeSnapshot(fingerprint,retainedFingerprint),{code:"E_SOURCE_ROLLBACK_NATIVE_CHANGED"});
  else requireUnchangedNativeSnapshot(fingerprint,retainedFingerprint);
 } finally {original.close();db.close();db=null;}
 if (postwrite) {
  if(operatorCli){const refused=invokeRollbackCli();assert.notEqual(refused.status,0);assert.match(refused.stdout+refused.stderr,/Accepted native changes/);}
 else if(operator) await assert.rejects(rollbackProjectStorage(target,{destination:"rollback-migration-retained",legacyRoot:legacy,writersQuiesced:true,nativeWritesExcluded:true}),{code:"E_STORAGE_SOURCE_ROLLBACK_INVALID"});
 else if(publication) await withStorageMaintenance(target,async()=>{
   await assert.rejects(prepareMigrationSourceRollback(target,"rollback-migration-retained",{writersQuiesced:true}),{code:"E_STORAGE_SOURCE_ROLLBACK_INVALID"});
  });
  db=openStorageDatabase(migrated.path,{readOnly:true});
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE task_id=?").get("rollback-must-refuse-new-work").n,1);
  console.log(JSON.stringify({scope:"Disposable post-write negative control",sourceRestorationRefused:true,productionAdmissionRefusal:publication,restored:false,newNativeTaskPreserved:true,nativeValidation,migrated},null,2));
 } else {
 let published;
 if(operator){
  if(operatorCli){const executed=invokeRollbackCli();assert.equal(executed.status,0,executed.stdout||executed.stderr);published=JSON.parse(executed.stdout);}
  else published=await rollbackProjectStorage(target,{destination:"rollback-migration-retained",legacyRoot:legacy,writersQuiesced:true,nativeWritesExcluded:true});
  assert.equal(published.targetVersionValidated,true);
  assert.equal(published.validation.status,"VALID");
  const {stat}=await import("node:fs/promises");
  await assert.rejects(stat(path.join(target,".forgeloop/.storage-maintenance")),{code:"ENOENT"});
 } else if(publication) {
  published=await withStorageMaintenance(target,async()=>{
   const options={writersQuiesced:true};
   await prepareMigrationSourceRollback(target,"rollback-migration-retained",options);
   await stageMigrationSourceRollback(target,"rollback-migration-retained",options);
   return publishMigrationSourceRollback(target,"rollback-migration-retained",{...options,nativeWritesExcluded:true});
  });
 } else {
 // Fixture-only offline switch: no writer is launched between migration and this point.
 await rename(path.join(target,".forgeloop"),path.join(retained,"migrated-native"));
 await cp(path.join(retained,"source/.forgeloop"),path.join(target,".forgeloop"),{recursive:true});
 }
 const after=runLegacy();
 db=openStorageDatabase(publication ? path.join(published.native,".forgeloop/state.sqlite") : path.join(retained,"migrated-native/state.sqlite"),{readOnly:true});
 assert.equal(canonicalFingerprint(logicalSnapshot(db)),fingerprint);
 const manifest=JSON.parse(await readFile(path.join(target,"rollback-migration-retained/source-manifest.json"),"utf8"));
 console.log(JSON.stringify({scope:publication ? "Owned linked-worktree conditional pre-write source publication with exact-target legacy validation; no public command or interrupted recovery claim" : "Disposable linked-worktree pre-write offline source restoration; no production rollback command or post-write rollback claim",operator,operatorCli,publication:published,before,migrated,nativeValidation,after,nativeSnapshotUnchanged:true,retainedNativeLayout:true,preservedSourceRetained:true,sourceManifestPresent:Boolean(manifest),fingerprint},null,2));
 }
} finally {db?.close();await cleanup();await rm(retained,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
