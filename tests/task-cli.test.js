import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

import { COMMAND_EXECUTORS } from "../src/core/command-executors.js";
import { getPackageRoot } from "../src/core/templates.js";
import { createContract, contractFingerprint } from "../src/core/contract.js";
import { createWorkState } from "../src/core/work-state.js";

const packageRoot = getPackageRoot();
const cliPath = path.join(packageRoot, "src", "cli.js");

async function withTarget(fn) {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-task-cli-"));
  try {
    await fn(target);
  } finally {
    await rm(target, { recursive: true, force: true });
  }
}

function runCli(target, ...args) {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: target,
    encoding: "utf8",
    env: { ...process.env, FORGELOOP_TASK: "" },
  });
  return result;
}

test("forgeloop task-create, task-list, task-show, task-scope, task-unlock CLI lifecycle", async () => {
  await withTarget(async (target) => {
    // 1. task-create
    const createRes = runCli(target, "task-create", "--task", "cli-task-1", "--claim", "src/auth", "--json");
    assert.equal(createRes.status, 0, `task-create failed: ${createRes.stderr}`);
    const created = JSON.parse(createRes.stdout);
    assert.equal(created.taskId, "cli-task-1");
    assert.deepEqual(created.writeClaims, ["src/auth"]);

    // 2. task-list
    const listRes = runCli(target, "task-list", "--json");
    assert.equal(listRes.status, 0, `task-list failed: ${listRes.stderr}`);
    const listed = JSON.parse(listRes.stdout);
    assert.ok(Array.isArray(listed.tasks));
    assert.equal(listed.tasks.length, 1);
    assert.equal(listed.tasks[0].taskId, "cli-task-1");

    // 3. task-show
    const showRes = runCli(target, "task-show", "--task", "cli-task-1", "--json");
    assert.equal(showRes.status, 0, `task-show failed: ${showRes.stderr}`);
    const shown = JSON.parse(showRes.stdout);
    assert.equal(shown.taskId, "cli-task-1");
    assert.deepEqual(shown.writeClaims, ["src/auth"]);

    const lockStatusRes = runCli(target, "task-lock-status", "--task", "cli-task-1", "--json");
    assert.equal(lockStatusRes.status, 0, `task-lock-status failed: ${lockStatusRes.stderr}`);
    const lockStatus = JSON.parse(lockStatusRes.stdout);
    assert.equal(lockStatus.taskId, "cli-task-1");
    assert.equal(lockStatus.status, "UNLOCKED");
    assert.equal(lockStatus.lock, null);

    // Human-readable task-show must handle unlocked state without crashing
    const humanShowRes = runCli(target, "task-show", "--task", "cli-task-1");
    assert.equal(
      humanShowRes.status,
      0,
      `task-show human output failed: ${humanShowRes.stderr}`,
    );
    assert.match(humanShowRes.stdout, /Lock: unlocked/);

    // 4. task-scope
    const scopeRes = runCli(target, "task-scope", "--task", "cli-task-1", "--claim", "src/auth", "--claim", "tests/auth", "--json");
    assert.equal(scopeRes.status, 0, `task-scope failed: ${scopeRes.stderr}`);
    const scoped = JSON.parse(scopeRes.stdout);
    assert.deepEqual(scoped.writeClaims, ["src/auth", "tests/auth"]);

    // 5. task-unlock
    const unlockRes = runCli(target, "task-unlock", "--task", "cli-task-1", "--force", "--json");
    assert.equal(unlockRes.status, 0, `task-unlock failed: ${unlockRes.stderr}`);
    const unlocked = JSON.parse(unlockRes.stdout);
    assert.equal(unlocked.unlocked, false); // no active lock was held
  });
});

