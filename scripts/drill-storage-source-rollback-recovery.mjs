/** Owned canonical linked-worktree recovery drill; the actual maintenance owner is killed. */
import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFileSync, fork, spawnSync } from "node:child_process";
import { once } from "node:events";
import { buildCanonicalDiagnosisProject } from "../tests/helpers/canonical-diagnosis-fixture.js";
import { TEST_TASK_ID } from "../tests/helpers/storage-fixtures.js";
import { openStorageDatabase } from "../src/storage/connection.js";
import { exportDatabase } from "../src/storage/exporter.js";
import { resumeMigrationSourceRollbackPublication } from "../src/storage/migration-rollback-publication.js";
import { resumeProjectStorageRollback } from "../src/storage/migration-rollback.js";
import { BINARY_SOURCE_BYTES } from "../tests/helpers/storage-binary-source-fixture.js";
const argument=name=>process.argv.find(value=>value.startsWith(`--${name}=`))?.slice(name.length+3);
assert.ok(argument("legacy-root"),"Provide a clean pinned legacy checkout");
const legacy=path.resolve(argument("legacy-root"));
assert.equal(execFileSync("git",["-C",legacy,"rev-parse","HEAD"],{encoding:"utf8"}).trim(),"ee9ce11123d4e728d3dbc92f5d62d4bf41bb79c5");
assert.equal(execFileSync("git",["-C",legacy,"status","--porcelain","--untracked-files=no"],{encoding:"utf8"}).trim(),"");
const operatorCli=argument("operator-cli") ?? "false";assert.ok(["true","false"].includes(operatorCli));
const release=argument("release") ?? "false";assert.ok(["true","false"].includes(release));
const phase=argument("phase") ?? "PARTIAL_SOURCE";
assert.ok(["SWITCHING","DATABASE_RETAINED","NATIVE_RETAINED","PARTIAL_SOURCE","RESTORED","STAGE_READY","STAGE_PREPARING_COMPLETE","STAGE_PREPARING_PARTIAL","STAGE_PREPARING_MISSING","STAGE_PREPARING_BINARY","PREP_READY","PREP_PREPARING_COMPLETE","PREP_PREPARING_PARTIAL","PREP_PREPARING_MISSING"].includes(phase));
const binary=argument("binary") ?? "false";assert.ok(["true","false"].includes(binary));
const {target,cleanup}=await buildCanonicalDiagnosisProject({taskId:TEST_TASK_ID,git:true,linkedWorktree:true});
const retained=await mkdtemp(path.join(os.tmpdir(),"forgeloop-canonical-source-recovery-"));
let db,worker;
function validateLegacy(){
 const result=spawnSync(process.execPath,[path.join(legacy,"src/cli.js"),"validate-protocol","--path",target,"--task",TEST_TASK_ID,"--json"],{encoding:"utf8",timeout:60000});
 assert.equal(result.status,0,result.stdout||result.stderr);
 const validation=JSON.parse(result.stdout);assert.equal(validation.status,"VALID");
 return {exit:result.status,validation};
}
try{
 db=openStorageDatabase(path.join(target,".forgeloop/state.sqlite"),{readOnly:true});
 await exportDatabase(db,path.join(retained,"source"),{attachmentRoot:target});db.close();db=null;
 await rename(path.join(target,".forgeloop"),path.join(retained,"seed-native"));
 await cp(path.join(retained,"source/.forgeloop"),path.join(target,".forgeloop"),{recursive:true});
 await cp(path.join(retained,"source/export-index.json"),path.join(target,"export-index.json"));
 const before=validateLegacy();
 const preparationOnly=phase.startsWith("PREP_");
 const prepublication=phase.startsWith("STAGE_") || preparationOnly;
 if(prepublication)assert.equal(operatorCli,"true","Prepublication drill uses the public operator command");
 worker=fork(new URL(preparationOnly ? "../tests/helpers/storage-rollback-ready-worker.mjs" : prepublication ? "../tests/helpers/storage-rollback-stage-worker.mjs" : "../tests/helpers/storage-rollback-publication-worker.mjs",import.meta.url),[target,preparationOnly ? phase.slice(5).toLowerCase().replaceAll("_","-") : prepublication ? phase.slice(6) : phase,binary === "true" ? "binary" : "none"],{silent:true});
 let errors="";worker.stderr.on("data",bytes=>{errors+=bytes;});
 const [ready]=await Promise.race([once(worker,"message"),once(worker,"exit").then(()=>{throw new Error(errors);})]);
 const options={expectedOwnerId:ready.ownerId,writersQuiesced:true,nativeWritesExcluded:true,...(release === "true" ? {legacyRoot:legacy} : {})};
 await assert.rejects((prepublication ? resumeProjectStorageRollback(target,{destination:"retained",...options}) : resumeMigrationSourceRollbackPublication(target,"retained",options)),/still present/);
 const nativeRoot=prepublication || phase === "SWITCHING" ? target : ready.native;
 const native=await readFile(path.join(nativeRoot,".forgeloop/state.sqlite"));
 const exited=once(worker,"exit");worker.kill("SIGKILL");await exited;
 let result;
 if(operatorCli === "true"){
  assert.equal(release,"true");
  const executed=spawnSync(process.execPath,["src/cli.js","storage-rollback-resume","--path",target,"--destination","retained","--legacy-root",legacy,"--expected-owner",ready.ownerId,"--writers-quiesced","--native-writes-excluded","--json"],{encoding:"utf8",timeout:120000});
  assert.equal(executed.status,0,executed.stdout||executed.stderr);result=JSON.parse(executed.stdout);
 }else result=await resumeMigrationSourceRollbackPublication(target,"retained",options);
 assert.equal(result.restored,true);assert.equal(result.journal.phase,"RESTORED");
 assert.deepEqual(await readFile(path.join(result.native,".forgeloop/state.sqlite")),native);
 const after=validateLegacy();
 if(release === "true"){
  assert.equal(result.targetVersionValidated,true);assert.equal(result.validation.status,"VALID");
  await assert.rejects(readFile(path.join(target,".forgeloop/.storage-maintenance/owner.json")),{code:"ENOENT"});
 }
 if(ready.reference){
  for(const root of [target,result.native,path.join(target,"retained/source"),path.join(path.dirname(result.root),"native-backup")])assert.deepEqual(await readFile(path.join(root,ready.reference.path)),Buffer.from(BINARY_SOURCE_BYTES));
  const catalog=JSON.parse(await readFile(path.join(target,"export-index.json")));
  assert.ok(catalog.attachments.some(reference=>reference.referenceId === ready.reference.referenceId && reference.sha256 === ready.reference.sha256));
 }
 console.log(JSON.stringify({scope:"Canonical linked-worktree legacy VALID after actual owner-death source publication recovery; constructed persisted boundaries, not syscall power loss",phase,operatorCli:operatorCli === "true",binary:binary === "true",before,after,restored:true,nativeBytesUnchanged:true,referencePreserved:ready.reference ?? null,maintenanceExclusionRetained:release !== "true",maintenanceReleased:release === "true",targetVersionValidatedInDrill:true},null,2));
}finally{
 db?.close();
 if(worker && worker.exitCode === null && worker.signalCode === null){const exited=once(worker,"exit");worker.kill("SIGKILL");await exited;}
 await cleanup();await rm(retained,{recursive:true,force:true,maxRetries:10,retryDelay:100});
}
