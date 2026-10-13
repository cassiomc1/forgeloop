import { randomUUID } from "node:crypto";
import { lstat, mkdir } from "node:fs/promises";
import { assertSafePath, writeFileAtomic } from "../core/filesystem.js";
import { canonicalFingerprint } from "../core/artifacts.js";
import { openStorageDatabase } from "./connection.js";
import { logicalSnapshot } from "./migration-candidate.js";
import { verifyMigrationSourceRollbackAdmission } from "./migration-rollback-admission.js";
import { assertOwnedStorageMaintenance, retainStorageMaintenance, resumeStorageMaintenance, assertStorageMaintenanceOwnerContinuity } from "./maintenance.js";
import { backupProjectStorage, withVerifiedProjectStorageBackup } from "./project-backup.js";
import { readStorageVersionMarker } from "./storage-marker.js";
import { readStorageMetadataJson } from "./metadata-json.js";
import { validateMigrationDatabase } from "./migration-validation.js";
function invalid(message) {return Object.assign(new Error(message),{code:"E_STORAGE_SOURCE_ROLLBACK_INVALID"});}
async function operationRoot(target,destination) {
 return assertSafePath(await assertSafePath(target,destination),"publication/source-rollback");
}

/** Retain a verified native backup before any source switch; never release exclusion. */
export async function prepareMigrationSourceRollback(target,destination,options={}) {
 const ownerId=await assertOwnedStorageMaintenance(target);
 const admission=await verifyMigrationSourceRollbackAdmission(target,destination,options);
 const marker=await readStorageVersionMarker(target);
 const root=await operationRoot(target,destination);
 await mkdir(root); // Existing/partial preparation requires explicit reconciliation.
 await retainStorageMaintenance(target);
 const journal={schemaVersion:1,kind:"MIGRATION_SOURCE_ROLLBACK",phase:"PREPARING",ownerId,operationId:admission.operationId,
  sourceInventoryFingerprint:marker.sourceInventoryFingerprint,nativeMarker:marker,nativeFingerprint:admission.fingerprint};
 const journalPath=await assertSafePath(root,"rollback-journal.json");
 const persist=()=>writeFileAtomic(journalPath,`${JSON.stringify(journal,null,2)}\n`);
 await persist();
 const db=openStorageDatabase(await assertSafePath(target,".forgeloop/state.sqlite"),{readOnly:true});
 try {await backupProjectStorage(db,target,await assertSafePath(root,"native-backup"));} finally {db.close();}
 journal.nativeBackupFingerprint=await withVerifiedProjectStorageBackup(await assertSafePath(root,"native-backup"),async snapshot=>{
  if (canonicalFingerprint(logicalSnapshot(snapshot.db)) !== admission.fingerprint) throw invalid("Retained native backup differs from rollback admission");
  await validateMigrationDatabase(snapshot.db,{target,packageRoot:options.packageRoot});
  return canonicalFingerprint(snapshot.manifest);
 });
 const after=await verifyMigrationSourceRollbackAdmission(target,destination,options);
 if (after.fingerprint !== admission.fingerprint || canonicalFingerprint(await readStorageVersionMarker(target)) !== canonicalFingerprint(marker)) throw invalid("Native authority changed during rollback preparation");
 await assertOwnedStorageMaintenance(target);
 journal.phase="READY";await persist();
 return verifyPreparedMigrationSourceRollback(target,destination,options);
}

async function backupRoot(root,journal) {
 const name=journal.nativeBackupDirectory ?? "native-backup";
 if (name !== "native-backup" && !/^native-backup-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(name)) throw invalid("Invalid retained backup directory");
 return assertSafePath(root,name);
}

/** A READY label alone cannot authorize source restoration. */
export async function verifyPreparedMigrationSourceRollback(target,destination,options={}) {
 return verifyReadyPreparation(target,destination,options,false);
}

async function verifyReadyPreparation(target,destination,options,adoptOwner) {
 const ownerId=await assertOwnedStorageMaintenance(target);
 const admission=await verifyMigrationSourceRollbackAdmission(target,destination,options);
 const root=await operationRoot(target,destination);
 const journal=await readStorageMetadataJson(root,"rollback-journal.json");
 if (!journal || journal.schemaVersion !== 1 || journal.kind !== "MIGRATION_SOURCE_ROLLBACK" || journal.phase !== "READY"
  || (!adoptOwner && journal.ownerId !== ownerId) || journal.operationId !== admission.operationId || journal.nativeFingerprint !== admission.fingerprint
  || journal.sourceInventoryFingerprint !== journal.nativeMarker?.sourceInventoryFingerprint
  || canonicalFingerprint(journal.nativeMarker) !== canonicalFingerprint(await readStorageVersionMarker(target))) throw invalid("Rollback preparation binding or owner differs");
 if (adoptOwner) await assertStorageMaintenanceOwnerContinuity(target,{expectedOwnerId:ownerId,recordedOwnerId:journal.ownerId});
 await withVerifiedProjectStorageBackup(await backupRoot(root,journal),async snapshot=>{
  if (canonicalFingerprint(snapshot.manifest) !== journal.nativeBackupFingerprint || canonicalFingerprint(logicalSnapshot(snapshot.db)) !== admission.fingerprint) throw invalid("Retained native rollback backup binding differs");
  await validateMigrationDatabase(snapshot.db,{target,packageRoot:options.packageRoot});
 });
 await assertOwnedStorageMaintenance(target);
 return {root,journal,nativeAuthorityRetained:true,restored:false};
}

