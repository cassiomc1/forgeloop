import { execFileSync } from "node:child_process";
import { mkdtemp, rm, symlink, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
const revision="ee9ce11123d4e728d3dbc92f5d62d4bf41bb79c5";
/** Offline independent baseline; never modify the source checkout or its index. */
export async function createPinnedFilesystemBaseline(sourceRoot){
 const root=await mkdtemp(path.join(os.tmpdir(),"forgeloop-pinned-fs-guard-"));
 try{
  execFileSync("git",["clone","--no-hardlinks","--no-checkout",sourceRoot,root],{stdio:"pipe",timeout:60000});
  execFileSync("git",["-C",root,"checkout","--detach",revision],{stdio:"pipe",timeout:60000});
  if(execFileSync("git",["-C",root,"rev-parse","HEAD"],{encoding:"utf8"}).trim()!==revision)throw new Error("Filesystem baseline revision differs");
  await symlink(await realpath(path.join(sourceRoot,"node_modules")),path.join(root,"node_modules"),process.platform==="win32"?"junction":"dir");
  const guards=await import(pathToFileURL(path.join(root,"src/core/task-claim-state.js")).href);
  return {root,guards,revision,cleanup:async()=>{try{execFileSync("git",["-C",root,"diff","--exit-code",revision,"--"],{stdio:"pipe",timeout:60000});}finally{await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});}}};
 }catch(error){await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});throw error;}
}
