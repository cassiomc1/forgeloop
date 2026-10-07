import { readFixtureText, overwriteFixtureText } from "./helpers/native-storage-fixture.js";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { proposeAction } from "../src/core/actions.js";
import { authorizeAction } from "../src/core/action-authorization.js";
import { evaluateActionReadiness } from "../src/core/action-readiness.js";
import { requestApproval, resolveApproval } from "../src/core/approvals.js";
import { createWorkState, writeWorkState } from "../src/core/work-state.js";
import { createTaskDescriptor, writeTaskDescriptor } from "../src/core/task-descriptor.js";
import { taskApprovalPath } from "../src/core/task-paths.js";
import { seedPolicyEpoch } from "./helpers/durable-policy.js";
import { getPackageRoot } from "../src/core/templates.js";

const packageRoot = getPackageRoot();
const fingerprint = "a".repeat(64);

async function authorizedApprovalFixture(suffix) {
  const target = await mkdtemp(path.join(os.tmpdir(), `forgeloop-approval-integrity-${suffix}-`));
  const taskId = `approval-integrity-${suffix}`;
  await writeTaskDescriptor(target, createTaskDescriptor({ taskId, writeClaims: ["src"] }), packageRoot);
  await seedPolicyEpoch(target, packageRoot, taskId, {
    schemaVersion: 1,
    defaultDecision: "DENY",
    rules: [{ capability: "repository.push", decision: "REQUIRE_APPROVAL" }],
  });
  const { action } = await proposeAction(target, { packageRoot, taskId, input: {
    actionId: "action-push", effectClass: "EXTERNAL_PUBLICATION",
    capability: "repository.push", target: "origin/main", operation: "push branch",
    idempotencyKey: `${taskId}:push:v1`, requiredForCompletion: true,
    requirement: "publication", provenance: "FORGELOOP_EXECUTED",
  } });
  const state = createWorkState({
    taskId, contractFingerprint: fingerprint, phase: "EXECUTING", revision: 4,
  });
  await writeWorkState(target, state, { packageRoot, taskId });
  await requestApproval(target, { packageRoot, taskId, input: {
    approvalId: "approval-push", actionId: action.actionId,
    actionFingerprint: action.actionFingerprint, contractFingerprint: fingerprint,
    taskRevision: 4, capability: action.capability,
  } });
  const authorityContext = {
    trustMode: "HOST_ATTESTED", hostSupplied: true, source: "host-boundary", grantRef: "grant-1",
  };
  await resolveApproval(target, { packageRoot, taskId, approvalId: "approval-push",
    decision: "APPROVED", authorityKind: "HOST_ATTESTED", hostGrantRef: "grant-1", authorityContext });

  const result = await authorizeAction({ target, packageRoot, taskId, actionId: action.actionId,
    approvalId: "approval-push", authorityContext });
  assert.equal(result.authorization.capabilityDecision, "REQUIRE_APPROVAL");
  return { target, taskId, authorization: result.authorization, action: result.action };
}

test("post-authorization approval mutation makes readiness UNTRUSTED with an approval-integrity reason", async () => {
  const fixture = await authorizedApprovalFixture("tamper");
  try {
    // Untampered: readable AUTHORIZED readiness (pending execution).
    const before = await evaluateActionReadiness({ target: fixture.target, packageRoot,
      taskId: fixture.taskId, action: fixture.action });
    assert.equal(before.status, "PENDING");

    // Mutate the resolved approval artifact behind the protocol's back.
    const approvalPath = path.join(fixture.target, taskApprovalPath(fixture.taskId, "approval-push"));
    const approval = JSON.parse(await readFixtureText(fixture.target, approvalPath));
    approval.hostGrantRef = "tampered-grant";
    await overwriteFixtureText(fixture.target, approvalPath, JSON.stringify(approval, null, 2) + "\n", "utf8");

    const after = await evaluateActionReadiness({ target: fixture.target, packageRoot,
      taskId: fixture.taskId, action: fixture.action });
    assert.equal(after.status, "UNTRUSTED");
    assert.ok(after.reasons.some((reason) => reason.includes("bound approval integrity failed")));
  } finally { await rm(fixture.target, { recursive: true, force: true }); }
});

test("untampered bound approval keeps authorization trusted", async () => {
  const fixture = await authorizedApprovalFixture("intact");
  try {
    const { validateBoundApprovalFingerprint } = await import("../src/core/approvals.js");
    const verdict = await validateBoundApprovalFingerprint(fixture.target, {
      packageRoot, taskId: fixture.taskId, approvalId: "approval-push",
      expectedFingerprint: fixture.authorization.approvalFingerprint,
    });
    assert.equal(verdict.fingerprint, fixture.authorization.approvalFingerprint);
  } finally { await rm(fixture.target, { recursive: true, force: true }); }
});

test("post-authorization approval mutation is audit-visible", async () => {
  const fixture = await authorizedApprovalFixture("audit");
  try {
    const { evaluateAudit } = await import("../src/core/audit.js");
    const before = await evaluateAudit({ target: fixture.target, packageRoot, taskId: fixture.taskId });
    assert.equal(
      before.errors.some((error) => error.actionId === fixture.authorization.approvalId || error.readiness === "UNTRUSTED"),
      false,
      "untampered approval produces no untrusted-readiness audit error",
    );

    const approvalPath = path.join(fixture.target, taskApprovalPath(fixture.taskId, "approval-push"));
    const approval = JSON.parse(await readFixtureText(fixture.target, approvalPath));
    approval.hostGrantRef = "tampered-grant";
    await overwriteFixtureText(fixture.target, approvalPath, JSON.stringify(approval, null, 2) + "\n", "utf8");

    const after = await evaluateAudit({ target: fixture.target, packageRoot, taskId: fixture.taskId });
    assert.notEqual(after.status, "VALID");
    assert.ok(after.errors.some((error) => error.readiness === "UNTRUSTED"),
      "tampered bound approval surfaces an untrusted-readiness audit error");
  } finally { await rm(fixture.target, { recursive: true, force: true }); }
});
