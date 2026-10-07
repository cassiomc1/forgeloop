import { randomUUID } from "node:crypto";
import { cp, lstat, mkdir, open, rename } from "node:fs/promises";
import { assertSafePath, writeFileAtomic } from "../core/filesystem.js";
import { canonicalFingerprint } from "../core/artifacts.js";
import { assertOwnedStorageMaintenance, assertStorageMaintenanceOwnerContinuity, resumeStorageMaintenance, retainStorageMaintenance } from "./maintenance.js";
import { verifyPreparedMigrationSourceRollback, recoverOwnedMigrationSourceRollbackPreparation } from "./migration-rollback-preparation.js";
import { LEGACY_SOURCE_ROOTS, inventoryLegacyArchiveLayout, verifyLegacySourceCapture } from "./migration-source.js";
import { readStorageMetadataJson } from "./metadata-json.js";

function invalid(message) {return Object.assign(new Error(message),{code:"E_STORAGE_SOURCE_ROLLBACK_INVALID"});}
async function verifySourceInventory(source, captured) {
 const inventory=await inventoryLegacyArchiveLayout(source);
 inventory.directories=inventory.directories.filter(name=>LEGACY_SOURCE_ROOTS.some(root=>name === root || name.startsWith(`${root}/`)));
 if (canonicalFingerprint(inventory) !== canonicalFingerprint({files:captured.manifest.files,directories:captured.manifest.directories})) throw invalid("Rollback source stage membership or bytes differ from captured source");
}

/** Build an exclusive publication copy; preserve both source capture and active authority. */
export async function stageMigrationSourceRollback(target,destination,options={}) {
 const prepared=await verifyPreparedMigrationSourceRollback(target,destination,options);
 const captured=await verifyLegacySourceCapture(target,destination);
 const root=await assertSafePath(prepared.root,"source-stage");
 await mkdir(root); // Existing and interrupted stages are retained, never replaced.
 const manifest={schemaVersion:1,kind:"MIGRATION_SOURCE_ROLLBACK_STAGE",phase:"PREPARING",ownerId:prepared.journal.ownerId,
  operationId:prepared.journal.operationId,sourceInventoryFingerprint:prepared.journal.sourceInventoryFingerprint,
  nativeFingerprint:prepared.journal.nativeFingerprint,nativeBackupFingerprint:prepared.journal.nativeBackupFingerprint};
 const filename=await assertSafePath(root,"source-stage.json");
 const persist=()=>writeFileAtomic(filename,`${JSON.stringify(manifest,null,2)}\n`);
 await persist();
 const source=await assertSafePath(root,"source");
 await cp(captured.source,source,{recursive:true,errorOnExist:true,force:false});
 await verifySourceInventory(source,captured);
 await verifyPreparedMigrationSourceRollback(target,destination,options);
 await assertOwnedStorageMaintenance(target);
 manifest.phase="READY";await persist();
 return verifyMigrationSourceRollbackStage(target,destination,options);
}

/** A READY stage must still match captured bytes and the live prepared native authority. */
export async function verifyMigrationSourceRollbackStage(target,destination,options={}) {
 const prepared=await verifyPreparedMigrationSourceRollback(target,destination,options);
 const root=await assertSafePath(prepared.root,"source-stage");
 const manifest=await readStorageMetadataJson(root,"source-stage.json");
 if (!manifest || manifest.schemaVersion !== 1 || manifest.kind !== "MIGRATION_SOURCE_ROLLBACK_STAGE" || manifest.phase !== "READY"
  || manifest.ownerId !== prepared.journal.ownerId || manifest.operationId !== prepared.journal.operationId
  || manifest.sourceInventoryFingerprint !== prepared.journal.sourceInventoryFingerprint
  || manifest.nativeFingerprint !== prepared.journal.nativeFingerprint || manifest.nativeBackupFingerprint !== prepared.journal.nativeBackupFingerprint) throw invalid("Rollback source stage binding differs");
 const captured=await verifyLegacySourceCapture(target,destination);
 const source=await assertSafePath(root,"source");
 await verifySourceInventory(source,captured);
 await assertOwnedStorageMaintenance(target);
 return {root,source,manifest,nativeAuthorityRetained:true,restored:false};
}

