import { readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { migrateProjectStorage } from "../../src/storage/migration.js";
import { withStorageMaintenance } from "../../src/storage/maintenance.js";
import { prepareMigrationSourceRollback } from "../../src/storage/migration-rollback-preparation.js";
const target=process.argv[2];
await migrateProjectStorage(target,{destination:"retained",writersQuiesced:true});
await withStorageMaintenance(target,async()=>{
 const prepared=await prepareMigrationSourceRollback(target,"retained",{writersQuiesced:true});
 const mode=process.argv[3];
 if (mode?.startsWith("preparing")) {
  const filename=path.join(prepared.root,"rollback-journal.json");
  const journal=JSON.parse(await readFile(filename));journal.phase="PREPARING";delete journal.nativeBackupFingerprint;
  await writeFile(filename,JSON.stringify(journal));
  if(mode === "preparing-partial") {
   await writeFile(path.join(prepared.root,"native-backup/state.sqlite"),"retained incomplete database bytes");
   await writeFile(path.join(prepared.root,"native-backup/backup-manifest.json"),JSON.stringify({schemaVersion:1,kind:"SQLITE_WITH_REFERENCED_ATTACHMENTS",status:"PREPARING"}));
  }
  if(mode === "preparing-missing") await rm(path.join(prepared.root,"native-backup"),{recursive:true});
 }
 process.send({ownerId:prepared.journal.ownerId,root:prepared.root});
 await new Promise(()=>setInterval(()=>{},1000));
},{retainOnError:true});
