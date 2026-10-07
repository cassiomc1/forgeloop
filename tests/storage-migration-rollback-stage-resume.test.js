import assert from "node:assert/strict";
import test from "node:test";
import { fork } from "node:child_process";
import { once } from "node:events";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildDiagnosisProject } from "./helpers/storage-fixtures.js";
import { resumeMigrationSourceRollbackStage } from "../src/storage/migration-rollback-source-stage.js";
import { BINARY_SOURCE_BYTES } from "./helpers/storage-binary-source-fixture.js";
for(const mode of ["READY","PREPARING_COMPLETE","PREPARING_PARTIAL","PREPARING_MISSING","PREPARING_BINARY","READY_TAMPER","UNRECORDED","OWNER_TAMPER"])test(`dead rollback source stage ${mode} recovers only bound bytes`,{timeout:60000},async()=>{
 const target=await buildDiagnosisProject({legacy:true});let worker;
 try{
  worker=fork(new URL("./helpers/storage-rollback-stage-worker.mjs",import.meta.url),[target,mode],{silent:true});
  let errors="";worker.stderr.on("data",b=>{errors+=b;});
  const [ready]=await Promise.race([once(worker,"message"),once(worker,"exit").then(()=>{throw new Error(errors);})]);
  const options={expectedOwnerId:ready.ownerId,writersQuiesced:true};
  await assert.rejects(resumeMigrationSourceRollbackStage(target,"retained",options),/still present/);
  const native=await readFile(path.join(target,".forgeloop/state.sqlite"));
  const partial=mode === "PREPARING_PARTIAL" ? await readFile(path.join(ready.source,ready.relative)) : ready.reference ? await readFile(path.join(ready.source,ready.reference.path)) : null;
  const exited=once(worker,"exit");worker.kill("SIGKILL");await exited;
  if(mode === "READY_TAMPER")await writeFile(path.join(ready.source,ready.relative),"corrupt completed stage");
  if(mode === "UNRECORDED")await writeFile(path.join(ready.source,".forgeloop/task-state/unrecorded"),"unrecorded bytes");
  if(mode === "OWNER_TAMPER"){
   const filename=path.join(ready.root,"source-stage.json");const manifest=JSON.parse(await readFile(filename));
   await writeFile(filename,JSON.stringify({...manifest,ownerId:"00000000-0000-0000-0000-000000000000"}));
  }
  const negative=["READY_TAMPER","UNRECORDED","OWNER_TAMPER"].includes(mode);
  if(negative){
   const before=await readFile(path.join(ready.root,"source-stage.json"));
   const preparation=await readFile(path.join(path.dirname(ready.root),"rollback-journal.json"));
   await assert.rejects(resumeMigrationSourceRollbackStage(target,"retained",options));
   assert.deepEqual(await readFile(path.join(ready.root,"source-stage.json")),before);
   assert.deepEqual(await readFile(path.join(path.dirname(ready.root),"rollback-journal.json")),preparation);
  }else{
   const result=await resumeMigrationSourceRollbackStage(target,"retained",options);
   assert.equal(result.manifest.phase,"READY");assert.notEqual(result.manifest.ownerId,ready.ownerId);assert.equal(result.restored,false);
   assert.deepEqual(await readFile(path.join(result.source,ready.relative)),await readFile(path.join(target,"retained/source",ready.relative)));
   if(partial){
    const relative=ready.reference?.path ?? ready.relative;
    assert.deepEqual(await readFile(path.join(result.root,"recovery-history",result.manifest.retainedAttempt,"source",relative)),partial);
   }
   if(ready.reference)assert.deepEqual(await readFile(path.join(result.source,ready.reference.path)),Buffer.from(BINARY_SOURCE_BYTES));
  }
  assert.deepEqual(await readFile(path.join(target,".forgeloop/state.sqlite")),native);
 }finally{
  if(worker && worker.exitCode === null && worker.signalCode === null){const exited=once(worker,"exit");worker.kill("SIGKILL");await exited;}
  await rm(target,{recursive:true,force:true});
 }
});
