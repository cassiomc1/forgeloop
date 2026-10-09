import { lstat, mkdir, rename } from "node:fs/promises";
import path from "node:path";
import { syncDirectory } from "./file-durability.js";
import { assertSafePath, writeFileAtomic } from "../core/filesystem.js";
import { canonicalFingerprint } from "../core/artifacts.js";
import { assertOwnedStorageMaintenance, assertStorageMaintenanceOwnerContinuity, resumeStorageMaintenance, retainStorageMaintenance } from "./maintenance.js";
import { verifyMigrationSourceRollbackStage } from "./migration-rollback-source-stage.js";
import { LEGACY_SOURCE_ROOTS, inventoryLegacyArchiveLayout, inventoryLegacySourceLayout, inventoryStorageRoots, verifyLegacySourceCapture } from "./migration-source.js";
import { openStorageDatabase } from "./connection.js";
import { logicalSnapshot } from "./migration-candidate.js";
import { withVerifiedProjectStorageBackup } from "./project-backup.js";
import { readStorageMetadataJson } from "./metadata-json.js";

const NATIVE_ROOTS=[".forgeloop/state.sqlite",".forgeloop/storage-version.json",".forgeloop/attachments"];
function invalid(message){return Object.assign(new Error(message),{code:"E_STORAGE_SOURCE_ROLLBACK_INVALID"});}
async function exists(filename){try{await lstat(filename);return true;}catch(error){if(error.code === "ENOENT")return false;throw error;}}
async function retainedRoot(target,destination){return assertSafePath(await assertSafePath(target,destination),"publication/source-rollback/source-publication");}
async function moveExclusive(sourceRoot,destinationRoot,relative){
 const source=await assertSafePath(sourceRoot,relative);
 const destination=await assertSafePath(destinationRoot,relative);
 if(await exists(destination))throw invalid(`Rollback publication refuses existing destination: ${relative}`);
 await mkdir(path.dirname(destination),{recursive:true});
 await assertSafePath(destinationRoot,relative);
 await rename(source,destination);
 await syncDirectory(path.dirname(source));await syncDirectory(path.dirname(destination));
}

/** Conditional pre-write rollback only: operator exclusion is explicit, not inferred from equality. */
export async function publishMigrationSourceRollback(target,destination,{nativeWritesExcluded=false,...options}={}){
 if(nativeWritesExcluded !== true)throw invalid("Exclude all post-migration native writes before preserved-source restoration");
 const staged=await verifyMigrationSourceRollbackStage(target,destination,options);
 const ownerId=await assertOwnedStorageMaintenance(target);
 const root=await retainedRoot(target,destination);
 await mkdir(root); // Preserve any interrupted publication instead of restarting over it.
 await retainStorageMaintenance(target);
 const native=await assertSafePath(root,"retained-native");await mkdir(native);
 const journal={schemaVersion:1,kind:"MIGRATION_SOURCE_ROLLBACK_PUBLICATION",phase:"SWITCHING",ownerId,
  operationId:staged.manifest.operationId,sourceInventoryFingerprint:staged.manifest.sourceInventoryFingerprint,
  nativeFingerprint:staged.manifest.nativeFingerprint,nativeBackupFingerprint:staged.manifest.nativeBackupFingerprint,
  nativeWritesExcludedByOperator:true,nativeInventory:await inventoryStorageRoots(target,NATIVE_ROOTS)};
 const filename=await assertSafePath(root,"publication-journal.json");
 const persist=()=>writeFileAtomic(filename,`${JSON.stringify(journal,null,2)}\n`);
 await persist();
 return finishPublication(target,destination,root,journal,options);
}

async function finishPublication(target,destination,root,journal,options){
 const result=await continuePublication(target,destination,root,journal);
 if(options.legacyRoot){
  const {validateAndReleaseMigrationSourceRollback}=await import("./migration-rollback-release.js");
  return validateAndReleaseMigrationSourceRollback(target,destination,{legacyRoot:options.legacyRoot});
 }
 return result;
}

