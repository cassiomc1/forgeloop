import { assertSafePath, writeFileAtomic } from "../core/filesystem.js";
import { canonicalFingerprint } from "../core/artifacts.js";
import { MAINTENANCE_OWNER_ID, readMaintenanceOwner } from "./maintenance-owner.js";
import { assertOwnedStorageMaintenance, assertStorageMaintenanceOwnerContinuity } from "./maintenance.js";
import { readStorageMetadataJson } from "./metadata-json.js";
import { verifyPreparedActiveStorageReplacement } from "./restore-replacement.js";

const invalid = message => Object.assign(new Error(message), { code: "E_STORAGE_RESTORE_INVALID" });

/** Advance mutable ownership without changing independently retained outgoing evidence. */
export async function adoptPreparedReplacementOwner(target, operationId, { expectedOwnerId = null } = {}) {
  const ownerId = await assertOwnedStorageMaintenance(target);
  const retained = await verifyPreparedActiveStorageReplacement(target, operationId);
  const fingerprint = canonicalFingerprint(retained.manifest);
  const existing = await readStorageMetadataJson(retained.root, "owner-journal.json", { optional: true });
  if (existing && (existing.schemaVersion !== 1 || existing.kind !== "REPLACEMENT_OUTGOING_OWNER" || existing.operationId !== operationId
    || existing.outgoingFingerprint !== fingerprint || !MAINTENANCE_OWNER_ID.test(existing.ownerId ?? "")
    || (existing.resumedFrom !== undefined && !MAINTENANCE_OWNER_ID.test(existing.resumedFrom)))) throw invalid("Replacement outgoing ownership journal differs from retained evidence");
  const recorded = existing?.ownerId ?? retained.manifest.ownerId;
  if (recorded !== ownerId) {
    const owner = (await readMaintenanceOwner(target)).value;
    if (owner.resumedFrom !== expectedOwnerId) throw invalid("Replacement outgoing ownership requires exact recorded owner adoption");
    await assertStorageMaintenanceOwnerContinuity(target, { expectedOwnerId: ownerId, recordedOwnerId: recorded });
  }
  if (existing?.ownerId === ownerId) return existing;
  const journal = { schemaVersion: 1, kind: "REPLACEMENT_OUTGOING_OWNER", operationId, ownerId, outgoingFingerprint: fingerprint,
    ...(recorded !== ownerId ? { resumedFrom: recorded } : {}) };
  await assertOwnedStorageMaintenance(target);
  await writeFileAtomic(await assertSafePath(retained.root, "owner-journal.json"), `${JSON.stringify(journal, null, 2)}\n`);
  return journal;
}
