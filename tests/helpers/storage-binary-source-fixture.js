import { cp } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { importProjectState } from "../../src/storage/importer.js";
import { registerAttachment } from "../../src/storage/attachment-references.js";
import { exportDatabase } from "../../src/storage/exporter.js";
import { TEST_TASK_ID } from "./storage-fixtures.js";

export const BINARY_SOURCE_BYTES=Object.freeze([0,255,128,13,10,0,65]);
/** Add a genuine referenced binary object and portable catalog to an owned legacy fixture. */
export async function addLegacyBinaryAttachment(target,referenceId){
 const {db}=await importProjectState(target,path.join(target,"binary-source-fixture.sqlite"));
 let reference;
 try{
  reference=await registerAttachment(db,target,{taskId:TEST_TASK_ID,referenceId,readable:Readable.from([Buffer.from(BINARY_SOURCE_BYTES)])});
  await exportDatabase(db,path.join(target,"binary-source-export"),{attachmentRoot:target});
 }finally{db.close();}
 await cp(path.join(target,"binary-source-export/export-index.json"),path.join(target,"export-index.json"));
 return reference;
}
