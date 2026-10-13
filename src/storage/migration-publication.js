import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, rename } from "node:fs/promises";
import path from "node:path";
import { syncDirectory } from "./file-durability.js";
import { assertSafePath, writeFileAtomic } from "../core/filesystem.js";
import { canonicalFingerprint } from "../core/artifacts.js";
import { assertJsonBytes, assertJsonLimits } from "../core/json-safety.js";
import { assertOwnedStorageMaintenance, withStorageMaintenance } from "./maintenance.js";
import { logicalSnapshot, verifyMigrationCandidate } from "./migration-candidate.js";
import { backupProjectStorage, verifyProjectStorageBackup } from "./project-backup.js";
import { openStorageDatabase, readStorageMeta } from "./connection.js";
import { inspectMigrationSourcePartition } from "./migration-source-partition.js";
import { readStorageVersionMarker } from "./storage-marker.js";

function invalid(message) { return Object.assign(new Error(message), { code: "E_STORAGE_MIGRATION_PUBLICATION_INVALID" }); }

function requireAttachmentsVerified(candidate) {
  if (!["NOT_REQUIRED", "VERIFIED"].includes(candidate.manifest.parity.attachmentReferenceValidation)) {
    throw invalid("Attachment reference coverage must be validated before staging publication");
  }
}

function assertPublicationJournal(journal, candidate, published, marker) {
  if (!journal || journal.schemaVersion !== 1 || (!["STAGED", "ARCHIVING", "ARCHIVED"].includes(journal.phase) && !published) || journal.publicationReady !== published
    || typeof journal.operationId !== "string" || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(journal.operationId)
    || journal.candidateSha256 !== candidate.manifest.candidateSha256
    || journal.sourceInventoryFingerprint !== candidate.manifest.sourceInventoryFingerprint) throw invalid("Publication journal is incomplete or has changed bindings");
  if (marker && (marker.operationId !== journal.operationId || marker.sourceInventoryFingerprint !== journal.sourceInventoryFingerprint)) throw invalid("Cutover marker belongs to another publication");
}

/** Revalidate a closed stage; no journal field alone authorizes publication. */
export async function verifyMigrationPublicationStage(target, destination, options = {}) {
  const marker = options.sourcePartition ? await readStorageVersionMarker(target) : null;
  const allowSignatureObjectGrowth = Boolean(marker && ["CUTOVER_PENDING", "ACTIVE"].includes(marker.phase));
  const directory = await assertSafePath(await assertSafePath(target, destination), "publication");
  const bytes = await readFile(await assertSafePath(directory, "publication-journal.json"));
  assertJsonBytes(bytes, "publication journal");
  if (!Buffer.from(bytes.toString("utf8")).equals(bytes)) throw invalid("Publication journal is not UTF-8");
  const journal = JSON.parse(bytes.toString("utf8"));
  assertJsonLimits(journal, "publication journal");
  const published = journal?.phase === "PUBLISHED" && options.allowPublished === true;
  const candidate = await verifyMigrationCandidate(target, destination, { ...options, allowAttachmentGrowth: published, allowSignatureObjectGrowth });
  requireAttachmentsVerified(candidate);
  assertPublicationJournal(journal, candidate, published, marker);
  if (journal.phase === "ARCHIVED" || published) {
    const partition = await inspectMigrationSourcePartition(target, destination, { allowAttachmentGrowth: published, allowSignatureObjectGrowth });
    if (partition.roots.some(root => root.path !== ".forgeloop/attachments" && root.location === "ACTIVE")) throw invalid("Journal claims archival while legacy roots remain active");
  }
  const bundle = await assertSafePath(directory, "bundle");
  await verifyProjectStorageBackup(bundle);
  const manifest = JSON.parse(await readFile(await assertSafePath(bundle, "backup-manifest.json"), "utf8"));
  if (journal.databaseSha256 !== manifest.databaseSha256 || journal.inventorySha256 !== manifest.inventorySha256) throw invalid("Publication bundle bytes disagree with journal bindings");
  const db = openStorageDatabase(await assertSafePath(bundle, "state.sqlite"), { readOnly: true });
  try {
    if (marker && marker.databaseSchemaVersion !== readStorageMeta(db).schema_version) throw invalid("Cutover marker schema disagrees with staged storage");
    if (canonicalFingerprint(logicalSnapshot(db)) !== canonicalFingerprint(candidate.manifest.logical)) throw invalid("Publication bundle canonical rows differ from retained candidate");
  } finally { db.close(); }
  return { path: directory, bundle, journal };
}

