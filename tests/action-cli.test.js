import { removeTempTree } from "./helpers/rm-safe.js";
import { ensureFixtureTask } from "./helpers/native-storage-fixture.js";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { proposeAction, transitionAction, transitionAuthorizedAction } from "../src/core/actions.js";
import { runActionRecord } from "../src/commands/action-record.js";
import { getPackageRoot } from "../src/core/templates.js";
import { CLI_COMMAND_DEFINITIONS } from "../src/core/cli-command-definitions.js";

const packageRoot = getPackageRoot();

test("public action-record metadata advertises only caller or external provenance", () => {
  const description = CLI_COMMAND_DEFINITIONS["action-record"].options["--provenance"].description;
  assert.match(description, /CALLER_REPORTED/);
  assert.match(description, /EXTERNAL_OBSERVED/);
  assert.doesNotMatch(description, /HOST_REPORTED/);
});

test("host-reported transitions cannot skip states or claim ForgeLoop execution", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-action-cli-"));
  const taskId = "host-task";
  try {
    await ensureFixtureTask(target, taskId, packageRoot);
    const { action } = await proposeAction(target, { packageRoot, taskId, input: {
      actionId: "action-host", effectClass: "REVERSIBLE_WRITE", capability: "network.write",
      target: "service/item", operation: "update item", idempotencyKey: "host:update:v1",
      requiredForCompletion: false, requirement: null, provenance: "HOST_REPORTED",
    } });
    await assert.rejects(transitionAction(target, { packageRoot, taskId,
      actionId: action.actionId, to: "COMMITTED" }),
    (error) => error.code === "E_ACTION_STATE_MISMATCH");
    const authorized = await transitionAuthorizedAction(target, { packageRoot, taskId,
      actionId: action.actionId,
      details: {
        actionFingerprint: action.actionFingerprint,
        capabilityDecision: "ALLOW",
        capabilityPolicyFingerprint: "a".repeat(64),
        policyLockDigest: `sha256:${"b".repeat(64)}`,
        taskPolicyDigest: `sha256:${"c".repeat(64)}`,
      } });
    assert.equal(authorized.provenance, "HOST_REPORTED");
    await assert.rejects(runActionRecord({ target, packageRoot, taskId,
      actionId: action.actionId, state: "STARTED", provenance: "FORGELOOP_EXECUTED" }),
    (error) => error.code === "E_ACTION_INVALID");
  } finally { await removeTempTree(target); }
});