async function continuePublication(target,destination,root,journal){
 const native=await assertSafePath(root,"retained-native");
 const source=await assertSafePath(path.dirname(root),"source-stage/source");
 const filename=await assertSafePath(root,"publication-journal.json");
 const persist=()=>writeFileAtomic(filename,`${JSON.stringify(journal,null,2)}\n`);
 if(journal.phase === "SWITCHING"){
  await verifyNativePartition(target,native,journal);
  for(const relative of NATIVE_ROOTS){
   await assertOwnedStorageMaintenance(target);
   if(await exists(await assertSafePath(target,relative)))await moveExclusive(target,native,relative);
  }
  if(canonicalFingerprint(await inventoryStorageRoots(native,NATIVE_ROOTS)) !== canonicalFingerprint(journal.nativeInventory))throw invalid("Retained native bytes changed during source publication");
  journal.phase="NATIVE_RETAINED";await persist();
 }
 if(journal.phase === "NATIVE_RETAINED"){
  await verifySourcePartition(target,destination,source);
  for(const relative of LEGACY_SOURCE_ROOTS){
   await assertOwnedStorageMaintenance(target);
   if(await exists(await assertSafePath(source,relative)))await moveExclusive(source,target,relative);
  }
  const captured=await verifyLegacySourceCapture(target,destination);
  if(canonicalFingerprint(await inventoryLegacySourceLayout(target)) !== canonicalFingerprint({files:captured.manifest.files,directories:captured.manifest.directories}))throw invalid("Restored source differs from preserved capture");
  journal.phase="RESTORED";await persist();
 }
 return verifyPublishedMigrationSourceRollback(target,destination);
}

function subset(inventory,root){const matches=name=>name === root || name.startsWith(`${root}/`);return {files:inventory.files.filter(file=>matches(file.path)),directories:inventory.directories.filter(matches)};}
function present(inventory){return inventory.files.length || inventory.directories.length;}
async function verifyNativePartition(target,native,journal){
 const active=await inventoryStorageRoots(target,NATIVE_ROOTS);
 const retained=await inventoryStorageRoots(native,NATIVE_ROOTS);
 for(const root of NATIVE_ROOTS){
  const a=subset(active,root),r=subset(retained,root),expected=subset(journal.nativeInventory,root);
  if(present(a) && present(r))throw invalid(`Native root duplicated during rollback: ${root}`);
  if(canonicalFingerprint(present(a)?a:r) !== canonicalFingerprint(expected))throw invalid(`Native root bytes changed during rollback: ${root}`);
 }
}
async function verifySourcePartition(target,destination,source){
 const captured=await verifyLegacySourceCapture(target,destination);
 const expected={files:captured.manifest.files,directories:captured.manifest.directories};
 const active=await inventoryLegacySourceLayout(target),staged=await inventoryLegacyArchiveLayout(source);
 for(const root of LEGACY_SOURCE_ROOTS){
  const a=subset(active,root),s=subset(staged,root);
  if(present(a) && present(s))throw invalid(`Source root duplicated during rollback: ${root}`);
  if(canonicalFingerprint(present(a)?a:s) !== canonicalFingerprint(subset(expected,root)))throw invalid(`Source root bytes changed during rollback: ${root}`);
 }
}

