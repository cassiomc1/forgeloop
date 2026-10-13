import { removeTempTree } from "./helpers/rm-safe.js";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  detectLegacySingletonLayout,
  migrateLegacyLayout,
} from "../src/core/task-migration.js";
import { taskStorageKey } from "../src/core/task-identity.js";
import { fileExists } from "../src/core/filesystem.js";
import { getPackageRoot } from "../src/core/templates.js";
import { createWorkState } from "../src/core/work-state.js";
import { createContract, contractFingerprint } from "../src/core/contract.js";
import { migrateLegacyTaskStorage } from "../src/core/task-storage-migration.js";
import { openStorageDatabase, findTaskById } from "../src/storage/index.js";
import { inventoryLegacySource } from "../src/storage/migration-source.js";
import { createGate } from "./helpers/gates.js";
import {
  E_TASK_MIGRATION_IDENTITY_MISMATCH,
  E_TASK_MIGRATION_INVALID,
} from "../src/core/error-codes.js";

const packageRoot = getPackageRoot();

// Explicit pre-cutover source fixtures; these are migration inputs, not
// production operational writers or native authority mirrors.
async function writeJsonArtifact(target, relativePath, value) {
  const filename = path.join(target, relativePath);
  await mkdir(path.dirname(filename), { recursive: true });
  await writeFile(filename, JSON.stringify(value) + "\n", "utf8");
}
function writeContract(target, contract) {
  return writeJsonArtifact(target, ".forgeloop/current-contract.json", contract);
}
function writeWorkState(target, state) {
  return writeJsonArtifact(target, ".forgeloop/work-state.json", state);
}


async function withTarget(fn) {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-task-migration-"));
  try {
    await fn(target);
  } finally {
    await removeTempTree(target);
  }
}

test("detectLegacySingletonLayout detects presence of legacy root artifacts", async () => {
  await withTarget(async (target) => {
    // Empty directory
    const emptyDetect = await detectLegacySingletonLayout(target);
    assert.equal(emptyDetect.hasLegacy, false);

    // Write root contract and work-state
    const contract = createContract({
      taskId: "legacy-task-001",
      objective: "Legacy 1.0 task",
      deliverables: ["src/index.js"],
      constraints: ["none"],
      risks: ["low"],
      verification: ["tests"],
      successCriteria: ["tests pass"],
      stopConditions: ["error"],
      unresolvedDecisions: [],
      sourceRefs: ["src"],
    });
    await writeContract(target, contract, packageRoot);

    const state = createWorkState({
      taskId: "legacy-task-001",
      contractFingerprint: contractFingerprint(contract),
      repositoryFingerprint: { branch: null, head: null },
      phase: "PLANNED",
      completedSteps: [],
      pendingSteps: [],
      checks: [],
      failures: [],
      blockers: [],
    });
    await writeWorkState(target, state, { packageRoot });

    const detected = await detectLegacySingletonLayout(target);
    assert.equal(detected.hasLegacy, true);
    assert.ok(detected.legacyFiles.length >= 2);
  });
});

test("explicit migration publishes legacy artifacts into canonical SQLite storage", async () => {
  await withTarget(async (target) => {
    const contract = createContract({
      taskId: "migrating-task",
      objective: "Migrate me",
      deliverables: ["src/index.js"],
      constraints: ["none"],
      risks: ["low"],
      verification: ["tests"],
      successCriteria: ["tests pass"],
      stopConditions: ["error"],
      unresolvedDecisions: [],
      sourceRefs: ["src"],
    });
    await writeContract(target, contract, packageRoot);

    const state = createWorkState({
      taskId: "migrating-task",
      contractFingerprint: contractFingerprint(contract),
      repositoryFingerprint: { branch: null, head: null },
      phase: "PLANNED",
      completedSteps: [],
      pendingSteps: [],
      checks: [],
      failures: [],
      blockers: [],
    });
    await writeWorkState(target, state, { packageRoot });

    // Dry run first
    const dryRunResult = await migrateLegacyLayout(target, { dryRun: true, packageRoot });
    assert.equal(dryRunResult.migrated, false);
    assert.equal(dryRunResult.dryRun, true);
    assert.equal(dryRunResult.taskId, "migrating-task");

    // Perform actual migration
    const result = await migrateLegacyTaskStorage(target, { packageRoot, destination: "retained", writersQuiesced: true });
    assert.equal(result.migrated, true);
    assert.equal(result.taskId, "migrating-task");
    assert.equal(result.taskKey, taskStorageKey("migrating-task"));

    // Legacy root files should no longer exist
    assert.equal(await fileExists(path.join(target, ".forgeloop", "current-contract.json")), false);
    assert.equal(await fileExists(path.join(target, ".forgeloop", "work-state.json")), false);

    // Canonical storage replaces the writable namespace and has a real receipt.
    assert.equal(await fileExists(path.join(target, ".forgeloop", "task-state")), false);
    assert.equal(await fileExists(path.join(target, result.migrationReceipt)), true);
    const db = openStorageDatabase(path.join(target, ".forgeloop/state.sqlite"));
    try {
      const descriptor = findTaskById(db, "migrating-task").descriptor;
      assert.equal(descriptor.taskId, "migrating-task");
      assert.equal(descriptor.taskKey, result.taskKey);
    } finally { db.close(); }

  });
});