test("forgeloop task-migrate converts 1.0 layout via CLI with human and json outputs", async () => {
  // Test A: Human output on valid legacy state
  await withTarget(async (target) => {
    const contract = createContract({
      taskId: "cli-migrated-task",
      objective: "Migrate CLI",
      deliverables: ["src/index.js"],
      constraints: ["none"],
      risks: ["low"],
      verification: ["tests"],
      successCriteria: ["tests pass"],
      stopConditions: ["error"],
      unresolvedDecisions: [],
      sourceRefs: ["src"],
    });
    await mkdir(path.join(target, ".forgeloop"), { recursive: true });
    await writeFile(path.join(target, ".forgeloop/current-contract.json"), JSON.stringify(contract));

    const state = createWorkState({
      taskId: "cli-migrated-task",
      contractFingerprint: contractFingerprint(contract),
      repositoryFingerprint: { branch: null, head: null },
      phase: "PLANNED",
      completedSteps: [],
      pendingSteps: [],
      checks: [],
      failures: [],
      blockers: [],
    });
    await writeFile(path.join(target, ".forgeloop/work-state.json"), JSON.stringify(state));

    const result = runCli(target, "task-migrate", "--destination", "retained", "--writers-quiesced");
    assert.equal(result.status, 0, `task-migrate human failed: ${result.stderr}`);
    assert.match(result.stdout, /migrated task:\s+cli-migrated-task/);
    assert.match(result.stdout, /destination:\s+\.forgeloop\/state\.sqlite/);
    assert.match(result.stdout, /migrated artifacts:/);
    assert.match(result.stdout, /- \.forgeloop\/current-contract\.json/);
    assert.match(result.stdout, /- \.forgeloop\/work-state\.json/);
    assert.doesNotMatch(result.stdout, /undefined|null|\[object Object\]/);
    assert.equal(JSON.parse(await readFile(path.join(target, ".forgeloop/storage-version.json"), "utf8")).phase, "ACTIVE");
    await assert.rejects(access(path.join(target, ".forgeloop/task-state")), { code: "ENOENT" });
    const shown = runCli(target, "task-show", "--task", "cli-migrated-task", "--json");
    assert.equal(shown.status, 0, shown.stderr);
    assert.match(shown.stdout, /cli-migrated-task/);
  });

  // Test B: Dry run human output
  await withTarget(async (target) => {
    const contract = createContract({
      taskId: "cli-dryrun-task",
      objective: "Dryrun CLI",
      deliverables: ["src/index.js"],
      constraints: ["none"],
      risks: ["low"],
      verification: ["tests"],
      successCriteria: ["tests pass"],
      stopConditions: ["error"],
      unresolvedDecisions: [],
      sourceRefs: ["src"],
    });
    await mkdir(path.join(target, ".forgeloop"), { recursive: true });
    await writeFile(path.join(target, ".forgeloop/current-contract.json"), JSON.stringify(contract));

    const dryRes = runCli(target, "task-migrate", "--dry-run");
    assert.equal(dryRes.status, 0, `task-migrate --dry-run failed: ${dryRes.stderr}`);
    assert.match(dryRes.stdout, /\[dry-run\] task:\s+cli-dryrun-task/);
    assert.match(dryRes.stdout, /destination:\s+\.forgeloop\/state\.sqlite/);
    assert.match(dryRes.stdout, /legacy artifacts:/);
    assert.match(dryRes.stdout, /- \.forgeloop\/current-contract\.json/);
    assert.doesNotMatch(dryRes.stdout, /undefined|null|\[object Object\]/);
    await assert.rejects(access(path.join(target, ".forgeloop/state.sqlite")), { code: "ENOENT" });
    await assert.rejects(access(path.join(target, ".forgeloop/task-state")), { code: "ENOENT" });
  });

  // Test C: No legacy state
  await withTarget(async (target) => {
    const noStateRes = runCli(target, "task-migrate");
    assert.equal(noStateRes.status, 0, `task-migrate on empty target failed: ${noStateRes.stderr}`);
    assert.match(noStateRes.stdout, /No legacy ForgeLoop 1\.0 singleton artifacts found/i);
    assert.doesNotMatch(noStateRes.stdout, /undefined|null|\[object Object\]/);
  });

  // Test D: JSON output
  await withTarget(async (target) => {
    const contract = createContract({
      taskId: "cli-json-task",
      objective: "Migrate JSON CLI",
      deliverables: ["src/index.js"],
      constraints: ["none"],
      risks: ["low"],
      verification: ["tests"],
      successCriteria: ["tests pass"],
      stopConditions: ["error"],
      unresolvedDecisions: [],
      sourceRefs: ["src"],
    });
    await mkdir(path.join(target, ".forgeloop"), { recursive: true });
    await writeFile(path.join(target, ".forgeloop/current-contract.json"), JSON.stringify(contract));

    const migrateRes = runCli(target, "task-migrate", "--destination", "retained", "--writers-quiesced", "--json");
    assert.equal(migrateRes.status, 0, `task-migrate --json failed: ${migrateRes.stderr}`);
    const migrated = JSON.parse(migrateRes.stdout);
    assert.equal(migrated.migrated, true);
    assert.equal(migrated.taskId, "cli-json-task");
    assert.ok(migrated.taskKey);
    assert.ok(migrated.targetDirectory);
    assert.ok(Array.isArray(migrated.migratedArtifacts));
    assert.ok(migrated.migratedArtifacts.includes(".forgeloop/current-contract.json"));
  });
});

