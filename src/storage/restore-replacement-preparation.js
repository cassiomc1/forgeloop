import { randomUUID } from "node:crypto";
import { mkdir, rename } from "node:fs/promises";
import { syncDirectory } from "./file-durability.js";
import { assertSafePath, writeFileAtomic } from "../core/filesystem.js";
import { canonicalFingerprint } from "../core/artifacts.js";
import { readStorageMetadataJson } from "./metadata-json.js";
import { MAINTENANCE_OWNER_ID } from "./maintenance-owner.js";
import { assertOwnedStorageMaintenance, assertStorageMaintenanceOwnerContinuity } from "./maintenance.js";
import { readStorageVersionMarker } from "./storage-marker.js";
import { openStorageDatabase, checkStorageIntegrity } from "./connection.js";
import { validateMigrationDatabase } from "./migration-validation.js";
import { logicalSnapshot } from "./migration-candidate.js";
import { inventoryStorageRoots } from "./migration-source.js";
import { restorePathExists } from "./restore-layout.js";
import { prepareActiveStorageReplacement, verifyPreparedActiveStorageReplacement, REPLACEMENT_ACTIVE_ROOTS, assertReplacementConnectionsClosed } from "./restore-replacement.js";

const invalid = message => Object.assign(new Error(message), { code: "E_STORAGE_RESTORE_INVALID" });
const hash = value => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const independentInventory = inventory => ({ files: inventory.files.filter(file => file.path !== ".forgeloop/state.sqlite"), directories: inventory.directories });

export function assertOutgoingRebuildIntent(intent) {
  const rebuild = intent.outgoingRebuild;
  if (!rebuild) return;
  const previous = rebuild.previous ?? [];
  if (!MAINTENANCE_OWNER_ID.test(rebuild.historyId ?? "") || !hash(rebuild.manifestFingerprint)
    || !["RETAINING", "RETAINED"].includes(rebuild.phase) || !Array.isArray(previous) || previous.length > 63
    || previous.some(record => !MAINTENANCE_OWNER_ID.test(record?.historyId ?? "") || !hash(record.manifestFingerprint))
    || new Set([rebuild.historyId, ...previous.map(record => record.historyId)]).size !== previous.length + 1) throw invalid("Outgoing preparation retention intent is invalid");
}

async function verifyRetainedHistory(root, rebuild, operationId) {
  for (const record of [...(rebuild.previous ?? []), rebuild]) {
    const manifest = await readStorageMetadataJson(await assertSafePath(root, `outgoing-history/${record.historyId}`), "replacement-manifest.json");
    if (manifest.operationId !== operationId || canonicalFingerprint(manifest) !== record.manifestFingerprint) throw invalid("Retained outgoing preparation manifest changed");
  }
}

async function verifyPreparationBaseline(target, manifest, packageRoot) {
  const baseline = manifest?.preparationBaseline;
  if (manifest?.schemaVersion !== 2 || manifest.kind !== "ACTIVE_PROJECT_REPLACEMENT_OUTGOING" || manifest.status !== "PREPARING"
    || !MAINTENANCE_OWNER_ID.test(manifest.ownerId ?? "") || !hash(baseline?.logicalFingerprint) || !hash(baseline?.inventoryFingerprint)
    || canonicalFingerprint(baseline.inventory ?? null) !== baseline.inventoryFingerprint
    || canonicalFingerprint(await readStorageVersionMarker(target)) !== canonicalFingerprint(manifest.marker)) throw invalid("Interrupted outgoing preparation has no matching active baseline");
  await assertOwnedStorageMaintenance(target);
  await assertStorageMaintenanceOwnerContinuity(target, { expectedOwnerId: await assertOwnedStorageMaintenance(target), recordedOwnerId: manifest.ownerId });
  const db = openStorageDatabase(await assertSafePath(target, ".forgeloop/state.sqlite"), { allowSchemaUpgrade: false });
  try {
    if (!checkStorageIntegrity(db).ok || canonicalFingerprint(logicalSnapshot(db)) !== baseline.logicalFingerprint
      || db.prepare("SELECT 1 FROM task_artifacts WHERE kind = 'operationLease' LIMIT 1").get()) throw invalid("Outgoing authority changed during interrupted preparation");
    await validateMigrationDatabase(db, { target, packageRoot });
    const checkpoint = db.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get();
    if (checkpoint.busy !== 0 || checkpoint.log !== 0) throw invalid("Outgoing preparation recovery still has active readers");
  } finally { db.close(); }
  await assertReplacementConnectionsClosed(target);
  const current = await inventoryStorageRoots(target, REPLACEMENT_ACTIVE_ROOTS);
  if (canonicalFingerprint(independentInventory(current)) !== canonicalFingerprint(independentInventory(baseline.inventory))) throw invalid("Outgoing attachments or marker changed during preparation recovery");
}

