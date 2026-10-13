import { removeTempTree } from "./helpers/rm-safe.js";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { readAction } from "../src/core/actions.js";
import { projectActionLedger } from "../src/core/action-ledger-projection.js";
import { reconcileAction } from "../src/core/action-reconciliation.js";
import { evaluateActionReadiness } from "../src/core/action-readiness.js";
import { executeDurableAction } from "../src/core/action-execution.js";
import { runCheck } from "../src/commands/run-check.js";
import { verifyAction } from "../src/core/action-verification.js";
import { setupVerifyingTask } from "./helpers/durable-lifecycle.js";
import { getPackageRoot } from "../src/core/templates.js";

const packageRoot = getPackageRoot();
const trustedAuthority = Object.freeze({
  trustMode: "HOST_ATTESTED", hostSupplied: true, source: "host-boundary", grantRef: "grant-cross-domain",
});

async function ambiguousCommittedFixture(taskId) {
  const target = await mkdtemp(path.join(os.tmpdir(), `forgeloop-cross-${taskId}-`));
  await setupVerifyingTask(target, packageRoot, { taskId });
  const sentinel = path.join(target, `sentinel-${taskId}.txt`);
  const executed = await executeDurableAction({
    target, packageRoot, taskId,
    input: { actionId: "action-publish", effectClass: "EXTERNAL_PUBLICATION",
      capability: "external.publish", target: "registry/release", operation: "publish release",
      idempotencyKey: `${taskId}:publish:v1`, requiredForCompletion: true,
      requirement: "release-visible" },
    argv: [process.execPath, "-e", `require('fs').writeFileSync(${JSON.stringify(sentinel)},'ok');process.exit(2)`],
  });
  return { target, taskId, sentinel, execution: executed.execution };
}

test("trusted reconciled commit chain reaches SATISFIED through exact-requirement verification", async () => {
  const taskId = "cross-reconcile-satisfy";
  const fixture = await ambiguousCommittedFixture(taskId);
  try {
    // The side effect happened but ForgeLoop could not prove it.
    const settled = await reconcileAction({ target: fixture.target, packageRoot,
      taskId, actionId: "action-publish", outcome: "COMMITTED",
      evidenceRefs: ["external:registry-shows-release"], authorityContext: trustedAuthority });
    assert.equal(settled.action.state, "COMMITTED");

    // Replay stays exactly once-valid after the mirror event.
    const projection = await projectActionLedger({ target: fixture.target, packageRoot,
      taskId, actionId: "action-publish", artifact: settled.action });
    assert.equal(projection.valid, true);

    // Readiness is PENDING: committed is not verified.
    const pending = await evaluateActionReadiness({ target: fixture.target, packageRoot,
      taskId, action: await readAction(fixture.target, { packageRoot, taskId, actionId: "action-publish" }) });
    assert.equal(pending.status, "PENDING");

    // Independent postcondition evidence must cover the EXACT requirement.
    const wrong = await runCheck({ target: fixture.target, packageRoot, taskId,
      id: "check-wrong", requirement: "unit-tests-pass",
      argv: [process.execPath, "-e", "process.exit(0)"] });
    await assert.rejects(
      verifyAction({ target: fixture.target, packageRoot, taskId,
        actionId: "action-publish", evidenceRef: wrong.execution.executionId }),
      (error) => error.code === "E_ACTION_VERIFICATION_INVALID",
    );

    const right = await runCheck({ target: fixture.target, packageRoot, taskId,
      id: "check-right", requirement: "release-visible",
      argv: [process.execPath, "-e", `require('fs').accessSync(${JSON.stringify(fixture.sentinel)})`] });
    const verified = await verifyAction({ target: fixture.target, packageRoot, taskId,
      actionId: "action-publish", evidenceRef: right.execution.executionId });
    assert.equal(verified.state, "VERIFIED");

    const satisfied = await evaluateActionReadiness({ target: fixture.target, packageRoot,
      taskId, action: await readAction(fixture.target, { packageRoot, taskId, actionId: "action-publish" }) });
    assert.equal(satisfied.status, "SATISFIED");
  } finally { await removeTempTree(fixture.target); }
});

test("trusted NOT_COMMITTED reset keeps replay valid and re-evaluates changed policy before launch", async () => {
  const taskId = "cross-notcommitted-redeny";
  const fixture = await ambiguousCommittedFixture(taskId);
  try {
    void fixture.execution;
    const settled = await reconcileAction({ target: fixture.target, packageRoot,
      taskId, actionId: "action-publish", outcome: "NOT_COMMITTED",
      evidenceRefs: ["external:registry-missing"], authorityContext: trustedAuthority });
    assert.equal(settled.action.state, "PROPOSED");

    const current = await readAction(fixture.target, { packageRoot, taskId, actionId: "action-publish" });
    const projection = await projectActionLedger({ target: fixture.target, packageRoot,
      taskId, actionId: "action-publish", artifact: current });
    assert.equal(projection.valid, true);
    assert.equal(projection.reconciliation.latestOutcome, "NOT_COMMITTED");

    // New policy epoch denies everything.
    const { seedPolicyEpoch } = await import("./helpers/durable-policy.js");
    await seedPolicyEpoch(fixture.target, packageRoot, taskId, {
      schemaVersion: 1, defaultDecision: "DENY", rules: [],
    });

    const sentinel = path.join(fixture.target, "sentinel-denied.txt");
    await assert.rejects(
      executeDurableAction({ target: fixture.target, packageRoot, taskId,
        input: { actionId: "action-publish", effectClass: "EXTERNAL_PUBLICATION",
          capability: "external.publish", target: "registry/release", operation: "publish release",
          idempotencyKey: `${taskId}:publish:v1`, requiredForCompletion: true,
          requirement: "release-visible" },
        argv: [process.execPath, "-e", `require('fs').writeFileSync(${JSON.stringify(sentinel)},'x')`] }),
      (error) => error.code === "E_ACTION_CAPABILITY_DENIED",
    );
    await assert.rejects((async () => {
      const fs = await import("node:fs/promises");
      await fs.access(sentinel);
    })(), "no process may launch under the denied epoch");

    // Replay remains valid after the blocked attempt.
    const after = await readAction(fixture.target, { packageRoot, taskId, actionId: "action-publish" });
    const replayAfter = await projectActionLedger({ target: fixture.target, packageRoot,
      taskId, actionId: "action-publish", artifact: after });
    assert.equal(replayAfter.valid, true);
  } finally { await removeTempTree(fixture.target); }
});
