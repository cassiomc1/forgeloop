import { removeTempTree } from "./helpers/rm-safe.js";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { createContract } from "../src/core/contract.js";
import { validateMigrationSnapshot } from "../src/core/task-migration-validation.js";
import {
  E_TASK_MIGRATION_IDENTITY_MISMATCH,
  E_TASK_MIGRATION_INVALID,
} from "../src/core/error-codes.js";
import { getPackageRoot } from "../src/core/templates.js";

const packageRoot = getPackageRoot();

async function withTarget(fn) {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-migration-validation-"));
  try {
    await fn(target);
  } finally {
    await removeTempTree(target);
  }
}

function contract(taskId) {
  return createContract({
    taskId,
    objective: "Validate a migration snapshot",
    deliverables: ["src/index.js"],
    constraints: ["none"],
    risks: ["low"],
    verification: ["tests"],
    successCriteria: ["tests pass"],
    stopConditions: ["error"],
    unresolvedDecisions: [],
    sourceRefs: ["src"],
  });
}

test("migration snapshot validation fingerprints valid task artifacts", async () => {
  await withTarget(async (target) => {
    await mkdir(path.join(target, ".forgeloop"), { recursive: true });
    await writeFile(path.join(target, ".forgeloop/current-contract.json"), JSON.stringify(contract("migration-valid")));

    const result = await validateMigrationSnapshot(target, {
      taskId: "migration-valid",
      packageRoot,
      paths: { contract: ".forgeloop/current-contract.json" },
    });

    assert.equal(result.taskId, "migration-valid");
    assert.equal(typeof result.artifactFingerprints.contract, "string");
    assert.equal(result.eventCount, 0);
  });
});

test("migration snapshot validation rejects an artifact with another task identity", async () => {
  await withTarget(async (target) => {
    await mkdir(path.join(target, ".forgeloop"), { recursive: true });
    await writeFile(path.join(target, ".forgeloop/current-contract.json"), JSON.stringify(contract("other-task")));

    await assert.rejects(
      () => validateMigrationSnapshot(target, {
        taskId: "migration-expected",
        packageRoot,
        paths: { contract: ".forgeloop/current-contract.json" },
      }),
      (error) => error.code === E_TASK_MIGRATION_IDENTITY_MISMATCH,
    );
  });
});

test("migration snapshot validation rejects symlinks in artifact directories", async () => {
  await withTarget(async (target) => {
    const gates = path.join(target, ".forgeloop", "gates");
    await mkdir(gates, { recursive: true });
    await symlink("missing.json", path.join(gates, "gate.json"));

    await assert.rejects(
      () => validateMigrationSnapshot(target, {
        taskId: "migration-symlink",
        packageRoot,
        paths: { gates: ".forgeloop/gates" },
      }),
      (error) => error.code === E_TASK_MIGRATION_INVALID,
    );
  });
});
