import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, writeFile, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { removeTempTree } from "./helpers/rm-safe.js";
import { getPackageRoot } from "../src/core/templates.js";
import { taskArtifactPath } from "../src/core/task-paths.js";
import { readTaskPolicySnapshot } from "../src/core/policy-engine.js";
import { readPortableJsonArtifact } from "../src/core/artifacts.js";

test("canonical policy snapshot refuses legacy authority while portable inspection preserves bytes", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-policy-snapshot-authority-"));
  const packageRoot = getPackageRoot();
  const taskId = "legacy-policy-snapshot";
  const relative = taskArtifactPath(taskId, "policySnapshot");
  const filename = path.join(target, relative);
  try {
    assert.equal(await readTaskPolicySnapshot(target, taskId, packageRoot), null);
    const bytes = await readFile(path.join(packageRoot, "tests/fixtures/schemas/policy-snapshot/valid.json"));
    await mkdir(path.dirname(filename), { recursive: true });
    await writeFile(filename, bytes);
    await assert.rejects(readTaskPolicySnapshot(target, taskId, packageRoot), { code: "E_STORAGE_MIGRATION_REQUIRED" });
    assert.deepEqual((await readPortableJsonArtifact(target, relative, "policy-snapshot", packageRoot)).value, JSON.parse(bytes));
    assert.deepEqual(await readFile(filename), bytes);
    await assert.rejects(readFile(path.join(target, ".forgeloop/state.sqlite")), { code: "ENOENT" });
  } finally { await removeTempTree(target); }
});


test("canonical policy snapshot refuses a linked legacy file", { skip: process.platform === "win32" }, async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-policy-snapshot-link-"));
  const packageRoot = getPackageRoot();
  try {
    const relative = taskArtifactPath("linked-policy", "policySnapshot");
    const filename = path.join(target, relative);
    const source = path.join(target, "outside.json");
    const bytes = await readFile(path.join(packageRoot, "tests/fixtures/schemas/policy-snapshot/valid.json"));
    await mkdir(path.dirname(filename), { recursive: true });
    await writeFile(source, bytes);
    await symlink(source, filename);
    await assert.rejects(readTaskPolicySnapshot(target, "linked-policy", packageRoot), { code: "ARTIFACT_PATH_INVALID" });
    assert.deepEqual(await readFile(source), bytes);
    await assert.rejects(readFile(path.join(target, ".forgeloop/state.sqlite")), { code: "ENOENT" });
  } finally { await removeTempTree(target); }
});
