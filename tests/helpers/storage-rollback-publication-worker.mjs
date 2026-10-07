import { readFile, writeFile, rename, mkdir, lstat } from "node:fs/promises";
import path from "node:path";
import { migrateProjectStorage } from "../../src/storage/migration.js";
import { withStorageMaintenance } from "../../src/storage/maintenance.js";
import { prepareMigrationSourceRollback } from "../../src/storage/migration-rollback-preparation.js";
import { stageMigrationSourceRollback } from "../../src/storage/migration-rollback-source-stage.js";
import { publishMigrationSourceRollback } from "../../src/storage/migration-rollback-publication.js";
import { LEGACY_SOURCE_ROOTS } from "../../src/storage/migration-source.js";
import { addLegacyBinaryAttachment } from "./storage-binary-source-fixture.js";
const [target,phase,binary]=process.argv.slice(2);
const reference=binary === "binary" ? await addLegacyBinaryAttachment(target,"recovery-binary") : null;
async function move(root,destination,relative){
 const source=path.join(root,relative);
 try{await lstat(source);}catch(error){if(error.code === "ENOENT")return;throw error;}
 const filename=path.join(destination,relative);await mkdir(path.dirname(filename),{recursive:true});await rename(source,filename);
}
await migrateProjectStorage(target,{destination:"retained",writersQuiesced:true});
await withStorageMaintenance(target,async()=>{
 const options={writersQuiesced:true};
 await prepareMigrationSourceRollback(target,"retained",options);
 const staged=await stageMigrationSourceRollback(target,"retained",options);
 const published=await publishMigrationSourceRollback(target,"retained",{...options,nativeWritesExcluded:true});
 // Construct persisted interruption boundaries, then kill the actual live owner in the parent.
 if(phase !== "RESTORED"){
  for(const relative of LEGACY_SOURCE_ROOTS){
   if(phase === "PARTIAL_SOURCE" && relative === ".forgeloop/task-state")continue;
   await move(target,staged.source,relative);
  }
 }
 if(["SWITCHING","DATABASE_RETAINED"].includes(phase)){
  for(const relative of [".forgeloop/state.sqlite",".forgeloop/storage-version.json",".forgeloop/attachments"]){
   if(phase === "DATABASE_RETAINED" && relative === ".forgeloop/state.sqlite")continue;
   await move(published.native,target,relative);
  }
 }
 const filename=path.join(published.root,"publication-journal.json");
 const journal=JSON.parse(await readFile(filename));journal.phase=["SWITCHING","DATABASE_RETAINED"].includes(phase)?"SWITCHING":phase === "RESTORED"?"RESTORED":"NATIVE_RETAINED";
 await writeFile(filename,JSON.stringify(journal));
 process.send({ownerId:journal.ownerId,root:published.root,native:published.native,source:staged.source,reference});
 await new Promise(()=>setInterval(()=>{},1000));
},{retainOnError:true});
