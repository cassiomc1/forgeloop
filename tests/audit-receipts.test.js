import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { auditReceipts } from "../scripts/audit-receipts.mjs";
import { taskDirectory } from "../src/core/task-paths.js";
import { removeTempTree } from "./helpers/rm-safe.js";

for (const count of [0, 1, 2]) test(`receipt CI handles ${count} supplied task receipts explicitly`, async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "receipt-ci-"));
  t.after(() => removeTempTree(root));
  for (let i = 0; i < count; i += 1) {
    const taskId = `task-${i}`;
    const dir = path.join(root, taskDirectory(taskId));
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "execution-receipt.json"), JSON.stringify({ taskId }));
  }
  const calls = [];
  const result = await auditReceipts({ root, execute: (args) => { calls.push(args); return { status: 0 }; } });
  assert.equal(result.status, count ? "VERIFIED" : "NOT_VERIFIED");
  assert.equal(calls.length, count);
  for (let i = 0; i < count; i += 1) assert.deepEqual(calls[i], ["src/cli.js", "audit", "--strict", "--task", `task-${i}`]);
  if (count) await assert.rejects(auditReceipts({ root, execute: () => ({ status: 1 }) }), /audit failed/u);
});


test("receipt CI selects canonical SQLite receipts and ignores legacy shadow files",async(t)=>{
 const {ensureFixtureTask}=await import("./helpers/native-storage-fixture.js");
 const {writeJsonArtifact}=await import("../src/core/artifacts.js");
 const {taskArtifactPath}=await import("../src/core/task-paths.js");
 const {getPackageRoot}=await import("../src/core/templates.js");const packageRoot=getPackageRoot();
 const root=await mkdtemp(path.join(os.tmpdir(),"receipt-ci-native-"));t.after(()=>removeTempTree(root));
 const receipt=JSON.parse(await readFile(path.join(packageRoot,"tests/fixtures/schemas/execution-receipt/valid.json"),"utf8"));
 const ids=["native-receipt-b","native-receipt-a"];
 for(const taskId of ids){await ensureFixtureTask(root,taskId,packageRoot);await writeJsonArtifact(root,taskArtifactPath(taskId,"receipt"),{...receipt,taskId},"execution-receipt",packageRoot);}
 await assert.rejects(readdir(path.join(root,".forgeloop/task-state")),{code:"ENOENT"});
 await writeFile(path.join(root,".forgeloop/execution-receipt.json"),'malformed legacy shadow');
 const calls=[];assert.deepEqual(await auditReceipts({root,execute:args=>{calls.push(args);return {status:0};}}),{status:"VERIFIED",audited:2});
 assert.deepEqual(calls,ids.toSorted().map(taskId=>["src/cli.js","audit","--strict","--task",taskId]));
 await assert.rejects(auditReceipts({root,execute:()=>({status:1})}),/audit failed/);
 // A discovered receipt does not itself prove protocol validity: real CLI audit rejects these incomplete tasks.
 await assert.rejects(auditReceipts({root}),/audit failed/);
 const {overwriteFixtureText}=await import("./helpers/native-storage-fixture.js");
 await overwriteFixtureText(root,taskArtifactPath(ids[0],"receipt"),JSON.stringify({...receipt,taskId:"wrong-receipt-owner"}));
 const refusedCalls=[];await assert.rejects(auditReceipts({root,execute:args=>{refusedCalls.push(args);return {status:0};}}),/mismatched task identity/);assert.deepEqual(refusedCalls,[]);
});

test("receipt CI refuses missing native authority without allocating a replacement",async(t)=>{
 const root=await mkdtemp(path.join(os.tmpdir(),"receipt-ci-native-missing-"));t.after(()=>removeTempTree(root));
 await mkdir(path.join(root,".forgeloop"));await writeFile(path.join(root,".forgeloop/state.sqlite-wal"),'retained orphan bytes');
 let calls=0;await assert.rejects(auditReceipts({root,execute:()=>{calls++;return {status:0};}}),{code:"E_STORAGE_MIGRATION_REQUIRED"});assert.equal(calls,0);
 assert.deepEqual(await readdir(path.join(root,".forgeloop")),["state.sqlite-wal"]);assert.equal(await readFile(path.join(root,".forgeloop/state.sqlite-wal"),"utf8"),'retained orphan bytes');
});
