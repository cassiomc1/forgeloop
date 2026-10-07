import { randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { writeFileAtomic } from "../../src/core/filesystem.js";
import { canonicalFingerprint } from "../../src/core/artifacts.js";
import { getPackageRoot } from "../../src/core/templates.js";
import { withStorageMaintenance, assertOwnedStorageMaintenance } from "../../src/storage/maintenance.js";
import { backupProjectStorage, withVerifiedProjectStorageBackup } from "../../src/storage/project-backup.js";
import { validateMigrationDatabase } from "../../src/storage/migration-validation.js";
import { readStorageMeta } from "../../src/storage/connection.js";
import { writePendingStorageVersionMarker, activateStorageVersionMarker } from "../../src/storage/storage-marker.js";
import { iterateAttachmentReferences } from "../../src/storage/attachment-references.js";
import { publishAttachmentFile, withVerifiedAttachmentFile } from "../../src/storage/attachment-files.js";
import { createReadStream } from "node:fs";
import { backupStorageDatabase } from "../../src/storage/backup.js";

const [source, target, checkpoint = "READY"] = process.argv.slice(2);
await mkdir(path.join(target, ".forgeloop"));
await withStorageMaintenance(target, () => withVerifiedProjectStorageBackup(source, async ({ db, root, manifest: sourceManifest }) => {
  const operationId = randomUUID();
  const operationRoot = path.join(target, ".forgeloop/storage-restores", operationId);
  await mkdir(operationRoot, { recursive: true });
  const ownerId = await assertOwnedStorageMaintenance(target);
  const journal = { schemaVersion: 1, kind: "PROJECT_RESTORE", operationId, ownerId, source: root,
    sourceFingerprint: canonicalFingerprint(sourceManifest), phase: "PREPARING" };
  const persist = () => writeFileAtomic(path.join(operationRoot, "restore-journal.json"), `${JSON.stringify(journal, null, 2)}\n`);
  await persist();
  const snapshot = path.join(operationRoot, "snapshot");
  if (["PARTIAL", "MISSING", "RETAINING", "RETAINED", "REBUILD", "REBUILD_CONFLICT"].includes(checkpoint)) {
    if (checkpoint !== "MISSING") {
      await mkdir(snapshot);
      await writeFile(path.join(snapshot, "incomplete.bin"), Buffer.from([0, 255, 77]));
    }
    if (["RETAINING", "RETAINED", "REBUILD", "REBUILD_CONFLICT"].includes(checkpoint)) {
      journal.rebuild = { historyId: randomUUID(), retainSnapshot: true, phase: "RETAINING" };
      await persist();
      if (["RETAINED", "REBUILD", "REBUILD_CONFLICT"].includes(checkpoint)) {
        await mkdir(path.join(operationRoot, "snapshot-history"));
        await rename(snapshot, path.join(operationRoot, "snapshot-history", journal.rebuild.historyId));
      }
      if (["REBUILD", "REBUILD_CONFLICT"].includes(checkpoint)) {
        journal.rebuild.phase = "RETAINED";
        await persist();
        await mkdir(snapshot);
        await writeFile(path.join(snapshot, "incomplete.bin"), Buffer.from([0, 128, 99]));
        if (checkpoint === "REBUILD_CONFLICT") {
          await mkdir(path.join(operationRoot, "snapshot-intents"));
          await writeFile(path.join(operationRoot, "snapshot-intents", `${journal.rebuild.historyId}.json`), JSON.stringify({ kind: "UNBOUND" }));
        }
      }
    }
    process.send({ operationId, ownerId, previousHistoryId: journal.rebuild?.historyId });
    await new Promise(() => { setInterval(() => {}, 1000); });
  }
  await backupProjectStorage(db, root, snapshot);
  await withVerifiedProjectStorageBackup(snapshot, async ({ db: retained, manifest }) => {
    await validateMigrationDatabase(retained, { target: snapshot, packageRoot: getPackageRoot() });
    if (!["PREPARING", "PREPARING_CHANGED"].includes(checkpoint)) Object.assign(journal, { phase: "READY", snapshotFingerprint: canonicalFingerprint(manifest), binding: {
      operationId, databaseSchemaVersion: readStorageMeta(retained).schema_version,
      sourceInventoryFingerprint: canonicalFingerprint({ database: manifest.databaseSha256, inventory: manifest.inventorySha256, references: manifest.references }) } });
    await persist();
    if (!["READY", "PREPARING", "PREPARING_CHANGED"].includes(checkpoint)) {
      journal.phase = "PUBLISHING";
      await persist();
      await writePendingStorageVersionMarker(target, journal.binding);
      if (["OBJECT", "UNBOUND", "DATABASE", "ACTIVE_MARKER", "CHANGED_DATABASE", "TERMINAL_CHANGED"].includes(checkpoint)) {
        const reference = iterateAttachmentReferences(retained).next().value;
        const temporaryRoot = path.join(snapshot, "activation-attachments");
        await mkdir(temporaryRoot);
        await withVerifiedAttachmentFile(snapshot, reference, filename => publishAttachmentFile(target, createReadStream(filename), { db: retained, temporaryRoot }));
      }
      if (["DATABASE", "ACTIVE_MARKER", "CHANGED_DATABASE", "TERMINAL_CHANGED"].includes(checkpoint)) await backupStorageDatabase(retained, path.join(target, ".forgeloop/state.sqlite"));
      if (["ACTIVE_MARKER", "CHANGED_DATABASE", "TERMINAL_CHANGED"].includes(checkpoint)) await activateStorageVersionMarker(target, journal.binding);
      if (checkpoint === "TERMINAL_CHANGED") { journal.phase = "ACTIVE"; await persist(); }
    }
  });
  process.send({ operationId, ownerId });
  await new Promise(() => { setInterval(() => {}, 1000); });
}), { retainOnError: true });
