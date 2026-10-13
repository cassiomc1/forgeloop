import { removeTempTree } from "./helpers/rm-safe.js";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { proposeAction, readAction, transitionAuthorizedAction, transitionAction } from "../src/core/actions.js";
import { reconcileAction } from "../src/core/action-reconciliation.js";
import {
  reconciliationRequiresAuthority,
} from "../src/core/action-reconciliation-policy.js";
import { seedPolicyEpoch } from "./helpers/durable-policy.js";
import { getPackageRoot } from "../src/core/templates.js";

const packageRoot = getPackageRoot();
const trustedAuthority = Object.freeze({
  trustMode: "HOST_ATTESTED",
  hostSupplied: true,
  source: "host-boundary",
  grantRef: "grant-reconcile-1",
});

async function ambiguous(suffix) {
  const target = await mkdtemp(path.join(os.tmpdir(), `forgeloop-reconcile-${suffix}-`));
  const taskId = `task-${suffix}`;
  await seedPolicyEpoch(target, packageRoot, taskId, {
    schemaVersion: 1, defaultDecision: "ALLOW", rules: [],
  });
  const { action } = await proposeAction(target, { packageRoot, taskId, input: {
    actionId: `action-${suffix}`, effectClass: "EXTERNAL_PUBLICATION", capability: "external.publish",
    target: "registry/release", operation: "publish", idempotencyKey: `publish:${suffix}`,
    requiredForCompletion: true, requirement: "publication", provenance: "FORGELOOP_EXECUTED" } });
  await transitionAuthorizedAction(target, { packageRoot, taskId, actionId: action.actionId,
    expectedRevision: action.revision, expectedFingerprint: action.actionFingerprint,
    details: {
      actionFingerprint: action.actionFingerprint,
      capabilityDecision: "ALLOW",
      capabilityPolicyFingerprint: "a".repeat(64),
      policyLockDigest: `sha256:${"b".repeat(64)}`,
      taskPolicyDigest: `sha256:${"c".repeat(64)}`,
    } });
  await transitionAction(target, { packageRoot, taskId, actionId: action.actionId, to: "STARTED" });
  const unknown = await transitionAction(target, { packageRoot, taskId, actionId: action.actionId, to: "COMMIT_UNKNOWN",
    details: { commitResultCode: "AMBIGUOUS", reason: "started execution ended without proving external commit state" } });
  return { target, taskId, action: unknown };
}

test("settlement-class outcomes are classified correctly", () => {
  assert.equal(reconciliationRequiresAuthority("COMMITTED"), true);
  assert.equal(reconciliationRequiresAuthority("NOT_COMMITTED"), true);
  assert.equal(reconciliationRequiresAuthority("UNKNOWN"), false);
});

test("arbitrary COMMITTED settlement without trusted authority is rejected", async () => {
  const f = await ambiguous("commit-noauth");
  try {
    await assert.rejects(
      reconcileAction({ target: f.target, packageRoot, taskId: f.taskId,
        actionId: f.action.actionId, outcome: "COMMITTED",
        evidenceRefs: ["actor:claims-it-exists"] }),
      (error) => error.code === "E_ACTION_RECONCILIATION_AUTHORITY_REQUIRED",
    );
    const current = await readAction(f.target, { packageRoot, taskId: f.taskId, actionId: f.action.actionId });
    assert.equal(current.state, "COMMIT_UNKNOWN");
  } finally { await removeTempTree(f.target); }
});

test("arbitrary NOT_COMMITTED settlement without trusted authority is rejected", async () => {
  const f = await ambiguous("notcommitted-noauth");
  try {
    await assert.rejects(
      reconcileAction({ target: f.target, packageRoot, taskId: f.taskId,
        actionId: f.action.actionId, outcome: "NOT_COMMITTED",
        evidenceRefs: ["actor:says-not-committed"] }),
      (error) => error.code === "E_ACTION_RECONCILIATION_AUTHORITY_REQUIRED",
    );
  } finally { await removeTempTree(f.target); }
});

