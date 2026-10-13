import { assertSafePath } from "../core/filesystem.js";
import { readStorageMetadataJson } from "./metadata-json.js";
import { withStorageMaintenance, resumeStorageMaintenance } from "./maintenance.js";
import { verifyRollbackLegacyTarget } from "./migration-rollback-release.js";
import { prepareMigrationSourceRollback, recoverOwnedMigrationSourceRollbackPreparation } from "./migration-rollback-preparation.js";
import { stageMigrationSourceRollback, recoverOwnedMigrationSourceRollbackStage } from "./migration-rollback-source-stage.js";
import { publishMigrationSourceRollback, resumeMigrationSourceRollbackPublication } from "./migration-rollback-publication.js";

/** Supported conditional rollback entry point: verify the target before acquiring or altering storage. */
export async function rollbackProjectStorage(target,{destination,legacyRoot,writersQuiesced=false,nativeWritesExcluded=false,packageRoot}={}){
 if(typeof destination !== "string" || !destination || writersQuiesced !== true || nativeWritesExcluded !== true){
  throw Object.assign(new Error("Source rollback requires a retained migration destination, excluded writers and excluded post-migration native writes"),{code:"E_CLI_INVOCATION_INVALID"});
 }
 const validator=await verifyRollbackLegacyTarget(legacyRoot);
 const options={writersQuiesced,nativeWritesExcluded,packageRoot,legacyRoot:validator.root};
 return withStorageMaintenance(target,async()=>{
  await prepareMigrationSourceRollback(target,destination,options);
  await stageMigrationSourceRollback(target,destination,options);
  return publishMigrationSourceRollback(target,destination,options);
 },{retainOnError:true});
}

/** Resume a recorded rollback under the exact dead owner, through target validation and release. */
export async function resumeProjectStorageRollback(target,{destination,legacyRoot,expectedOwnerId,writersQuiesced=false,nativeWritesExcluded=false,packageRoot}={}){
 if(typeof destination !== "string" || !destination || writersQuiesced !== true || nativeWritesExcluded !== true || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(expectedOwnerId ?? "")){
  throw Object.assign(new Error("Rollback publication resume requires destination, exact owner, excluded writers and excluded native writes"),{code:"E_CLI_INVOCATION_INVALID"});
 }
 const validator=await verifyRollbackLegacyTarget(legacyRoot);
 const options={writersQuiesced,nativeWritesExcluded,packageRoot,legacyRoot:validator.root};
 const operation=await assertSafePath(await assertSafePath(target,destination),"publication/source-rollback");
 const publication=await readStorageMetadataJson(operation,"source-publication/publication-journal.json",{optional:true});
 if(publication)return resumeMigrationSourceRollbackPublication(target,destination,{expectedOwnerId,...options});
 return resumeStorageMaintenance(target,{expectedOwnerId,writersQuiesced},async()=>{
  if(await readStorageMetadataJson(operation,"source-publication/publication-journal.json",{optional:true}))throw Object.assign(new Error("Rollback publication appeared during recovery; retry publication recovery"),{code:"E_STORAGE_SOURCE_ROLLBACK_INVALID"});
  const stage=await readStorageMetadataJson(operation,"source-stage/source-stage.json",{optional:true});
  if(stage)await recoverOwnedMigrationSourceRollbackStage(target,destination,options);
  else{
   await recoverOwnedMigrationSourceRollbackPreparation(target,destination,options);
   await stageMigrationSourceRollback(target,destination,options);
  }
  return publishMigrationSourceRollback(target,destination,options);
 });
}
