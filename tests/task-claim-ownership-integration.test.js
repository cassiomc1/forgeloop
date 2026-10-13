import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { test } from "node:test";

import { readRawFixtureText, overwriteFixtureText, overwriteFixtureArtifactBytes, deleteFixtureArtifact } from "./helpers/native-storage-fixture.js";
import { runTaskCreate } from "../src/commands/task-create.js";
import { runTaskRecover } from "../src/commands/task-recover.js";
import { withTaskMutation } from "../src/core/task-command.js";
import { discoverTasks } from "../src/core/task-discovery.js";
import { ensureWithin, fileExists } from "../src/core/filesystem.js";
import { taskArtifactPath, taskDirectory } from "../src/core/task-paths.js";
import { createTaskRecovery, writeTaskRecovery } from "../src/core/task-recovery.js";
import { readWorkState } from "../src/core/work-state.js";
import { resolveTaskClaimState } from "../src/core/task-claim-state.js";
import { inspectTaskConflictState } from "../src/core/task-conflict-inspection.js";
import {
  packageRoot,
  setupAbandonedTask,
  withRecoveryTarget,
} from "./helpers/task-recovery-fixture.js";

async function writeUnattestedRecovery(target, taskId) {
  const state = await readWorkState(target, { packageRoot, taskId });
  await writeTaskRecovery(target, createTaskRecovery({
    taskId,
    recoveredAt: new Date().toISOString(),
    recoveryId: "recovery-unattested",
    recoveryEventSeq: 999,
    classificationAtRecovery: "ABANDONED",
    reasonCodes: ["IDLE_BEYOND_THRESHOLD"],
    releasedClaims: ["tests"],
    previousPhase: state.phase,
    previousRevision: state.revision,
    repositoryFingerprint: state.repositoryFingerprint,
    authority: { kind: "CALLER_ACKNOWLEDGED" },
  }), packageRoot);
}

test("a recovery artifact without ledger proof cannot free claims for task-create", async () => {
  await withRecoveryTarget(async (target) => {
    const { taskId } = await setupAbandonedTask(target, { taskId: "unattested-owner" });
    await writeUnattestedRecovery(target, taskId);

    const discovered = (await discoverTasks(target, packageRoot)).find((task) => task.taskId === taskId);
    assert.equal(discovered.claimState, "INCONSISTENT");
    assert.deepEqual(discovered.effectiveWriteClaims, ["tests"]);

    await assert.rejects(
      () => runTaskCreate({ target, packageRoot, taskId: "blocked-new-owner", claims: ["tests"] }),
      (error) => error.code === "E_TASK_CLAIM_OWNERSHIP_INCONSISTENT",
    );
  });
});

test("deleting an active recovery tombstone cannot restore mutation authority", async () => {
  await withRecoveryTarget(async (target) => {
    const { taskId } = await setupAbandonedTask(target, { taskId: "deleted-recovery-owner" });
    await runTaskRecover({ target, packageRoot, taskId, acknowledgeRecovery: true });
    await deleteFixtureArtifact(target, taskArtifactPath(taskId, "recovery"));

    let callbackRan = false;
    await assert.rejects(
      () => withTaskMutation(target, { taskId, packageRoot }, "tamper-attempt", async () => {
        callbackRan = true;
      }),
      (error) => error.code === "E_TASK_CLAIM_OWNERSHIP_INCONSISTENT",
    );
    assert.equal(callbackRan, false);
  });
});

test("a corrupt recovery artifact blocks overlapping claim acquisition", async () => {
  await withRecoveryTarget(async (target) => {
    const { taskId } = await setupAbandonedTask(target, { taskId: "corrupt-recovery-owner" });
    await writeUnattestedRecovery(target, taskId);
    await overwriteFixtureArtifactBytes(target, taskArtifactPath(taskId, "recovery"), "{\"status\":");

    await assert.rejects(
      () => runTaskCreate({ target, packageRoot, taskId: "blocked-by-corruption", claims: ["tests"] }),
      (error) => error.code === "E_TASK_CLAIM_OWNERSHIP_INCONSISTENT",
    );
  });
});

test("an unmigrated unhealthy task namespace blocks native claim acquisition", async () => {
  await withRecoveryTarget(async (target) => {
    const corruptTaskId = "descriptorless-owner";
    const directory = ensureWithin(target, taskDirectory(corruptTaskId));
    await mkdir(directory, { recursive: true });
    await writeFile(`${directory}/events.ndjson`, "corrupt\n", "utf8");

    await assert.rejects(
      () => runTaskCreate({ target, packageRoot, taskId: "blocked-by-namespace", claims: ["src"] }),
      (error) => error.code === "E_STORAGE_MIGRATION_REQUIRED",
    );
    assert.equal(await fileExists(ensureWithin(target, ".forgeloop/state.sqlite")), false);
  });
});

test("ownership surfaces remain deterministic on a large append-only ledger", async () => {
  await withRecoveryTarget(async (target) => {
    const { taskId } = await setupAbandonedTask(target, { taskId: "large-ledger-task" });
    const { eventHash } = await import("../src/core/events.js");
    const eventsPath = ensureWithin(target, taskArtifactPath(taskId, "events"));
    const lines = (await readRawFixtureText(target, eventsPath)).trim().split("\n").map((line) => JSON.parse(line));
    let previousHash = lines.at(-1).hash;
    const baseSeq = lines.length;
    const baseAt = Date.parse(lines[0].at);
    const count = 5000 - baseSeq;
    for (let i = 0; i < count; i += 1) {
      const event = {
        seq: baseSeq + i + 1,
        schemaVersion: 1,
        protocolVersion: 1,
        taskId,
        event: "CONTINUITY_RECORDED",
        at: new Date(baseAt + (i + 1) * 1000).toISOString(),
        previousHash,
        details: { note: `checkpoint ${i}` },
      };
      event.hash = eventHash(event);
      previousHash = event.hash;
      lines.push(event);
    }
    await overwriteFixtureText(target, eventsPath, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`, "utf8");

    const startedAt = Date.now();
    const projection = await resolveTaskClaimState(target, { taskId, packageRoot });
    const conflict = await inspectTaskConflictState(target, { taskId, packageRoot });
    const elapsed = Date.now() - startedAt;
    assert.equal(projection.claimState, "ACTIVE");
    assert.equal(conflict.evidence.claimState, "ACTIVE");
    assert.ok(elapsed < 60000, `ownership resolution should complete promptly, took ${elapsed}ms`);
  });
});
