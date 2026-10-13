import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { migrateProjectStorage } from "../../src/storage/migration.js";
import { withStorageMaintenance } from "../../src/storage/maintenance.js";
import { prepareMigrationSourceRollback } from "../../src/storage/migration-rollback-preparation.js";
import { stageMigrationSourceRollback } from "../../src/storage/migration-rollback-source-stage.js";
import { taskStorageKey } from "../../src/core/task-identity.js";
import { TEST_TASK_ID } from "./storage-fixtures.js";
import { addLegacyBinaryAttachment } from "./storage-binary-source-fixture.js";
const [target,mode]=process.argv.slice(2);
const reference=mode === "PREPARING_BINARY" ? await addLegacyBinaryAttachment(target,"stage-recovery-binary") : null;
await migrateProjectStorage(target,{destination:"retained",writersQuiesced:true});
await withStorageMaintenance(target,async()=>{
 const options={writersQuiesced:true};await prepareMigrationSourceRollback(target,"retained",options);
 const staged=await stageMigrationSourceRollback(target,"retained",options);
 const relative=`.forgeloop/task-state/${taskStorageKey(TEST_TASK_ID)}/task.json`;
 if(mode.startsWith("PREPARING") || mode === "UNRECORDED"){
  staged.manifest.phase="PREPARING";
  await writeFile(path.join(staged.root,"source-stage.json"),JSON.stringify(staged.manifest));
 }
 if(mode === "PREPARING_PARTIAL")await writeFile(path.join(staged.source,relative),"retained incomplete descriptor");
 if(mode === "PREPARING_MISSING")await rm(staged.source,{recursive:true});
 if(reference)await writeFile(path.join(staged.source,reference.path),"retained incomplete binary");
 process.send({ownerId:staged.manifest.ownerId,root:staged.root,source:staged.source,reference,relative});
 await new Promise(()=>setInterval(()=>{},1000));
},{retainOnError:true});
