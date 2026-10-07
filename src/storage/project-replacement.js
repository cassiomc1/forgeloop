import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { assertSafePath, writeFileAtomic } from "../core/filesystem.js";
import { canonicalFingerprint } from "../core/artifacts.js";
import { getPackageRoot } from "../core/templates.js";
import { withStorageMaintenance, resumeStorageMaintenance, assertOwnedStorageMaintenance, retainStorageMaintenance, assertStorageMaintenanceOwnerContinuity } from "./maintenance.js";
import { backupProjectStorage, withVerifiedProjectStorageBackup } from "./project-backup.js";
import { validateMigrationDatabase } from "./migration-validation.js";
import { logicalSnapshot } from "./migration-candidate.js";
import { prepareActiveStorageReplacement, REPLACEMENT_ACTIVE_ROOTS } from "./restore-replacement.js";
import { archiveActiveStorageReplacement } from "./restore-replacement-archive.js";
import { publishArchivedStorageReplacement, resumeProjectStorageRestore } from "./project-restore.js";
import { verifyProjectRestoreJournal } from "./restore-journal.js";
import { MAINTENANCE_OWNER_ID } from "./maintenance-owner.js";
import { readStorageMetadataJson } from "./metadata-json.js";
import { restorePathExists } from "./restore-layout.js";
import { ensurePreparedRestoreSnapshot } from "./restore-preparation.js";
import { adoptPreparedReplacementOwner } from "./restore-replacement-owner.js";
import { ensurePreparedOutgoingReplacement, assertOutgoingRebuildIntent } from "./restore-replacement-preparation.js";

const invalid = message => Object.assign(new Error(message), { code: "E_STORAGE_RESTORE_INVALID" });
const hash = value => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);

function assertRebuildIntent(intent) {
  if (intent.rebuild && (!MAINTENANCE_OWNER_ID.test(intent.rebuild.historyId ?? "") || typeof intent.rebuild.retainSnapshot !== "boolean"
    || !["RETAINING", "RETAINED"].includes(intent.rebuild.phase) || (intent.phase === "READY" && intent.rebuild.phase !== "RETAINED"))) throw invalid("Replacement snapshot retention intent is invalid");
  assertOutgoingRebuildIntent(intent);
}

export async function verifyProjectReplacementIntent(target, operationId, { expectedOwnerId = null } = {}) {
  if (!MAINTENANCE_OWNER_ID.test(operationId ?? "")) throw invalid("Replacement inspection requires an exact operation identity");
  const root = await assertSafePath(target, `.forgeloop/storage-restores/${operationId}`);
  const intent = await readStorageMetadataJson(root, "replacement-intent.json");
  if (!intent || intent.schemaVersion !== 1 || intent.kind !== "ACTIVE_PROJECT_REPLACEMENT" || intent.operationId !== operationId
    || !MAINTENANCE_OWNER_ID.test(intent.ownerId ?? "") || (expectedOwnerId !== null && intent.ownerId !== expectedOwnerId)
    || typeof intent.source !== "string" || !path.isAbsolute(intent.source) || !hash(intent.sourceFingerprint)
    || !["PREPARING", "READY"].includes(intent.phase)
    || (intent.phase === "READY" && !hash(intent.snapshotFingerprint))
    || (intent.phase === "PREPARING" && intent.snapshotFingerprint !== undefined)) throw invalid("Replacement preparation identity or phase is invalid");
  assertRebuildIntent(intent);
  return { root, intent };
}

/** Select only the stage recorded for the explicitly requested replacement. */
export async function resumeActiveProjectReplacement(target, options = {}) {
  if (options.writersQuiesced !== true) throw Object.assign(new Error("Exclude writers before replacement recovery"), { code: "E_STORAGE_MIGRATION_QUIESCENCE_REQUIRED" });
  const selected = await verifyProjectReplacementIntent(target, options.operationId);
  if (!await restorePathExists(selected.root, "restore-journal.json")) return resumeProjectReplacementPreparation(target, options);
  const publication = await verifyProjectRestoreJournal(target, options.operationId);
  if (selected.intent.phase !== "READY" || !publication.journal.replacement
    || selected.intent.snapshotFingerprint !== publication.journal.snapshotFingerprint
    || selected.intent.snapshotFingerprint !== publication.journal.replacement.incomingFingerprint) throw invalid("Replacement preparation and publication checkpoints disagree");
  return resumeProjectStorageRestore(target, options);
}

