import { lstat } from "node:fs/promises";
import { assertSafePath } from "../core/filesystem.js";
import { canonicalFingerprint } from "../core/artifacts.js";
import { openStorageDatabase } from "./connection.js";
import { logicalSnapshot } from "./migration-candidate.js";
import { verifyPublishedMigration } from "./migration-terminal.js";
import { verifyMigrationPublicationStage } from "./migration-publication.js";
import { inspectMigrationSourcePartition } from "./migration-source-partition.js";
import { assertOwnedStorageMaintenance } from "./maintenance.js";
import { withStorageSnapshot } from "./snapshot.js";
function invalid(message) { return Object.assign(new Error(message), {code:"E_STORAGE_SOURCE_ROLLBACK_INVALID"}); }

async function assertConnectionsClosed(target) {
  await assertOwnedStorageMaintenance(target);
  const filename=await assertSafePath(target,".forgeloop/state.sqlite");
  try {if (!(await lstat(filename)).isFile()) throw invalid("Source rollback admission requires an existing regular native database");}
  catch(error){if(error.code === "ENOENT")throw invalid("Source rollback admission requires an existing native database");throw error;}
  const checkpoint=openStorageDatabase(filename,{allowSchemaUpgrade:false});
  try {
    const result=checkpoint.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get();
    if (result.busy !== 0 || result.log !== 0) throw invalid("Busy SQLite checkpoint forbids source rollback admission");
  } finally {checkpoint.close();}
  for (const suffix of ["-wal","-shm"]) {
    const filename=await assertSafePath(target,`.forgeloop/state.sqlite${suffix}`);
    try {await lstat(filename);} catch (error) {if (error.code === "ENOENT") continue;throw error;}
    throw invalid("Close all SQLite connections; retained sidecars forbid source rollback admission");
  }
}

/** Owned checkpoint/content admission; not a historical-write proof or restoration token. */
export async function verifyMigrationSourceRollbackAdmission(target,destination,{writersQuiesced=false,packageRoot}={}) {
  if (writersQuiesced !== true) throw invalid("Source rollback admission requires excluded writers");
  await assertOwnedStorageMaintenance(target);
  await assertConnectionsClosed(target);
  await verifyPublishedMigration(target,destination,{writersQuiesced,packageRoot});
  const staged=await verifyMigrationPublicationStage(target,destination,{packageRoot,sourcePartition:true,allowPublished:true});
  // Refuse added orphan bytes too: source restoration must not silently discard them.
  await inspectMigrationSourcePartition(target,destination,{allowSignatureObjectGrowth:true});
  const current=openStorageDatabase(await assertSafePath(target,".forgeloop/state.sqlite"),{readOnly:true});
  let original;
  let result;
  try {
    original=openStorageDatabase(await assertSafePath(staged.bundle,"state.sqlite"),{readOnly:true});
    result = await withStorageSnapshot(current,async snapshot=>{
      const fingerprint=canonicalFingerprint(logicalSnapshot(snapshot));
      if (fingerprint !== canonicalFingerprint(logicalSnapshot(original))) throw invalid("Accepted native changes forbid preserved-source restoration");
      await assertOwnedStorageMaintenance(target);
      return {operationId:staged.journal.operationId,unchangedCanonicalSnapshot:true,fingerprint,restored:false,historicalWritesExcluded:false};
    });
  } finally {try {original?.close();} finally {current.close();}}
  await assertConnectionsClosed(target);
  await assertOwnedStorageMaintenance(target);
  return result;
}