/** Adopt only a dead local owner; recover persisted locations rather than trusting phase labels. */
async function verifyRecoveryJournalBindings(target, ownerId, journal, preparation, stage) {
  if(!journal || journal.schemaVersion !== 1 || journal.kind !== "MIGRATION_SOURCE_ROLLBACK_PUBLICATION" || !["SWITCHING","NATIVE_RETAINED","RESTORED"].includes(journal.phase)
   || journal.nativeWritesExcludedByOperator !== true || preparation?.schemaVersion !== 1 || preparation.kind !== "MIGRATION_SOURCE_ROLLBACK" || preparation.phase !== "READY"
   || stage?.schemaVersion !== 1 || stage.kind !== "MIGRATION_SOURCE_ROLLBACK_STAGE" || stage.phase !== "READY")throw invalid("Rollback recovery journals are incomplete");
  for(const recorded of [journal,preparation,stage]){
   await assertStorageMaintenanceOwnerContinuity(target,{expectedOwnerId:ownerId,recordedOwnerId:recorded.ownerId});
   for(const key of ["operationId","sourceInventoryFingerprint","nativeFingerprint","nativeBackupFingerprint"]){if(recorded[key] !== preparation[key])throw invalid("Rollback recovery bindings differ");}
  }
}

export async function resumeMigrationSourceRollbackPublication(target,destination,{expectedOwnerId,nativeWritesExcluded=false,...options}={}){
 if(nativeWritesExcluded !== true)throw invalid("Exclude all post-migration native writes before rollback recovery");
 return resumeStorageMaintenance(target,{expectedOwnerId,writersQuiesced:options.writersQuiesced},async()=>{
  await retainStorageMaintenance(target);
  const ownerId=await assertOwnedStorageMaintenance(target);
  const root=await retainedRoot(target,destination),operation=path.dirname(root);
  const journal=await readStorageMetadataJson(root,"publication-journal.json");
  const preparation=await readStorageMetadataJson(operation,"rollback-journal.json");
  const stage=await readStorageMetadataJson(await assertSafePath(operation,"source-stage"),"source-stage.json");
  await verifyRecoveryJournalBindings(target, ownerId, journal, preparation, stage);
  const captured=await verifyLegacySourceCapture(target,destination);
  if(canonicalFingerprint({files:captured.manifest.files,directories:captured.manifest.directories}) !== journal.sourceInventoryFingerprint)throw invalid("Rollback recovery capture differs");
  const backupName=preparation.nativeBackupDirectory ?? "native-backup";
  if(backupName !== "native-backup" && !/^native-backup-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(backupName))throw invalid("Rollback backup path differs");
  await withVerifiedProjectStorageBackup(await assertSafePath(operation,backupName),async snapshot=>{
   if(canonicalFingerprint(snapshot.manifest) !== journal.nativeBackupFingerprint || canonicalFingerprint(logicalSnapshot(snapshot.db)) !== journal.nativeFingerprint)throw invalid("Rollback recovery backup differs");
  });
  const native=await assertSafePath(root,"retained-native"),source=await assertSafePath(operation,"source-stage/source");
  if(journal.phase === "SWITCHING"){
   await verifyNativePartition(target,native,journal);
   // No source root may have been published before native retention completes.
   const staged=await inventoryLegacyArchiveLayout(source);
   staged.directories=staged.directories.filter(name=>LEGACY_SOURCE_ROOTS.some(root=>name === root || name.startsWith(`${root}/`)));
   if(canonicalFingerprint(staged) !== journal.sourceInventoryFingerprint)throw invalid("Source stage differs before native retention");
   const active=await inventoryLegacySourceLayout(target);
   if(active.files.some(file=>!file.path.startsWith(".forgeloop/attachments/")) || active.directories.some(name=>name !== ".forgeloop/attachments" && !name.startsWith(".forgeloop/attachments/")))throw invalid("Source published before native retention");
  }else{
   for(const relative of [".forgeloop/state.sqlite",".forgeloop/state.sqlite-wal",".forgeloop/state.sqlite-shm",".forgeloop/storage-version.json"]){
    if(await exists(await assertSafePath(target,relative)))throw invalid("Native authority reappeared before rollback recovery; source publication refused");
   }
   if(canonicalFingerprint(await inventoryStorageRoots(native,NATIVE_ROOTS)) !== canonicalFingerprint(journal.nativeInventory))throw invalid("Retained native inventory differs");
   await verifySourcePartition(target,destination,source);
  }
  const databaseRoot=await exists(await assertSafePath(native,".forgeloop/state.sqlite")) ? native : target;
  const db=openStorageDatabase(await assertSafePath(databaseRoot,".forgeloop/state.sqlite"),{readOnly:true});
  try{if(canonicalFingerprint(logicalSnapshot(db)) !== journal.nativeFingerprint)throw invalid("Original native canonical state differs during rollback recovery");}finally{db.close();}
  const checkpoint=openStorageDatabase(await assertSafePath(databaseRoot,".forgeloop/state.sqlite"));
  try{const result=checkpoint.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get();if(result.busy !== 0 || result.log !== 0)throw invalid("Busy original native database forbids rollback recovery");}finally{checkpoint.close();}
  for(const suffix of ["-wal","-shm"]){if(await exists(await assertSafePath(databaseRoot,`.forgeloop/state.sqlite${suffix}`)))throw invalid("Close all original native connections before rollback recovery");}
  // Adopt metadata only after bytes and the exact owner chain pass verification.
  for(const [recorded,recordRoot,filename] of [[preparation,operation,"rollback-journal.json"],[stage,await assertSafePath(operation,"source-stage"),"source-stage.json"],[journal,root,"publication-journal.json"]]){
   recorded.previousOwnerId=recorded.ownerId;recorded.ownerId=ownerId;
   await writeFileAtomic(await assertSafePath(recordRoot,filename),`${JSON.stringify(recorded,null,2)}\n`);
  }
  return finishPublication(target,destination,root,journal,options);
 });
}