/** Stage an independent publication copy; archiving/marker/activation are separate. */
export async function stageMigrationPublication(target, destination, { writersQuiesced = false, packageRoot } = {}) {
  if (writersQuiesced !== true) throw Object.assign(new Error("Stop and exclude writers before staging publication"), { code: "E_STORAGE_MIGRATION_QUIESCENCE_REQUIRED" });
  return withStorageMaintenance(target, async () => {
    const candidate = await verifyMigrationCandidate(target, destination, { packageRoot });
    requireAttachmentsVerified(candidate);
    const directory = await assertSafePath(candidate.path, "publication");
    await mkdir(directory); // Exclusive: an interrupted stage requires explicit reconciliation.
    const journalPath = await assertSafePath(directory, "publication-journal.json");
    const journal = { schemaVersion: 1, operationId: randomUUID(), phase: "STAGING", publicationReady: false,
      candidateSha256: candidate.manifest.candidateSha256, sourceInventoryFingerprint: candidate.manifest.sourceInventoryFingerprint };
    const persist = () => writeFileAtomic(journalPath, `${JSON.stringify(journal, null, 2)}\n`);
    await persist();
    let db;
    try {
      db = openStorageDatabase(candidate.candidatePath, { readOnly: true });
      await backupProjectStorage(db, candidate.attachmentRoot, path.join(directory, "bundle"));
      db.close(); db = null;
      await verifyMigrationCandidate(target, destination, { packageRoot });
      const bundleManifest = JSON.parse(await readFile(await assertSafePath(directory, "bundle/backup-manifest.json"), "utf8"));
      Object.assign(journal, { phase: "STAGED", databaseSha256: bundleManifest.databaseSha256, inventorySha256: bundleManifest.inventorySha256 });
      await persist();
      return await verifyMigrationPublicationStage(target, destination, { packageRoot });
    } catch (error) {
      journal.phase = "FAILED";
      journal.error = { code: error.code ?? "E_STORAGE_MIGRATION_PUBLICATION_INVALID", message: error.message };
      try { await persist(); } catch { /* Retained STAGING cannot authorize publication. */ }
      throw error;
    } finally { db?.close(); }
  }, { retainOnError: true });
}

async function present(filename) {
  try { return await lstat(filename); } catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

/** Preserve an unpublished interrupted stage, then rebuild from verified sources. */
export async function resumeMigrationPublicationStage(target, destination, { writersQuiesced = false, packageRoot } = {}) {
  if (writersQuiesced !== true) throw invalid("Publication recovery requires excluded writers");
  await assertOwnedStorageMaintenance(target);
  const root = await assertSafePath(target, destination);
  const directory = await assertSafePath(root, "publication");
  const existing = await present(directory);
  let journal;
  if (existing) {
    if (!existing.isDirectory()) throw invalid("Publication stage is not a directory");
    const journalPath = await assertSafePath(directory, "publication-journal.json");
    if (await present(journalPath)) {
      const bytes = await readFile(journalPath);
      assertJsonBytes(bytes, "publication journal");
      if (!Buffer.from(bytes.toString("utf8")).equals(bytes)) throw invalid("Publication journal is not UTF-8");
      journal = JSON.parse(bytes.toString("utf8"));
      assertJsonLimits(journal, "publication journal");
      if (["STAGED", "ARCHIVING", "ARCHIVED", "PUBLISHED"].includes(journal?.phase)) {
        return verifyMigrationPublicationStage(target, destination, { packageRoot, sourcePartition: true, allowPublished: true });
      }
      if (journal?.schemaVersion !== 1 || !["STAGING", "FAILED"].includes(journal.phase) || journal.publicationReady !== false
        || typeof journal.operationId !== "string" || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(journal.operationId)) throw invalid("Interrupted stage has unsupported publication identity");
    } else if ((await readdir(directory)).length !== 0) throw invalid("Nonempty publication without an identity requires reconciliation");
  }
  // A stage rebuild is forbidden after any cutover marker/database publication.
  if (await readStorageVersionMarker(target) || await present(await assertSafePath(target, ".forgeloop/state.sqlite"))) throw invalid("Published or pending storage cannot be rebuilt from an old candidate");
  const candidate = await verifyMigrationCandidate(target, destination, { packageRoot });
  requireAttachmentsVerified(candidate);
  if (journal && (journal.candidateSha256 !== candidate.manifest.candidateSha256
    || journal.sourceInventoryFingerprint !== candidate.manifest.sourceInventoryFingerprint)) throw invalid("Interrupted stage differs from the retained candidate");
  if (existing) {
    await assertOwnedStorageMaintenance(target);
    const history = await assertSafePath(root, "publication-history");
    await mkdir(history, { recursive: true });
    const attempt = await assertSafePath(history, randomUUID());
    await mkdir(attempt); // Exclusive history allocation; never replace an older attempt.
    await syncDirectory(root, { catchOpenErrors: false, catchCloseErrors: false });
    await syncDirectory(history, { catchOpenErrors: false, catchCloseErrors: false });
    await syncDirectory(attempt, { catchOpenErrors: false, catchCloseErrors: false });
    const retained = await assertSafePath(attempt, "publication");
    await rename(directory, retained);
    await syncDirectory(attempt, { catchOpenErrors: false, catchCloseErrors: false });
    await syncDirectory(root, { catchOpenErrors: false, catchCloseErrors: false });
    await syncDirectory(history, { catchOpenErrors: false, catchCloseErrors: false });
  }
  return stageMigrationPublication(target, destination, { writersQuiesced, packageRoot });
}
