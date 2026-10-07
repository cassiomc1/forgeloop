import { removeTempTree } from "./helpers/rm-safe.js";
import assert from "node:assert/strict";
import test from "node:test";
import { cp, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { importProjectState } from "../src/storage/importer.js";
import { registerAttachment } from "../src/storage/attachment-references.js";
import { exportDatabase } from "../src/storage/exporter.js";
import { TEST_TASK_ID } from "./helpers/storage-fixtures.js";
import { buildDiagnosisProject } from "./helpers/storage-fixtures.js";
import { migrateProjectStorage } from "../src/storage/migration.js";
import { prepareMigrationSourceRollback, verifyPreparedMigrationSourceRollback } from "../src/storage/migration-rollback-preparation.js";
import { withStorageMaintenance } from "../src/storage/maintenance.js";
import { executeForgeLoopCommand } from "../src/core/command-runtime.js";
for(const mode of ["ready","backup-tamper","owner-tamper","new-native-task","attachments"]) {
 test(`rollback native retention validates ${mode} without switching active authority`,async()=>{
  const target=await buildDiagnosisProject({legacy:true});
  let reference;
  const bytes=Buffer.from([0,255,128,13,10]);
  try {
   if(mode === "attachments") {
    const {db}=await importProjectState(target,path.join(target,"preparation-fixture.sqlite"));
    try {
     reference=await registerAttachment(db,target,{taskId:TEST_TASK_ID,referenceId:"retained-binary",readable:Readable.from([bytes])});
     await exportDatabase(db,path.join(target,"portable-source"),{attachmentRoot:target});
    } finally {db.close();}
    await cp(path.join(target,"portable-source/export-index.json"),path.join(target,"export-index.json"));
   }
   await migrateProjectStorage(target,{destination:"retained",writersQuiesced:true});
   if(mode === "new-native-task") assert.equal((await executeForgeLoopCommand({command:"task-create",projectPath:target,input:{taskId:"accepted-new-task",claims:[]}})).ok,true);
   const before=await readFile(path.join(target,".forgeloop/state.sqlite"));
   await withStorageMaintenance(target,async()=>{
    const options={writersQuiesced:true};
    if(mode === "new-native-task") {
     await assert.rejects(prepareMigrationSourceRollback(target,"retained",options),{code:"E_STORAGE_SOURCE_ROLLBACK_INVALID"});
     await assert.rejects(stat(path.join(target,"retained/publication/source-rollback")),{code:"ENOENT"});return;
    }
    const prepared=await prepareMigrationSourceRollback(target,"retained",options);
    if(reference) assert.deepEqual(await readFile(path.join(prepared.root,"native-backup",reference.path)),bytes);
    assert.equal(prepared.journal.phase,"READY");assert.equal(prepared.restored,false);assert.equal(prepared.nativeAuthorityRetained,true);
    if(mode === "backup-tamper") {
     await writeFile(path.join(prepared.root,"native-backup/state.sqlite"),"corrupt");
     await assert.rejects(verifyPreparedMigrationSourceRollback(target,"retained",options),{code:"E_STORAGE_BACKUP_INVALID"});
    } else if(mode === "owner-tamper") {
     await writeFile(path.join(prepared.root,"rollback-journal.json"),JSON.stringify({...prepared.journal,ownerId:"00000000-0000-0000-0000-000000000000"}));
     await assert.rejects(verifyPreparedMigrationSourceRollback(target,"retained",options),{code:"E_STORAGE_SOURCE_ROLLBACK_INVALID"});
    }
   });
   assert.deepEqual(await readFile(path.join(target,".forgeloop/state.sqlite")),before);
   if(reference) assert.deepEqual(await readFile(path.join(target,reference.path)),bytes);
   if(mode !== "new-native-task") {
    await assert.rejects(verifyPreparedMigrationSourceRollback(target,"retained",{writersQuiesced:true}),{code:"E_STORAGE_MAINTENANCE_IN_PROGRESS"});
    assert.equal((await executeForgeLoopCommand({command:"task-list",projectPath:target,input:{}})).ok,false);
   }
  } finally {await removeTempTree(target);}
 });
}
