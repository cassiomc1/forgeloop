import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, symlink } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { executeForgeLoopCommand } from "../src/integration.js";
import { buildDiagnosisProject, TEST_TASK_ID } from "./helpers/storage-fixtures.js";

async function databaseDigest(target) {
  return createHash("sha256").update(await readFile(path.join(target, ".forgeloop/state.sqlite"))).digest("hex");
}

test("public bundle export retains native database bytes and produces portable output", async () => {
  const target = await buildDiagnosisProject();
  try {
    const before = await databaseDigest(target);
    const result = await executeForgeLoopCommand({ command: "bundle", projectPath: target, input: { taskId: TEST_TASK_ID } });
    assert.equal(result.ok, true, JSON.stringify(result.error));
    const directory = path.join(target, ".forgeloop/tasks", TEST_TASK_ID);
    const bundle = JSON.parse(await readFile(path.join(directory, "bundle.json"), "utf8"));
    assert.equal(bundle.taskId, TEST_TASK_ID);
    assert.ok(bundle.artifacts.includes("events.ndjson"));
    assert.equal(await databaseDigest(target), before);
    await assert.rejects(readFile(path.join(target, ".forgeloop/current-contract.json")), { code: "ENOENT" });
  } finally { await rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); }
});

test("public bundle export refuses a symlink destination before replacing native authority", async () => {
  const target = await buildDiagnosisProject();
  try {
    const before = await databaseDigest(target);
    const parent = path.join(target, ".forgeloop/tasks");
    await mkdir(parent, { recursive: true });
    await symlink(path.join(target, ".forgeloop"), path.join(parent, TEST_TASK_ID), process.platform === "win32" ? "junction" : "dir");
    const result = await executeForgeLoopCommand({ command: "bundle", projectPath: target, input: { taskId: TEST_TASK_ID } });
    assert.equal(result.ok, false);
    assert.match(JSON.stringify(result.error), /symlink/i);
    assert.equal(await databaseDigest(target), before);
    await assert.rejects(readFile(path.join(target, ".forgeloop/bundle.json")), { code: "ENOENT" });
  } finally { await rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); }
});
