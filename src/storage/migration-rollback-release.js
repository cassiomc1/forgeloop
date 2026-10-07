import { spawnSync } from "node:child_process";
import path from "node:path";
import { assertSafePath, writeFileAtomic } from "../core/filesystem.js";
import { canonicalFingerprint } from "../core/artifacts.js";
import { readStorageMetadataJson } from "./metadata-json.js";
import { assertOwnedStorageMaintenance, allowStorageMaintenanceRelease, retainStorageMaintenance } from "./maintenance.js";
import { verifyPublishedMigrationSourceRollback } from "./migration-rollback-publication.js";
import { withVerifiedProjectStorageBackup } from "./project-backup.js";
import { logicalSnapshot } from "./migration-candidate.js";

const SUPPORTED_TARGET_COMMIT="ee9ce11123d4e728d3dbc92f5d62d4bf41bb79c5";
function invalid(message){return Object.assign(new Error(message),{code:"E_STORAGE_SOURCE_ROLLBACK_VALIDATION_INVALID"});}
function run(executable,args){
 const result=spawnSync(executable,args,{encoding:"utf8",timeout:60000,maxBuffer:16*1024*1024});
 if(result.status !== 0)throw invalid(`Rollback target validation failed: ${args[0]} (${result.error?.code ?? result.status ?? result.signal})`);
 return result.stdout;
}

/** The supported target is explicit and source-pinned; arbitrary validator callbacks are not accepted. */
export async function verifyRollbackLegacyTarget(legacyRoot){
 if(typeof legacyRoot !== "string" || !legacyRoot)throw invalid("Rollback release requires a supported legacy checkout");
 const root=await assertSafePath(path.resolve(legacyRoot),".");
 const commit=run("git",["-C",root,"rev-parse","HEAD"]).trim();
 if(commit !== SUPPORTED_TARGET_COMMIT || run("git",["-C",root,"status","--porcelain","--untracked-files=no"]).trim())throw invalid("Rollback target must be the clean supported pinned checkout");
 const cli=await assertSafePath(root,"src/cli.js");
 const metadata=await readStorageMetadataJson(root,"package.json");
 if(metadata.name !== "@cassiomc1/forgeloop" || typeof metadata.version !== "string")throw invalid("Rollback target package identity differs");
 return {root,cli,commit,version:metadata.version};
}

/** Release only after exact-target validation of every retained task and final byte checks. */
export async function validateAndReleaseMigrationSourceRollback(target,destination,{legacyRoot}={}){
 await retainStorageMaintenance(target);
 const published=await verifyPublishedMigrationSourceRollback(target,destination);
 const validator=await verifyRollbackLegacyTarget(legacyRoot);
 const operation=path.dirname(published.root);
 const preparation=await readStorageMetadataJson(operation,"rollback-journal.json");
 const name=preparation.nativeBackupDirectory ?? "native-backup";
 if(name !== "native-backup" && !/^native-backup-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(name))throw invalid("Rollback release backup path differs");
 const taskIds=await withVerifiedProjectStorageBackup(await assertSafePath(operation,name),snapshot=>{
  if(canonicalFingerprint(snapshot.manifest) !== published.journal.nativeBackupFingerprint || canonicalFingerprint(logicalSnapshot(snapshot.db)) !== published.journal.nativeFingerprint)throw invalid("Rollback release native backup binding differs");
  return snapshot.db.prepare("SELECT task_id FROM tasks ORDER BY task_id").all().map(row=>row.task_id);
 });
 const invoke=(command,args=[])=>{
  let value;try{value=JSON.parse(run(process.execPath,[validator.cli,command,"--path",target,...args,"--json"]));}catch(error){if(error.code)throw error;throw invalid("Rollback target returned invalid JSON");}
  return value;
 };
 const catalog=invoke("task-list");
 if(!Array.isArray(catalog.tasks) || canonicalFingerprint(catalog.tasks.map(task=>task.taskId).sort()) !== canonicalFingerprint(taskIds))throw invalid("Rollback target task identities differ from native authority");
 const validations=[];
 for(const taskId of taskIds){
  await assertOwnedStorageMaintenance(target);
  const result=invoke("validate-protocol",["--task",taskId]);
  if(result.status !== "VALID")throw invalid(`Rollback target protocol validation refused task ${taskId}`);
  validations.push({taskId,status:result.status});
 }
 await verifyRollbackLegacyTarget(validator.root);
 await verifyPublishedMigrationSourceRollback(target,destination);
 const receipt={schemaVersion:1,kind:"MIGRATION_SOURCE_ROLLBACK_VALIDATION",status:"VALID",ownerId:await assertOwnedStorageMaintenance(target),
  operationId:published.journal.operationId,sourceInventoryFingerprint:published.journal.sourceInventoryFingerprint,nativeFingerprint:published.journal.nativeFingerprint,
  target:{commit:validator.commit,version:validator.version},tasks:validations};
 await writeFileAtomic(await assertSafePath(published.root,"target-validation.json"),`${JSON.stringify(receipt,null,2)}\n`);
 await verifyPublishedMigrationSourceRollback(target,destination);
 await allowStorageMaintenanceRelease(target);
 return {...published,targetVersionValidated:true,validation:receipt,maintenanceReleaseAllowed:true};
}