async function syncDirectory(directory){
 try{const handle=await open(directory,"r");try{await handle.sync();}finally{await handle.close();}}
 catch(error){if(!["EINVAL","EPERM","EISDIR","ENOTSUP","UNKNOWN"].includes(error.code))throw error;}
}

/** Recover a dead stage owner; incomplete copies are retained as independent attempts. */
export async function resumeMigrationSourceRollbackStage(target,destination,{expectedOwnerId,...options}={}){
 return resumeStorageMaintenance(target,{expectedOwnerId,writersQuiesced:options.writersQuiesced},()=>recoverOwnedMigrationSourceRollbackStage(target,destination,options));
}

/** Recover staging inside the already adopted maintenance owner. */
export async function recoverOwnedMigrationSourceRollbackStage(target,destination,options={}){
  await assertOwnedStorageMaintenance(target);
  await retainStorageMaintenance(target);
  const ownerId=await assertOwnedStorageMaintenance(target);
  const operation=await assertSafePath(await assertSafePath(target,destination),"publication/source-rollback");
  const root=await assertSafePath(operation,"source-stage");
  const manifest=await readStorageMetadataJson(root,"source-stage.json");
  const preparation=await readStorageMetadataJson(operation,"rollback-journal.json");
  if(!manifest || manifest.schemaVersion !== 1 || manifest.kind !== "MIGRATION_SOURCE_ROLLBACK_STAGE" || !["PREPARING","READY"].includes(manifest.phase)
   || preparation?.schemaVersion !== 1 || preparation.kind !== "MIGRATION_SOURCE_ROLLBACK" || preparation.phase !== "READY")throw invalid("Source stage recovery journals are incomplete");
  for(const recorded of [manifest,preparation])await assertStorageMaintenanceOwnerContinuity(target,{expectedOwnerId:ownerId,recordedOwnerId:recorded.ownerId});
  for(const key of ["operationId","sourceInventoryFingerprint","nativeFingerprint","nativeBackupFingerprint"]){if(manifest[key] !== preparation[key])throw invalid("Source stage recovery binding differs");}
  const captured=await verifyLegacySourceCapture(target,destination);
  const expected={files:captured.manifest.files,directories:captured.manifest.directories};
  if(canonicalFingerprint(expected) !== manifest.sourceInventoryFingerprint)throw invalid("Source stage recovery capture differs");
  const source=await assertSafePath(root,"source");
  const partial=await inventoryLegacyArchiveLayout(source);
  partial.directories=partial.directories.filter(name=>LEGACY_SOURCE_ROOTS.some(relative=>name === relative || name.startsWith(`${relative}/`)));
  const files=new Set(expected.files.map(file=>file.path)),directories=new Set(expected.directories);
  if(partial.files.some(file=>!files.has(file.path)) || partial.directories.some(name=>!directories.has(name)))throw invalid("Interrupted source stage contains unrecorded entries");
  const complete=canonicalFingerprint(partial) === canonicalFingerprint(expected);
  if(manifest.phase === "READY" && !complete)throw invalid("Completed source stage bytes changed; recovery refused");
  await recoverOwnedMigrationSourceRollbackPreparation(target,destination,options);
  manifest.previousOwnerId=manifest.ownerId;manifest.ownerId=ownerId;
  const filename=await assertSafePath(root,"source-stage.json");
  const persist=()=>writeFileAtomic(filename,`${JSON.stringify(manifest,null,2)}\n`);
  if(!complete){
   let present=true;try{await lstat(source);}catch(error){if(error.code !== "ENOENT")throw error;present=false;}
   if(present){
    manifest.retainedAttempt=randomUUID();await persist();
    const history=await assertSafePath(root,"recovery-history");await mkdir(history,{recursive:true});
    const attempt=await assertSafePath(history,manifest.retainedAttempt);await mkdir(attempt);
    await syncDirectory(history);await syncDirectory(attempt);
    await rename(source,await assertSafePath(attempt,"source"));
    await syncDirectory(root);await syncDirectory(attempt);
   }else await persist();
   await cp(captured.source,source,{recursive:true,errorOnExist:true,force:false});
  }
  await verifySourceInventory(source,captured);
  await verifyPreparedMigrationSourceRollback(target,destination,options);
  manifest.phase="READY";await persist();
  return verifyMigrationSourceRollbackStage(target,destination,options);
}
