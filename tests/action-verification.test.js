import { ensureFixtureTask } from "./helpers/native-storage-fixture.js";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { executeDurableAction } from "../src/core/action-execution.js";
import { readAction } from "../src/core/actions.js";
void readAction;
import { verifyAction } from "../src/core/action-verification.js";
import { runActivate } from "../src/commands/activate.js";
import { runPrepareCompletion } from "../src/commands/prepare-completion.js";
import { runAdvance } from "../src/commands/advance.js";
import { runCheck } from "../src/commands/run-check.js";
import { runRoute } from "../src/commands/route.js";
import { runPreflight } from "../src/commands/preflight.js";
import { runTaskCreate } from "../src/commands/task-create.js";
import { createContract, writeContract, contractFingerprint } from "../src/core/contract.js";
import { seedPolicyEpoch } from "./helpers/durable-policy.js";
import { getPackageRoot } from "../src/core/templates.js";

const packageRoot = getPackageRoot();

async function committedActionFixture(taskId) {
  const target = await mkdtemp(path.join(os.tmpdir(), `forgeloop-verify-${taskId}-`));
  await runTaskCreate({ target, packageRoot, taskId, claims: ["src"] });
  await seedPolicyEpoch(target, packageRoot, taskId, {
    schemaVersion: 1, defaultDecision: "ALLOW", rules: [],
  });
  const sentinel = path.join(target, "sentinel.txt");
  const contract = createContract({
    taskId,
    objective: "verify durable action postconditions",
    deliverables: ["sentinel.txt"],
    constraints: [],
    risks: [],
    stopConditions: [],
    unresolvedDecisions: [],
    sourceRefs: [],
    verification: ["independent sentinel check passes"],
    successCriteria: ["action is verified with canonical evidence"],
  });
  await writeContract(target, contract, packageRoot, { taskId });
  const fingerprint = contractFingerprint(contract);
  await runRoute({ target, packageRoot, taskId, workType: "code", surfaces: ["config"], executableChange: true });
  const preflight = await runPreflight({ target, packageRoot, taskId });
  if (preflight.status !== "READY") throw new Error(`fixture preflight not READY: ${preflight.status}`);
  await runActivate({ target, packageRoot, taskId });
  for (const phase of ["PLANNED", "EXECUTING", "VERIFYING"]) {
    await runAdvance({ target, packageRoot, taskId, to: phase });
  }
  await runPrepareCompletion({ target, packageRoot, taskId });
  const executed = await executeDurableAction({
    target, packageRoot, taskId,
    input: { actionId: "action-write", effectClass: "REVERSIBLE_WRITE",
      capability: "filesystem.write", target: "sentinel.txt", operation: "write sentinel",
      idempotencyKey: `${taskId}:write:v1`, requiredForCompletion: true,
      requirement: "sentinel-written" },
    argv: [process.execPath, "-e", `require('fs').writeFileSync(${JSON.stringify(sentinel)},'ok')`],
  });
  void fingerprint;
  return { target, taskId, action: executed.action, execution: executed.execution };
}

test("arbitrary evidence strings cannot verify an action", async () => {
  const fixture = await committedActionFixture("verify-arbitrary");
  try {
    await assert.rejects(
      verifyAction({ target: fixture.target, packageRoot, taskId: fixture.taskId,
        actionId: fixture.action.actionId, evidenceRef: "external:looks-good" }),
      (error) => error.code === "E_ACTION_VERIFICATION_INVALID",
    );
    const current = await readAction(fixture.target, { packageRoot, taskId: fixture.taskId, actionId: fixture.action.actionId });
    assert.equal(current.state, "COMMITTED");
  } finally { await rm(fixture.target, { recursive: true, force: true }); }
});

test("the action's own commit execution is not independent postcondition verification", async () => {
  const fixture = await committedActionFixture("verify-self");
  try {
    await assert.rejects(
      verifyAction({ target: fixture.target, packageRoot, taskId: fixture.taskId,
        actionId: fixture.action.actionId, evidenceRef: fixture.execution.executionId }),
      (error) => error.code === "E_ACTION_VERIFICATION_INVALID",
    );
  } finally { await rm(fixture.target, { recursive: true, force: true }); }
});

test("a canonical independent passed check verifies the action", async () => {
  const fixture = await committedActionFixture("verify-canonical");
  try {
    // The side effect actually happened; the independent check observes it.
    const check = await runCheck({
      target: fixture.target, packageRoot, taskId: fixture.taskId,
      id: "check-sentinel", requirement: "sentinel-written",
      argv: [process.execPath, "-e",
        `require('fs').accessSync(${JSON.stringify(path.join(fixture.target, "sentinel.txt"))})`],
    });
    const evidenceRef = check.execution?.executionId;
    assert.ok(evidenceRef, "run-check produces a canonical execution reference");

    const result = await verifyAction({ target: fixture.target, packageRoot,
      taskId: fixture.taskId, actionId: fixture.action.actionId, evidenceRef });
    assert.equal(result.state, "VERIFIED");
    assert.equal(result.lastEvidenceRef, evidenceRef);
  } finally { await rm(fixture.target, { recursive: true, force: true }); }
});

test("a passed check for a different requirement cannot verify the action", async () => {
  const fixture = await committedActionFixture("verify-mismatch");
  try {
    // Independent passing execution that proves a DIFFERENT requirement.
    const other = await runCheck({
      target: fixture.target, packageRoot, taskId: fixture.taskId,
      id: "check-unrelated", requirement: "unit-tests-pass",
      argv: [process.execPath, "-e", "process.exit(0)"],
    });
    await assert.rejects(
      verifyAction({ target: fixture.target, packageRoot, taskId: fixture.taskId,
        actionId: fixture.action.actionId, evidenceRef: other.execution.executionId }),
      (error) => error.code === "E_ACTION_VERIFICATION_INVALID",
    );
    const current = await readAction(fixture.target, { packageRoot, taskId: fixture.taskId, actionId: fixture.action.actionId });
    assert.equal(current.state, "COMMITTED");
  } finally { await rm(fixture.target, { recursive: true, force: true }); }
});

test("new required proposals cannot omit a requirement", async () => {
  const { proposeAction } = await import("../src/core/actions.js");
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-verify-noreq-"));
  try {
    await assert.rejects(
      proposeAction(target, { packageRoot, taskId: "verify-noreq", input: {
        actionId: "action-required", effectClass: "REVERSIBLE_WRITE", capability: "filesystem.write",
        target: "f", operation: "op", idempotencyKey: "noreq:v1",
        requiredForCompletion: true, requirement: null, provenance: "CALLER_REPORTED",
      } }),
      (error) => error.code === "E_ACTION_INVALID",
    );
    await ensureFixtureTask(target, "verify-noreq", packageRoot);
    // Non-required actions without a requirement remain allowed.
    const { action } = await proposeAction(target, { packageRoot, taskId: "verify-noreq", input: {
      actionId: "action-optional", effectClass: "REVERSIBLE_WRITE", capability: "filesystem.write",
      target: "f", operation: "op", idempotencyKey: "noreq:v2",
      requiredForCompletion: false, requirement: null, provenance: "CALLER_REPORTED",
    } });
    assert.equal(action.requiredForCompletion, false);
  } finally { await rm(target, { recursive: true, force: true }); }
});
