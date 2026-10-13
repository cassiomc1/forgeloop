import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { CLI_COMMAND_DEFINITIONS } from "../src/core/cli-command-definitions.js";
import { COMMAND_EXECUTORS } from "../src/core/command-executors.js";
import { getPackageRoot } from "../src/core/templates.js";
import { buildDiagnosisProject } from "./helpers/storage-fixtures.js";

// These commands own migration/maintenance admission rather than ordinary
// project admission. Their recovery behavior has separate maintenance tests.
const MAINTENANCE_COMMANDS = [
  "task-migrate", "migrate-protocol", "storage-migration-status",
  "storage-rollback-resume", "storage-rollback", "storage-migrate",
  "storage-migration-resume", "storage-restore", "storage-restore-resume",
];

async function inventory(root, relative = "") {
  const entries = [];
  for (const entry of (await readdir(path.join(root, relative), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const name = path.join(relative, entry.name);
    if (entry.isDirectory()) entries.push([name, "directory"], ...await inventory(root, name));
    else {
      assert.equal(entry.isFile(), true, `unexpected fixture entry: ${name}`);
      entries.push([name, createHash("sha256").update(await readFile(path.join(root, name))).digest("hex")]);
    }
  }
  return entries;
}

test("every ordinary command executor refuses retained maintenance before changing project files", async () => {
  const target = await buildDiagnosisProject();
  try {
    for (const name of MAINTENANCE_COMMANDS) {
      assert.equal(typeof COMMAND_EXECUTORS[name], "function", name);
      assert.equal(CLI_COMMAND_DEFINITIONS[name].category, "project-maintenance", name);
    }
    const exclusion = path.join(target, ".forgeloop/.storage-maintenance");
    await mkdir(exclusion);
    await writeFile(path.join(exclusion, "owner.json"), JSON.stringify({ schemaVersion: 1, ownerId: "catalogue-admission-test", pid: process.pid }));
    const before = await inventory(target);
    const ordinary = Object.entries(COMMAND_EXECUTORS).filter(([name]) => !MAINTENANCE_COMMANDS.includes(name));
    assert.ok(ordinary.length > 0);
    for (const [name, executor] of ordinary) {
      await assert.rejects(executor({ target, packageRoot: getPackageRoot(), options: {}, runtimeContext: null }),
        { code: "E_STORAGE_MAINTENANCE_IN_PROGRESS" }, name);
    }
    assert.deepEqual(await inventory(target), before);
  } finally { await rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); }
});