test("migration rejects malformed event line and preserves legacy files", async () => {
  await withTarget(async (target) => {
    const contract = createContract({
      taskId: "event-corrupt-task",
      objective: "Test corrupt event line",
      deliverables: ["src/index.js"],
      constraints: ["none"],
      risks: ["low"],
      verification: ["tests"],
      successCriteria: ["tests pass"],
      stopConditions: ["error"],
      unresolvedDecisions: [],
      sourceRefs: ["src"],
    });
    await writeContract(target, contract, packageRoot);

    const state = createWorkState({
      taskId: "event-corrupt-task",
      contractFingerprint: contractFingerprint(contract),
      repositoryFingerprint: { branch: null, head: null },
      phase: "PLANNED",
      completedSteps: [],
      pendingSteps: [],
      checks: [],
      failures: [],
      blockers: [],
    });
    await writeWorkState(target, state, { packageRoot });

    // Write malformed events.ndjson
    await writeFile(path.join(target, ".forgeloop", "events.ndjson"), "{\"schemaVersion\":1}\n{broken json\n", "utf8");

    await assert.rejects(
      () => migrateLegacyLayout(target, { packageRoot }),
      (error) => error.code === E_TASK_MIGRATION_INVALID,
    );

    // Legacy files remain untouched
    assert.equal(await fileExists(path.join(target, ".forgeloop", "current-contract.json")), true);
    assert.equal(await fileExists(path.join(target, ".forgeloop", "work-state.json")), true);
    assert.equal(await fileExists(path.join(target, ".forgeloop", "events.ndjson")), true);

    // Target task directory does not exist
    const taskKey = taskStorageKey("event-corrupt-task");
    assert.equal(await fileExists(path.join(target, ".forgeloop", "task-state", taskKey)), false);
  });
});

test("migration rejects gate or execution with mismatched taskId and preserves legacy files", async () => {
  await withTarget(async (target) => {
    const contract = createContract({
      taskId: "mismatch-task",
      objective: "Test gate mismatch",
      deliverables: ["src/index.js"],
      constraints: ["none"],
      risks: ["low"],
      verification: ["tests"],
      successCriteria: ["tests pass"],
      stopConditions: ["error"],
      unresolvedDecisions: [],
      sourceRefs: ["src"],
    });
    await writeContract(target, contract, packageRoot);

    const state = createWorkState({
      taskId: "mismatch-task",
      contractFingerprint: contractFingerprint(contract),
      repositoryFingerprint: { branch: null, head: null },
      phase: "PLANNED",
      completedSteps: [],
      pendingSteps: [],
      checks: [],
      failures: [],
      blockers: [],
    });
    await writeWorkState(target, state, { packageRoot });

    // Create legacy gate with different taskId
    const gatesDir = path.join(target, ".forgeloop", "gates");
    await mkdir(gatesDir, { recursive: true });
    const gateObj = createGate({
      taskId: "other-task-id",
      gate: "approval",
      status: "satisfied",
      requiredBy: ["preflight"],
      artifacts: [],
      decisions: ["DECISION-1"],
      unknowns: [],
      approvedAssumptions: [],
    });
    await writeJsonArtifact(
      target,
      ".forgeloop/gates/gate-1.json",
      gateObj,
      "gate",
      packageRoot,
    );

    await assert.rejects(
      () => migrateLegacyLayout(target, { packageRoot }),
      (error) => error.code === E_TASK_MIGRATION_IDENTITY_MISMATCH || error.code === E_TASK_MIGRATION_INVALID,
    );

    // Legacy files untouched
    assert.equal(await fileExists(path.join(target, ".forgeloop", "current-contract.json")), true);
    assert.equal(await fileExists(path.join(target, ".forgeloop", "gates", "gate-1.json")), true);
  });
});

