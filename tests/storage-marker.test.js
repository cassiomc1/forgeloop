import { removeTempTree } from "./helpers/rm-safe.js";
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { withStorageMaintenance } from "../src/storage/maintenance.js";
import { activateStorageVersionMarker, readStorageVersionMarker, writePendingStorageVersionMarker } from "../src/storage/storage-marker.js";
import { withProjectStorage } from "../src/storage/project-boundary.js";
import { openStorageDatabase } from "../src/storage/connection.js";

test("expired maintenance activation preserves the pending marker and cannot adopt a later owner", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-marker-owner-expiry-"));
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let delayed;
  const binding = { databaseSchemaVersion: 5, operationId: randomUUID(), sourceInventoryFingerprint: "c".repeat(64) };
  try {
    await mkdir(path.join(target, ".forgeloop"));
    await withStorageMaintenance(target, async () => {
      await writePendingStorageVersionMarker(target, binding);
      delayed = gate.then(() => activateStorageVersionMarker(target, binding));
    });
    const filename = path.join(target, ".forgeloop/storage-version.json");
    const before = await readFile(filename);
    await assert.rejects(activateStorageVersionMarker(target, binding), { code: "E_STORAGE_MAINTENANCE_IN_PROGRESS" });
    await withStorageMaintenance(target, async () => {
      release();
      await assert.rejects(delayed, { code: "E_STORAGE_MAINTENANCE_IN_PROGRESS" });
      assert.deepEqual(await readFile(filename), before);
      await assert.rejects(activateStorageVersionMarker(target, { ...binding, operationId: randomUUID() }), { code: "E_STORAGE_VERSION_MARKER_INVALID" });
      assert.deepEqual(await readFile(filename), before);
      assert.equal((await activateStorageVersionMarker(target, binding)).phase, "ACTIVE");
    });
    assert.equal((await readStorageVersionMarker(target)).phase, "ACTIVE");
  } finally {
    release();
    await delayed?.catch(() => {});
    await removeTempTree(target);
  }
});

test("pending and missing-database markers prevent filesystem fallback after exclusion release", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-storage-marker-"));
  try {
    await mkdir(path.join(target, ".forgeloop"));
    const binding = { databaseSchemaVersion: 5, operationId: randomUUID(), sourceInventoryFingerprint: "a".repeat(64) };
    await assert.rejects(writePendingStorageVersionMarker(target, binding), { code: "E_STORAGE_MAINTENANCE_IN_PROGRESS" });
    await withStorageMaintenance(target, async () => {
      const marker = await writePendingStorageVersionMarker(target, binding);
      assert.equal(marker.phase, "CUTOVER_PENDING");
      assert.deepEqual(await writePendingStorageVersionMarker(target, binding), marker);
      await assert.rejects(writePendingStorageVersionMarker(target, { ...binding, operationId: randomUUID() }), { code: "E_STORAGE_VERSION_MARKER_INVALID" });
    });
    await assert.rejects(withProjectStorage(target, () => assert.fail("filesystem fallback must be refused")), { code: "E_STORAGE_MIGRATION_REQUIRED" });
    const filename = path.join(target, ".forgeloop/storage-version.json");
    const pending = await readStorageVersionMarker(target);
    await writeFile(filename, JSON.stringify({ ...pending, phase: "ACTIVE" }));
    await assert.rejects(withProjectStorage(target, () => assert.fail("missing SQLite must not fall back")), { code: "E_STORAGE_MIGRATION_REQUIRED" });
    for (const invalid of ["null", "{}", "{broken", "x".repeat(65537)]) {
      await writeFile(filename, invalid);
      await assert.rejects(readStorageVersionMarker(target), { code: "E_STORAGE_VERSION_MARKER_INVALID" });
    }
    assert.equal(await readFile(filename, "utf8"), "x".repeat(65537));
  } finally { await removeTempTree(target); }
});

test("marked writable dispatch refuses schema disagreement without upgrading database bytes", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-storage-marker-"));
  try {
    await mkdir(path.join(target, ".forgeloop"));
    const filename = path.join(target, ".forgeloop/state.sqlite");
    const db = openStorageDatabase(filename);
    db.close();
    const marker = { schemaVersion: 1, storageFormat: "sqlite", storageVersion: 1, databaseSchemaVersion: 4,
      operationId: randomUUID(), sourceInventoryFingerprint: "b".repeat(64), phase: "ACTIVE" };
    await writeFile(path.join(target, ".forgeloop/storage-version.json"), JSON.stringify(marker));
    const before = await readFile(filename);
    await assert.rejects(withProjectStorage(target, () => assert.fail("mismatched marker must refuse dispatch")), { code: "E_STORAGE_VERSION_MARKER_INVALID" });
    assert.deepEqual(await readFile(filename), before);
    const old = openStorageDatabase(filename);
    old.prepare("UPDATE storage_meta SET schema_version = 4 WHERE id = 1").run();
    old.close();
    const oldBytes = await readFile(filename);
    await assert.rejects(withProjectStorage(target, () => assert.fail("marked schema must not auto-upgrade")), { code: "E_STORAGE_MIGRATION_REQUIRED" });
    assert.deepEqual(await readFile(filename), oldBytes);
  } finally { await removeTempTree(target); }
});
