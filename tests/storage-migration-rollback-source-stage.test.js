import { removeTempTree } from "./helpers/rm-safe.js";
import { Readable } from "node:stream";
import { importProjectState } from "../src/storage/importer.js";
import { registerAttachment } from "../src/storage/attachment-references.js";
import { exportDatabase } from "../src/storage/exporter.js";
import assert from "node:assert/strict";
import test from "node:test";
import { cp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildDiagnosisProject, TEST_TASK_ID } from "./helpers/storage-fixtures.js";
import { taskStorageKey } from "../src/core/task-identity.js";
import { migrateProjectStorage } from "../src/storage/migration.js";
import { withStorageMaintenance } from "../src/storage/maintenance.js";
import { prepareMigrationSourceRollback } from "../src/storage/migration-rollback-preparation.js";
import { stageMigrationSourceRollback, verifyMigrationSourceRollbackStage } from "../src/storage/migration-rollback-source-stage.js";
for(const mode of ["ready","source-tamper","extra-file","binding-tamper","binary-attachment"]) test(`rollback source staging ${mode} retains native authority`,async()=>{
 const target=await buildDiagnosisProject({legacy:true});
 let reference;
 const bytes=Buffer.from([0,255,128,13,10,0,65]);
 try {
  if(mode === "binary-attachment") {
   const {db}=await importProjectState(target,path.join(target,"source-stage-fixture.sqlite"));
   try {
    reference=await registerAttachment(db,target,{taskId:TEST_TASK_ID,referenceId:"source-stage-binary",readable:Readable.from([bytes])});
    await exportDatabase(db,path.join(target,"portable-source"),{attachmentRoot:target});
   } finally {db.close();}
   await cp(path.join(target,"portable-source/export-index.json"),path.join(target,"export-index.json"));
  }
  await migrateProjectStorage(target,{destination:"retained",writersQuiesced:true});
  const native=await readFile(path.join(target,".forgeloop/state.sqlite"));
  await withStorageMaintenance(target,async()=>{
   const options={writersQuiesced:true};
   const prepared=await prepareMigrationSourceRollback(target,"retained",options);
   const staged=await stageMigrationSourceRollback(target,"retained",options);
   assert.equal(staged.manifest.phase,"READY");assert.equal(staged.restored,false);
   if(reference) {
    for(const root of [staged.source,path.join(target,"retained/source"),path.join(prepared.root,"native-backup"),target]) assert.deepEqual(await readFile(path.join(root,reference.path)),bytes);
   }
   const relative=`.forgeloop/task-state/${taskStorageKey(TEST_TASK_ID)}/task.json`;
   const captured=await readFile(path.join(target,"retained/source",relative));
   assert.deepEqual(await readFile(path.join(staged.source,relative)),captured);
   await assert.rejects(stageMigrationSourceRollback(target,"retained",options),{code:"EEXIST"});
   if(mode === "source-tamper") await writeFile(path.join(staged.source,relative),"corrupt");
   if(mode === "extra-file") await writeFile(path.join(staged.source,"unexpected"),"extra");
   if(mode === "binding-tamper") await writeFile(path.join(staged.root,"source-stage.json"),JSON.stringify({...staged.manifest,nativeBackupFingerprint:"0".repeat(64)}));
   if(mode !== "ready" && mode !== "binary-attachment") await assert.rejects(verifyMigrationSourceRollbackStage(target,"retained",options),{code:mode === "extra-file" ? "E_STORAGE_MIGRATION_ARCHIVE_INVALID" : "E_STORAGE_SOURCE_ROLLBACK_INVALID"});
   else await verifyMigrationSourceRollbackStage(target,"retained",options);
   assert.deepEqual(await readFile(path.join(target,"retained/source",relative)),captured);
  });
  assert.deepEqual(await readFile(path.join(target,".forgeloop/state.sqlite")),native);
 } finally {await removeTempTree(target);}
});