test("forgeloop migrate-protocol plans safely and rejects unsupported targets without allocating storage", async () => {
  await withTarget(async (target) => {
    const dryRun = runCli(target, "migrate-protocol", "--to", "1", "--dry-run", "--json");
    assert.equal(dryRun.status, 0, `migrate-protocol dry-run failed: ${dryRun.stderr}`);
    const planned = JSON.parse(dryRun.stdout);
    assert.equal(planned.status, "ALREADY_COMPATIBLE");
    assert.equal(planned.dryRun, true);
    assert.deepEqual(planned.actions, []);
    await assert.rejects(access(path.join(target, ".forgeloop")));

    const unsupported = runCli(target, "migrate-protocol", "--to", "2", "--json");
    assert.equal(unsupported.status, 1);
    assert.match(unsupported.stderr, /E_PROTOCOL_MIGRATION_TARGET_UNSUPPORTED/);
    await assert.rejects(access(path.join(target, ".forgeloop")));

    for (const to of [undefined, "", "2"]) {
      await assert.rejects(COMMAND_EXECUTORS["migrate-protocol"]({
        target, packageRoot, options: { to },
      }), { code: "E_PROTOCOL_MIGRATION_TARGET_UNSUPPORTED" });
      await assert.rejects(access(path.join(target, ".forgeloop")));
    }
  });
});

test("unsupported protocol migration preserves legacy source and its protocol error", async () => {
  await withTarget(async target => {
    const directory = path.join(target, ".forgeloop");
    await mkdir(directory);
    const source = path.join(directory, "work-state.json");
    const retained = "retained malformed legacy evidence\n";
    await writeFile(source, retained);
    const unsupported = runCli(target, "migrate-protocol", "--to", "2", "--json");
    assert.equal(unsupported.status, 1);
    assert.match(unsupported.stderr, /E_PROTOCOL_MIGRATION_TARGET_UNSUPPORTED/);
    assert.doesNotMatch(unsupported.stderr, /E_STORAGE_MIGRATION_REQUIRED/);
    await assert.rejects(access(path.join(directory, "state.sqlite")));
    assert.equal(await readFile(source, "utf8"), retained);
  });
});

test("legacy public migration refuses missing exclusion acknowledgement before allocating storage", async () => {
  await withTarget(async target => {
    const directory = path.join(target, ".forgeloop");
    await mkdir(directory);
    const source = path.join(directory, "work-state.json");
    const text = "retained legacy source\n";
    await writeFile(source, text);
    for (const args of [["task-migrate"], ["task-migrate", "--destination", "retained"], ["migrate-protocol", "--to", "1", "--destination", "retained"]]) {
      const result = runCli(target, ...args, "--json");
      assert.equal(result.status, 2);
      assert.match(result.stderr, /E_CLI_INVOCATION_INVALID/);
      assert.equal(await readFile(source, "utf8"), text);
      await assert.rejects(access(path.join(directory, "state.sqlite")), { code: "ENOENT" });
      await assert.rejects(access(path.join(directory, ".storage-maintenance")), { code: "ENOENT" });
      await assert.rejects(access(path.join(target, "retained")), { code: "ENOENT" });
    }
  });
});

test("forgeloop migrate-protocol reuses receipt-backed legacy migration", async () => {
  await withTarget(async (target) => {
    const contract = createContract({
      taskId: "protocol-migration-task",
      objective: "Migrate through the protocol surface",
      deliverables: ["src/index.js"],
      constraints: ["none"],
      risks: ["low"],
      verification: ["tests"],
      successCriteria: ["tests pass"],
      stopConditions: ["error"],
      unresolvedDecisions: [],
      sourceRefs: ["src"],
    });
    await mkdir(path.join(target, ".forgeloop"), { recursive: true });
    await writeFile(path.join(target, ".forgeloop/current-contract.json"), JSON.stringify(contract));

    const plan = runCli(target, "migrate-protocol", "--to=1", "--dry-run", "--json");
    assert.equal(plan.status, 0, `legacy protocol dry-run failed: ${plan.stderr}`);
    const planned = JSON.parse(plan.stdout);
    assert.equal(planned.status, "PLANNED_LEGACY_LAYOUT_MIGRATION");
    assert.equal(planned.migrated, false);
    assert.equal(planned.targetDirectory, ".forgeloop/state.sqlite");
    assert.deepEqual(planned.actions.map((action) => action.kind), ["LEGACY_LAYOUT_MIGRATION"]);

    const migrated = runCli(target, "migrate-protocol", "--to", "1", "--destination", "retained", "--writers-quiesced", "--json");
    assert.equal(migrated.status, 0, `legacy protocol migration failed: ${migrated.stderr}`);
    const result = JSON.parse(migrated.stdout);
    assert.equal(result.status, "MIGRATED_LEGACY_LAYOUT");
    assert.equal(result.migrated, true);
    assert.equal(result.taskId, "protocol-migration-task");
    assert.equal(result.migrationReceipt, "retained/publication/publication-journal.json");
    assert.equal(JSON.parse(await readFile(path.join(target, result.migrationReceipt), "utf8")).phase, "PUBLISHED");
  });
});
