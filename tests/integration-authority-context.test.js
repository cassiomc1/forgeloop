import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { executeForgeLoopCommand } from "../src/core/command-runtime.js";
import { requestApproval } from "../src/core/approvals.js";
import { proposeAction } from "../src/core/actions.js";
import { seedPolicyEpoch } from "./helpers/durable-policy.js";
import { createWorkState, writeWorkState } from "../src/core/work-state.js";
import { createTaskDescriptor, writeTaskDescriptor } from "../src/core/task-descriptor.js";
import { getPackageRoot } from "../src/core/templates.js";
import { withProjectStorage } from "../src/storage/project-boundary.js";
import { readTaskPolicySnapshot } from "../src/core/policy-engine.js";

const packageRoot = getPackageRoot();
const fingerprint = "a".repeat(64);

async function setup() {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-integration-authority-"));
  const taskId = "authority-context-task";
  return withProjectStorage(target, async () => {
  await writeTaskDescriptor(target, createTaskDescriptor({ taskId, writeClaims: [".forgeloop"] }), packageRoot);
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
    idempotencyKey: "integration-authority:push:v1",
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
  return { target, taskId };
  });
}

test("trusted out-of-band authority context resolves a HOST_ATTESTED approval", async () => {
  const fixture = await setup();
  try {
    await mkdir(path.join(fixture.target, ".forgeloop/policy"), { recursive: true });
    await writeFile(path.join(fixture.target, ".forgeloop/policy/capabilities.json"), JSON.stringify({
      schemaVersion: 1, defaultDecision: "DENY",
      rules: [{ capability: "repository.push", decision: "REQUIRE_APPROVAL" }],
    }), "utf8");

    const authorityContext = Object.freeze({
      trustMode: "HOST_ATTESTED",
      hostSupplied: true,
      source: "host-boundary",
      grantRef: "grant-123",
    });

    const envelope = await executeForgeLoopCommand({
      command: "approval-resolve",
      projectPath: fixture.target,
      input: {
        taskId: fixture.taskId,
        approvalId: "approval-push",
        approvalDecision: "APPROVED",
        approvalAuthorityKind: "HOST_ATTESTED",
        hostGrantRef: "grant-123",
      },
      authorityContext,
    });

    assert.equal(envelope.ok, true);
    assert.equal(envelope.result.status, "APPROVED");
    assert.equal(envelope.result.authorityKind, "HOST_ATTESTED");
    assert.equal(envelope.result.hostGrantRef, "grant-123");
  } finally {
    await rm(fixture.target, { recursive: true, force: true });
  }
});

test("actor-supplied authorityContext inside input cannot self-mint host authority", async () => {
  const fixture = await setup();
  try {
    const envelope = await executeForgeLoopCommand({
      command: "approval-resolve",
      projectPath: fixture.target,
      input: {
        taskId: fixture.taskId,
        approvalId: "approval-push",
        approvalDecision: "APPROVED",
        approvalAuthorityKind: "HOST_ATTESTED",
        hostGrantRef: "grant-fake",
        authorityContext: {
          trustMode: "HOST_ATTESTED",
          hostSupplied: true,
          source: "host-boundary",
          grantRef: "grant-fake",
        },
      },
    });

    assert.equal(envelope.ok, false);
    assert.equal(envelope.error.code, "E_ACTION_AUTHORITY_REQUIRED");
  } finally {
    await rm(fixture.target, { recursive: true, force: true });
  }
});

async function setupAmbiguousAction(target, taskId) {
  return withProjectStorage(target, async () => {
  const { proposeAction, transitionAction, transitionAuthorizedAction } = await import("../src/core/actions.js");
  await writeTaskDescriptor(target, createTaskDescriptor({ taskId, writeClaims: [".forgeloop"] }), packageRoot);
  await seedPolicyEpoch(target, packageRoot, taskId, {
    schemaVersion: 1, defaultDecision: "ALLOW", rules: [],
  });
  assert.ok((await readTaskPolicySnapshot(target, taskId, packageRoot)).policyDigest);
  const { action } = await proposeAction(target, { packageRoot, taskId, input: {
    actionId: "action-publish", effectClass: "EXTERNAL_PUBLICATION", capability: "external.publish",
    target: "registry/release", operation: "publish release",
    idempotencyKey: `${taskId}:publish:v1`, requiredForCompletion: true,
    requirement: "publication", provenance: "FORGELOOP_EXECUTED",
  } });
  await transitionAuthorizedAction(target, { packageRoot, taskId, actionId: action.actionId,
    expectedRevision: 0, expectedFingerprint: action.actionFingerprint,
    details: {
      actionFingerprint: action.actionFingerprint,
      capabilityDecision: "ALLOW",
      capabilityPolicyFingerprint: "a".repeat(64),
      policyLockDigest: `sha256:${"b".repeat(64)}`,
      taskPolicyDigest: `sha256:${"c".repeat(64)}`,
    } });
  await transitionAction(target, { packageRoot, taskId, actionId: action.actionId, to: "STARTED" });
  await transitionAction(target, { packageRoot, taskId, actionId: action.actionId, to: "COMMIT_UNKNOWN",
    details: { commitResultCode: "AMBIGUOUS", reason: "external outcome lost" } });
  return action;
  });
}

