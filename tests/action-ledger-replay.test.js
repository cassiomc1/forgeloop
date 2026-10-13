import { ensureFixtureTask, overwriteFixtureText } from "./helpers/native-storage-fixture.js";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  proposeAction,
  readAction,
  transitionAction,
  transitionAuthorizedAction,
  validateActionLedgerConsistency,
} from "../src/core/actions.js";
import { projectActionLedger } from "../src/core/action-ledger-projection.js";
import { reconcileAction } from "../src/core/action-reconciliation.js";
import { seedPolicyEpoch } from "./helpers/durable-policy.js";
import { taskActionPath } from "../src/core/task-paths.js";
import { getPackageRoot } from "../src/core/templates.js";

const packageRoot = getPackageRoot();

const AUTHORIZATION_EVIDENCE = (actionFingerprint) => ({
  actionFingerprint,
  capabilityDecision: "ALLOW",
  capabilityPolicyFingerprint: "a".repeat(64),
  policyLockDigest: `sha256:${"b".repeat(64)}`,
  taskPolicyDigest: `sha256:${"c".repeat(64)}`,
});

async function freshTarget(prefix) {
  return mkdtemp(path.join(os.tmpdir(), `forgeloop-replay-${prefix}-`));
}

// The tests below operate on raw event fixtures appended through the canonical
// transition APIs; forged scenarios are produced by editing artifacts/events
// directly to simulate tampering.

test("revision skip in the event chronology is audit-visible", async () => {
  const target = await freshTarget("revskip");
  const taskId = "replay-task-1";
  try {
    await ensureFixtureTask(target, taskId, packageRoot);
    const { action } = await proposeAction(target, { packageRoot, taskId, input: {
      actionId: "action-rev", effectClass: "REVERSIBLE_WRITE", capability: "filesystem.write",
      target: "f", operation: "op", idempotencyKey: "replay:rev:v1",
      requiredForCompletion: false, requirement: null, provenance: "CALLER_REPORTED",
    } });
    // Legitimately authorize, then hand-forge a STARTED artifact whose
    // revision skips a step without any event.
    await transitionAuthorizedAction(target, { packageRoot, taskId, actionId: action.actionId,
      expectedRevision: 0, expectedFingerprint: action.actionFingerprint,
      details: AUTHORIZATION_EVIDENCE(action.actionFingerprint) });
    const current = await readAction(target, { packageRoot, taskId, actionId: action.actionId });
    const forged = { ...current, state: "STARTED", revision: 5 };
    await overwriteFixtureText(target, taskActionPath(taskId, action.actionId), JSON.stringify(forged, null, 2) + "\n", "utf8");

    const issues = await validateActionLedgerConsistency(target, { packageRoot, taskId });
    assert.ok(issues.some((i) => i.actionId === "action-rev"), "forged revision/state divergence is detected");
  } finally { await rm(target, { recursive: true, force: true }); }
});

test("STARTED without trusted authorization evidence makes VERIFIED untrusted", async () => {
  const target = await freshTarget("legacyauth");
  const taskId = "replay-task-2";
  try {
    await ensureFixtureTask(target, taskId, packageRoot);
    const { action } = await proposeAction(target, { packageRoot, taskId, input: {
      actionId: "action-legacy", effectClass: "REVERSIBLE_WRITE", capability: "filesystem.write",
      target: "f", operation: "op", idempotencyKey: "replay:legacy:v1",
      requiredForCompletion: false, requirement: null, provenance: "CALLER_REPORTED",
    } });
    // Legacy-era chronology appended directly: AUTHORIZED without any policy
    // binding fields, followed by STARTED. This is readable history but is
    // never trusted modern authorization evidence.
    const { appendProtocolEvent } = await import("../src/core/events.js");
    await appendProtocolEvent(target, {
      taskId,
      event: "ACTION_AUTHORIZED",
      fingerprint: action.actionFingerprint,
      details: {
        actionId: action.actionId,
        actionFingerprint: action.actionFingerprint,
        fromState: "PROPOSED",
        toState: "AUTHORIZED",
        revision: 1,
      },
    }, packageRoot, { taskId });
    await appendProtocolEvent(target, {
      taskId,
      event: "ACTION_STARTED",
      fingerprint: action.actionFingerprint,
      details: {
        actionId: action.actionId,
        actionFingerprint: action.actionFingerprint,
        fromState: "AUTHORIZED",
        toState: "STARTED",
        revision: 2,
      },
    }, packageRoot, { taskId });

    const projection = await projectActionLedger({ target, packageRoot, taskId, actionId: "action-legacy", artifact: action });
    assert.equal(projection.authorization.valid, false,
      "legacy authorization evidence is not trusted");
    assert.equal(
      projection.errors.some((e) => e.message.includes("without valid modern authorization")),
      true,
      "STARTED without valid modern authorization is flagged",
    );
  } finally { await rm(target, { recursive: true, force: true }); }
});

