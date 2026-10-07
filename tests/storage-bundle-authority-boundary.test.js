import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, symlink, rename } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { executeForgeLoopCommand } from "../src/integration.js";
import { buildDiagnosisProject, exportLegacyFixture, TEST_TASK_ID } from "./helpers/storage-fixtures.js";
import { exportTaskBundle } from "../src/core/bundles.js";
import { writeJsonArtifact } from "../src/core/artifacts.js";
import { taskArtifactPath } from "../src/core/task-paths.js";
import { getPackageRoot } from "../src/core/templates.js";

async function databaseDigest(target) {
  return createHash("sha256").update(await readFile(path.join(target, ".forgeloop/state.sqlite"))).digest("hex");
}

for (const trailingSeparator of [false, true]) {
  test(`direct bundle retains portable singleton gates with trailing separator ${trailingSeparator}`, async () => {
    const target = await buildDiagnosisProject();
    const packageRoot = getPackageRoot();
    const gate = { schemaVersion: 1, protocolVersion: 1, taskId: TEST_TASK_ID,
      gate: "portable-boundary", status: "satisfied", requiredBy: [], artifacts: [],
      decisions: [], unknowns: [], approvedAssumptions: [], evidence: [] };
    try {
      const canonicalDirectory = path.join(target, taskArtifactPath(TEST_TASK_ID, "gates"));
      await writeJsonArtifact(target, `${taskArtifactPath(TEST_TASK_ID, "gates")}/portable-boundary.json`, gate, "gate", packageRoot, { taskId: TEST_TASK_ID });
      await exportLegacyFixture(target);
      const portableDirectory = path.join(target, ".forgeloop/gates");
      await mkdir(portableDirectory, { recursive: true });
      await rename(path.join(canonicalDirectory, "portable-boundary.json"), path.join(portableDirectory, "portable-boundary.json"));
      await rm(canonicalDirectory, { recursive: true });
      const before = await readFile(path.join(portableDirectory, "portable-boundary.json"));
      const result = await exportTaskBundle(trailingSeparator ? `${target}${path.sep}` : target, TEST_TASK_ID, packageRoot);
      assert.ok(result.artifacts.includes("gates/portable-boundary.json"));
      assert.deepEqual(JSON.parse(await readFile(path.join(target, ".forgeloop/tasks", TEST_TASK_ID, "gates/portable-boundary.json"), "utf8")), gate);
      assert.deepEqual(await readFile(path.join(portableDirectory, "portable-boundary.json")), before);
      await assert.rejects(readFile(path.join(target, ".forgeloop/state.sqlite")), { code: "ENOENT" });
    } finally { await rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); }
  });
}

for (const trailingSeparator of [false, true]) {
  test(`direct bundle exports native gates with trailing separator ${trailingSeparator}`, async () => {
    const target = await buildDiagnosisProject();
    const packageRoot = getPackageRoot();
    const gate = { schemaVersion: 1, protocolVersion: 1, taskId: TEST_TASK_ID,
      gate: "export-boundary", status: "satisfied", requiredBy: [], artifacts: [],
      decisions: [], unknowns: [], approvedAssumptions: [], evidence: [] };
    try {
      await writeJsonArtifact(target, `${taskArtifactPath(TEST_TASK_ID, "gates")}/export-boundary.json`, gate, "gate", packageRoot, { taskId: TEST_TASK_ID });
      const before = await databaseDigest(target);
      const result = await exportTaskBundle(trailingSeparator ? `${target}${path.sep}` : target, TEST_TASK_ID, packageRoot);
      assert.ok(result.artifacts.includes("gates/export-boundary.json"));
      assert.deepEqual(JSON.parse(await readFile(path.join(target, ".forgeloop/tasks", TEST_TASK_ID, "gates/export-boundary.json"), "utf8")), gate);
      assert.equal(await databaseDigest(target), before);
      await assert.rejects(readFile(path.join(target, taskArtifactPath(TEST_TASK_ID, "gates"), "export-boundary.json")), { code: "ENOENT" });
    } finally { await rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); }
  });
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
