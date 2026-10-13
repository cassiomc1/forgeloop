import { removeTempTree } from "./helpers/rm-safe.js";
import assert from "node:assert/strict";
import test from "node:test";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { executeForgeLoopCommand } from "../src/core/command-runtime.js";
import { canonicalFingerprint } from "../src/core/artifacts.js";
import { openStorageDatabase } from "../src/storage/connection.js";
import { registerAttachment } from "../src/storage/attachment-references.js";
import { withVerifiedProjectStorageBackup } from "../src/storage/project-backup.js";
import { readStorageVersionMarker } from "../src/storage/storage-marker.js";
import { withStorageMaintenance } from "../src/storage/maintenance.js";
import { putArtifact } from "../src/storage/repository.js";
import { prepareActiveStorageReplacement, verifyPreparedActiveStorageReplacement, assertActiveStorageReplacementUnchanged } from "../src/storage/restore-replacement.js";

const taskId = "outgoing-replacement-task";
async function fixture(callback) {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-replacement-"));
  try {
    const created = await executeForgeLoopCommand({ command: "task-create", projectPath: target, input: { taskId, claims: ["src/outgoing"] } });
    assert.equal(created.ok, true, JSON.stringify(created));
    const db = openStorageDatabase(path.join(target, ".forgeloop/state.sqlite"));
    let reference;
    try { reference = await registerAttachment(db, target, { taskId, referenceId: "outgoing-binary", readable: Readable.from([Buffer.from([0, 255, 128, 10])]) }); }
    finally { db.close(); }
    await callback({ target, reference });
  } finally { await removeTempTree(target); }
}

const databaseDigest = async target => createHash("sha256").update(await readFile(path.join(target, ".forgeloop/state.sqlite"))).digest("hex");

test("active replacement preparation retains outgoing authority and independent attachments without replacing state", async () => {
  await fixture(async ({ target, reference }) => {
    const operationId = randomUUID();
    const marker = await readStorageVersionMarker(target);
    const before = await databaseDigest(target);
    const orphanPath = path.join(target, ".forgeloop/attachments/objects", "e".repeat(64));
    await writeFile(orphanPath, "unreferenced retained evidence");
    let retained;
    await withStorageMaintenance(target, async () => {
      retained = await prepareActiveStorageReplacement(target, operationId, { writersQuiesced: true });
      assert.equal(retained.outgoingVerified, true);
      assert.equal(retained.replaced, false);
      assert.equal(retained.manifest.databaseSha256, before);
      assert.deepEqual(retained.manifest.marker, marker);
      assert.ok(retained.manifest.inventory.files.some(file => file.path.endsWith("e".repeat(64))));
      await assertActiveStorageReplacementUnchanged(target, operationId);
      await withVerifiedProjectStorageBackup(retained.backup, async ({ db, root }) => {
        assert.equal(db.prepare("SELECT task_id FROM tasks").get().task_id, taskId);
        assert.equal(db.prepare("SELECT reservation_state FROM claims").get().reservation_state, "ACTIVE");
        assert.deepEqual(await readFile(path.join(root, reference.path)), Buffer.from([0, 255, 128, 10]));
      });
    });
    assert.equal(await databaseDigest(target), before);
    assert.deepEqual(await readStorageVersionMarker(target), marker);
    assert.equal(await readFile(orphanPath, "utf8"), "unreferenced retained evidence");
    await writeFile(path.join(target, reference.path), "later corruption");
    assert.deepEqual(await readFile(path.join(retained.backup, reference.path)), Buffer.from([0, 255, 128, 10]));
    assert.equal((await verifyPreparedActiveStorageReplacement(target, operationId)).outgoingVerified, true);
    await withStorageMaintenance(target, () => assert.rejects(assertActiveStorageReplacementUnchanged(target, operationId), { code: "E_STORAGE_RESTORE_INVALID" }));
  });
});

