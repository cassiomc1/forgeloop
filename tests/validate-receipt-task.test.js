import { removeTempTree } from "./helpers/rm-safe.js";
import { exportLegacyFixture } from "./helpers/storage-fixtures.js";
import { runTaskCreate } from "../src/commands/task-create.js";
import { runValidateReceipt } from "../src/commands/validate-receipt.js";
import { openStorageDatabase, putArtifact } from "../src/storage/index.js";
import { access } from "node:fs/promises";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { taskStorageKey } from "../src/core/task-identity.js";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = path.join(repositoryRoot, "src", "cli.js");

test("direct receipt command selects native authority without an ambient dispatcher", async () => {
  await withTarget(async target => {
    const taskId = "direct-native-receipt";
    await runTaskCreate({ target, taskId, packageRoot: repositoryRoot, claims: [] });
    const receipt = receiptFixture(taskId);
    await writeTaskReceipt(target, taskId, receipt);
    assert.equal((await runValidateReceipt({ target, taskId, packageRoot: repositoryRoot })).taskId, taskId);
    const relativeFile = `.forgeloop/task-state/${taskStorageKey(taskId)}/execution-receipt.json`;
    await mkdir(path.dirname(path.join(target, relativeFile)), { recursive: true });
    await writeFile(path.join(target, relativeFile), JSON.stringify(receiptFixture("contradictory-file")));
    await assert.rejects(runValidateReceipt({ target, file: relativeFile, packageRoot: repositoryRoot }), { code: "E_STORAGE_MIGRATION_REQUIRED" });
    await writeFile(path.join(target, "portable-receipt.json"), JSON.stringify(receiptFixture("explicit-portable")));
    assert.equal((await runValidateReceipt({ target, file: "portable-receipt.json", packageRoot: repositoryRoot })).taskId, "explicit-portable");
    await rm(path.join(target, ".forgeloop/task-state"), { recursive: true, force: true });
    assert.equal((await runValidateReceipt({ target, file: relativeFile, packageRoot: repositoryRoot })).taskId, taskId);
    const db = openStorageDatabase(path.join(target, ".forgeloop/state.sqlite"));
    try { db.prepare("UPDATE task_artifacts SET fingerprint = ? WHERE task_id = ? AND kind = 'receipt'").run("0".repeat(64), taskId); }
    finally { db.close(); }
    await assert.rejects(runValidateReceipt({ target, taskId, packageRoot: repositoryRoot }), /fingerprint disagrees/);
  });
});

test("canonical receipt validation rejects missing and fingerprint-tampered records", async () => {
  await withTarget(async target => {
    const created = runCli(target, "task-create", "--task", "receipt-integrity", "--json");
    assert.equal(created.status, 0, created.stderr);
    const missing = runCli(target, "validate-receipt", "--task", "receipt-integrity", "--json");
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /missing from canonical storage/);
    await writeTaskReceipt(target, "receipt-integrity", receiptFixture("receipt-integrity"));
    const db = openStorageDatabase(path.join(target, ".forgeloop/state.sqlite"));
    try {
      db.prepare("UPDATE task_artifacts SET fingerprint = ? WHERE task_id = ? AND kind = 'receipt'").run("0".repeat(64), "receipt-integrity");
    } finally { db.close(); }
    const tampered = runCli(target, "validate-receipt", "--task", "receipt-integrity", "--json");
    assert.equal(tampered.status, 1);
    assert.match(tampered.stderr, /fingerprint disagrees/);
    await assert.rejects(access(path.join(target, ".forgeloop/task-state")), { code: "ENOENT" });
  });
});

async function withTarget(run) {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-vr-task-"));
  try {
    await run(target);
  } finally {
    await removeTempTree(target);
  }
}

function runCli(target, ...args) {
  return spawnSync(process.execPath, [cliPath, ...args, "--path", target], {
    encoding: "utf8",
  });
}

function receiptFixture(taskId, overrides = {}) {
  return {
    schemaVersion: 1,
    protocolVersion: 1,
    taskId,
    contractFingerprint: "a".repeat(64),
    selectedGuides: ["clean"],
    changedPaths: [],
    checks: [],
    review: { status: "not-run", independent: false },
    limitations: [],
    publication: { committed: false, pushed: false, pullRequest: null, deployed: false },
    ...overrides,
  };
}

