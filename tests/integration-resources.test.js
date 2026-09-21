import assert from "node:assert/strict";
import { test } from "node:test";

import {
  INTEGRATION_RESOURCE_DEFINITIONS,
  readForgeLoopIntegrationResource,
} from "../src/integration.js";
import { packageRoot, setupAbandonedTask, withRecoveryTarget } from "./helpers/task-recovery-fixture.js";
import { readWorkState, createWorkState, writeWorkState } from "../src/core/work-state.js";
import { setupVerifyingTask } from "./helpers/durable-lifecycle.js";
import { createGitRepository } from "./helpers/git-fixture.js";
import { removeTempTree } from "./helpers/rm-safe.js";
import { bindTaskWorkspace } from "../src/core/workspace-binding.js";
import { runHandoffCreate } from "../src/commands/handoff-create.js";
import { runHandoffAccept } from "../src/commands/handoff-accept.js";

test("resource allowlist is closed and ownership is canonical", async () => {
  await assert.rejects(
    () => readForgeLoopIntegrationResource("project/events-tail", { projectPath: "." }),
    (error) => error.code === "E_INTEGRATION_RESOURCE_UNKNOWN",
  );
  await assert.rejects(
    () => readForgeLoopIntegrationResource("../../etc/passwd", { projectPath: "." }),
    (error) => error.code === "E_INTEGRATION_RESOURCE_UNKNOWN",
  );
  assert.ok(INTEGRATION_RESOURCE_DEFINITIONS["task/ownership"]);
  assert.equal(INTEGRATION_RESOURCE_DEFINITIONS["task/audit-view"].scope, "TASK");
});

test("ownership resource uses the canonical resolver across all states", async () => {
  // ACTIVE task.
  await withRecoveryTarget(async (target) => {
    const { taskId } = await setupAbandonedTask(target, { taskId: "resource-active" });
    const resource = await readForgeLoopIntegrationResource("task/ownership", {
      projectPath: target,
      packageRoot,
      taskId,
    });
    assert.equal(resource.data.claimState, "ACTIVE");
    assert.deepEqual(resource.data.effectiveWriteClaims, ["tests"]);
    assert.equal(resource.data.mutationAllowed, true);
    assert.equal(resource.data.ownershipValid, true);

    // RECOVERED task releases effective claims through validated recovery.
    const { runTaskRecover } = await import("../src/commands/task-recover.js");
    await runTaskRecover({ target, packageRoot, taskId, acknowledgeRecovery: true });
    const recovered = await readForgeLoopIntegrationResource("task/ownership", {
      projectPath: target,
      packageRoot,
      taskId,
    });
    assert.equal(recovered.data.claimState, "RELEASED_BY_RECOVERY");
    assert.deepEqual(recovered.data.effectiveWriteClaims, []);
    assert.equal(recovered.data.mutationAllowed, false);
  });

  // Forged COMPLETE fails closed and retains historical claims.
  await withRecoveryTarget(async (target) => {
    const { taskId } = await setupAbandonedTask(target, { taskId: "resource-forged-complete" });
    const state = await readWorkState(target, { packageRoot, taskId });
    await writeWorkState(target, createWorkState({
      ...state,
      phase: "COMPLETE",
      previousPhase: "REVIEWING",
      verificationEvidence: [{ kind: "OBSERVED", source: "fixture", result: "passed" }],
      evidenceCoverage: [],
      checks: [],
    }), { packageRoot, taskId });

    const forged = await readForgeLoopIntegrationResource("task/ownership", {
      projectPath: target,
      packageRoot,
      taskId,
    });
    assert.equal(forged.data.claimState, "INCONSISTENT");
    assert.deepEqual(forged.data.effectiveWriteClaims, ["tests"]);
    assert.equal(forged.data.mutationAllowed, false);
    assert.equal(forged.data.ownershipValid, false);
    assert.ok(forged.data.reasonCodes.includes("E_COMPLETION_OWNERSHIP_UNPROVEN"));
  });

  // Missing taskId is refused.
  await withRecoveryTarget(async (target) => {
    await assert.rejects(
      () => readForgeLoopIntegrationResource("task/ownership", { projectPath: target, packageRoot }),
      (error) => error.code === "E_TASK_REQUIRED",
    );
  });
});

test("task resources require an existing subject and protocol/info works without one", async () => {
  await withRecoveryTarget(async (target) => {
    const info = await readForgeLoopIntegrationResource("protocol/info", {
      projectPath: target,
      packageRoot,
      packageVersion: "test",
    });
    assert.equal(info.data.features.taskClaimRecovery.validatedClaimProjection, true);
    assert.equal(info.data.features.integrationApi.version, 1);

    await assert.rejects(
      () => readForgeLoopIntegrationResource("task/contract", {
        projectPath: target,
        packageRoot,
        taskId: "no-such-task",
      }),
    );
  });
});

test("task/handoffs projects invalid ledgers as INCONSISTENT", async () => {
  const target = await createGitRepository("forgeloop-resource-handoff-");
  const taskId = "resource-handoff-ledger-invalid";
  try {
    await setupVerifyingTask(target, packageRoot, { taskId });
    await bindTaskWorkspace(target, { taskId, packageRoot });
    const created = await runHandoffCreate({ target, packageRoot, taskId });
    await runHandoffAccept({
      target,
      packageRoot,
      taskId,
      handoffId: created.handoff.handoffId,
      consumerId: "resource-consumer",
    });

    const { appendProtocolEvent } = await import("../src/core/events.js");
    await appendProtocolEvent(target, {
      taskId,
      event: "HANDOFF_ACCEPTED",
      details: {
        handoffId: created.handoff.handoffId,
        handoffDigest: created.handoff.artifactDigest,
        consumerId: "second-consumer",
      },
    }, packageRoot, { taskId });

    const resource = await readForgeLoopIntegrationResource("task/handoffs", {
      projectPath: target,
      packageRoot,
      taskId,
    });
    assert.equal(resource.data.handoffs[0].acceptance.status, "INCONSISTENT");
    assert.ok(resource.data.handoffs[0].acceptance.reasonCodes.includes("E_HANDOFF_ALREADY_ACCEPTED"));
  } finally {
    await removeTempTree(target);
  }
});

