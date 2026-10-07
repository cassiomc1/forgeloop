import assert from "node:assert/strict";
import test from "node:test";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { taskStorageKey } from "../src/core/task-identity.js";
import { TEST_TASK_ID } from "./helpers/storage-fixtures.js";
import { Readable } from "node:stream";
import { buildDiagnosisProject } from "./helpers/storage-fixtures.js";
import { migrateProjectStorage } from "../src/storage/migration.js";
import { verifyMigrationSourceRollbackAdmission } from "../src/storage/migration-rollback-admission.js";
import { withStorageMaintenance } from "../src/storage/maintenance.js";
import { openStorageDatabase } from "../src/storage/connection.js";
import { executeForgeLoopCommand } from "../src/core/command-runtime.js";
import { publishAttachmentFile } from "../src/storage/attachment-files.js";
for (const mode of ["unchanged","new-task","orphan-bytes","altered-source","retained-reader"]) {
 test(`source rollback admission ${mode} preserves existing authority`,async()=>{
  const target=await buildDiagnosisProject({legacy:true});
  let reader;
  try {
   await migrateProjectStorage(target,{destination:"retained",writersQuiesced:true});
   if (mode === "new-task") {
    const written=await executeForgeLoopCommand({command:"task-create",projectPath:target,input:{taskId:"accepted-new-task",claims:[]}});
    assert.equal(written.ok,true,JSON.stringify(written));
   }
   let orphan;
   if (mode === "orphan-bytes") orphan=await publishAttachmentFile(target,Readable.from([Buffer.from([0,255,13,10])]));
   if (mode === "altered-source") await writeFile(path.join(target,"retained/source/.forgeloop/task-state",taskStorageKey(TEST_TASK_ID),"task.json"),"{}");
   if (mode === "retained-reader") {
    reader=openStorageDatabase(path.join(target,".forgeloop/state.sqlite"),{readOnly:true});
    reader.prepare("SELECT COUNT(*) FROM tasks").get();
   }
   const before=await readFile(path.join(target,".forgeloop/state.sqlite"));
   await assert.rejects(verifyMigrationSourceRollbackAdmission(target,"retained",{writersQuiesced:true}),{code:"E_STORAGE_MAINTENANCE_IN_PROGRESS"});
   const verify=()=>withStorageMaintenance(target,()=>verifyMigrationSourceRollbackAdmission(target,"retained",{writersQuiesced:true}));
   if (mode === "unchanged") {
    const result=await verify();assert.equal(result.unchangedCanonicalSnapshot,true);assert.equal(result.restored,false);assert.equal(result.historicalWritesExcluded,false);
    await assert.rejects(withStorageMaintenance(target,()=>verifyMigrationSourceRollbackAdmission(target,"retained")),{code:"E_STORAGE_SOURCE_ROLLBACK_INVALID"});
   } else await assert.rejects(verify,["new-task","retained-reader"].includes(mode) ? {code:"E_STORAGE_SOURCE_ROLLBACK_INVALID"} : {code:mode === "altered-source" ? "E_STORAGE_MIGRATION_CAPTURE_INVALID" : "E_STORAGE_MIGRATION_ARCHIVE_INVALID"});
   assert.deepEqual(await readFile(path.join(target,".forgeloop/state.sqlite")),before);
   if (orphan) assert.deepEqual(await readFile(path.join(target,orphan.path)),Buffer.from([0,255,13,10]));
   assert.equal((await executeForgeLoopCommand({command:"task-list",projectPath:target,input:{}})).ok,true);
  } finally {reader?.close();await rm(target,{recursive:true,force:true});}
 });
}

test("source rollback admission refuses an independent busy writer without changing authority",{timeout:60000},async()=>{
 const { fork }=await import("node:child_process");
 const { once }=await import("node:events");
 const target=await buildDiagnosisProject({legacy:true});
 let worker;
 try {
  await migrateProjectStorage(target,{destination:"retained",writersQuiesced:true});
  const filename=path.join(target,".forgeloop/state.sqlite");
  const before=await readFile(filename);
  worker=fork(new URL("./helpers/storage-rollback-busy-worker.mjs",import.meta.url),[filename],{silent:true});
  let errors="";worker.stderr.on("data",bytes=>{errors+=bytes;});
  const ready=await Promise.race([once(worker,"message"),once(worker,"exit").then(()=>{throw new Error(errors);})]);
  assert.equal(ready[0].writerHeld,true);
  await assert.rejects(withStorageMaintenance(target,()=>verifyMigrationSourceRollbackAdmission(target,"retained",{writersQuiesced:true})),error=>error.code === "E_STORAGE_SOURCE_ROLLBACK_INVALID" && /Busy SQLite checkpoint/.test(error.message));
  assert.deepEqual(await readFile(filename),before);
  const exited=once(worker,"exit");worker.kill("SIGKILL");await exited;
  const recovered=await withStorageMaintenance(target,()=>verifyMigrationSourceRollbackAdmission(target,"retained",{writersQuiesced:true}));
  assert.equal(recovered.unchangedCanonicalSnapshot,true);
 } finally {
  if (worker && worker.exitCode === null && worker.signalCode === null) {const exited=once(worker,"exit");worker.kill("SIGKILL");await exited;}
  await rm(target,{recursive:true,force:true});
 }
});