test("migration rejects execution with mismatched taskId and preserves legacy files", async () => {
  await withTarget(async (target) => {
    const contract = createContract({
      taskId: "exec-mismatch-task",
      objective: "Test execution mismatch",
      deliverables: ["src/index.js"],
      constraints: ["none"],
      risks: ["low"],
      verification: ["tests"],
      successCriteria: ["tests pass"],
      stopConditions: ["error"],
      unresolvedDecisions: [],
      sourceRefs: ["src"],
    });
    await writeContract(target, contract, packageRoot);

    const state = createWorkState({
      taskId: "exec-mismatch-task",
      contractFingerprint: contractFingerprint(contract),
      repositoryFingerprint: { branch: null, head: null },
      phase: "PLANNED",
      completedSteps: [],
      pendingSteps: [],
      checks: [],
      failures: [],
      blockers: [],
    });
    await writeWorkState(target, state, { packageRoot });

    // Create legacy execution with different taskId
    const execsDir = path.join(target, ".forgeloop", "executions");
    await mkdir(execsDir, { recursive: true });
    await writeJsonArtifact(
      target,
      ".forgeloop/executions/exec-001.json",
      {
        schemaVersion: 1,
        protocolVersion: 1,
        executionId: "exec-001",
        taskId: "other-task-id",
        checkId: "check-1",
        requirement: "verification",
        verificationCycle: 1,
        kind: "COMMAND_EXECUTION",
        argv: ["npm", "test"],
        cwd: target,
        resolution: {
          resolutionMode: "DIRECT_EXEC",
          mayInstall: false,
          installer: null,
          tool: "npm",
        },
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        status: "passed",
        exitCode: 0,
      },
      "execution",
      packageRoot,
    );

    await assert.rejects(
      () => migrateLegacyLayout(target, { packageRoot }),
      (error) => error.code === E_TASK_MIGRATION_IDENTITY_MISMATCH || error.code === E_TASK_MIGRATION_INVALID,
    );

    assert.equal(await fileExists(path.join(target, ".forgeloop", "current-contract.json")), true);
    assert.equal(await fileExists(path.join(target, ".forgeloop", "executions", "exec-001.json")), true);
  });
});

test("retired filesystem migration refuses copy, publication and cleanup hooks without changing source", async () => {
  await withTarget(async target => {
    const contract = createContract({ taskId: "retired-legacy-writer", objective: "Preserve source", deliverables: ["src"], constraints: [], risks: [], verification: ["tests"], successCriteria: ["pass"], stopConditions: ["error"], unresolvedDecisions: [], sourceRefs: [] });
    await writeContract(target, contract, packageRoot);
    const before = await inventoryLegacySource(target);
    for (const hook of ["afterCopyForTest", "afterPublishForTest", "beforeLegacyCleanupForTest", "removeLegacyArtifactForTest"]) {
      await assert.rejects(migrateLegacyLayout(target, { packageRoot, [hook]: () => assert.fail("Retired filesystem lifecycle must not execute") }), { code: "E_STORAGE_OPERATION_UNSUPPORTED" });
      assert.deepEqual(await inventoryLegacySource(target), before);
      assert.equal(await fileExists(path.join(target, ".forgeloop/task-state")), false);
      assert.equal(await fileExists(path.join(target, ".forgeloop/state.sqlite")), false);
    }
  });
});

test("migration result contract matches exact required keys for success, dry-run, and no-state", async () => {
  await withTarget(async (target) => {
    // 1. No legacy state
    const noLegacyRes = await migrateLegacyLayout(target, { packageRoot });
    assert.equal(noLegacyRes.migrated, false);
    assert.equal(noLegacyRes.reason, "NO_LEGACY_STATE");
    assert.ok(noLegacyRes.message);

    // Setup legacy files
    const contract = createContract({
      taskId: "shape-test-task",
      objective: "Test result shape",
      deliverables: ["src/index.js"],
      constraints: ["none"],
      risks: ["low"],
      verification: ["tests"],
      successCriteria: ["tests pass"],
      stopConditions: ["error"],
      unresolvedDecisions: [],
      sourceRefs: ["src"],
    });
    await writeContract(target, contract, packageRoot);

    const state = createWorkState({
      taskId: "shape-test-task",
      contractFingerprint: contractFingerprint(contract),
      repositoryFingerprint: { branch: null, head: null },
      phase: "PLANNED",
      completedSteps: [],
      pendingSteps: [],
      checks: [],
      failures: [],
      blockers: [],
    });
    await writeWorkState(target, state, { packageRoot });

    // 2. Dry run result shape
    const dryRes = await migrateLegacyLayout(target, { packageRoot, dryRun: true });
    assert.deepEqual(
      Object.keys(dryRes).sort(),
      ["dryRun", "legacyFiles", "migrated", "targetDirectory", "taskId", "taskKey"].sort(),
    );
    assert.equal(dryRes.migrated, false);
    assert.equal(dryRes.dryRun, true);
    assert.equal(dryRes.taskId, "shape-test-task");
    assert.ok(Array.isArray(dryRes.legacyFiles));

    // 3. Success result shape
    const successRes = await migrateLegacyTaskStorage(target, { packageRoot, destination: "retained", writersQuiesced: true });
    assert.deepEqual(
      Object.keys(successRes).sort(),
      ["migrated", "migratedArtifacts", "targetDirectory", "taskId", "taskKey", "storage", "migrationReceipt"].sort(),
    );
    assert.equal(successRes.migrated, true);
    assert.equal(successRes.taskId, "shape-test-task");
    assert.ok(Array.isArray(successRes.migratedArtifacts));
  });
});
