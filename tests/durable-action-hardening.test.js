import { ensureFixtureTask } from "./helpers/native-storage-fixture.js";
import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { executeDurableAction } from "../src/core/action-execution.js";
import { seedPolicyEpoch } from "./helpers/durable-policy.js";
import { proposeAction } from "../src/core/actions.js";
import { requestApproval, resolveApproval } from "../src/core/approvals.js";
import { resolveCapabilityDecision } from "../src/core/capability-policy.js";
import { readEvents } from "../src/core/events.js";
import { classifyForgeLoopInvocation, INTEGRATION_RISK_CLASSES } from "../src/core/integration-invocation-policy.js";
import { runActionPropose } from "../src/commands/action-propose.js";
import { createTaskDescriptor, writeTaskDescriptor } from "../src/core/task-descriptor.js";
import { taskDirectory } from "../src/core/task-paths.js";
import { createWorkState, writeWorkState } from "../src/core/work-state.js";
import { getPackageRoot } from "../src/core/templates.js";

const packageRoot = getPackageRoot();
const fingerprint = "a".repeat(64);

async function makeTarget(taskId = null, policy = {
  schemaVersion: 1,
  defaultDecision: "DENY",
  rules: [{ capability: "filesystem.write", decision: "ALLOW" }],
}) {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-durable-hardening-"));
  await mkdir(path.join(target, ".forgeloop", "policy"), { recursive: true });
  await writeFile(path.join(target, ".forgeloop", "policy", "capabilities.json"), JSON.stringify(policy), "utf8");
  if (taskId) await seedPolicyEpoch(target, packageRoot, taskId, policy);
  return target;
}

function writeActionInput(overrides = {}) {
  return {
    actionId: "action-write",
    effectClass: "REVERSIBLE_WRITE",
    capability: "filesystem.write",
    target: "sentinel.txt",
    operation: "write sentinel",
    idempotencyKey: "write:sentinel:v1",
    requiredForCompletion: false,
    requirement: null,
    ...overrides,
  };
}

test("started side effect that times out becomes COMMIT_UNKNOWN", async () => {
  const target = await makeTarget("task-timeout");
  const sentinel = path.join(target, "sentinel.txt");
  try {
    const result = await executeDurableAction({
      target,
      packageRoot,
      taskId: "task-timeout",
      input: writeActionInput(),
      timeoutMs: 1000,
      argv: [process.execPath, "-e", `require('fs').writeFileSync(${JSON.stringify(sentinel)},'committed'); setTimeout(() => {}, 10000)`],
    });
    assert.equal(await readFile(sentinel, "utf8"), "committed");
    assert.equal(result.execution.termination, "timeout");
    assert.equal(result.action.state, "COMMIT_UNKNOWN");
  } finally {
    await rm(target, { recursive: true, force: true });
  }
});

test("started side effect with non-zero exit becomes COMMIT_UNKNOWN", async () => {
  const target = await makeTarget("task-nonzero");
  const sentinel = path.join(target, "sentinel.txt");
  try {
    const result = await executeDurableAction({
      target,
      packageRoot,
      taskId: "task-nonzero",
      input: writeActionInput({ idempotencyKey: "write:sentinel:nonzero:v1" }),
      argv: [process.execPath, "-e", `require('fs').writeFileSync(${JSON.stringify(sentinel)},'committed'); process.exit(2)`],
    });
    assert.equal(await readFile(sentinel, "utf8"), "committed");
    assert.equal(result.execution.exitCode, 2);
    assert.equal(result.action.state, "COMMIT_UNKNOWN");
  } finally {
    await rm(target, { recursive: true, force: true });
  }
});

