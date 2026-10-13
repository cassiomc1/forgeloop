import { removeTempTree } from "./helpers/rm-safe.js";
import assert from "node:assert/strict";
import test from "node:test";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { buildDiagnosisProject } from "./helpers/storage-fixtures.js";
import { migrateProjectStorage } from "../src/storage/migration.js";
import { executeForgeLoopCommand } from "../src/core/command-runtime.js";
for(const mode of ["missing-native-exclusion","missing-target","unsupported-target"])test(`public rollback ${mode} refuses without storage changes`,async()=>{
 const target=await buildDiagnosisProject({legacy:true});
 try{
  await migrateProjectStorage(target,{destination:"retained",writersQuiesced:true});
  const database=await readFile(path.join(target,".forgeloop/state.sqlite"));
  const input={destination:"retained",writersQuiesced:true,...(mode !== "missing-target"?{legacyRoot:target}:{}),...(mode !== "missing-native-exclusion"?{nativeWritesExcluded:true}:{})};
  const refused=await executeForgeLoopCommand({command:"storage-rollback",projectPath:target,input});
  assert.equal(refused.ok,false);
  assert.deepEqual(await readFile(path.join(target,".forgeloop/state.sqlite")),database);
  await assert.rejects(stat(path.join(target,".forgeloop/.storage-maintenance")),{code:"ENOENT"});
  await assert.rejects(stat(path.join(target,"retained/publication/source-rollback")),{code:"ENOENT"});
 }finally{await removeTempTree(target);}
});
test("public rollback help explains conditional native-write exclusion",()=>{
 const result=spawnSync(process.execPath,["src/cli.js","storage-rollback","--help"],{encoding:"utf8"});
 assert.equal(result.status,0);assert.match(result.stdout,/--native-writes-excluded/);assert.match(result.stdout,/--legacy-root/);
});

test("public rollback resume requires exact owner before touching project",async()=>{
 const target=await buildDiagnosisProject({legacy:true});
 try{
  const result=await executeForgeLoopCommand({command:"storage-rollback-resume",projectPath:target,input:{destination:"retained",legacyRoot:target,writersQuiesced:true,nativeWritesExcluded:true,expectedOwnerId:"unknown"}});
  assert.equal(result.ok,false);
  await assert.rejects(stat(path.join(target,".forgeloop/.storage-maintenance")),{code:"ENOENT"});
  await assert.rejects(stat(path.join(target,".forgeloop/state.sqlite")),{code:"ENOENT"});
 }finally{await removeTempTree(target);}
});
test("public rollback resume help names exact owner and publication boundary",()=>{
 const result=spawnSync(process.execPath,["src/cli.js","storage-rollback-resume","--help"],{encoding:"utf8"});
 assert.equal(result.status,0);assert.match(result.stdout,/--expected-owner/);assert.match(result.stdout,/preparation, staging or publication/);
});