async function reconcileOutgoingAllocation(target, root, outgoing, intent, packageRoot) {
  const present = await restorePathExists(root, "outgoing");
  if (present && await readStorageMetadataJson(outgoing, "replacement-manifest.json", { optional: true })) return;
  const allocated = await readStorageMetadataJson(root, "replacement-manifest.json", { optional: true });
  if (!allocated) {
    if (present) throw invalid("Outgoing allocation has no recorded preparation baseline");
    return;
  }
  if (allocated.operationId !== intent.operationId) throw invalid("Outgoing allocation belongs to a different operation");
  if (!present && intent.outgoingRebuild?.manifestFingerprint === canonicalFingerprint(allocated)) return;
  await verifyPreparationBaseline(target, allocated, packageRoot);
  await assertOwnedStorageMaintenance(target);
  if (!present) { await mkdir(outgoing); await syncDirectory(root); }
  // Reconstruct only missing metadata from its preallocation record; retained
  // partial files remain in place and are moved to history by the caller.
  await writeFileAtomic(await assertSafePath(outgoing, "replacement-manifest.json"), `${JSON.stringify(allocated, null, 2)}\n`);
}

/** Retain incomplete outgoing evidence before any new backup attempt. */
export async function ensurePreparedOutgoingReplacement(target, root, intent, { writersQuiesced, packageRoot } = {}) {
  await assertOwnedStorageMaintenance(target);
  assertOutgoingRebuildIntent(intent);
  const outgoing = await assertSafePath(root, "outgoing");
  if (!intent.outgoingRebuild || intent.outgoingRebuild.phase === "RETAINED") {
    await reconcileOutgoingAllocation(target, root, outgoing, intent, packageRoot);
  }
  const persist = async () => { await assertOwnedStorageMaintenance(target); await writeFileAtomic(await assertSafePath(root, "replacement-intent.json"), `${JSON.stringify(intent, null, 2)}\n`); };
  if (!intent.outgoingRebuild) {
    if (!await restorePathExists(root, "outgoing")) return prepareActiveStorageReplacement(target, intent.operationId, { writersQuiesced, packageRoot });
    const manifest = await readStorageMetadataJson(outgoing, "replacement-manifest.json");
    if (manifest?.status === "READY") return verifyPreparedActiveStorageReplacement(target, intent.operationId);
    if (manifest?.operationId !== intent.operationId) throw invalid("Interrupted outgoing preparation belongs to another operation");
    await verifyPreparationBaseline(target, manifest, packageRoot);
    intent.outgoingRebuild = { historyId: randomUUID(), phase: "RETAINING", manifestFingerprint: canonicalFingerprint(manifest) };
    await persist();
  }
  const rebuild = intent.outgoingRebuild;
  const history = await assertSafePath(root, `outgoing-history/${rebuild.historyId}`);
  if (rebuild.phase === "RETAINING") {
    const current = await restorePathExists(root, "outgoing");
    const retained = await restorePathExists(root, `outgoing-history/${rebuild.historyId}`);
    if (current === retained) throw invalid("Outgoing preparation retention has ambiguous membership");
    const manifest = await readStorageMetadataJson(current ? outgoing : history, "replacement-manifest.json");
    if (manifest.operationId !== intent.operationId || canonicalFingerprint(manifest) !== rebuild.manifestFingerprint) throw invalid("Retained outgoing preparation operation or manifest differs");
    await verifyPreparationBaseline(target, manifest, packageRoot);
    if (current) {
      await mkdir(await assertSafePath(root, "outgoing-history"), { recursive: true });
      await rename(outgoing, history);
      await syncDirectory(root);
      await syncDirectory(await assertSafePath(root, "outgoing-history"));
    }
    rebuild.phase = "RETAINED";
    await persist();
  }
  if (!await restorePathExists(root, `outgoing-history/${rebuild.historyId}`)) throw invalid("Outgoing preparation history is missing");
  await verifyRetainedHistory(root, rebuild, intent.operationId);
  if (await restorePathExists(root, "outgoing")) {
    const manifest = await readStorageMetadataJson(outgoing, "replacement-manifest.json");
    if (manifest?.status === "READY") return verifyPreparedActiveStorageReplacement(target, intent.operationId);
    if (manifest?.operationId !== intent.operationId) throw invalid("Interrupted rebuilt outgoing operation differs");
    await verifyPreparationBaseline(target, manifest, packageRoot);
    const previous = [...(rebuild.previous ?? []), { historyId: rebuild.historyId, manifestFingerprint: rebuild.manifestFingerprint }];
    intent.outgoingRebuild = { historyId: randomUUID(), phase: "RETAINING", manifestFingerprint: canonicalFingerprint(manifest), previous };
    assertOutgoingRebuildIntent(intent);
    await persist();
    return ensurePreparedOutgoingReplacement(target, root, intent, { writersQuiesced, packageRoot });
  }
  await verifyPreparationBaseline(target, await readStorageMetadataJson(history, "replacement-manifest.json"), packageRoot);
  return prepareActiveStorageReplacement(target, intent.operationId, { writersQuiesced, packageRoot });
}