test("ACTION_AUTHORIZED records the exact capability-policy decision", async () => {
  const target = await makeTarget("task-policy-binding");
  try {
    const result = await executeDurableAction({
      target,
      packageRoot,
      taskId: "task-policy-binding",
      input: writeActionInput({ idempotencyKey: "write:binding:v1" }),
      argv: [process.execPath, "-e", "process.exit(0)"],
    });
    assert.equal(result.action.state, "COMMITTED");
    const events = await readEvents(target, packageRoot, { taskId: "task-policy-binding" });
    const authorized = events.find((event) => event.event === "ACTION_AUTHORIZED");
    assert.equal(authorized?.details?.capabilityDecision, "ALLOW");
    assert.match(authorized?.details?.capabilityPolicyFingerprint ?? "", /^[a-f0-9]{64}$/);
  } finally {
    await rm(target, { recursive: true, force: true });
  }
});

test("HOST_ATTESTED approval cannot be minted without a trusted host boundary", async () => {
  const target = await makeTarget();
  const taskId = "task-approval-boundary";
  try {
    await ensureFixtureTask(target, taskId, packageRoot);
    await writeWorkState(target, createWorkState({
      taskId,
      contractFingerprint: fingerprint,
      phase: "EXECUTING",
      revision: 4,
    }), { packageRoot, taskId });
    const { action } = await proposeAction(target, { packageRoot, taskId, input: {
      ...writeActionInput({
        actionId: "action-approve",
        idempotencyKey: "approval:boundary:v1",
      }),
      provenance: "FORGELOOP_EXECUTED",
    } });
    await requestApproval(target, { packageRoot, taskId, input: {
      approvalId: "approval-boundary",
      actionId: action.actionId,
      actionFingerprint: action.actionFingerprint,
      contractFingerprint: fingerprint,
      taskRevision: 4,
      capability: action.capability,
    } });

    await assert.rejects(
      resolveApproval(target, {
        packageRoot,
        taskId,
        approvalId: "approval-boundary",
        decision: "APPROVED",
        authorityKind: "HOST_ATTESTED",
        hostGrantRef: "self-asserted-grant",
      }),
      (error) => error.code === "E_ACTION_AUTHORITY_REQUIRED",
    );
  } finally {
    await rm(target, { recursive: true, force: true });
  }
});

test("public action-propose records caller provenance, never HOST_REPORTED", async () => {
  const target = await makeTarget();
  const taskId = "task-caller-provenance";
  try {
    await writeTaskDescriptor(target, createTaskDescriptor({ taskId }), packageRoot);
    const result = await runActionPropose({
      target,
      packageRoot,
      taskId,
      input: writeActionInput({ actionId: "action-caller", idempotencyKey: "caller:v1" }),
    });
    assert.equal(result.action.provenance, "CALLER_REPORTED");
  } finally {
    await rm(target, { recursive: true, force: true });
  }
});

test("approval resolution has a dedicated integration authority capability", () => {
  const classification = classifyForgeLoopInvocation("approval-resolve");
  assert.equal(classification.riskClass, INTEGRATION_RISK_CLASSES.AUTHORITY_MUTATION);
  assert.equal(classification.requiredCapability, "allowApprovalResolution");
});

test("known capability without an explicit rule uses defaultDecision", () => {
  const policy = { schemaVersion: 1, defaultDecision: "ALLOW", rules: [] };
  assert.deepEqual(resolveCapabilityDecision(policy, "network.read"), {
    decision: "ALLOW",
    reasonCode: null,
  });
});

test("durable action writes reject a symlinked actions directory", { skip: process.platform === "win32" }, async () => {
  const target = await makeTarget();
  const outside = await mkdtemp(path.join(os.tmpdir(), "forgeloop-actions-outside-"));
  const taskId = "task-symlink-actions";
  try {
    const taskDir = path.join(target, taskDirectory(taskId));
    await mkdir(taskDir, { recursive: true });
    await symlink(outside, path.join(taskDir, "actions"));
    await assert.rejects(
      proposeAction(target, { packageRoot, taskId, input: {
        ...writeActionInput({ actionId: "action-escape", idempotencyKey: "escape:v1" }),
        provenance: "HOST_REPORTED",
      }}),
      (error) => error.code === "E_STORAGE_MIGRATION_REQUIRED",
    );
    await assert.rejects(access(path.join(outside, "action-escape.json")));
  } finally {
    await rm(target, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
