import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { persistGate, readCanonicalGateArtifactBinding, readGateIfPresent, validateGateArtifacts } from "../src/core/gate-artifact.js";
import { taskArtifactPath, taskGatePath } from "../src/core/task-paths.js";
import { sha256 } from "../src/core/manifest.js";
import { withProjectStorage } from "../src/storage/project-boundary.js";
import { withOperationalTransaction } from "../src/storage/unit-of-work.js";
import { openStorageDatabase, upsertTask } from "../src/storage/index.js";
import { getPackageRoot } from "../src/core/templates.js";
import { createGate } from "./helpers/gates.js";
import { ensureFixtureTask, readFixtureText } from "./helpers/native-storage-fixture.js";
import { removeTempTree } from "./helpers/rm-safe.js";

test("direct optional gate read selects existing SQLite authority without allocating an empty project", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-native-gate-"));
  const packageRoot = getPackageRoot();
  const taskId = "gate-native";
  try {
    assert.equal(await readGateIfPresent(target, "design", packageRoot, { taskId }), null);
    assert.deepEqual(await readdir(target), []);
    await ensureFixtureTask(target, taskId, packageRoot);
    const gate = createGate({ taskId, gate: "design", status: "satisfied" });
    await persistGate(target, gate, packageRoot, { taskId });
    assert.deepEqual((await readGateIfPresent(target, "design", packageRoot, { taskId })).value, gate);
    assert.equal(await readGateIfPresent(target, "quality", packageRoot, { taskId }), null);
    assert.equal((await readdir(path.join(target, ".forgeloop"))).includes("task-state"), false);
  } finally { await removeTempTree(target); }
});

test("gate freshness selects canonical bytes and ignores missing-artifact filesystem shadows", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-gate-canonical-binding-"));
  const packageRoot = getPackageRoot();
  const taskId = "gate-canonical-binding";
  try {
    await ensureFixtureTask(target, taskId, packageRoot);
    const descriptorPath = taskArtifactPath(taskId, "descriptor");
    const bytes = await readFixtureText(target, descriptorPath);
    const gate = createGate({ taskId, gate: "design", status: "satisfied", artifacts: [{ path: descriptorPath, sha256: sha256(bytes) }] });
    assert.deepEqual(await validateGateArtifacts(target, gate, packageRoot), []);
    assert.deepEqual(await validateGateArtifacts(target, { ...gate, artifacts: [{ path: descriptorPath, sha256: "0".repeat(64) }] }, packageRoot), [{ path: descriptorPath, status: "changed" }]);
    await assert.rejects(readFile(path.join(target, descriptorPath)), { code: "ENOENT" });
    const missingPath = taskArtifactPath(taskId, "route");
    const missingGate = { ...gate, artifacts: [{ path: missingPath, sha256: sha256("shadow bytes") }] };
    await withProjectStorage(target, async () => {
      await mkdir(path.dirname(path.join(target, missingPath)), { recursive: true });
      await writeFile(path.join(target, missingPath), "shadow bytes");
      assert.deepEqual(await validateGateArtifacts(target, missingGate, packageRoot), [{ path: missingPath, status: "missing" }]);
    }, { readOnly: true });
    await assert.rejects(validateGateArtifacts(target, missingGate, packageRoot), { code: "E_STORAGE_MIGRATION_REQUIRED" });
    assert.equal(await readFile(path.join(target, missingPath), "utf8"), "shadow bytes");
  } finally { await removeTempTree(target); }
});

test("canonical gate binding participates in commit conflict detection against an independent writer", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-gate-binding-conflict-"));
  const packageRoot = getPackageRoot();
  const taskId = "gate-binding-conflict";
  try {
    await ensureFixtureTask(target, taskId, packageRoot);
    const descriptorPath = taskArtifactPath(taskId, "descriptor");
    const descriptor = JSON.parse(await readFixtureText(target, descriptorPath));
    const replacement = { ...descriptor, updatedAt: new Date(Date.parse(descriptor.updatedAt) + 1000).toISOString() };
    await assert.rejects(withProjectStorage(target, () => withOperationalTransaction({ target, taskId, operation: "gate-binding-conflict", packageRoot }, async transaction => {
      const binding = readCanonicalGateArtifactBinding(target, descriptorPath);
      const gate = createGate({ taskId, gate: "design", status: "satisfied", artifacts: [{ path: descriptorPath, sha256: binding.sha256 }] });
      transaction.stageText(taskGatePath(taskId, "design"), JSON.stringify(gate));
      const independent = openStorageDatabase(path.join(target, ".forgeloop/state.sqlite"));
      try { upsertTask(independent, { taskId, descriptor: replacement }); }
      finally { independent.close(); }
    })), { code: "E_STATE_REVISION_CONFLICT" });
    assert.equal(await readGateIfPresent(target, "design", packageRoot, { taskId }), null);
    assert.deepEqual(JSON.parse(await readFixtureText(target, descriptorPath)), replacement);
  } finally { await removeTempTree(target); }
});

test("canonical gate ledger hashing streams rows and preserves exact exported byte digest", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-gate-ledger-binding-"));
  const packageRoot = getPackageRoot();
  const taskId = "gate-ledger-binding";
  try {
    await ensureFixtureTask(target, taskId, packageRoot);
    const eventsPath = taskArtifactPath(taskId, "events");
    const text = await readFixtureText(target, eventsPath);
    await withProjectStorage(target, store => {
      const readText = store.readText.bind(store);
      store.readText = relative => {
        assert.notEqual(relative, eventsPath, "ledger hashing must not materialize the whole event text");
        return readText(relative);
      };
      const binding = readCanonicalGateArtifactBinding(target, eventsPath);
      assert.equal(binding.sha256, sha256(text));
      assert.equal(binding.byteLength, Buffer.byteLength(text));
    }, { readOnly: true });
  } finally { await removeTempTree(target); }
});