/** Revalidate a retained READY backup under exact dead-owner adoption; never switch source. */
export async function resumePreparedMigrationSourceRollback(target,destination,{expectedOwnerId,...options}={}) {
 return resumeStorageMaintenance(target,{expectedOwnerId,writersQuiesced:options.writersQuiesced},()=>recoverOwnedMigrationSourceRollbackPreparation(target,destination,options));
}

/** Compose recovery inside an already adopted live owner; no caller-supplied ownership bypass. */
export async function recoverOwnedMigrationSourceRollbackPreparation(target,destination,options={}) {
 await assertOwnedStorageMaintenance(target);
 await retainStorageMaintenance(target);
 await recoverPreparingBackup(target,destination,options);
 const verified=await verifyReadyPreparation(target,destination,options,true);
 const ownerId=await assertOwnedStorageMaintenance(target);
 const journal={...verified.journal,ownerId,previousOwnerId:verified.journal.ownerId === ownerId ? verified.journal.previousOwnerId : verified.journal.ownerId};
 await writeFileAtomic(await assertSafePath(verified.root,"rollback-journal.json"),`${JSON.stringify(journal,null,2)}\n`);
 return verifyPreparedMigrationSourceRollback(target,destination,options);
}

/** Preserve interrupted attempts; only a validated committed backup may become READY. */
async function recoverPreparingBackup(target,destination,options) {
 const root=await operationRoot(target,destination);
 const journal=await readStorageMetadataJson(root,"rollback-journal.json");
 if (journal?.phase === "READY") return;
 const ownerId=await assertOwnedStorageMaintenance(target);
 const admission=await verifyMigrationSourceRollbackAdmission(target,destination,options);
 if (!journal || journal.schemaVersion !== 1 || journal.kind !== "MIGRATION_SOURCE_ROLLBACK" || journal.phase !== "PREPARING"
  || journal.operationId !== admission.operationId || journal.nativeFingerprint !== admission.fingerprint
  || journal.sourceInventoryFingerprint !== journal.nativeMarker?.sourceInventoryFingerprint
  || canonicalFingerprint(journal.nativeMarker) !== canonicalFingerprint(await readStorageVersionMarker(target))) throw invalid("Interrupted rollback preparation binding differs");
 await assertStorageMaintenanceOwnerContinuity(target,{expectedOwnerId:ownerId,recordedOwnerId:journal.ownerId});
 let directory=await backupRoot(root,journal);
 let exists=true;
 try {if (!(await lstat(directory)).isDirectory()) throw invalid("Backup attempt must be a directory");}
 catch(error){if(error.code !== "ENOENT") throw error;exists=false;}
 const manifest=exists ? await readStorageMetadataJson(directory,"backup-manifest.json",{optional:true}) : null;
 const journalPath=await assertSafePath(root,"rollback-journal.json");
 const persist=()=>writeFileAtomic(journalPath,`${JSON.stringify(journal,null,2)}\n`);
 if (manifest?.status !== "READY") {
  // Never replace bytes from a prior incomplete attempt, including one with no manifest.
  if (exists) {
   journal.nativeBackupDirectory=`native-backup-${randomUUID()}`;
   directory=await backupRoot(root,journal);
  }
  journal.previousOwnerId=journal.ownerId;journal.ownerId=ownerId;
  await persist();
  const db=openStorageDatabase(await assertSafePath(target,".forgeloop/state.sqlite"),{readOnly:true});
  try {await backupProjectStorage(db,target,directory);} finally {db.close();}
 }
 const fingerprint=await withVerifiedProjectStorageBackup(directory,async snapshot=>{
  if (canonicalFingerprint(logicalSnapshot(snapshot.db)) !== admission.fingerprint) throw invalid("Recovered backup differs from rollback admission");
  await validateMigrationDatabase(snapshot.db,{target,packageRoot:options.packageRoot});
  return canonicalFingerprint(snapshot.manifest);
 });
 if (journal.nativeBackupFingerprint && journal.nativeBackupFingerprint !== fingerprint) throw invalid("Interrupted backup fingerprint differs");
 const after=await verifyMigrationSourceRollbackAdmission(target,destination,options);
 if (after.fingerprint !== admission.fingerprint || canonicalFingerprint(await readStorageVersionMarker(target)) !== canonicalFingerprint(journal.nativeMarker)) throw invalid("Native authority changed during rollback recovery");
 await assertOwnedStorageMaintenance(target);
 journal.nativeBackupFingerprint=fingerprint;journal.phase="READY";
 await persist();
}
