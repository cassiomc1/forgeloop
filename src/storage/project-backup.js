import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdir } from "node:fs/promises";
import path from "node:path";
import { assertSafePath, writeFileAtomic } from "../core/filesystem.js";
import { JSON_LIMITS } from "../core/json-safety.js";
import { readStorageMetadataJson } from "./metadata-json.js";
import { backupStorageDatabase } from "./backup.js";
import { checkStorageIntegrity, openStorageDatabase } from "./connection.js";
import { iterateAttachmentReferences } from "./attachment-references.js";
import { publishAttachmentFile, verifyAttachmentFile } from "./attachment-files.js";

function invalid(message) { return Object.assign(new Error(message), { code: "E_STORAGE_BACKUP_INVALID" }); }

async function digest(filename) {
  const hash = createHash("sha256");
  for await (const bytes of createReadStream(filename)) hash.update(bytes);
  return hash.digest("hex");
}

async function copyAttachment(source, destination, reference) {
  await verifyAttachmentFile(source, reference);
  const copied = await publishAttachmentFile(destination, createReadStream(await assertSafePath(source, reference.path)));
  if (copied.size !== reference.size || copied.sha256 !== reference.sha256) throw invalid("Attachment changed during backup copy");
}

/** Retained database snapshot plus all canonically referenced attachment bytes. */
export async function backupProjectStorage(db, target, destination) {
  if (db.isTransaction) throw invalid("Project backup requires committed storage state");
  const directory = path.resolve(destination);
  await assertSafePath(path.dirname(directory), path.basename(directory));
  await mkdir(directory); // Never overwrite a retained or interrupted backup.
  const manifestPath = await assertSafePath(directory, "backup-manifest.json");
  const manifest = { schemaVersion: 1, kind: "SQLITE_WITH_REFERENCED_ATTACHMENTS", status: "PREPARING" };
  const persist = () => writeFileAtomic(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await persist();
  let snapshot;
  try {
    const databasePath = await assertSafePath(directory, "state.sqlite");
    await backupStorageDatabase(db, databasePath);
    snapshot = openStorageDatabase(databasePath, { readOnly: true });
    let references = 0;
    async function* inventory() {
      for (const reference of iterateAttachmentReferences(snapshot)) {
        await copyAttachment(target, directory, reference);
        references += 1;
        yield `${JSON.stringify(reference)}\n`;
      }
    }
    const inventoryPath = await assertSafePath(directory, "attachments.ndjson");
    await writeFileAtomic(inventoryPath, inventory());
    snapshot.close(); snapshot = null;
    Object.assign(manifest, { status: "READY", databaseSha256: await digest(databasePath), inventorySha256: await digest(inventoryPath), references });
    await persist();
    return { path: directory, kind: manifest.kind, attachmentsIncluded: true, references };
  } catch (error) {
    manifest.status = "FAILED";
    manifest.error = { code: error.code ?? "E_STORAGE_BACKUP_INVALID", message: error.message };
    try { await persist(); } catch { /* PREPARING is also refused during restore. */ }
    throw error;
  } finally { snapshot?.close(); }
}

export async function withVerifiedProjectStorageBackup(directory, callback) {
  const root = path.resolve(directory);
  const manifest = await readStorageMetadataJson(root, "backup-manifest.json", { limits: JSON_LIMITS });
  if (!manifest || manifest.schemaVersion !== 1 || manifest.kind !== "SQLITE_WITH_REFERENCED_ATTACHMENTS" || manifest.status !== "READY"
    || !Number.isSafeInteger(manifest.references) || manifest.references < 0) throw invalid("Backup is incomplete or unsupported");
  const filename = await assertSafePath(root, "state.sqlite");
  for (const suffix of ["-wal", "-shm"]) {
    const sidecar = await assertSafePath(root, `state.sqlite${suffix}`);
    try { if (suffix === "-wal" && (await lstat(sidecar)).size !== 0) throw invalid("Backup requires unshipped WAL contents"); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  if (await digest(filename) !== manifest.databaseSha256) throw invalid("Backup database digest mismatch");
  const db = openStorageDatabase(filename, { readOnly: true });
  try {
    if (!checkStorageIntegrity(db).ok) throw invalid("Backup database failed integrity");
    let references = 0;
    const inventory = createHash("sha256");
    for (const reference of iterateAttachmentReferences(db)) {
      await verifyAttachmentFile(root, reference);
      references += 1;
      inventory.update(`${JSON.stringify(reference)}\n`);
    }
    if (references !== manifest.references || inventory.digest("hex") !== manifest.inventorySha256
      || await digest(await assertSafePath(root, "attachments.ndjson")) !== manifest.inventorySha256) throw invalid("Backup inventory disagrees with canonical references");
    return await callback({ db, root, manifest });
  } finally { db.close(); }
}

export async function verifyProjectStorageBackup(directory) {
  return withVerifiedProjectStorageBackup(directory, ({ root, manifest }) => ({ path: root, references: manifest.references, valid: true }));
}

/** Restore only into a fresh directory; never replace a running project. */
export async function restoreProjectStorageBackup(source, destination) {
  return withVerifiedProjectStorageBackup(source, async ({ db, root }) => {
    const restored = await backupProjectStorage(db, root, destination);
    await verifyProjectStorageBackup(destination);
    return { ...restored, restored: true, source: root };
  });
}