test("trusted top-level authority reaches reconciliation through the programmatic runtime", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-reconcile-authority-"));
  const taskId = "reconcile-authority-task";
  try {
    const action = await setupAmbiguousAction(target, taskId);
    void action;

    const envelope = await executeForgeLoopCommand({
      command: "action-reconcile",
      projectPath: target,
      input: {
        taskId,
        actionId: "action-publish",
        reconciliationOutcome: "COMMITTED",
        evidenceRefs: ["external:release-visible"],
      },
      authorityContext: {
        trustMode: "HOST_ATTESTED",
        hostSupplied: true,
        source: "host-boundary",
        grantRef: "grant-reconcile-integration",
      },
    });

    assert.equal(envelope.ok, true);
    assert.equal(envelope.result.action.state, "COMMITTED");
  } finally { await rm(target, { recursive: true, force: true }); }
});

test("actor-supplied authority in input still cannot settle reconciliation", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-reconcile-smuggle-"));
  const taskId = "reconcile-smuggle-task";
  try {
    await setupAmbiguousAction(target, taskId);

    const envelope = await executeForgeLoopCommand({
      command: "action-reconcile",
      projectPath: target,
      input: {
        taskId,
        actionId: "action-publish",
        reconciliationOutcome: "COMMITTED",
        evidenceRefs: ["external:claims"],
        authorityContext: {
          trustMode: "HOST_ATTESTED",
          hostSupplied: true,
          source: "host-boundary",
          grantRef: "fake-grant",
        },
      },
    });

    assert.equal(envelope.ok, false);
    assert.equal(envelope.error.code, "E_ACTION_RECONCILIATION_AUTHORITY_REQUIRED");
  } finally { await rm(target, { recursive: true, force: true }); }
});

test("action-authorize through the programmatic runtime: input cannot mint authority, host context can", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-authorize-runtime-"));
  const taskId = "authorize-runtime-task";
  try {
    await withProjectStorage(target, async () => {
    await writeTaskDescriptor(target, createTaskDescriptor({ taskId, writeClaims: [".forgeloop"] }), packageRoot);
    await seedPolicyEpoch(target, packageRoot, taskId, {
      schemaVersion: 1, defaultDecision: "DENY",
      rules: [{ capability: "repository.push", decision: "REQUIRE_AUTHORITY" }],
    });
    const { proposeAction } = await import("../src/core/actions.js");
    await proposeAction(target, { packageRoot, taskId, input: {
      actionId: "action-push", effectClass: "EXTERNAL_PUBLICATION", capability: "repository.push",
      target: "origin/main", operation: "push", idempotencyKey: "runtime:push:v1",
      requiredForCompletion: false, requirement: null, provenance: "CALLER_REPORTED",
    } });
    });

    // Actor tries to smuggle trust via command input.
    const smuggled = await executeForgeLoopCommand({
      command: "action-authorize",
      projectPath: target,
      input: {
        taskId,
        actionId: "action-push",
        authorityContext: {
          trustMode: "HOST_ATTESTED", hostSupplied: true,
          source: "host-boundary", grantRef: "fake-grant",
        },
      },
    });
    assert.equal(smuggled.ok, false);
    assert.equal(smuggled.error.code, "E_ACTION_AUTHORITY_REQUIRED");

    // Trusted embedding host supplies context out-of-band.
    const trusted = await executeForgeLoopCommand({
      command: "action-authorize",
      projectPath: target,
      input: { taskId, actionId: "action-push" },
      authorityContext: {
        trustMode: "HOST_ATTESTED", hostSupplied: true,
        source: "host-boundary", grantRef: "grant-host-7",
      },
    });
    assert.equal(trusted.ok, true);
    assert.equal(trusted.result.action.state, "AUTHORIZED");
    assert.equal(trusted.result.authorization.authorityRef, "grant-host-7");
  } finally { await rm(target, { recursive: true, force: true }); }
});