/** Resume preparation/archival before a publication journal has been created. */
export async function resumeProjectReplacementPreparation(target, { operationId, expectedOwnerId, writersQuiesced = false, packageRoot = getPackageRoot() } = {}) {
  if (writersQuiesced !== true) throw Object.assign(new Error("Exclude writers before replacement recovery"), { code: "E_STORAGE_MIGRATION_QUIESCENCE_REQUIRED" });
  const before = await verifyProjectReplacementIntent(target, operationId);
  await assertStorageMaintenanceOwnerContinuity(target, { expectedOwnerId, recordedOwnerId: before.intent.ownerId });
  if (await restorePathExists(before.root, "restore-journal.json")) throw invalid("Replacement publication intent already exists; use publication resume");
  return resumeStorageMaintenance(target, { expectedOwnerId, writersQuiesced }, async () => {
    await retainStorageMaintenance(target);
    const current = await verifyProjectReplacementIntent(target, operationId);
    if (canonicalFingerprint(current.intent) !== canonicalFingerprint(before.intent)) throw invalid("Replacement intent changed during owner adoption");
    await assertStorageMaintenanceOwnerContinuity(target, { expectedOwnerId: await assertOwnedStorageMaintenance(target), recordedOwnerId: current.intent.ownerId });
    const intent = current.intent;
    intent.ownerId = await assertOwnedStorageMaintenance(target);
    const persist = async () => {
      await assertOwnedStorageMaintenance(target);
      await writeFileAtomic(await assertSafePath(current.root, "replacement-intent.json"), `${JSON.stringify(intent, null, 2)}\n`);
    };
    await persist();
    await ensurePreparedOutgoingReplacement(target, current.root, intent, { writersQuiesced, packageRoot });
    await adoptPreparedReplacementOwner(target, operationId, { expectedOwnerId });
    if (intent.phase === "PREPARING") {
      await ensurePreparedRestoreSnapshot(target, current.root, intent, { journalFilename: "replacement-intent.json" });
      await withVerifiedProjectStorageBackup(await assertSafePath(current.root, "snapshot"), async retained => {
        await validateMigrationDatabase(retained.db, { target: retained.root, packageRoot });
        await withVerifiedProjectStorageBackup(intent.source, source => {
          if (canonicalFingerprint(source.manifest) !== intent.sourceFingerprint
            || canonicalFingerprint(logicalSnapshot(source.db)) !== canonicalFingerprint(logicalSnapshot(retained.db))) throw invalid("Replacement recovery snapshot differs from recorded source");
        });
        intent.snapshotFingerprint = canonicalFingerprint(retained.manifest);
      });
      intent.phase = "READY";
      await persist();
    }
    await withVerifiedProjectStorageBackup(await assertSafePath(current.root, "snapshot"), retained => {
      if (canonicalFingerprint(retained.manifest) !== intent.snapshotFingerprint) throw invalid("Replacement incoming snapshot changed after preparation");
    });
    await archiveActiveStorageReplacement(target, operationId, { packageRoot, expectedOwnerId });
    return publishArchivedStorageReplacement(target, operationId, { packageRoot });
  });
}

/** Initial replacement orchestration. Every outgoing byte remains independently retained. */
export async function replaceActiveProjectStorage(source, target, { writersQuiesced = false, packageRoot = getPackageRoot() } = {}) {
  if (writersQuiesced !== true) throw Object.assign(new Error("Exclude writers and close their database connections before active replacement"), { code: "E_STORAGE_MIGRATION_QUIESCENCE_REQUIRED" });
  return withVerifiedProjectStorageBackup(source, async ({ db, root, manifest }) => {
    await validateMigrationDatabase(db, { target: root, packageRoot });
    const relative = path.relative(path.resolve(target), root).split(path.sep).join("/");
    if (REPLACEMENT_ACTIVE_ROOTS.some(name => relative === name || relative.startsWith(`${name}/`))) throw invalid("Replacement source cannot be archived outgoing operational state");
    return withStorageMaintenance(target, async () => {
      await retainStorageMaintenance(target);
      const operationId = randomUUID();
      const operationRoot = await assertSafePath(target, `.forgeloop/storage-restores/${operationId}`);
      await mkdir(path.dirname(operationRoot), { recursive: true });
      await mkdir(operationRoot);
      const intent = { schemaVersion: 1, kind: "ACTIVE_PROJECT_REPLACEMENT", operationId, ownerId: await assertOwnedStorageMaintenance(target),
        source: root, sourceFingerprint: canonicalFingerprint(manifest), phase: "PREPARING" };
      const persist = async () => {
        await assertOwnedStorageMaintenance(target);
        await writeFileAtomic(await assertSafePath(operationRoot, "replacement-intent.json"), `${JSON.stringify(intent, null, 2)}\n`);
      };
      await persist();
      await prepareActiveStorageReplacement(target, operationId, { writersQuiesced, packageRoot });
      const snapshot = await assertSafePath(operationRoot, "snapshot");
      await backupProjectStorage(db, root, snapshot);
      await withVerifiedProjectStorageBackup(snapshot, async retained => {
        await validateMigrationDatabase(retained.db, { target: retained.root, packageRoot });
        await withVerifiedProjectStorageBackup(root, current => {
          if (canonicalFingerprint(current.manifest) !== intent.sourceFingerprint
            || canonicalFingerprint(logicalSnapshot(current.db)) !== canonicalFingerprint(logicalSnapshot(retained.db))) throw invalid("Incoming source changed during replacement preparation");
        });
        intent.snapshotFingerprint = canonicalFingerprint(retained.manifest);
      });
      intent.phase = "READY";
      await persist();
      await archiveActiveStorageReplacement(target, operationId, { packageRoot });
      // Publication owns the terminal validator and admission release decision.
      const result = await publishArchivedStorageReplacement(target, operationId, { packageRoot });
      return { ...result, operationId, replacementIntent: await assertSafePath(operationRoot, "replacement-intent.json") };
    }, { retainOnError: true });
  });
}