async function writeTaskReceipt(target, taskId, receipt) {
  try {
    await access(path.join(target, ".forgeloop/state.sqlite"));
    const db = openStorageDatabase(path.join(target, ".forgeloop/state.sqlite"));
    try { putArtifact(db, { taskId, kind: "receipt", payload: receipt }); }
    finally { db.close(); }
    return;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const directory = path.join(target, ".forgeloop", "task-state", taskStorageKey(taskId));
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, "execution-receipt.json"),
    `${JSON.stringify(receipt, null, 2)}\n`,
    "utf8",
  );
}

test("VR-TASK-1: validate-receipt --task validates the namespaced receipt when no singleton exists", async () => {
  await withTarget(async (target) => {
    const created = runCli(target, "task-create", "--task", "task-a", "--json");
    assert.equal(created.status, 0, created.stderr);

    await writeTaskReceipt(target, "task-a", receiptFixture("task-a"));

    const result = runCli(target, "validate-receipt", "--task", "task-a", "--json");
    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.taskId, "task-a");
  });
});

test("VR-TASK-2: validate-receipt --task A validates only task A's receipt", async () => {
  await withTarget(async (target) => {
    for (const taskId of ["task-a", "task-b"]) {
      const created = runCli(target, "task-create", "--task", taskId, "--json");
      assert.equal(created.status, 0, created.stderr);
    }

    // Task A receipt is valid; task B receipt is schema-invalid (bad protocolVersion).
    await writeTaskReceipt(target, "task-a", receiptFixture("task-a"));
    await writeTaskReceipt(target, "task-b", receiptFixture("task-b", { protocolVersion: 999 }));

    const resultA = runCli(target, "validate-receipt", "--task", "task-a", "--json");
    assert.equal(resultA.status, 0, resultA.stderr);
    assert.equal(JSON.parse(resultA.stdout).taskId, "task-a");

    const resultB = runCli(target, "validate-receipt", "--task", "task-b", "--json");
    assert.equal(resultB.status, 1, "task B's invalid receipt must fail");
    assert.match(resultB.stderr, /Invalid receipt .*task-state/);
    assert.match(resultB.stderr, /protocolVersion/);
  });
});

test("VR-TASK-3: --file overrides task-derived receipt resolution", async () => {
  await withTarget(async (target) => {
    const created = runCli(target, "task-create", "--task", "task-a", "--json");
    assert.equal(created.status, 0, created.stderr);

    // The task's namespaced receipt is invalid; the explicit --file receipt is valid.
    await writeTaskReceipt(target, "task-a", receiptFixture("task-a", { protocolVersion: 999 }));
    await writeFile(
      path.join(target, "explicit-receipt.json"),
      `${JSON.stringify(receiptFixture("explicit-file"), null, 2)}\n`,
      "utf8",
    );

    const result = runCli(target, "validate-receipt", "--task", "task-a", "--file", "explicit-receipt.json", "--json");
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).taskId, "explicit-file");
  });
});

test("VR-TASK-4: legacy singleton receipt still validates when no task descriptors exist", async () => {
  await withTarget(async (target) => {
    await mkdir(path.join(target, ".forgeloop"), { recursive: true });
    await writeFile(
      path.join(target, ".forgeloop", "execution-receipt.json"),
      `${JSON.stringify(receiptFixture("legacy-singleton"), null, 2)}\n`,
      "utf8",
    );

    const result = runCli(target, "validate-receipt", "--json");
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).taskId, "legacy-singleton");
  });
});

test("VR-TASK-5: multiple active tasks without --task or --file fail with E_TASK_AMBIGUOUS", async () => {
  await withTarget(async (target) => {
    for (const taskId of ["task-a", "task-b"]) {
      const created = runCli(target, "task-create", "--task", taskId, "--json");
      assert.equal(created.status, 0, created.stderr);
      await writeTaskReceipt(target, taskId, receiptFixture(taskId));
    }

    const result = runCli(target, "validate-receipt", "--json");
    assert.equal(result.status, 1);
    assert.match(result.stderr, /E_TASK_AMBIGUOUS|Multiple active tasks/i);
  });
});

/**
 * Writes a corrupt task namespace: a 64-hex directory whose task.json contains
 * a valid descriptor for a different taskId, so its storage key does not match
 * the directory name (surfaced by discoverTasks as E_TASK_KEY_MISMATCH).
 */
