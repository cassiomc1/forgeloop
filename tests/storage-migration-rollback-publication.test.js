import assert from "node:assert/strict";
import test from "node:test";
import { readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildDiagnosisProject, TEST_TASK_ID } from "./helpers/storage-fixtures.js";
import { taskStorageKey } from "../src/core/task-identity.js";
import { migrateProjectStorage } from "../src/storage/migration.js";
import { withStorageMaintenance } from "../src/storage/maintenance.js";
import { prepareMigrationSourceRollback, verifyPreparedMigrationSourceRollback } from "../src/storage/migration-rollback-preparation.js";
import { stageMigrationSourceRollback } from "../src/storage/migration-rollback-source-stage.js";
import { publishMigrationSourceRollback, verifyPublishedMigrationSourceRollback } from "../src/storage/migration-rollback-publication.js";
import { addLegacyBinaryAttachment, BINARY_SOURCE_BYTES } from "./helpers/storage-binary-source-fixture.js";
for(const mode of ["restored","source-tamper","native-tamper","binary-attachment"])test(`owned source rollback publication ${mode} preserves native authority`,async()=>{
 const target=await buildDiagnosisProject({legacy:true});
 try{
  const reference=mode === "binary-attachment" ? await addLegacyBinaryAttachment(target,"publication-binary") : null;
  await migrateProjectStorage(target,{destination:"retained",writersQuiesced:true});
  const native=await readFile(path.join(target,".forgeloop/state.sqlite"));
  const marker=await readFile(path.join(target,".forgeloop/storage-version.json"));
  const relative=`.forgeloop/task-state/${taskStorageKey(TEST_TASK_ID)}/task.json`;
  const original=await readFile(path.join(target,"retained/source",relative));
  await withStorageMaintenance(target,async()=>{
   const options={writersQuiesced:true};
   await prepareMigrationSourceRollback(target,"retained",options);
   await stageMigrationSourceRollback(target,"retained",options);
   await assert.rejects(publishMigrationSourceRollback(target,"retained",options),/Exclude all post-migration/);
   assert.deepEqual(await readFile(path.join(target,".forgeloop/state.sqlite")),native);
   const result=await publishMigrationSourceRollback(target,"retained",{...options,nativeWritesExcluded:true});
   assert.equal(result.restored,true);assert.equal(result.targetVersionValidated,false);assert.equal(result.historicalWritesExcluded,false);
   assert.deepEqual(await readFile(path.join(result.native,".forgeloop/state.sqlite")),native);
   assert.deepEqual(await readFile(path.join(result.native,".forgeloop/storage-version.json")),marker);
   assert.deepEqual(await readFile(path.join(target,relative)),original);
   if(reference)for(const root of [target,result.native,path.join(target,"retained/source"),path.join(path.dirname(result.root),"native-backup")])assert.deepEqual(await readFile(path.join(root,reference.path)),Buffer.from(BINARY_SOURCE_BYTES));
   await assert.rejects(stat(path.join(target,".forgeloop/state.sqlite")),{code:"ENOENT"});
   await assert.rejects(verifyPreparedMigrationSourceRollback(target,"retained",options));
   await assert.rejects(stat(path.join(target,".forgeloop/state.sqlite")),{code:"ENOENT"});
   if(mode === "source-tamper")await writeFile(path.join(target,relative),"corrupt");
   if(mode === "native-tamper")await writeFile(path.join(result.native,".forgeloop/state.sqlite"),"corrupt");
   if(mode !== "restored" && mode !== "binary-attachment")await assert.rejects(verifyPublishedMigrationSourceRollback(target,"retained"),{code:"E_STORAGE_SOURCE_ROLLBACK_INVALID"});
   else await verifyPublishedMigrationSourceRollback(target,"retained");
   assert.deepEqual(await readFile(path.join(target,"retained/source",relative)),original);
  });
 }finally{await rm(target,{recursive:true,force:true});}
});
