import { removeTempTree } from "./helpers/rm-safe.js";
import assert from "node:assert/strict";
import test from "node:test";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { buildDiagnosisProject } from "./helpers/storage-fixtures.js";
import { migrateProjectStorage } from "../src/storage/migration.js";
import { rollbackProjectStorage } from "../src/storage/migration-rollback.js";
for(const mode of ["no-quiescence","no-write-exclusion","unsupported-target"])test(`rollback operator ${mode} refuses before allocating storage`,async()=>{
 const target=await buildDiagnosisProject({legacy:true});
 try{
  await migrateProjectStorage(target,{destination:"retained",writersQuiesced:true});
  const database=await readFile(path.join(target,".forgeloop/state.sqlite"));
  const marker=await readFile(path.join(target,".forgeloop/storage-version.json"));
  const options={destination:"retained",legacyRoot:target,writersQuiesced:mode !== "no-quiescence",nativeWritesExcluded:mode !== "no-write-exclusion"};
  await assert.rejects(rollbackProjectStorage(target,options),{code:mode === "unsupported-target"?"E_STORAGE_SOURCE_ROLLBACK_VALIDATION_INVALID":"E_CLI_INVOCATION_INVALID"});
  assert.deepEqual(await readFile(path.join(target,".forgeloop/state.sqlite")),database);
  assert.deepEqual(await readFile(path.join(target,".forgeloop/storage-version.json")),marker);
  await assert.rejects(stat(path.join(target,".forgeloop/.storage-maintenance")),{code:"ENOENT"});
  await assert.rejects(stat(path.join(target,"retained/publication/source-rollback")),{code:"ENOENT"});
 }finally{await removeTempTree(target);}
});
