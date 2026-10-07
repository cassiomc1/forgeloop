import path from "node:path";
import { canonicalFingerprint } from "../core/artifacts.js";
import { assertSafePath } from "../core/filesystem.js";
import { JSON_LIMITS } from "../core/json-safety.js";
import { MAINTENANCE_OWNER_ID } from "./maintenance-owner.js";
import { readStorageMetadataJson } from "./metadata-json.js";
import { withVerifiedProjectStorageBackup } from "./project-backup.js";
import { readStorageMeta } from "./connection.js";
import { readStorageVersionMarker } from "./storage-marker.js";
import { verifyRetainedStorageReplacementArchive } from "./restore-replacement-archive.js";

function invalid(message) { return Object.assign(new Error(message), { code: "E_STORAGE_RESTORE_INVALID" }); }
const hash = value => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);

function assertJournalIdentity(journal, operationId, expectedOwnerId) {
  if (!journal || journal.schemaVersion !== 1 || journal.kind !== "PROJECT_RESTORE" || journal.operationId !== operationId
    || !MAINTENANCE_OWNER_ID.test(journal.ownerId ?? "") || (expectedOwnerId !== null && journal.ownerId !== expectedOwnerId)
    || typeof journal.source !== "string" || !path.isAbsolute(journal.source) || !hash(journal.sourceFingerprint)
    || !["PREPARING", "READY", "PUBLISHING", "ACTIVE"].includes(journal.phase)) throw invalid("Restore journal identity or phase is invalid");
}

function assertRetentionIntent(journal) {
  if (journal.rebuild && (!MAINTENANCE_OWNER_ID.test(journal.rebuild.historyId ?? "") || typeof journal.rebuild.retainSnapshot !== "boolean"
    || !["RETAINING", "RETAINED"].includes(journal.rebuild.phase)
    || (journal.phase !== "PREPARING" && journal.rebuild.phase !== "RETAINED"))) throw invalid("Restore preparation retention intent is invalid");
}

function assertPublicationBinding(journal, operationId, marker) {
  const binding = journal.binding;
  if (!binding || binding.operationId !== operationId || !Number.isSafeInteger(binding.databaseSchemaVersion) || binding.databaseSchemaVersion < 1
    || !hash(binding.sourceInventoryFingerprint) || !hash(journal.snapshotFingerprint)) throw invalid("Restore journal has no valid snapshot binding");
  if ((journal.phase === "READY" && marker) || (journal.phase === "ACTIVE" && marker?.phase !== "ACTIVE")) throw invalid("Restore journal phase disagrees with storage publication");
  if (marker && (marker.operationId !== operationId || marker.databaseSchemaVersion !== binding.databaseSchemaVersion
    || marker.sourceInventoryFingerprint !== binding.sourceInventoryFingerprint)) throw invalid("Restore marker belongs to different retained evidence");
  return binding;
}

/** Read only the explicitly selected operation; never infer it by scanning. */
export async function verifyProjectRestoreJournal(target, operationId, { expectedOwnerId = null } = {}) {
  if (!MAINTENANCE_OWNER_ID.test(operationId ?? "")) throw invalid("Restore inspection requires an exact operation identity");
  const root = await assertSafePath(target, `.forgeloop/storage-restores/${operationId}`);
  const journal = await readStorageMetadataJson(root, "restore-journal.json", { limits: JSON_LIMITS });
  assertJournalIdentity(journal, operationId, expectedOwnerId);
  if (journal.replacement !== undefined) {
    if (journal.phase === "PREPARING" || !hash(journal.replacement?.outgoingFingerprint) || !hash(journal.replacement?.incomingFingerprint)) throw invalid("Replacement publication intent is invalid");
    await verifyRetainedStorageReplacementArchive(target, operationId, journal.replacement);
  }
  const marker = await readStorageVersionMarker(target);
  assertRetentionIntent(journal);
  if (journal.phase === "PREPARING") {
    if (journal.binding !== undefined || journal.snapshotFingerprint !== undefined || marker) throw invalid("Unvalidated restore preparation cannot own an activation binding");
    return { root, journal, snapshotVerified: false, marker };
  }
  const binding = assertPublicationBinding(journal, operationId, marker);
  const snapshot = await assertSafePath(root, "snapshot");
  await withVerifiedProjectStorageBackup(snapshot, ({ db, manifest }) => {
    const fingerprint = canonicalFingerprint({ database: manifest.databaseSha256, inventory: manifest.inventorySha256, references: manifest.references });
    if (canonicalFingerprint(manifest) !== journal.snapshotFingerprint || fingerprint !== binding.sourceInventoryFingerprint
      || readStorageMeta(db).schema_version !== binding.databaseSchemaVersion) throw invalid("Restore snapshot disagrees with its journal binding");
  });
  return { root, journal, snapshot, snapshotVerified: true, marker };
}
