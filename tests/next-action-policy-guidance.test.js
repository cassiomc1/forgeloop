import { readFixtureText, overwriteFixtureText, overwriteFixtureRecordBytes } from "./helpers/native-storage-fixture.js";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { requestApproval, resolveApproval } from "../src/core/approvals.js";
import {
  proposeAction,
  transitionAction,
  transitionAuthorizedAction,
} from "../src/core/actions.js";
import { getNextAction, NEXT_ACTIONS } from "../src/core/next-action.js";
import { readWorkState } from "../src/core/work-state.js";
import { getPackageRoot } from "../src/core/templates.js";
import { loadPolicyIdentity } from "../src/core/policy-engine.js";
import { taskActionPath, taskApprovalPath } from "../src/core/task-paths.js";
import { setupVerifyingTask } from "./helpers/durable-lifecycle.js";
import { seedPolicyEpoch } from "./helpers/durable-policy.js";
import { removeTempTree } from "./helpers/rm-safe.js";

const packageRoot = getPackageRoot();

const trustedAuthority = Object.freeze({
  trustMode: "HOST_ATTESTED",
  hostSupplied: true,
  source: "host-boundary",
  grantRef: "grant-next-policy",
});

async function withProposedAction(run, {
  decision = "ALLOW",
  capability = "filesystem.write",
  taskId = `next-policy-${decision.toLowerCase().replaceAll("_", "-")}`,
} = {}) {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-next-policy-"));
  try {
    await setupVerifyingTask(target, packageRoot, {
      taskId,
      capabilityPolicy: {
        schemaVersion: 1,
        defaultDecision: "DENY",
        rules: capability === "unknown.capability" ? [] : [{ capability, decision }],
      },
    });
    const { action } = await proposeAction(target, {
      packageRoot,
      taskId,
      input: {
        actionId: "action-policy",
        effectClass: "REVERSIBLE_WRITE",
        capability,
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

async function createPendingApproval(target, taskId, action, overrides = {}) {
  const state = await readWorkState(target, { packageRoot, taskId });
  await requestApproval(target, {
    packageRoot,
    taskId,
    input: {
      approvalId: "approval-policy",
      actionId: action.actionId,
      actionFingerprint: action.actionFingerprint,
      contractFingerprint: state.contractFingerprint,
      taskRevision: state.revision,
      capability: action.capability,
      ...overrides,
    },
  });
}

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

test("next keeps ALLOW authorization guidance for a proposed required action", async () => {
  await withProposedAction(async ({ target, taskId }) => {
    const result = await getNextAction({ target, packageRoot, taskId });

    assert.equal(result.nextAction, NEXT_ACTIONS.AUTHORIZE_ACTION);
    assert.ok(result.commands.some((command) => command.includes("action-authorize")));
    assert.equal(result.capabilityDecision.decision, "ALLOW");
  });
});

test("next requests approval instead of recommending authorization when policy requires it", async () => {
  await withProposedAction(async ({ target, taskId }) => {
    const result = await getNextAction({ target, packageRoot, taskId });

    assert.equal(result.nextAction, NEXT_ACTIONS.REQUEST_ACTION_APPROVAL);
    assert.ok(result.commands.some((command) => command.includes("approval-request")));
    assert.equal(result.commands.some((command) => command.includes("action-authorize")), false);
    assert.equal(result.approvalRequired.actionId, "action-policy");
    assert.equal(result.capabilityDecision.decision, "REQUIRE_APPROVAL");
  }, { decision: "REQUIRE_APPROVAL" });
});

test("next fails closed when REQUIRE_APPROVAL is tampered to ALLOW", async () => {
  await withProposedAction(async ({ target, taskId }) => {
    await overwriteCapabilityPolicy(target, "ALLOW");

    const result = await getNextAction({ target, packageRoot, taskId });

    assert.notEqual(result.nextAction, NEXT_ACTIONS.AUTHORIZE_ACTION);
    assert.notEqual(result.nextAction, NEXT_ACTIONS.REQUEST_ACTION_APPROVAL);
    assert.notEqual(result.nextAction, NEXT_ACTIONS.RESOLVE_ACTION_APPROVAL);
    assert.deepEqual(result.commands ?? [], []);
    assert.ok(result.reasons.some((reason) => reason.code === "E_ACTION_POLICY_DRIFT"));
    assert.equal(result.capabilityDecision, undefined);
  }, {
    decision: "REQUIRE_APPROVAL",
    taskId: "next-policy-drift-approval-to-allow",
  });
});

test("next reports policy drift before interpreting every tampered capability decision", async () => {
  const cases = [
    { initial: "ALLOW", tampered: "DENY", taskId: "next-policy-drift-allow-to-deny" },
    { initial: "REQUIRE_APPROVAL", tampered: "DENY", taskId: "next-policy-drift-approval-to-deny", pending: true },
    { initial: "REQUIRE_APPROVAL", tampered: "REQUIRE_AUTHORITY", taskId: "next-policy-drift-approval-to-authority", pending: true },
  ];

  for (const { initial, tampered, taskId, pending } of cases) {
    await withProposedAction(async ({ target, taskId: activeTaskId, action }) => {
      if (pending) await createPendingApproval(target, activeTaskId, action);
      await overwriteCapabilityPolicy(target, tampered);

      const result = await getNextAction({ target, packageRoot, taskId: activeTaskId });

      assert.notEqual(result.nextAction, NEXT_ACTIONS.RESOLVE_ACTION_APPROVAL, `${initial} -> ${tampered}`);
      assert.deepEqual(result.commands ?? [], [], `${initial} -> ${tampered}`);
      assert.ok(
        result.reasons.some((reason) => reason.code === "E_ACTION_POLICY_DRIFT"),
        `${initial} -> ${tampered}`,
      );
      assert.equal(result.capabilityDecision, undefined, `${initial} -> ${tampered}`);
      if (tampered === "REQUIRE_AUTHORITY") {
        assert.equal(result.hostActionRequired, undefined);
        assert.equal(result.authorityRequired, undefined);
      }
    }, { decision: initial, taskId });
  }
});

test("next resumes normal guidance after a canonical policy epoch update", async () => {
  await withProposedAction(async ({ target, taskId }) => {
    await seedPolicyEpoch(target, packageRoot, taskId, {
      schemaVersion: 1,
      defaultDecision: "DENY",
      rules: [{ capability: "filesystem.write", decision: "ALLOW" }],
    });

    const identity = await loadPolicyIdentity(target, packageRoot, taskId);
    assert.equal(identity.status, "VALID");

    const result = await getNextAction({ target, packageRoot, taskId });

    assert.equal(result.nextAction, NEXT_ACTIONS.AUTHORIZE_ACTION);
    assert.ok(result.commands.some((command) => command.includes("action-authorize")));
    assert.equal(result.capabilityDecision.decision, "ALLOW");
  }, {
    decision: "REQUIRE_APPROVAL",
    taskId: "next-policy-valid-epoch-update",
  });
});

test("next exposes host resolution for a pending approval without an impossible CLI command", async () => {
  await withProposedAction(async ({ target, taskId, action }) => {
    await createPendingApproval(target, taskId, action);

    const result = await getNextAction({ target, packageRoot, taskId });

    assert.equal(result.nextAction, NEXT_ACTIONS.RESOLVE_ACTION_APPROVAL);
    assert.deepEqual(result.commands, []);
    assert.equal(result.authorityRequired.kind, "HOST_ATTESTED");
    assert.equal(result.authorityRequired.approvalId, "approval-policy");
  }, { decision: "REQUIRE_APPROVAL" });
});

test("current ALLOW policy overrides an old pending approval", async () => {
  await withProposedAction(async ({ target, taskId, action }) => {
    await createPendingApproval(target, taskId, action);

    const result = await getNextAction({ target, packageRoot, taskId });

    assert.equal(result.nextAction, NEXT_ACTIONS.AUTHORIZE_ACTION);
    assert.notEqual(result.nextAction, NEXT_ACTIONS.RESOLVE_ACTION_APPROVAL);
    assert.equal(result.capabilityDecision.decision, "ALLOW");
  }, { decision: "ALLOW", taskId: "next-policy-allow-pending" });
});

test("current DENY policy overrides an old pending approval", async () => {
  await withProposedAction(async ({ target, taskId, action }) => {
    await createPendingApproval(target, taskId, action);

    const result = await getNextAction({ target, packageRoot, taskId });

    assert.equal(result.nextAction, NEXT_ACTIONS.RESOLVE_BLOCKER);
    assert.notEqual(result.nextAction, NEXT_ACTIONS.RESOLVE_ACTION_APPROVAL);
    assert.deepEqual(result.commands, []);
    assert.equal(result.capabilityDecision.decision, "DENY");
  }, { decision: "DENY", taskId: "next-policy-deny-pending" });
});

test("non-approval policy decisions do not inspect malformed approval artifacts", async () => {
  for (const decision of ["ALLOW", "DENY", "REQUIRE_AUTHORITY"]) {
    await withProposedAction(async ({ target, taskId }) => {
      const approvalPath = path.join(target, taskApprovalPath(taskId, "approval-malformed"));
      await overwriteFixtureRecordBytes(target,
        approvalPath,
        "{ invalid approval json\n",
      );

      const result = await getNextAction({ target, packageRoot, taskId });

      assert.notEqual(result.nextAction, NEXT_ACTIONS.RESOLVE_ACTION_APPROVAL, decision);
      assert.equal(result.capabilityDecision.decision, decision);
    }, {
      decision,
      taskId: `next-policy-no-approval-inspection-${decision.toLowerCase()}`,
    });
  }
});

test("next accepts a valid trusted approval and returns authorization guidance", async () => {
  await withProposedAction(async ({ target, taskId, action }) => {
    const state = await readWorkState(target, { packageRoot, taskId });
    await requestApproval(target, {
      packageRoot,
      taskId,
      input: {
        approvalId: "approval-policy",
        actionId: action.actionId,
        actionFingerprint: action.actionFingerprint,
        contractFingerprint: state.contractFingerprint,
        taskRevision: state.revision,
        capability: action.capability,
      },
    });
    await resolveApproval(target, {
      packageRoot,
      taskId,
      approvalId: "approval-policy",
      decision: "APPROVED",
      authorityKind: "HOST_ATTESTED",
      hostGrantRef: trustedAuthority.grantRef,
      authorityContext: trustedAuthority,
    });

    const result = await getNextAction({ target, packageRoot, taskId });

    assert.equal(result.nextAction, NEXT_ACTIONS.AUTHORIZE_ACTION);
    assert.ok(result.commands.some((command) => command.includes("action-authorize")));
    assert.equal(result.capabilityDecision.decision, "REQUIRE_APPROVAL");
    assert.equal(result.capabilityDecision.approvalId, "approval-policy");
  }, { decision: "REQUIRE_APPROVAL" });
});

test("next keeps REQUIRE_AUTHORITY host-bound even when a pending approval exists", async () => {
  await withProposedAction(async ({ target, taskId, action }) => {
    await createPendingApproval(target, taskId, action);

    const result = await getNextAction({ target, packageRoot, taskId });

    assert.equal(result.nextAction, NEXT_ACTIONS.AUTHORIZE_ACTION);
    assert.deepEqual(result.commands, []);
    assert.equal(result.authorityRequired.kind, "HOST_ATTESTED");
    assert.equal(result.hostActionRequired.executionBoundary, "HOST");
    assert.equal(result.hostActionRequired.requiresAuthorityContext, true);
    assert.notEqual(result.nextAction, NEXT_ACTIONS.RESOLVE_ACTION_APPROVAL);
  }, { decision: "REQUIRE_AUTHORITY", taskId: "next-policy-authority-pending" });
});

test("next keeps REQUIRE_AUTHORITY host-bound with or without trusted authority", async () => {
  await withProposedAction(async ({ target, taskId }) => {
    const blocked = await getNextAction({ target, packageRoot, taskId });
    assert.equal(blocked.nextAction, NEXT_ACTIONS.AUTHORIZE_ACTION);
    assert.deepEqual(blocked.commands, []);
    assert.equal(blocked.authorityRequired.kind, "HOST_ATTESTED");
    assert.equal(blocked.hostActionRequired.action, "action-authorize");
    assert.equal(blocked.capabilityDecision.decision, "REQUIRE_AUTHORITY");

    const trusted = await getNextAction({ target, packageRoot, taskId, authorityContext: trustedAuthority });
    assert.equal(trusted.nextAction, NEXT_ACTIONS.AUTHORIZE_ACTION);
    assert.deepEqual(trusted.commands, []);
    assert.equal(trusted.hostActionRequired.action, "action-authorize");
    assert.equal(trusted.capabilityDecision.authorityRef, trustedAuthority.grantRef);
  }, { decision: "REQUIRE_AUTHORITY" });
});

test("stale pending approvals are ignored when REQUIRE_APPROVAL is current", async () => {
  const staleBindings = [
    ["actionFingerprint", "c".repeat(64)],
    ["contractFingerprint", "d".repeat(64)],
    ["taskRevision", 999],
  ];

  for (const [field, value] of staleBindings) {
    await withProposedAction(async ({ target, taskId, action }) => {
      await createPendingApproval(target, taskId, action, { [field]: value });

      const result = await getNextAction({ target, packageRoot, taskId });

      assert.equal(result.nextAction, NEXT_ACTIONS.REQUEST_ACTION_APPROVAL, field);
      assert.notEqual(result.nextAction, NEXT_ACTIONS.RESOLVE_ACTION_APPROVAL, field);
      assert.equal(result.capabilityDecision.decision, "REQUIRE_APPROVAL", field);
    }, {
      decision: "REQUIRE_APPROVAL",
      taskId: `next-policy-stale-${field}`,
    });
  }
});

test("pending approvals for non-required actions do not block the required action", async () => {
  await withProposedAction(async ({ target, taskId, action }) => {
    const { action: unrelated } = await proposeAction(target, {
      packageRoot,
      taskId,
      input: {
        actionId: "action-unrelated",
        effectClass: "REVERSIBLE_WRITE",
        capability: action.capability,
        target: "workspace/unrelated",
        operation: "update unrelated item",
        idempotencyKey: `${taskId}:unrelated:v1`,
        requiredForCompletion: false,
        requirement: "unrelated",
        provenance: "CALLER_REPORTED",
      },
    });
    await createPendingApproval(target, taskId, unrelated, { approvalId: "approval-unrelated" });

    const result = await getNextAction({ target, packageRoot, taskId });

    assert.equal(result.nextAction, NEXT_ACTIONS.REQUEST_ACTION_APPROVAL);
    assert.notEqual(result.nextAction, NEXT_ACTIONS.RESOLVE_ACTION_APPROVAL);
  }, { decision: "REQUIRE_APPROVAL", taskId: "next-policy-unrelated-pending" });
});

test("pending approvals for non-PROPOSED actions do not block next", async () => {
  await withProposedAction(async ({ target, taskId, action }) => {
    await transitionAuthorizedAction(target, {
      packageRoot,
      taskId,
      actionId: action.actionId,
      expectedRevision: action.revision,
      expectedFingerprint: action.actionFingerprint,
      details: {
        actionFingerprint: action.actionFingerprint,
        capabilityDecision: "ALLOW",
        capabilityPolicyFingerprint: "a".repeat(64),
        policyLockDigest: `sha256:${"b".repeat(64)}`,
        taskPolicyDigest: `sha256:${"c".repeat(64)}`,
      },
    });
    await createPendingApproval(target, taskId, action);

    const result = await getNextAction({ target, packageRoot, taskId });

    assert.notEqual(result.nextAction, NEXT_ACTIONS.RESOLVE_ACTION_APPROVAL);
  }, { decision: "ALLOW", taskId: "next-policy-authorized-pending" });
});

test("next blocks denied and unknown capabilities without authorization guidance", async () => {
  await withProposedAction(async ({ target, taskId }) => {
    const result = await getNextAction({ target, packageRoot, taskId });
    assert.equal(result.nextAction, NEXT_ACTIONS.RESOLVE_BLOCKER);
    assert.deepEqual(result.commands, []);
    assert.equal(result.reasonCodes.includes("E_ACTION_CAPABILITY_DENIED"), true);
  }, { decision: "DENY" });

  await withProposedAction(async ({ target, taskId, action }) => {
    const actionPath = path.join(target, taskActionPath(taskId, action.actionId));
    const artifact = JSON.parse(await readFixtureText(target, actionPath));
    artifact.capability = "unknown.capability";
    await overwriteFixtureText(target, actionPath, `${JSON.stringify(artifact)}\n`, "utf8");
    const result = await getNextAction({ target, packageRoot, taskId });
    assert.equal(result.nextAction, NEXT_ACTIONS.RESOLVE_BLOCKER);
    assert.deepEqual(result.commands, []);
    assert.equal(result.reasonCodes.includes("E_ACTION_INVALID"), true);
  }, {
    decision: "DENY",
    taskId: "next-policy-unknown",
  });
});

test("next preserves COMMIT_UNKNOWN reconciliation priority over policy guidance", async () => {
  await withProposedAction(async ({ target, taskId, action }) => {
    await transitionAuthorizedAction(target, {
      packageRoot,
      taskId,
      actionId: action.actionId,
      expectedRevision: action.revision,
      expectedFingerprint: action.actionFingerprint,
      details: {
        actionFingerprint: action.actionFingerprint,
        capabilityDecision: "ALLOW",
        capabilityPolicyFingerprint: "a".repeat(64),
        policyLockDigest: `sha256:${"b".repeat(64)}`,
        taskPolicyDigest: `sha256:${"c".repeat(64)}`,
      },
    });
    await transitionAction(target, { packageRoot, taskId, actionId: action.actionId, to: "STARTED" });
    await transitionAction(target, {
      packageRoot,
      taskId,
      actionId: action.actionId,
      to: "COMMIT_UNKNOWN",
      details: { commitResultCode: "AMBIGUOUS", reason: "outcome unavailable" },
    });

    const result = await getNextAction({ target, packageRoot, taskId });
    assert.equal(result.nextAction, NEXT_ACTIONS.RECONCILE_ACTION);
    assert.equal(result.commands.some((command) => command.includes("action-reconcile")), true);
  }, { decision: "ALLOW" });
});