async function writeCorruptNamespace(target, dirName, taskId) {
  const descriptor = {
    schemaVersion: 1,
    protocolVersion: 1,
    taskId,
    taskKey: taskStorageKey(taskId),
    createdAt: "2026-08-19T00:00:00.000Z",
    updatedAt: "2026-08-19T00:00:00.000Z",
    writeClaims: [],
  };
  const dir = path.join(target, ".forgeloop", "task-state", dirName);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "task.json"), `${JSON.stringify(descriptor, null, 2)}\n`, "utf8");
}

test("TASK-RESOLVE-CORRUPT-1: corrupt namespace plus legacy receipt fails closed (no singleton fallback)", async () => {
  await withTarget(async (target) => {
    await writeCorruptNamespace(target, "a".repeat(64), "corrupt-task");
    await mkdir(path.join(target, ".forgeloop"), { recursive: true });
    await writeFile(
      path.join(target, ".forgeloop", "execution-receipt.json"),
      `${JSON.stringify(receiptFixture("legacy-singleton"), null, 2)}\n`,
      "utf8",
    );

    const result = runCli(target, "validate-receipt", "--json");
    assert.equal(result.status, 1);
    assert.match(result.stderr, /E_TASK_KEY_MISMATCH/i);
    // Must NOT validate the legacy singleton over corrupt modern state.
    assert.doesNotMatch(result.stdout, /legacy-singleton/);
  });
});

test("TASK-RESOLVE-CORRUPT-2: corrupt namespace without legacy state fails with the corruption error", async () => {
  await withTarget(async (target) => {
    await writeCorruptNamespace(target, "a".repeat(64), "corrupt-task");

    const result = runCli(target, "validate-receipt", "--json");
    assert.equal(result.status, 1);
    assert.match(result.stderr, /E_TASK_KEY_MISMATCH/i);
  });
});

test("TASK-RESOLVE-CORRUPT-3: no task namespaces plus legacy receipt remains compatible", async () => {
  await withTarget(async (target) => {
    await mkdir(path.join(target, ".forgeloop"), { recursive: true });
    await writeFile(
      path.join(target, ".forgeloop", "execution-receipt.json"),
      `${JSON.stringify(receiptFixture("legacy-singleton"), null, 2)}\n`,
      "utf8",
    );

    const result = runCli(target, "validate-receipt", "--json");
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).taskId, "legacy-singleton");
  });
});

test("TASK-RESOLVE-CORRUPT-4: one healthy task plus one corrupt namespace resolves the healthy task", async () => {
  await withTarget(async (target) => {
    // Legacy read-only compatibility control; public writable creation uses SQLite.
    await runTaskCreate({ target, packageRoot: repositoryRoot, taskId: "healthy-a" });
    await writeTaskReceipt(target, "healthy-a", receiptFixture("healthy-a"));
    await exportLegacyFixture(target);
    await writeCorruptNamespace(target, "a".repeat(64), "corrupt-task");

    const result = runCli(target, "validate-receipt", "--json");
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).taskId, "healthy-a");
  });
});

test("TASK-RESOLVE-CORRUPT-5: policy-snapshot-only directory is legacy spillover; legacy fallback preserved", async () => {
  await withTarget(async (target) => {
    // The only recognized legacy-incidental artifact inside a descriptor-less
    // 64-hex directory is the legacy preflight policy snapshot.
    const dir = path.join(target, ".forgeloop", "task-state", "b".repeat(64));
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "policy-snapshot.json"), `${JSON.stringify({ schemaVersion: 1, policyDigest: "x" })}\n`, "utf8");
    await mkdir(path.join(target, ".forgeloop"), { recursive: true });
    await writeFile(
      path.join(target, ".forgeloop", "execution-receipt.json"),
      `${JSON.stringify(receiptFixture("legacy-singleton"), null, 2)}\n`,
      "utf8",
    );

    const result = runCli(target, "validate-receipt", "--json");
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).taskId, "legacy-singleton");
  });
});