test("active replacement requires explicit quiescence, exact operation and live maintenance ownership", async () => {
  await fixture(async ({ target }) => {
    const operationId = randomUUID();
    await assert.rejects(prepareActiveStorageReplacement(target, operationId), { code: "E_STORAGE_MIGRATION_QUIESCENCE_REQUIRED" });
    await assert.rejects(prepareActiveStorageReplacement(target, operationId, { writersQuiesced: true }), { code: "E_STORAGE_MAINTENANCE_IN_PROGRESS" });
    await withStorageMaintenance(target, async () => {
      await assert.rejects(prepareActiveStorageReplacement(target, "../unbound", { writersQuiesced: true }), { code: "E_STORAGE_RESTORE_INVALID" });
      await prepareActiveStorageReplacement(target, operationId, { writersQuiesced: true });
      const manifestPath = path.join(target, ".forgeloop/storage-restores", operationId, "outgoing/replacement-manifest.json");
      const original = await readFile(manifestPath);
      await assert.rejects(prepareActiveStorageReplacement(target, operationId, { writersQuiesced: true }), { code: "EEXIST" });
      assert.deepEqual(await readFile(manifestPath), original);
      for (const changes of [{ status: "PREPARING" }, { operationId: randomUUID() }, { backupFingerprint: "0".repeat(64) }, { logicalFingerprint: "0".repeat(64) }]) {
        await writeFile(manifestPath, JSON.stringify({ ...JSON.parse(original), ...changes }));
        await assert.rejects(verifyPreparedActiveStorageReplacement(target, operationId), { code: "E_STORAGE_RESTORE_INVALID" });
      }
      await writeFile(manifestPath, original);
    });
  });
});

for (const changed of ["marker", "database", "reservation", "legacy"]) {
  test(`active replacement refuses ${changed} conflicts and preserves outgoing state`, async () => {
    await fixture(async ({ target }) => {
      const operationId = randomUUID();
      await withStorageMaintenance(target, async () => {
        if (changed === "reservation") {
          const db = openStorageDatabase(path.join(target, ".forgeloop/state.sqlite"));
          try { putArtifact(db, { taskId, kind: "operationLease", payload: { taskId, retained: true } }); }
          finally { db.close(); }
          await assert.rejects(prepareActiveStorageReplacement(target, operationId, { writersQuiesced: true }), { code: "E_STORAGE_RESTORE_INVALID" });
          return;
        }
        if (changed === "legacy") {
          await writeFile(path.join(target, ".forgeloop/work-state.json"), "retained legacy bytes");
          await assert.rejects(prepareActiveStorageReplacement(target, operationId, { writersQuiesced: true }), { code: "E_STORAGE_RESTORE_INVALID" });
          assert.equal(await readFile(path.join(target, ".forgeloop/work-state.json"), "utf8"), "retained legacy bytes");
          return;
        }
        const retained = await prepareActiveStorageReplacement(target, operationId, { writersQuiesced: true });
        if (changed === "marker") {
          const marker = await readStorageVersionMarker(target);
          await writeFile(path.join(target, ".forgeloop/storage-version.json"), JSON.stringify({ ...marker, operationId: randomUUID() }));
        } else {
          const db = openStorageDatabase(path.join(target, ".forgeloop/state.sqlite"));
          try { putArtifact(db, { taskId, kind: "retained-control", payload: { taskId, acceptedLater: true } }); }
          finally { db.close(); }
        }
        await assert.rejects(assertActiveStorageReplacementUnchanged(target, operationId), { code: "E_STORAGE_RESTORE_INVALID" });
        assert.equal((await verifyPreparedActiveStorageReplacement(target, operationId)).manifest.backupFingerprint, retained.manifest.backupFingerprint);
        assert.equal(canonicalFingerprint((await readStorageVersionMarker(target)).phase), canonicalFingerprint("ACTIVE"));
      });
    });
  });
}

test("active replacement refuses a retained SQLite connection and preserves its failed backup evidence", async () => {
  await fixture(async ({ target }) => {
    const operationId = randomUUID();
    const before = await databaseDigest(target);
    const marker = await readStorageVersionMarker(target);
    const retainedConnection = openStorageDatabase(path.join(target, ".forgeloop/state.sqlite"));
    try {
      retainedConnection.prepare("SELECT task_id FROM tasks").get();
      await withStorageMaintenance(target, async () => {
        await assert.rejects(prepareActiveStorageReplacement(target, operationId, { writersQuiesced: true }), error => {
          assert.equal(error.code, "E_STORAGE_RESTORE_INVALID");
          assert.match(error.message, /Close all SQLite connections/);
          return true;
        });
        const root = path.join(target, ".forgeloop/storage-restores", operationId, "outgoing");
        assert.equal(JSON.parse(await readFile(path.join(root, "replacement-manifest.json"))).status, "FAILED");
        await withVerifiedProjectStorageBackup(path.join(root, "backup"), ({ db }) => {
          assert.equal(db.prepare("SELECT task_id FROM tasks").get().task_id, taskId);
        });
        await assert.rejects(verifyPreparedActiveStorageReplacement(target, operationId), { code: "E_STORAGE_RESTORE_INVALID" });
        assert.equal(await databaseDigest(target), before);
        assert.deepEqual(await readStorageVersionMarker(target), marker);
      });
    } finally { retainedConnection.close(); }
  });
});
