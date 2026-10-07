import { removeTempTree } from "./helpers/rm-safe.js";
import assert from "node:assert/strict";
import test from "node:test";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import os from "node:os";
import { buildCanonicalDiagnosisProject } from "./helpers/canonical-diagnosis-fixture.js";
import { openStorageDatabase } from "../src/storage/connection.js";
import { exportDatabase } from "../src/storage/exporter.js";
import { prepareMigrationCandidate } from "../src/storage/migration-candidate.js";
import { taskStorageKey } from "../src/core/task-identity.js";
for (const change of ["historical-prefix","identity","prefix-digest","membership"]) {
 test(`migration retains historical export metadata and validates ${change}`,async()=>{
  const fixture=await buildCanonicalDiagnosisProject();
  const portable=await mkdtemp(path.join(os.tmpdir(),"forgeloop-historic-export-"));
  let db;
  try {
   db=openStorageDatabase(path.join(fixture.target,".forgeloop/state.sqlite"),{readOnly:true});
   await exportDatabase(db,portable,{attachmentRoot:fixture.target});db.close();db=null;
   await rm(path.join(fixture.target,".forgeloop"),{recursive:true,force:true});
   await cp(path.join(portable,".forgeloop"),path.join(fixture.target,".forgeloop"),{recursive:true});
   await cp(path.join(portable,"export-index.json"),path.join(fixture.target,"export-index.json"));
   const relative=`.forgeloop/task-state/${taskStorageKey(fixture.taskId)}/export-manifest.json`;
   const filename=path.join(fixture.target,relative);
   const manifest=JSON.parse(await readFile(filename,"utf8"));
   const ledger=manifest.files.find(file=>file.path === "events.ndjson");
   if (change === "historical-prefix") {
    const bytes=await readFile(path.join(path.dirname(filename),"events.ndjson"));
    const prefix=bytes.subarray(0,bytes.lastIndexOf(10,bytes.length-2)+1);
    manifest.events-=1;ledger.size=prefix.length;ledger.sha256=createHash("sha256").update(prefix).digest("hex");
   } else if (change === "identity") manifest.taskId="substituted-task";
   else if (change === "prefix-digest") ledger.sha256="0".repeat(64);
   else manifest.included.push("unbound.json");
   const original=JSON.stringify(manifest);await writeFile(filename,original);
   const prepare=()=>prepareMigrationCandidate(fixture.target,{destination:"retained",writersQuiesced:true});
   if (change === "historical-prefix") {
    const candidate=await prepare();assert.equal(candidate.manifest.status,"PREPARED");
    assert.equal(await readFile(path.join(candidate.path,"source",relative),"utf8"),original);
   } else await assert.rejects(prepare,{code:"E_STORAGE_MIGRATION_PARITY_INVALID"});
   assert.equal(await readFile(filename,"utf8"),original);
  } finally {db?.close();await fixture.cleanup();await removeTempTree(portable);}
 });
}
