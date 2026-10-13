import { removeTempTree } from "./helpers/rm-safe.js";
import assert from "node:assert/strict";
import test from "node:test";
import { fork } from "node:child_process";
import { once } from "node:events";
import { cp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildDiagnosisProject, TEST_TASK_ID } from "./helpers/storage-fixtures.js";
import { taskStorageKey } from "../src/core/task-identity.js";
import { resumeMigrationSourceRollbackPublication } from "../src/storage/migration-rollback-publication.js";
import { BINARY_SOURCE_BYTES } from "./helpers/storage-binary-source-fixture.js";
for(const mode of ["SWITCHING","DATABASE_RETAINED","NATIVE_RETAINED","PARTIAL_SOURCE","RESTORED","BINARY_PARTIAL_SOURCE","duplicate-native","corrupt-source","substituted-owner"])test(`dead source publication owner ${mode} resumes only verified locations`,{timeout:60000},async()=>{
 const target=await buildDiagnosisProject({legacy:true});let worker;
 try{
  worker=fork(new URL("./helpers/storage-rollback-publication-worker.mjs",import.meta.url),[target,mode === "BINARY_PARTIAL_SOURCE" ? "PARTIAL_SOURCE" : mode.includes("-")?"NATIVE_RETAINED":mode,mode === "BINARY_PARTIAL_SOURCE" ? "binary" : "none"],{silent:true});
  let errors="";worker.stderr.on("data",b=>{errors+=b;});
  const [ready]=await Promise.race([once(worker,"message"),once(worker,"exit").then(()=>{throw new Error(errors);})]);
  const options={expectedOwnerId:ready.ownerId,writersQuiesced:true,nativeWritesExcluded:true};
  await assert.rejects(resumeMigrationSourceRollbackPublication(target,"retained",options),/still present/);
  const databaseRoot=mode === "SWITCHING"?target:ready.native;
  const native=await readFile(path.join(databaseRoot,".forgeloop/state.sqlite"));
  const exited=once(worker,"exit");worker.kill("SIGKILL");await exited;
  if(mode === "duplicate-native")await cp(path.join(ready.native,".forgeloop/state.sqlite"),path.join(target,".forgeloop/state.sqlite"));
  if(mode === "corrupt-source")await writeFile(path.join(ready.source,`.forgeloop/task-state/${taskStorageKey(TEST_TASK_ID)}/task.json`),"corrupt");
  if(mode === "substituted-owner"){
   const filename=path.join(ready.root,"publication-journal.json");const journal=JSON.parse(await readFile(filename));
   await writeFile(filename,JSON.stringify({...journal,ownerId:"00000000-0000-0000-0000-000000000000"}));
  }
  if(mode.includes("-")){
   const journalBefore=await readFile(path.join(ready.root,"publication-journal.json"));
   const relative=`.forgeloop/task-state/${taskStorageKey(TEST_TASK_ID)}/task.json`;
   const stagedBefore=await readFile(path.join(ready.source,relative));
   await assert.rejects(resumeMigrationSourceRollbackPublication(target,"retained",options));
   assert.deepEqual(await readFile(path.join(ready.root,"publication-journal.json")),journalBefore);
   assert.deepEqual(await readFile(path.join(ready.source,relative)),stagedBefore);
   await assert.rejects(readFile(path.join(target,relative)),{code:"ENOENT"});
   assert.deepEqual(await readFile(path.join(ready.native,".forgeloop/state.sqlite")),native);
  }
  else{
   const result=await resumeMigrationSourceRollbackPublication(target,"retained",options);
   assert.equal(result.restored,true);assert.equal(result.journal.phase,"RESTORED");assert.notEqual(result.journal.ownerId,ready.ownerId);
   assert.deepEqual(await readFile(path.join(result.native,".forgeloop/state.sqlite")),native);
   if(ready.reference){
    for(const root of [target,result.native,path.join(target,"retained/source"),path.join(path.dirname(ready.root),"native-backup")])assert.deepEqual(await readFile(path.join(root,ready.reference.path)),Buffer.from(BINARY_SOURCE_BYTES));
    const catalog=JSON.parse(await readFile(path.join(target,"export-index.json")));
    assert.ok(catalog.attachments.some(item=>item.referenceId === ready.reference.referenceId && item.sha256 === ready.reference.sha256));
   }
   const relative=`.forgeloop/task-state/${taskStorageKey(TEST_TASK_ID)}/task.json`;
   assert.deepEqual(await readFile(path.join(target,relative)),await readFile(path.join(target,"retained/source",relative)));
  }
 }finally{
  if(worker && worker.exitCode === null && worker.signalCode === null){const exited=once(worker,"exit");worker.kill("SIGKILL");await exited;}
  await removeTempTree(target);
 }
});