/** Verify source bytes and retained original native files; keep exclusion for target-version validation. */
export async function verifyPublishedMigrationSourceRollback(target,destination){
 const ownerId=await assertOwnedStorageMaintenance(target);
 const root=await retainedRoot(target,destination);
 const journal=await readStorageMetadataJson(root,"publication-journal.json");
 const preparation=await readStorageMetadataJson(await assertSafePath(await assertSafePath(target,destination),"publication/source-rollback"),"rollback-journal.json");
 if(!journal || journal.schemaVersion !== 1 || journal.kind !== "MIGRATION_SOURCE_ROLLBACK_PUBLICATION" || journal.phase !== "RESTORED"
  || journal.ownerId !== ownerId || journal.ownerId !== preparation.ownerId || journal.nativeWritesExcludedByOperator !== true
  || journal.operationId !== preparation.operationId || journal.sourceInventoryFingerprint !== preparation.sourceInventoryFingerprint
  || journal.nativeFingerprint !== preparation.nativeFingerprint || journal.nativeBackupFingerprint !== preparation.nativeBackupFingerprint)throw invalid("Source rollback publication binding differs");
 const captured=await verifyLegacySourceCapture(target,destination);
 const inventory={files:captured.manifest.files,directories:captured.manifest.directories};
 if(canonicalFingerprint(inventory) !== journal.sourceInventoryFingerprint || canonicalFingerprint(await inventoryLegacySourceLayout(target)) !== canonicalFingerprint(inventory))throw invalid("Published source inventory differs");
 const native=await assertSafePath(root,"retained-native");
 if(canonicalFingerprint(await inventoryStorageRoots(native,NATIVE_ROOTS)) !== canonicalFingerprint(journal.nativeInventory))throw invalid("Retained original native bytes differ");
 for(const relative of [".forgeloop/state.sqlite",".forgeloop/state.sqlite-wal",".forgeloop/state.sqlite-shm",".forgeloop/storage-version.json"]){
  if(await exists(await assertSafePath(target,relative)))throw invalid("Native authority remains active after preserved-source restoration");
 }
 await assertOwnedStorageMaintenance(target);
 return {root,native,source:target,journal,restored:true,nativeAuthorityRetained:true,historicalWritesExcluded:false,nativeWritesExcludedByOperator:true,targetVersionValidated:false};
}
