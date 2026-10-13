import { removeTempTree } from "./helpers/rm-safe.js";
import assert from "node:assert/strict";
import { access, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { proposeAction, readAction, transitionAction } from "../src/core/actions.js";
import { executeDurableAction } from "../src/core/action-execution.js";
import { authorizeAction } from "../src/core/action-authorization.js";
import { seedPolicyEpoch } from "./helpers/durable-policy.js";
import { getPackageRoot } from "../src/core/templates.js";

const packageRoot = getPackageRoot();

function input(overrides = {}) {
  return { actionId: "action-write", effectClass: "REVERSIBLE_WRITE",
    capability: "filesystem.write", target: "sentinel.txt", operation: "write sentinel",
    idempotencyKey: "write:sentinel:v1", requiredForCompletion: false, requirement: null,
    ...overrides };
}

function allowPolicy() {
  return { schemaVersion: 1, defaultDecision: "DENY",
    rules: [{ capability: "filesystem.write", decision: "ALLOW" }] };
}

test("capability-policy drift after the task snapshot blocks before launch", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-authz-drift-"));
  const taskId = "task-drift";
  try {
    await seedPolicyEpoch(target, packageRoot, taskId, allowPolicy());
    const sentinel = path.join(target, "sentinel.txt");

    // Tamper with capabilities.json after the epoch was bound.
    const policyPath = path.join(target, ".forgeloop/policy/capabilities.json");
    await writeFile(policyPath, JSON.stringify({
      schemaVersion: 1, defaultDecision: "ALLOW", rules: [],
    }), "utf8");

    await assert.rejects(
      executeDurableAction({ target, packageRoot, taskId,
        input: input(), argv: [process.execPath, "-e", `require('fs').writeFileSync(${JSON.stringify(sentinel)},'bad')`] }),
      (error) => error.code === "E_ACTION_POLICY_DRIFT",
    );
    await assert.rejects(access(sentinel));
  } finally { await removeTempTree(target); }
});

test("raw transitionAction cannot mint AUTHORIZED on the modern flow", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-authz-raw-"));
  const taskId = "task-raw";
  try {
    await seedPolicyEpoch(target, packageRoot, taskId, allowPolicy());
    const { action } = await proposeAction(target, { packageRoot, taskId, input: { ...input(), provenance: "CALLER_REPORTED" } });

    await assert.rejects(
      transitionAction(target, { packageRoot, taskId, actionId: action.actionId, to: "AUTHORIZED" }),
      (error) => error.code === "E_ACTION_AUTHORIZATION_INVALID",
    );
    const current = await readAction(target, { packageRoot, taskId, actionId: action.actionId });
    assert.equal(current.state, "PROPOSED");
  } finally { await removeTempTree(target); }
});

test("canonical authorization binds full policy evidence to the event", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-authz-canonical-"));
  const taskId = "task-canonical";
  try {
    await seedPolicyEpoch(target, packageRoot, taskId, allowPolicy());
    const { action } = await proposeAction(target, { packageRoot, taskId, input: { ...input(), provenance: "CALLER_REPORTED" } });

    const result = await authorizeAction({ target, packageRoot, taskId, actionId: action.actionId });
    assert.equal(result.action.state, "AUTHORIZED");
    assert.equal(result.authorization.capabilityDecision, "ALLOW");
    assert.match(result.authorization.capabilityPolicyFingerprint, /^[a-f0-9]{64}$/);
    assert.match(result.authorization.policyLockDigest, /^sha256:[a-f0-9]{64}$/);
    assert.match(result.authorization.taskPolicyDigest, /^sha256:[a-f0-9]{64}$/);

    const { readEvents } = await import("../src/core/events.js");
    const events = await readEvents(target, packageRoot, { taskId });
    const authorizedEvent = events.find((event) => event.event === "ACTION_AUTHORIZED");
    assert.ok(authorizedEvent, "ACTION_AUTHORIZED event is appended");
    assert.equal(authorizedEvent.details.capabilityDecision, "ALLOW");
    assert.match(authorizedEvent.details.policyLockDigest, /^sha256:[a-f0-9]{64}$/);
    assert.match(authorizedEvent.details.taskPolicyDigest, /^sha256:[a-f0-9]{64}$/);
    assert.match(authorizedEvent.details.capabilityPolicyFingerprint, /^[a-f0-9]{64}$/);
  } finally { await removeTempTree(target); }
});

test("REQUIRE_APPROVAL authorization events must bind approval and authority evidence", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-authz-approval-"));
  const taskId = "task-approval-binding";
  const { transitionAuthorizedAction } = await import("../src/core/actions.js");
  try {
    await seedPolicyEpoch(target, packageRoot, taskId, {
      schemaVersion: 1, defaultDecision: "DENY",
      rules: [{ capability: "repository.push", decision: "REQUIRE_APPROVAL" }],
    });
    const { action } = await proposeAction(target, { packageRoot, taskId,
      input: { ...input({ actionId: "action-pushy", idempotencyKey: "push:v2", capability: "repository.push" }), provenance: "CALLER_REPORTED" } });

    // Incomplete modern authorization details fail closed.
    await assert.rejects(
      transitionAuthorizedAction(target, { packageRoot, taskId, actionId: action.actionId,
        expectedRevision: action.revision, expectedFingerprint: action.actionFingerprint,
        details: {
          actionFingerprint: action.actionFingerprint,
          capabilityDecision: "REQUIRE_APPROVAL",
          capabilityPolicyFingerprint: "a".repeat(64),
          policyLockDigest: `sha256:${"b".repeat(64)}`,
          taskPolicyDigest: `sha256:${"c".repeat(64)}`,
          approvalId: "approval-x",
        } }),
      (error) => error.code === "E_ACTION_EVIDENCE_INVALID",
    );
  } finally { await removeTempTree(target); }
});
