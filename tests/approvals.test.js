import { ensureFixtureTask } from "./helpers/native-storage-fixture.js";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { proposeAction } from "../src/core/actions.js";
import {
  listApprovals,
  readApproval,
  requestApproval,
  resolveApproval,
  validateApprovalForAction,
} from "../src/core/approvals.js";
import { getPackageRoot } from "../src/core/templates.js";
import { createWorkState, writeWorkState } from "../src/core/work-state.js";

const packageRoot = getPackageRoot();
const fingerprint = "a".repeat(64);

async function setup() {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-approvals-"));
  const taskId = "approval-task";
  await ensureFixtureTask(target, taskId, packageRoot);
  await writeWorkState(target, createWorkState({
    taskId,
    contractFingerprint: fingerprint,
    phase: "EXECUTING",
    revision: 4,
  }), { packageRoot, taskId });
  const { action } = await proposeAction(target, { packageRoot, taskId, input: {
    actionId: "action-push",
    effectClass: "EXTERNAL_PUBLICATION",
    capability: "repository.push",
    target: "origin/main",
    operation: "push branch",
    idempotencyKey: "approval-task:push:v1",
    requiredForCompletion: true,
    requirement: "publication",
    provenance: "HOST_REPORTED",
  } });
  return { target, taskId, action };
}

test("approval persists and is readable by a fresh invocation", async () => {
  const fixture = await setup();
  try {
    const input = {
      approvalId: "approval-push",
      actionId: fixture.action.actionId,
      actionFingerprint: fixture.action.actionFingerprint,
      contractFingerprint: fingerprint,
      taskRevision: 4,
      capability: fixture.action.capability,
      reason: "publish the reviewed branch",
    };
    await requestApproval(fixture.target, { packageRoot, taskId: fixture.taskId, input });
    const fresh = await readApproval(fixture.target, {
      packageRoot, taskId: fixture.taskId, approvalId: input.approvalId,
    });
    assert.equal(fresh.status, "PENDING");
    assert.equal((await listApprovals(fixture.target, { packageRoot, taskId: fixture.taskId })).length, 1);
  } finally {
    await rm(fixture.target, { recursive: true, force: true });
  }
});

test("approval resolution is one-time and current binding validates", async () => {
  const fixture = await setup();
  try {
    await requestApproval(fixture.target, { packageRoot, taskId: fixture.taskId, input: {
      approvalId: "approval-push", actionId: fixture.action.actionId,
      actionFingerprint: fixture.action.actionFingerprint, contractFingerprint: fingerprint,
      taskRevision: 4, capability: fixture.action.capability,
    } });
    await resolveApproval(fixture.target, { packageRoot, taskId: fixture.taskId,
      approvalId: "approval-push", decision: "APPROVED", authorityKind: "CALLER_ACKNOWLEDGED" });
    const validated = await validateApprovalForAction(fixture.target, { packageRoot,
      taskId: fixture.taskId, action: fixture.action, approvalId: "approval-push" });
    assert.equal(validated.status, "APPROVED");
    await assert.rejects(resolveApproval(fixture.target, { packageRoot, taskId: fixture.taskId,
      approvalId: "approval-push", decision: "REJECTED", authorityKind: "CALLER_ACKNOWLEDGED" }),
    (error) => error.code === "E_APPROVAL_ALREADY_RESOLVED");
  } finally {
    await rm(fixture.target, { recursive: true, force: true });
  }
});


test("approval listing and payload reads refuse legacy authority without changing retained bytes",async()=>{
 const target=await mkdtemp(path.join(os.tmpdir(),"forgeloop-approval-retired-files-"));
 try{
  const {taskApprovalPath}=await import("../src/core/task-paths.js");
  const filename=path.join(target,taskApprovalPath("legacy-approval","approval-retained"));
  const bytes=Buffer.from('{"status":"APPROVED","decision":"ALLOW"}');
  await mkdir(path.dirname(filename),{recursive:true});await writeFile(filename,bytes);
  await assert.rejects(listApprovals(target,{packageRoot,taskId:"legacy-approval"}),{code:"E_STORAGE_MIGRATION_REQUIRED"});
  await assert.rejects(readApproval(target,{packageRoot,taskId:"legacy-approval",approvalId:"approval-retained"}),{code:"E_STORAGE_MIGRATION_REQUIRED"});
  assert.deepEqual(await readFile(filename),bytes);
  await assert.rejects(readFile(path.join(target,".forgeloop/state.sqlite")),{code:"ENOENT"});
 }finally{await rm(target,{recursive:true,force:true});}
});