test("settling without any evidence reference is rejected even with trusted authority", async () => {
  const f = await ambiguous("commit-noevic");
  try {
    await assert.rejects(
      reconcileAction({ target: f.target, packageRoot, taskId: f.taskId,
        actionId: f.action.actionId, outcome: "COMMITTED",
        evidenceRefs: [], authorityContext: trustedAuthority }),
      (error) => error.code === "E_ACTION_RECONCILIATION_EVIDENCE_INVALID",
    );
  } finally { await removeTempTree(f.target); }
});

test("UNKNOWN observation remains caller-recordable and keeps COMMIT_UNKNOWN", async () => {
  const f = await ambiguous("unknown-ok");
  try {
    const result = await reconcileAction({ target: f.target, packageRoot, taskId: f.taskId,
      actionId: f.action.actionId, outcome: "UNKNOWN", evidenceRefs: [] });
    assert.equal(result.action.state, "COMMIT_UNKNOWN");
  } finally { await removeTempTree(f.target); }
});

test("trusted COMMITTED settlement settles the action", async () => {
  const f = await ambiguous("commit-trusted");
  try {
    const result = await reconcileAction({ target: f.target, packageRoot, taskId: f.taskId,
      actionId: f.action.actionId, outcome: "COMMITTED",
      evidenceRefs: ["external:release-visible"], authorityContext: trustedAuthority });
    assert.equal(result.action.state, "COMMITTED");
  } finally { await removeTempTree(f.target); }
});

test("trusted NOT_COMMITTED returns the action to PROPOSED for reauthorization", async () => {
  const f = await ambiguous("notcommitted-trusted");
  try {
    const result = await reconcileAction({ target: f.target, packageRoot, taskId: f.taskId,
      actionId: f.action.actionId, outcome: "NOT_COMMITTED",
      evidenceRefs: ["external:registry-missing-entry"], authorityContext: trustedAuthority });
    assert.equal(result.action.state, "PROPOSED");

    // Retry re-evaluates current policy: deny it via a drifted epoch.
    await assert.rejects(
      reconcileAction({ target: f.target, packageRoot, taskId: f.taskId,
        actionId: f.action.actionId, outcome: "UNKNOWN" }),
      (error) => error.code === "E_ACTION_STATE_MISMATCH",
    );
  } finally { await removeTempTree(f.target); }
});

test("retry after trusted NOT_COMMITTED re-evaluates changed policy before launch", async () => {
  const f = await ambiguous("notcommitted-redeny");
  const { executeDurableAction } = await import("../src/core/action-execution.js");
    try {
    const result = await reconcileAction({ target: f.target, packageRoot, taskId: f.taskId,
      actionId: f.action.actionId, outcome: "NOT_COMMITTED",
      evidenceRefs: ["external:registry-missing-entry"], authorityContext: trustedAuthority });
    assert.equal(result.action.state, "PROPOSED");

    // New policy epoch: DENY everything (valid lock + refreshed snapshot).
    await seedPolicyEpoch(f.target, packageRoot, f.taskId, {
      schemaVersion: 1, defaultDecision: "DENY", rules: [],
    });

    const sentinel = path.join(f.target, "sentinel.txt");
    await assert.rejects(
      executeDurableAction({ target: f.target, packageRoot, taskId: f.taskId,
        input: { actionId: f.action.actionId, effectClass: "EXTERNAL_PUBLICATION",
          capability: "external.publish", target: "registry/release", operation: "publish",
          idempotencyKey: `publish:notcommitted-redeny`, requiredForCompletion: true, requirement: "publication" },
        argv: [process.execPath, "-e", "process.exit(0)"] }),
      (error) => error.code === "E_ACTION_CAPABILITY_DENIED",
    );
    await assert.rejects((async () => { const { access } = await import("node:fs/promises"); await access(sentinel); })());
  } finally { await removeTempTree(f.target); }
});