test("contract and continuity resources resolve for an existing task", async () => {
  await withRecoveryTarget(async (target) => {
    const { taskId } = await setupAbandonedTask(target, { taskId: "resource-contract-continuity" });

    const contract = await readForgeLoopIntegrationResource("task/contract", {
      projectPath: target,
      packageRoot,
      taskId,
    });
    assert.equal(contract.data.taskId, taskId);

    const continuity = await readForgeLoopIntegrationResource("task/continuity", {
      projectPath: target,
      packageRoot,
      taskId,
    });
    assert.ok(continuity.data !== undefined);
  });
});

test("task/contract failures surface a resource-scoped message", async () => {
  await withRecoveryTarget(async (target) => {
    await setupAbandonedTask(target, { taskId: "resource-contract-missing" });
    const { rm } = await import("node:fs/promises");
    const { taskArtifactPath, taskDirectory } = await import("../src/core/task-paths.js");
    const { ensureWithin } = await import("../src/core/filesystem.js");
    void taskDirectory;
    await rm(ensureWithin(target, taskArtifactPath("resource-contract-missing", "contract")));
    await assert.rejects(
      () => readForgeLoopIntegrationResource("task/contract", {
        projectPath: target,
        packageRoot,
        taskId: "resource-contract-missing",
      }),
      /task\/contract unavailable/,
    );
  });
});

test("project/tasks and task/status resources resolve through canonical discovery", async () => {
  await withRecoveryTarget(async (target) => {
    const { taskId } = await setupAbandonedTask(target, { taskId: "resource-status-tasks" });

    const tasksResource = await readForgeLoopIntegrationResource("project/tasks", {
      projectPath: target,
      packageRoot,
    });
    assert.equal(tasksResource.data.count >= 1, true);
    const projected = tasksResource.data.tasks.find((task) => task.taskId === taskId);
    assert.ok(projected);
    assert.equal(projected.healthy, true);
    assert.equal(projected.mutationAllowed, true);

    const status = await readForgeLoopIntegrationResource("task/status", {
      projectPath: target,
      packageRoot,
      taskId,
    });
    assert.equal(status.data.taskId, taskId);
    assert.equal(status.data.claimState, "ACTIVE");
  });
});

test("task/metrics resource accepts trusted runtime usage context", async () => {
  await withRecoveryTarget(async (target) => {
    const { taskId } = await setupAbandonedTask(target, { taskId: "resource-metrics-usage" });
    const metrics = await readForgeLoopIntegrationResource("task/metrics", {
      projectPath: target,
      packageRoot,
      taskId,
      runtimeContext: {
        usageProvider: {
          async getTaskUsage() {
            return { source: "HOST_REPORTED", totalTokens: 3 };
          },
        },
      },
    });
    assert.equal(metrics.data.usage.source, "HOST_REPORTED");
    assert.equal(metrics.data.usage.totalTokens, 3);
  });
});

test("task/context projects the resolved profile into bounded host context", async () => {
  await withRecoveryTarget(async (target) => {
    const { taskId } = await setupAbandonedTask(target, { taskId: "resource-profile-context" });
    const resource = await readForgeLoopIntegrationResource("task/context", {
      projectPath: target,
      packageRoot,
      taskId,
    });
    assert.equal(resource.data.executionProfile.resolved, "light");
    assert.equal(resource.data.contextPolicy.output, "compact");
    assert.deepEqual(resource.data.optionalContext.available, []);
    assert.equal(resource.data.invariants.requiredGatesPreserved, true);
    assert.equal(resource.data.invariants.verificationTruthPreserved, true);
    assert.equal(resource.data.invariants.lifecyclePhaseSkippingAllowed, false);
  });
});

test("task-scoped resources refuse missing taskId", async () => {
  await withRecoveryTarget(async (target) => {
    for (const uri of ["task/status", "task/ownership", "task/contract", "task/continuity", "task/context", "task/audit-view"]) {
      await assert.rejects(
        () => readForgeLoopIntegrationResource(uri, { projectPath: target, packageRoot }),
        (error) => error.code === "E_TASK_REQUIRED",
        uri,
      );
    }
  });
});

test("project/tasks projects recovered tasks as non-mutable", async () => {
  await withRecoveryTarget(async (target) => {
    const { taskId } = await setupAbandonedTask(target, { taskId: "resource-tasks-recovered" });
    const { runTaskRecover } = await import("../src/commands/task-recover.js");
    await runTaskRecover({ target, packageRoot, taskId, acknowledgeRecovery: true });

    const tasksResource = await readForgeLoopIntegrationResource("project/tasks", {
      projectPath: target,
      packageRoot,
    });
    const projected = tasksResource.data.tasks.find((task) => task.taskId === taskId);
    assert.equal(projected.mutationAllowed, false);
    // Recovery suspends mutation authority without rewriting lifecycle phase.
    assert.equal(projected.phase, "VERIFYING");
  });
});
