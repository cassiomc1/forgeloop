import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { buildDiagnosisProject } from "./helpers/storage-fixtures.js";
import { executeForgeLoopCommand } from "../src/core/command-runtime.js";

test("public migration requires quiescence, publishes retained state, and permits subsequent commands", async () => {
  const target = await buildDiagnosisProject({ legacy: true });
  try {
    const rejected = await executeForgeLoopCommand({ command: "storage-migrate", projectPath: target, input: { destination: "retained" } });
    assert.equal(rejected.ok, false);
    await assert.rejects(stat(path.join(target, ".forgeloop/.storage-maintenance")), { code: "ENOENT" });
    const stdout = execFileSync(process.execPath, ["src/cli.js", "storage-migrate", "--path", target, "--destination", "retained", "--writers-quiesced", "--json"], { encoding: "utf8" });
    const result = JSON.parse(stdout);
    assert.equal(result.phase, "PUBLISHED");
    assert.equal(result.currentStateVerified, true);
    assert.equal(result.taskCount, 1);
    assert.equal(JSON.parse(await readFile(path.join(target, ".forgeloop/storage-version.json"))).phase, "ACTIVE");
    await assert.rejects(stat(path.join(target, ".forgeloop/.storage-maintenance")), { code: "ENOENT" });
    await stat(path.join(target, "retained/publication/legacy-archive/.forgeloop/task-state"));
    const created = await executeForgeLoopCommand({ command: "task-create", projectPath: target, input: { taskId: "after-migration", claims: ["separate-path"] } });
    assert.equal(created.ok, true, JSON.stringify(created));
    const listed = await executeForgeLoopCommand({ command: "task-list", projectPath: target, input: {} });
    assert.equal(listed.ok, true, JSON.stringify(listed));
  } finally { await rm(target, { recursive: true, force: true }); }
});

test("public migration failure retains exclusion and preserves an existing destination", async () => {
  const target = await buildDiagnosisProject({ legacy: true });
  try {
    await mkdir(path.join(target, "retained"));
    const sentinel = path.join(target, "retained/sentinel");
    await writeFile(sentinel, "existing bytes");
    const result = await executeForgeLoopCommand({ command: "storage-migrate", projectPath: target, input: { destination: "retained", writersQuiesced: true } });
    assert.equal(result.ok, false);
    assert.equal(await readFile(sentinel, "utf8"), "existing bytes");
    await stat(path.join(target, ".forgeloop/.storage-maintenance/owner.json"));
    await assert.rejects(stat(path.join(target, ".forgeloop/state.sqlite")), { code: "ENOENT" });
    await stat(path.join(target, ".forgeloop/task-state"));
    const listed = await executeForgeLoopCommand({ command: "task-list", projectPath: target, input: {} });
    assert.equal(listed.ok, false);
  } finally { await rm(target, { recursive: true, force: true }); }
});
