import { removeTempTree } from "./helpers/rm-safe.js";
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { verifyRollbackLegacyTarget } from "../src/storage/migration-rollback-release.js";
for(const mode of ["missing","unsupported","modified"])test(`rollback release refuses ${mode} validator checkout`,async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),"forgeloop-release-target-"));
 try{
  if(mode === "unsupported"){
   execFileSync("git",["init","-q",root]);await writeFile(path.join(root,"seed"),"unsupported");
   execFileSync("git",["-C",root,"add","seed"]);
   execFileSync("git",["-C",root,"-c","user.name=Fixture","-c","user.email=fixture@example.invalid","commit","-qm","seed"]);
  }
  if(mode === "modified"){
   const packageRoot=fileURLToPath(new URL("..",import.meta.url));
   execFileSync("git",["clone","-q","--no-hardlinks",packageRoot,root]);
   execFileSync("git",["-C",root,"checkout","-q","ee9ce11123d4e728d3dbc92f5d62d4bf41bb79c5"]);
   await writeFile(path.join(root,"src/cli.js"),"modified validator");
  }
  await assert.rejects(verifyRollbackLegacyTarget(root),{code:"E_STORAGE_SOURCE_ROLLBACK_VALIDATION_INVALID"});
 }finally{await removeTempTree(root);}
});
