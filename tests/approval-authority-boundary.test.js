import { ensureFixtureTask, readFixtureText, overwriteFixtureRecordBytes } from "./helpers/native-storage-fixture.js";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { proposeAction } from "../src/core/actions.js";
import { requestApproval, resolveApproval } from "../src/core/approvals.js";
import { taskApprovalPath } from "../src/core/task-paths.js";
import { evaluateActionCapability } from "../src/core/capability-policy.js";
import { createWorkState, writeWorkState } from "../src/core/work-state.js";
import { getPackageRoot } from "../src/core/templates.js";

const packageRoot = getPackageRoot();
const fingerprint = "a".repeat(64);

async function setup() {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-approval-authority-"));
  await mkdir(path.join(target, ".forgeloop", "policy"), { recursive: true });
  await writeFile(path.join(target, ".forgeloop", "policy", "capabilities.json"), JSON.stringify({
    schemaVersion: 1,
    defaultDecision: "DENY",
    rules: [{ capability: "repository.push", decision: "REQUIRE_APPROVAL" }],
  }), "utf8");
  const taskId = "approval-authority-task";
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
    idempotencyKey: "approval-authority:push:v1",
    requiredForCompletion: true,
    requirement: "publication",
    provenance: "FORGELOOP_EXECUTED",
  } });
  await requestApproval(target, { packageRoot, taskId, input: {
    approvalId: "approval-push",
    actionId: action.actionId,
    actionFingerprint: action.actionFingerprint,
    contractFingerprint: fingerprint,
    taskRevision: 4,
    capability: action.capability,
  } });
  return { target, taskId, action };
}

test("CALLER_ACKNOWLEDGED approval does not satisfy REQUIRE_APPROVAL", async () => {
  const fixture = await setup();
  try {
    await resolveApproval(fixture.target, {
      packageRoot,
      taskId: fixture.taskId,
      approvalId: "approval-push",
      decision: "APPROVED",
      authorityKind: "CALLER_ACKNOWLEDGED",
    });
    const result = await evaluateActionCapability({
      target: fixture.target,
      packageRoot,
      action: fixture.action,
      approval: { approvalId: "approval-push" },
    });
    assert.equal(result.allowed, false);
    assert.equal(result.reasonCode, "E_ACTION_AUTHORITY_REQUIRED");
  } finally {
    await rm(fixture.target, { recursive: true, force: true });
  }
});

test("HOST_ATTESTED approval from a trusted host boundary satisfies REQUIRE_APPROVAL", async () => {
  const fixture = await setup();
  try {
    const authorityContext = {
      trustMode: "HOST_ATTESTED",
      hostSupplied: true,
      source: "host-boundary",
      grantRef: "approval-grant-1",
    };
    await resolveApproval(fixture.target, {
      packageRoot,
      taskId: fixture.taskId,
      approvalId: "approval-push",
      decision: "APPROVED",
      authorityKind: "HOST_ATTESTED",
      hostGrantRef: "approval-grant-1",
      authorityContext,
    });
    const result = await evaluateActionCapability({
      target: fixture.target,
      packageRoot,
      action: fixture.action,
      approval: { approvalId: "approval-push" },
    });
    assert.equal(result.allowed, true);
    assert.equal(result.approval.approvalId, "approval-push");
    assert.equal(result.approval.authorityKind, "HOST_ATTESTED");
    assert.equal(result.approval.authorityRef, "approval-grant-1");
    assert.match(result.approval.approvalFingerprint, /^[a-f0-9]{64}$/);
  } finally {
    await rm(fixture.target, { recursive: true, force: true });
  }
});

test("replaced approval content after authorization is detectable via the bound fingerprint", async () => {
  const fixture = await setup();
  try {
    const authorityContext = { trustMode: "HOST_ATTESTED", hostSupplied: true, source: "host-boundary", grantRef: "grant-1" };
    await resolveApproval(fixture.target, {
      packageRoot, taskId: fixture.taskId, approvalId: "approval-push",
      decision: "APPROVED", authorityKind: "HOST_ATTESTED", hostGrantRef: "grant-1",
      authorityContext,
    });
    const result = await evaluateActionCapability({
      target: fixture.target, packageRoot, action: fixture.action,
      approval: { approvalId: "approval-push" },
    });
    assert.equal(result.allowed, true);
    const boundFingerprint = result.approval.approvalFingerprint;

    // Mutate the resolved approval artifact behind the protocol's back.
    const approvalPath = taskApprovalPath(fixture.taskId, "approval-push");
    const absolute = path.join(fixture.target, approvalPath);
    const approval = JSON.parse(await readFixtureText(fixture.target, absolute));
    approval.hostGrantRef = "tampered-grant";
    await overwriteFixtureRecordBytes(fixture.target, absolute, JSON.stringify(approval, null, 2) + "\n");

    const { readApproval, approvalFingerprint } = await import("../src/core/approvals.js");
    const current = await readApproval(fixture.target, { packageRoot, taskId: fixture.taskId, approvalId: "approval-push" });
    assert.notEqual(approvalFingerprint(current), boundFingerprint);
  } finally {
    await rm(fixture.target, { recursive: true, force: true });
  }
});
