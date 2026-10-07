import { readFixtureText, readRawFixtureText, deleteFixtureArtifact } from "./helpers/native-storage-fixture.js";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runApprovalRequest } from "../src/commands/approval-request.js";
import { proposeAction } from "../src/core/actions.js";
import { getPackageRoot } from "../src/core/templates.js";
import { taskApprovalPath, taskArtifactPath } from "../src/core/task-paths.js";
import { setupVerifyingTask } from "./helpers/durable-lifecycle.js";
import { removeTempTree } from "./helpers/rm-safe.js";

const packageRoot = getPackageRoot();

async function overwriteCapabilityPolicy(target, decision) {
  await writeFile(
    path.join(target, ".forgeloop", "policy", "capabilities.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      defaultDecision: "DENY",
      rules: [{ capability: "filesystem.write", decision }],
    })}\n`,
    "utf8",
  );
}

async function withApprovalRequestPolicy(decision, run) {
  const taskId = `approval-request-${decision.toLowerCase().replaceAll("_", "-")}`;
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-approval-request-policy-"));
  try {
    await setupVerifyingTask(target, packageRoot, {
      taskId,
      capabilityPolicy: {
        schemaVersion: 1,
        defaultDecision: "DENY",
        rules: [{ capability: "filesystem.write", decision }],
      },
    });
    const { action } = await proposeAction(target, {
      packageRoot,
      taskId,
      input: {
        actionId: "action-approval-request",
        effectClass: "REVERSIBLE_WRITE",
        capability: "filesystem.write",
        target: "workspace/item",
        operation: "update item",
        idempotencyKey: `${taskId}:action:v1`,
        requiredForCompletion: true,
        requirement: "postcondition",
        provenance: "CALLER_REPORTED",
      },
    });
    await run({ target, taskId, action });
  } finally {
    await removeTempTree(target);
  }
}

test("approval-request is policy-aware and never mints an unnecessary approval", async () => {
  const cases = [
    ["ALLOW", "E_ACTION_APPROVAL_NOT_REQUIRED"],
    ["DENY", "E_ACTION_CAPABILITY_DENIED"],
    ["REQUIRE_AUTHORITY", "E_ACTION_AUTHORITY_REQUIRED"],
  ];

  for (const [decision, expectedCode] of cases) {
    await withApprovalRequestPolicy(decision, async ({ target, taskId, action }) => {
      await assert.rejects(
        runApprovalRequest({
          target,
          packageRoot,
          taskId,
          approvalId: "approval-not-created",
          actionId: action.actionId,
          reason: "should be rejected by current policy",
        }),
        (error) => error.code === expectedCode,
      );

      assert.equal(await readFixtureText(target, taskApprovalPath(taskId, "approval-not-created")), null);
    });
  }
});

test("approval-request creates a pending approval only when policy requires it", async () => {
  await withApprovalRequestPolicy("REQUIRE_APPROVAL", async ({ target, taskId, action }) => {
    const result = await runApprovalRequest({
      target,
      packageRoot,
      taskId,
      approvalId: "approval-required",
      actionId: action.actionId,
      reason: "current policy requires approval",
    });

    assert.equal(result.created, true);
    assert.ok(await readFixtureText(target, taskApprovalPath(taskId, "approval-required")));
  });
});

test("approval-request rejects a tampered epoch before creating an approval or ledger event", async () => {
  await withApprovalRequestPolicy("ALLOW", async ({ target, taskId, action }) => {
    const eventsPath = path.join(target, taskArtifactPath(taskId, "events"));
    const eventsBefore = await readRawFixtureText(target, eventsPath);
    await overwriteCapabilityPolicy(target, "REQUIRE_APPROVAL");

    await assert.rejects(
      runApprovalRequest({
        target,
        packageRoot,
        taskId,
        approvalId: "approval-drifted",
        actionId: action.actionId,
        reason: "should never persist",
      }),
      (error) => error.code === "E_ACTION_POLICY_DRIFT",
    );

    assert.equal(await readFixtureText(target, taskApprovalPath(taskId, "approval-drifted")), null);
    assert.equal(await readRawFixtureText(target, eventsPath), eventsBefore);
  });
});

test("approval-request rejects a missing task policy snapshot before persistence", async () => {
  await withApprovalRequestPolicy("REQUIRE_APPROVAL", async ({ target, taskId, action }) => {
    const eventsPath = path.join(target, taskArtifactPath(taskId, "events"));
    const eventsBefore = await readRawFixtureText(target, eventsPath);
    await deleteFixtureArtifact(target, taskArtifactPath(taskId, "policySnapshot"));

    await assert.rejects(
      runApprovalRequest({
        target,
        packageRoot,
        taskId,
        approvalId: "approval-no-snapshot",
        actionId: action.actionId,
        reason: "snapshot is required",
      }),
      (error) => error.code === "E_ACTION_POLICY_LOCK_REQUIRED",
    );

    assert.equal(await readFixtureText(target, taskApprovalPath(taskId, "approval-no-snapshot")), null);
    assert.equal(await readRawFixtureText(target, eventsPath), eventsBefore);
  });
});