test("direct artifact edits remain audit-visible via replay divergence", async () => {
  const target = await freshTarget("artifact-edit");
  const taskId = "replay-task-3";
  try {
    await ensureFixtureTask(target, taskId, packageRoot);
    const { action } = await proposeAction(target, { packageRoot, taskId, input: {
      actionId: "action-edit", effectClass: "REVERSIBLE_WRITE", capability: "filesystem.write",
      target: "f", operation: "op", idempotencyKey: "replay:edit:v1",
      requiredForCompletion: false, requirement: null, provenance: "CALLER_REPORTED",
    } });
    await transitionAuthorizedAction(target, { packageRoot, taskId, actionId: action.actionId,
      expectedRevision: 0, expectedFingerprint: action.actionFingerprint,
      details: AUTHORIZATION_EVIDENCE(action.actionFingerprint) });
    await transitionAction(target, { packageRoot, taskId, actionId: action.actionId, to: "STARTED" });

    // Hand-edit artifact to COMMITTED with no matching event.
    const current = await readAction(target, { packageRoot, taskId, actionId: action.actionId });
    const edited = { ...current, state: "COMMITTED" };
    await overwriteFixtureText(target, taskActionPath(taskId, action.actionId), JSON.stringify(edited, null, 2) + "\n", "utf8");

    const projection = await projectActionLedger({ target, packageRoot, taskId, actionId: "action-edit", artifact: edited });
    assert.equal(projection.valid, false);
    assert.ok(projection.errors.some((e) => e.message.includes("artifact state")));
  } finally { await rm(target, { recursive: true, force: true }); }
});

test("trusted COMMITTED reconciliation replays as one transition", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const os = await import("node:os");
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-replay-reconciled-commit-"));
  const taskId = "replay-reconciled-commit";
  try {
    await seedPolicyEpoch(target, packageRoot, taskId, {
      schemaVersion: 1, defaultDecision: "ALLOW", rules: [],
    });
    const { action } = await proposeAction(target, { packageRoot, taskId, input: {
      actionId: "action-publish", effectClass: "EXTERNAL_PUBLICATION", capability: "external.publish",
      target: "registry/release", operation: "publish", idempotencyKey: "replay:commit:v1",
      requiredForCompletion: true, requirement: "publication", provenance: "FORGELOOP_EXECUTED",
    } });
    await transitionAuthorizedAction(target, { packageRoot, taskId, actionId: action.actionId,
      expectedRevision: 0, expectedFingerprint: action.actionFingerprint,
      details: { ...AUTHORIZATION_EVIDENCE(action.actionFingerprint) } });
    await transitionAction(target, { packageRoot, taskId, actionId: action.actionId, to: "STARTED" });
    await transitionAction(target, { packageRoot, taskId, actionId: action.actionId, to: "COMMIT_UNKNOWN",
      details: { commitResultCode: "AMBIGUOUS", reason: "external outcome lost" } });

    const settled = await reconcileAction({
      target, packageRoot, taskId, actionId: action.actionId,
      outcome: "COMMITTED",
      evidenceRefs: ["external:release-visible"],
      authorityContext: {
        trustMode: "HOST_ATTESTED", hostSupplied: true, source: "host-boundary",
        grantRef: "grant-replay-commit",
      },
    });
    assert.equal(settled.action.state, "COMMITTED");

    const projection = await projectActionLedger({
      target, packageRoot, taskId,
      actionId: action.actionId,
      artifact: settled.action,
    });
    assert.equal(projection.valid, true);
    assert.equal(projection.state, "COMMITTED");
    assert.equal(projection.revision, settled.action.revision);
    assert.equal(projection.reconciliation.latestOutcome, "COMMITTED");

    const issues = await validateActionLedgerConsistency(target, { packageRoot, taskId });
    assert.equal(issues.length, 0);
  } finally { await rm(target, { recursive: true, force: true }); }
});

