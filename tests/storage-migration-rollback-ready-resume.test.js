import assert from "node:assert/strict";
import test from "node:test";
import { fork } from "node:child_process";
import { once } from "node:events";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildDiagnosisProject } from "./helpers/storage-fixtures.js";
import { resumePreparedMigrationSourceRollback } from "../src/storage/migration-rollback-preparation.js";
import { executeForgeLoopCommand } from "../src/core/command-runtime.js";
for(const mode of ["ready","backup-tamper","owner-tamper","preparing-ready","preparing-partial","preparing-missing"]) test(`dead rollback preparation owner ${mode} resumes only verified native retention`,{timeout:60000},async()=>{
 const target=await buildDiagnosisProject({legacy:true});let worker;
 try {
  worker=fork(new URL("./helpers/storage-rollback-ready-worker.mjs",import.meta.url),[target,mode],{silent:true});
  let errors="";worker.stderr.on("data",b=>{errors+=b;});
  const [ready]=await Promise.race([once(worker,"message"),once(worker,"exit").then(()=>{throw new Error(errors);})]);
  const options={expectedOwnerId:ready.ownerId,writersQuiesced:true};
  await assert.rejects(resumePreparedMigrationSourceRollback(target,"retained",options),/still present/);
  const native=await readFile(path.join(target,".forgeloop/state.sqlite"));
  const backup=mode === "preparing-missing" ? null : await readFile(path.join(ready.root,"native-backup/state.sqlite"));
  const exited=once(worker,"exit");worker.kill("SIGKILL");await exited;
  if(mode === "backup-tamper") await writeFile(path.join(ready.root,"native-backup/state.sqlite"),"corrupt");
  if(mode === "owner-tamper") {
   const filename=path.join(ready.root,"rollback-journal.json");const journal=JSON.parse(await readFile(filename));
   await writeFile(filename,JSON.stringify({...journal,ownerId:"00000000-0000-0000-0000-000000000000"}));
  }
  if(mode === "ready" || mode.startsWith("preparing")) {
   const result=await resumePreparedMigrationSourceRollback(target,"retained",options);
   assert.notEqual(result.journal.ownerId,ready.ownerId);assert.equal(result.journal.previousOwnerId,ready.ownerId);
   assert.equal(result.restored,false);assert.equal(result.journal.phase,"READY");
   if(backup) assert.deepEqual(await readFile(path.join(ready.root,"native-backup/state.sqlite")),backup);
   if(mode === "preparing-partial") {
    assert.match(result.journal.nativeBackupDirectory,/^native-backup-/);
    assert.notDeepEqual(await readFile(path.join(ready.root,result.journal.nativeBackupDirectory,"state.sqlite")),backup);
   }
  } else await assert.rejects(resumePreparedMigrationSourceRollback(target,"retained",options),{code:mode === "backup-tamper" ? "E_STORAGE_BACKUP_INVALID" : "E_STORAGE_MAINTENANCE_IN_PROGRESS"});
  assert.deepEqual(await readFile(path.join(target,".forgeloop/state.sqlite")),native);
  assert.equal((await executeForgeLoopCommand({command:"task-list",projectPath:target,input:{}})).ok,false);
 } finally {
  if(worker && worker.exitCode === null && worker.signalCode === null){const exited=once(worker,"exit");worker.kill("SIGKILL");await exited;}
  await rm(target,{recursive:true,force:true});
 }
});