test("TASK-DESCRIPTOR-MISSING-1: policy-snapshot-only directory is not a task namespace", async () => {
  await withTarget(async (target) => {
    const dir = path.join(target, ".forgeloop", "task-state", "b".repeat(64));
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "policy-snapshot.json"), `${JSON.stringify({ schemaVersion: 1, policyDigest: "x" })}\n`, "utf8");
    await mkdir(path.join(target, ".forgeloop"), { recursive: true });
    await writeFile(
      path.join(target, ".forgeloop", "execution-receipt.json"),
      `${JSON.stringify(receiptFixture("legacy-singleton"), null, 2)}\n`,
      "utf8",
    );

    const result = runCli(target, "validate-receipt", "--json");
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).taskId, "legacy-singleton");
  });
});

test("TASK-DESCRIPTOR-MISSING-2: receipt without task.json fails closed with no legacy fallback", async () => {
  await withTarget(async (target) => {
    const dir = path.join(target, ".forgeloop", "task-state", "c".repeat(64));
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "execution-receipt.json"), `${JSON.stringify(receiptFixture("orphan-receipt"), null, 2)}\n`, "utf8");
    await mkdir(path.join(target, ".forgeloop"), { recursive: true });
    await writeFile(
      path.join(target, ".forgeloop", "execution-receipt.json"),
      `${JSON.stringify(receiptFixture("legacy-singleton"), null, 2)}\n`,
      "utf8",
    );

    const result = runCli(target, "validate-receipt", "--json");
    assert.equal(result.status, 1);
    assert.match(result.stderr, /E_TASK_DESCRIPTOR_INVALID/i);
    assert.doesNotMatch(result.stdout, /legacy-singleton/);
  });
});

test("TASK-DESCRIPTOR-MISSING-3: work-state and events without task.json fail closed", async () => {
  await withTarget(async (target) => {
    const dir = path.join(target, ".forgeloop", "task-state", "d".repeat(64));
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "work-state.json"), `${JSON.stringify({ schemaVersion: 1, taskId: "orphan" })}\n`, "utf8");
    await writeFile(path.join(dir, "events.ndjson"), "{\"event\":\"TASK_RECEIVED\"}\n", "utf8");

    const result = runCli(target, "validate-receipt", "--json");
    assert.equal(result.status, 1);
    assert.match(result.stderr, /E_TASK_DESCRIPTOR_INVALID/i);
  });
});

test("TASK-DESCRIPTOR-MISSING-4: empty 64-hex directory fails closed", async () => {
  await withTarget(async (target) => {
    await mkdir(path.join(target, ".forgeloop", "task-state", "e".repeat(64)), { recursive: true });

    const result = runCli(target, "validate-receipt", "--json");
    assert.equal(result.status, 1);
    assert.match(result.stderr, /E_TASK_DESCRIPTOR_INVALID/i);
  });
});

test("TASK-DESCRIPTOR-MISSING-5: one healthy task plus one descriptor-less corrupt namespace resolves the healthy task (deliberate)", async () => {
  await withTarget(async (target) => {
    // Legacy read-only compatibility control; public writable creation uses SQLite.
    await runTaskCreate({ target, packageRoot: repositoryRoot, taskId: "healthy-b" });
    await writeTaskReceipt(target, "healthy-b", receiptFixture("healthy-b"));
    await exportLegacyFixture(target);
    const dir = path.join(target, ".forgeloop", "task-state", "f".repeat(64));
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "work-state.json"), `${JSON.stringify({ schemaVersion: 1, taskId: "orphan" })}\n`, "utf8");

    const result = runCli(target, "validate-receipt", "--json");
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).taskId, "healthy-b");
  });
});

test("TASK-DESCRIPTOR-MISSING-6: only corrupt descriptor-less modern namespace plus legacy singleton fails closed", async () => {
  await withTarget(async (target) => {
    const dir = path.join(target, ".forgeloop", "task-state", "9".repeat(64));
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "execution-receipt.json"), `${JSON.stringify(receiptFixture("orphan-receipt"), null, 2)}\n`, "utf8");
    await mkdir(path.join(target, ".forgeloop"), { recursive: true });
    await writeFile(
      path.join(target, ".forgeloop", "execution-receipt.json"),
      `${JSON.stringify(receiptFixture("legacy-singleton"), null, 2)}\n`,
      "utf8",
    );

    const result = runCli(target, "validate-receipt", "--json");
    assert.equal(result.status, 1);
    assert.match(result.stderr, /E_TASK_DESCRIPTOR_INVALID/i);
    assert.doesNotMatch(result.stdout, /legacy-singleton/);
  });
});