async function reconciledCommitFixture(suffix) {
  const { mkdtemp } = await import("node:fs/promises");
  const os = await import("node:os");
  const target = await mkdtemp(path.join(os.tmpdir(), `forgeloop-mirror-${suffix}-`));
  const taskId = `mirror-${suffix}`;
  await seedPolicyEpoch(target, packageRoot, taskId, {
    schemaVersion: 1, defaultDecision: "ALLOW", rules: [],
  });
  const { action } = await proposeAction(target, { packageRoot, taskId, input: {
    actionId: "action-publish", effectClass: "EXTERNAL_PUBLICATION", capability: "external.publish",
    target: "registry/release", operation: "publish", idempotencyKey: `mirror:${suffix}:v1`,
    requiredForCompletion: true, requirement: "publication", provenance: "FORGELOOP_EXECUTED",
  } });
  return { target, taskId, action };
}

test("forged reconciled commit mirrors invalidate replay", async () => {
  const { appendProtocolEvent } = await import("../src/core/events.js");

  const baseReconciled = async (suffix) => {
    const fixture = await reconciledCommitFixture(suffix);
    await transitionAuthorizedAction(fixture.target, { packageRoot, taskId: fixture.taskId,
      actionId: fixture.action.actionId, expectedRevision: 0, expectedFingerprint: fixture.action.actionFingerprint,
      details: AUTHORIZATION_EVIDENCE(fixture.action.actionFingerprint) });
    await transitionAction(fixture.target, { packageRoot, taskId: fixture.taskId, actionId: fixture.action.actionId, to: "STARTED" });
    await transitionAction(fixture.target, { packageRoot, taskId: fixture.taskId, actionId: fixture.action.actionId, to: "COMMIT_UNKNOWN" });
    await reconcileAction({ target: fixture.target, packageRoot, taskId: fixture.taskId,
      actionId: fixture.action.actionId, outcome: "COMMITTED", evidenceRefs: ["ext:ok"],
      authorityContext: { trustMode: "HOST_ATTESTED", hostSupplied: true, source: "host-boundary", grantRef: "g" } });
    return fixture;
  };

  // Case 1: duplicate mirror with a wrong revision.
  {
    const f = await baseReconciled("wrong-rev");
    try {
      // A second mirror with a wrong revision binds correctly at the event
      // layer but must be flagged by replay as a mismatched/orphaned mirror.
      const { settled } = { settled: await readAction(f.target, { packageRoot, taskId: f.taskId, actionId: f.action.actionId }) };
      await appendProtocolEvent(f.target, {
        taskId: f.taskId,
        event: "ACTION_COMMIT_RECORDED",
        fingerprint: f.action.actionFingerprint,
        details: {
          actionId: f.action.actionId,
          actionFingerprint: f.action.actionFingerprint,
          fromState: "COMMIT_UNKNOWN",
          toState: "COMMITTED",
          revision: 99,
          reconciled: true,
        },
      }, packageRoot, { taskId: f.taskId });

      const projection = await projectActionLedger({
        target: f.target, packageRoot, taskId: f.taskId,
        actionId: f.action.actionId, artifact: settled,
      });
      assert.equal(projection.valid, false, "wrong revision");
      assert.ok(projection.errors.some((e) => e.message.includes("reconciled commit mirror")), "wrong revision");
    } finally { await rm(f.target, { recursive: true, force: true }); }
  }

  // Case 2+3: forged mirror shapes appended directly (bypassing writers).
  for (const [label, details] of [
    ["orphan mirror", {
      actionId: "action-publish",
      actionFingerprint: null,
      fromState: "COMMIT_UNKNOWN",
      toState: "COMMITTED",
      revision: 3,
      reconciled: true,
    }],
  ]) {
    const f = await reconciledCommitFixture(label.replaceAll(" ", "-"));
    try {
      await transitionAuthorizedAction(f.target, { packageRoot, taskId: f.taskId,
        actionId: f.action.actionId, expectedRevision: 0, expectedFingerprint: f.action.actionFingerprint,
        details: AUTHORIZATION_EVIDENCE(f.action.actionFingerprint) });
      await transitionAction(f.target, { packageRoot, taskId: f.taskId, actionId: f.action.actionId, to: "STARTED" });
      const current = await readAction(f.target, { packageRoot, taskId: f.taskId, actionId: f.action.actionId });
      const forgedDetails = {
        ...details,
        actionFingerprint: current.actionFingerprint,
        revision: current.revision + 1,
      };
      await appendProtocolEvent(f.target, {
        taskId: f.taskId,
        event: "ACTION_COMMIT_RECORDED",
        fingerprint: current.actionFingerprint,
        details: forgedDetails,
      }, packageRoot, { taskId: f.taskId });

      const projection = await projectActionLedger({ target: f.target, packageRoot, taskId: f.taskId, actionId: f.action.actionId });
      assert.equal(projection.valid, false, label);
      assert.ok(projection.errors.some((e) => e.message.includes("reconciled commit mirror")), label);
    } finally { await rm(f.target, { recursive: true, force: true }); }
  }
});

