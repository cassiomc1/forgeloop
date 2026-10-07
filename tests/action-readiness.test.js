import { removeTempTree } from "./helpers/rm-safe.js";
import { ensureFixtureTask, overwriteFixtureRecordBytes } from "./helpers/native-storage-fixture.js";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  proposeAction,
  readAction,
} from "../src/core/actions.js";
import { evaluateActionReadiness, evaluateRequiredActionReadiness } from "../src/core/action-readiness.js";
import { runCheck } from "../src/commands/run-check.js";
import { verifyAction } from "../src/core/action-verification.js";
import { executeDurableAction } from "../src/core/action-execution.js";
import { setupVerifyingTask } from "./helpers/durable-lifecycle.js";
import { getPackageRoot } from "../src/core/templates.js";

const packageRoot = getPackageRoot();

async function verifiedFixture(taskId) {
  const target = await mkdtemp(path.join(os.tmpdir(), `forgeloop-ready-${taskId}-`));
  if (taskId !== "ready-forged") {
    await setupVerifyingTask(target, packageRoot, { taskId });
  } else {
    await ensureFixtureTask(target, taskId, packageRoot);
  }
  return { target };
}

async function canonicalSatisfied(target, taskId) {
  // Full trusted chain through hardened helpers only.
  const sentinel = path.join(target, `sentinel-${taskId}.txt`);
  const executed = await executeDurableAction({
    target, packageRoot, taskId,
    input: { actionId: "action-ready", effectClass: "REVERSIBLE_WRITE",
      capability: "filesystem.write", target: "sentinel", operation: "write sentinel",
      idempotencyKey: `${taskId}:ready:v1`, requiredForCompletion: true,
      requirement: "sentinel-written" },
    argv: [process.execPath, "-e", `require('fs').writeFileSync(${JSON.stringify(sentinel)},'ok')`],
  });
  const check = await runCheck({
    target, packageRoot, taskId,
    id: "check-postcondition", requirement: "sentinel-written",
    argv: [process.execPath, "-e", `require('fs').accessSync(${JSON.stringify(sentinel)})`],
  });
  const verified = await verifyAction({ target, packageRoot, taskId,
    actionId: executed.action.actionId, evidenceRef: check.execution.executionId });
  return verified;
}

test("raw forged VERIFIED state without trusted evidence is UNTRUSTED", async () => {
  const { target } = await verifiedFixture("ready-forged");
  const taskId = "ready-forged";
  try {
    // Forge a VERIFIED artifact without any authorization/verification events.
    const { action } = await proposeAction(target, { packageRoot, taskId, input: {
      actionId: "action-forged", effectClass: "REVERSIBLE_WRITE", capability: "filesystem.write",
      target: "file", operation: "write", idempotencyKey: "forged:v1",
      requiredForCompletion: true, requirement: "forged-postcondition", provenance: "CALLER_REPORTED",
    } });
    const { taskActionPath } = await import("../src/core/task-paths.js");
    const forged = { ...action, state: "VERIFIED", revision: 4, lastEvidenceRef: "external:forged" };
    await overwriteFixtureRecordBytes(target, taskActionPath(taskId, action.actionId), JSON.stringify(forged, null, 2) + "\n");

    // readAction validates; bypass by passing the artifact directly.
    const readiness = await evaluateActionReadiness({ target, packageRoot, taskId, action: forged });
    assert.equal(readiness.status, "UNTRUSTED");

    const summary = await evaluateRequiredActionReadiness({ target, packageRoot, taskId });
    assert.equal(summary.untrusted >= 1, true);
    assert.equal(summary.satisfied, 0);
  } finally { await removeTempTree(target); }
});

test("correctly authorized + committed + verified action is SATISFIED", async () => {
  const { target } = await verifiedFixture("ready-satisfied");
  const taskId = "ready-satisfied";
  try {
    const verified = await canonicalSatisfied(target, taskId);
    assert.equal(verified.state, "VERIFIED");

    const readiness = await evaluateActionReadiness({ target, packageRoot, taskId,
      action: await readAction(target, { packageRoot, taskId, actionId: "action-ready" }) });
    assert.equal(readiness.status, "SATISFIED");

    const summary = await evaluateRequiredActionReadiness({ target, packageRoot, taskId });
    assert.equal(summary.satisfied, 1);
    assert.equal(summary.unresolved, 0);
  } finally { await removeTempTree(target); }
});

test("legacy required action without a requirement is readable but never trusted-satisfied", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-ready-legacy-noreq-"));
  const taskId = "ready-legacy-noreq";
  try {
    // Retain the historical payload in native storage without minting trusted chronology.
    await ensureFixtureTask(target, taskId, packageRoot);
    const { canonicalActionFingerprint } = await import("../src/core/action-model.js");
    const { taskActionPath } = await import("../src/core/task-paths.js");
    const now = "2026-01-01T00:00:00.000Z";
    const identityInput = {
      taskId, actionId: "action-legacy-noreq", effectClass: "REVERSIBLE_WRITE",
      capability: "filesystem.write", target: "f", operation: "op",
      idempotencyKey: "legacy:noreq:v1", requiredForCompletion: true, requirement: null,
    };
    const legacy = {
      schemaVersion: 1,
      ...identityInput,
      actionFingerprint: canonicalActionFingerprint(identityInput),
      provenance: "HOST_REPORTED",
      state: "VERIFIED",
      revision: 3,
      lastEvidenceRef: "external:legacy",
      createdAt: now,
      updatedAt: now,
    };
    await overwriteFixtureRecordBytes(target, taskActionPath(taskId, legacy.actionId), JSON.stringify(legacy, null, 2) + "\n");

    const readiness = await evaluateActionReadiness({ target, packageRoot, taskId, action: legacy });
    // The artifact is readable; it is untrusted both because its label has no
    // trusted chronology and because a required action without a requirement
    // can never be strongly verified.
    assert.equal(readiness.status, "UNTRUSTED");

    const summary = await evaluateRequiredActionReadiness({ target, packageRoot, taskId });
    assert.equal(summary.untrusted, 1);
    assert.equal(summary.satisfied, 0);
  } finally { await removeTempTree(target); }
});
