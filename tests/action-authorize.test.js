import { removeTempTree } from "./helpers/rm-safe.js";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runActionAuthorize } from "../src/commands/action-authorize.js";
import { proposeAction, readAction } from "../src/core/actions.js";
import { createTaskDescriptor, writeTaskDescriptor } from "../src/core/task-descriptor.js";
import { requestApproval, resolveApproval } from "../src/core/approvals.js";
import { createWorkState, writeWorkState } from "../src/core/work-state.js";
import { seedPolicyEpoch } from "./helpers/durable-policy.js";
import { getPackageRoot } from "../src/core/templates.js";

const packageRoot = getPackageRoot();
const fingerprint = "a".repeat(64);
const trustedAuthority = Object.freeze({
  trustMode: "HOST_ATTESTED", hostSupplied: true, source: "host-boundary", grantRef: "grant-authorize-1",
});

async function allowFixture(taskId) {
  const target = await mkdtemp(path.join(os.tmpdir(), `forgeloop-authorize-${taskId}-`));
  await writeTaskDescriptor(target, createTaskDescriptor({ taskId, writeClaims: ["src"] }), packageRoot);
  await seedPolicyEpoch(target, packageRoot, taskId, {
    schemaVersion: 1, defaultDecision: "ALLOW", rules: [],
  });
  const { action } = await proposeAction(target, { packageRoot, taskId, input: {
    actionId: "action-publish", effectClass: "EXTERNAL_PUBLICATION", capability: "external.publish",
    target: "registry/release", operation: "publish release",
    idempotencyKey: `${taskId}:publish:v1`, requiredForCompletion: true,
    requirement: "publication", provenance: "CALLER_REPORTED",
  } });
  return { target, taskId, action };
}

test("action-authorize delegates to the canonical authorization service under ALLOW", async () => {
  const fixture = await allowFixture("allow");
  try {
    const result = await runActionAuthorize({
      target: fixture.target, packageRoot, taskId: fixture.taskId, actionId: fixture.action.actionId,
    });
    assert.equal(result.action.state, "AUTHORIZED");
    assert.equal(result.authorization.capabilityDecision, "ALLOW");
  } finally { await removeTempTree(fixture.target); }
});

test("action-authorize REQUIRE_AUTHORITY fails without host context and succeeds with trusted host context", async () => {
  const withoutHost = await mkdtemp(path.join(os.tmpdir(), "forgeloop-authorize-ra-nohost-"));
  const taskIdNoHost = "authorize-ra-nohost";
  try {
    const { action } = await (async () => {
      await writeTaskDescriptor(withoutHost, createTaskDescriptor({ taskId: taskIdNoHost, writeClaims: ["src"] }), packageRoot);
      await seedPolicyEpoch(withoutHost, packageRoot, taskIdNoHost, {
        schemaVersion: 1, defaultDecision: "DENY",
        rules: [{ capability: "repository.push", decision: "REQUIRE_AUTHORITY" }],
      });
      return proposeAction(withoutHost, { packageRoot, taskId: taskIdNoHost, input: {
        actionId: "action-push", effectClass: "EXTERNAL_PUBLICATION", capability: "repository.push",
        target: "origin/main", operation: "push", idempotencyKey: "ra:push:v1",
        requiredForCompletion: false, requirement: null, provenance: "CALLER_REPORTED",
      } });
    })();

    // Actor-supplied fake authority inside the command arguments is not a
    // parameter of the command surface at all; passing it via the core call
    // with an untrusted context must still fail closed.
    await assert.rejects(
      runActionAuthorize({ target: withoutHost, packageRoot, taskId: taskIdNoHost,
        actionId: action.actionId,
        authorityContext: { trustMode: "HOST_ATTESTED", hostSupplied: false, source: "cli-flag" } }),
      (error) => error.code === "E_ACTION_AUTHORITY_REQUIRED",
    );

    const result = await runActionAuthorize({ target: withoutHost, packageRoot, taskId: taskIdNoHost,
      actionId: action.actionId, authorityContext: trustedAuthority });
    assert.equal(result.action.state, "AUTHORIZED");
    assert.equal(result.authorization.authorityKind, "HOST_ATTESTED");
    assert.equal(result.authorization.authorityRef, "grant-authorize-1");
  } finally { await removeTempTree(withoutHost); }
});

test("action-authorize binds a host-approved approval into authorization evidence", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-authorize-appr-"));
  const taskId = "authorize-appr";
  try {
    await writeTaskDescriptor(target, createTaskDescriptor({ taskId, writeClaims: ["src"] }), packageRoot);
    await seedPolicyEpoch(target, packageRoot, taskId, {
      schemaVersion: 1, defaultDecision: "DENY",
      rules: [{ capability: "repository.push", decision: "REQUIRE_APPROVAL" }],
    });
    const { action } = await proposeAction(target, { packageRoot, taskId, input: {
      actionId: "action-push", effectClass: "EXTERNAL_PUBLICATION", capability: "repository.push",
      target: "origin/main", operation: "push", idempotencyKey: "appr:push:v1",
      requiredForCompletion: true, requirement: "publication", provenance: "CALLER_REPORTED",
    } });
    await writeWorkState(target, createWorkState({
      taskId, contractFingerprint: fingerprint, phase: "EXECUTING", revision: 4,
    }), { packageRoot, taskId });
    await requestApproval(target, { packageRoot, taskId, input: {
      approvalId: "approval-push", actionId: action.actionId,
      actionFingerprint: action.actionFingerprint, contractFingerprint: fingerprint,
      taskRevision: 4, capability: action.capability,
    } });
    await resolveApproval(target, { packageRoot, taskId, approvalId: "approval-push",
      decision: "APPROVED", authorityKind: "HOST_ATTESTED", hostGrantRef: "grant-appr-9",
      authorityContext: { ...trustedAuthority, grantRef: "grant-appr-9" } });

    const result = await runActionAuthorize({ target, packageRoot, taskId,
      actionId: action.actionId, approvalId: "approval-push", authorityContext: undefined });

    assert.equal(result.action.state, "AUTHORIZED");
    assert.equal(result.authorization.capabilityDecision, "REQUIRE_APPROVAL");
    assert.equal(result.authorization.approvalId, "approval-push");
    assert.match(result.authorization.approvalFingerprint, /^[a-f0-9]{64}$/);
    assert.equal(result.authorization.authorityKind, "HOST_ATTESTED");
    assert.equal(result.authorization.authorityRef, "grant-appr-9");

    const current = await readAction(target, { packageRoot, taskId, actionId: action.actionId });
    assert.equal(current.state, "AUTHORIZED");
  } finally { await removeTempTree(target); }
});