test("NOT_COMMITTED and UNKNOWN reconciliation emit no commit mirror and remain valid", async () => {
  const { readEvents } = await import("../src/core/events.js");
  for (const outcome of ["NOT_COMMITTED", "UNKNOWN"]) {
    const f = await reconciledCommitFixture(outcome.toLowerCase());
    try {
      await transitionAuthorizedAction(f.target, { packageRoot, taskId: f.taskId,
        actionId: f.action.actionId, expectedRevision: 0, expectedFingerprint: f.action.actionFingerprint,
        details: AUTHORIZATION_EVIDENCE(f.action.actionFingerprint) });
      await transitionAction(f.target, { packageRoot, taskId: f.taskId, actionId: f.action.actionId, to: "STARTED" });
      await transitionAction(f.target, { packageRoot, taskId: f.taskId, actionId: f.action.actionId, to: "COMMIT_UNKNOWN" });
      const settled = await reconcileAction({ target: f.target, packageRoot, taskId: f.taskId,
        actionId: f.action.actionId, outcome, evidenceRefs: ["ext:obs"],
        authorityContext: { trustMode: "HOST_ATTESTED", hostSupplied: true, source: "host-boundary", grantRef: "g" } });
      const events = await readEvents(f.target, packageRoot, { taskId: f.taskId });
      assert.equal(events.some((e) => e.event === "ACTION_COMMIT_RECORDED"), false, outcome);
      const projection = await projectActionLedger({ target: f.target, packageRoot, taskId: f.taskId,
        actionId: f.action.actionId, artifact: settled.action });
      assert.equal(projection.valid, true, outcome);
      assert.equal(projection.state, outcome === "NOT_COMMITTED" ? "PROPOSED" : "COMMIT_UNKNOWN", outcome);
    } finally { await rm(f.target, { recursive: true, force: true }); }
  }
});
