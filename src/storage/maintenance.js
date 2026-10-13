import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readdir, rename, rmdir, unlink } from "node:fs/promises";
import os from "node:os";
import { assertSafePath } from "../core/filesystem.js";
import { MAINTENANCE_OWNER_ID, readMaintenanceOwner } from "./maintenance-owner.js";
import { archiveMaintenanceOwner, claimMaintenanceHandoff, publishMaintenanceOwner } from "./maintenance-handoff.js";

const EXCLUSION = ".forgeloop/.storage-maintenance";
const EXCLUSION_STAGING_PREFIX = `${EXCLUSION}.staging-`;
// Single bounded retry for the Windows kill-to-observation race. Small enough
// to stay inside resume timeouts, long enough for the kernel to release the
// exited process handle. The retry re-reads the owner observation; it never
// converts an absent observation into a death proof.
const WINDOWS_OWNER_REQUERY_DELAY_MS = 250;
const active = new AsyncLocalStorage();

function busy(message) { return Object.assign(new Error(message), { code: "E_STORAGE_MAINTENANCE_IN_PROGRESS" }); }

// Readonly admission can inspect maintenance ownership without loading the
// filesystem durability kernel. Load it only when maintenance writes run.
async function syncDirectory(directory) {
  const durability = await import("./file-durability.js");
  return durability.syncDirectory(directory);
}

async function createOwner(extra = {}) {
  const owner = { schemaVersion: 1, ownerId: randomUUID(), pid: process.pid, hostname: os.hostname(), acquiredAt: new Date().toISOString(), ...extra };
  if (process.platform !== "win32") return owner;
  const {
    isWindowsProcessIncarnationToken,
    readWindowsProcessIncarnation,
    WINDOWS_PROCESS_INCARNATION_KIND,
    WINDOWS_PROCESS_INCARNATION_SCHEMA_VERSION,
  } = await import("./windows-process-incarnation.js");
  let observation;
  try { observation = await readWindowsProcessIncarnation(process.pid); } catch { observation = null; }
  if (!observation || observation.status !== "ALIVE" || observation.hasExited !== false || observation.pid !== process.pid) {
    throw busy("Windows process incarnation is unavailable; maintenance owner publication refused");
  }
  const processIncarnation = {
    kind: WINDOWS_PROCESS_INCARNATION_KIND,
    pid: observation.pid,
    schemaVersion: WINDOWS_PROCESS_INCARNATION_SCHEMA_VERSION,
    startTimeTicks: observation.startTimeTicks,
  };
  if (!isWindowsProcessIncarnationToken(processIncarnation, { pid: process.pid })) {
    throw busy("Windows process incarnation is malformed; maintenance owner publication refused");
  }
  owner.processIncarnation = processIncarnation;
  return owner;
}

async function runOwnedMaintenance(target, directory, ownerData, callback, { retainOnError = false } = {}, deadOwner = null) {
  const context = { directory, ownerId: ownerData.ownerId, active: true, releaseBlocked: false, deadOwner };
  let completed = false;
  try {
    const result = await active.run(context, callback);
    completed = true;
    return result;
  } finally {
    context.active = false;
    const retained = await readMaintenanceOwner(target);
    if (retained.value.ownerId !== ownerData.ownerId) throw busy("Maintenance owner changed; retained exclusion cannot be released");
    if ((completed || !retainOnError) && !context.releaseBlocked) {
      if (JSON.stringify((await readdir(directory)).sort()) !== JSON.stringify(["owner.json"])) throw busy("Unexpected maintenance entries require reconciliation");
      await unlink(await assertSafePath(target, `${EXCLUSION}/owner.json`));
      await rmdir(directory);
    }
  }
}

export async function assertStorageMaintenanceInactive(target) {
  const filename = await assertSafePath(target, EXCLUSION);
  try { await lstat(filename); }
  catch (error) { if (error.code === "ENOENT") return; throw error; }
  throw busy("Storage maintenance excludes ordinary commands; inspect and resume the retained maintenance operation");
}

/** Destructive cutover steps must join the exact live maintenance owner. */
export async function assertOwnedStorageMaintenance(target) {
  const directory = await assertSafePath(target, EXCLUSION);
  const owner = active.getStore();
  if (!owner?.active || owner.directory !== directory || (await readMaintenanceOwner(target)).value.ownerId !== owner.ownerId) {
    throw busy("Cutover requires the current owner-bound maintenance context");
  }
  return owner.ownerId;
}

/** Publication stages must retain admission exclusion even after a partial return. */
export async function retainStorageMaintenance(target) {
  await assertOwnedStorageMaintenance(target);
  active.getStore().releaseBlocked = true;
}

/** Call only after the owning publication validator accepts terminal state. */
export async function allowStorageMaintenanceRelease(target) {
  await assertOwnedStorageMaintenance(target);
  active.getStore().releaseBlocked = false;
}

async function removeUnpublishedExclusionStage(target, relativePath) {
  let directory;
  try { directory = await assertSafePath(target, relativePath); }
  catch (error) { if (error.code === "ENOENT") return; throw error; }
  let entries;
  try { entries = await readdir(directory); }
  catch (error) { if (error.code === "ENOENT") return; throw error; }
  if (entries.some(entry => entry !== "owner.json")) return;
  if (entries.includes("owner.json")) {
    const ownerPath = await assertSafePath(target, `${relativePath}/owner.json`);
    const info = await lstat(ownerPath);
    if (!info.isFile()) return;
    await unlink(ownerPath);
  }
  await rmdir(directory);
  await syncDirectory(await assertSafePath(target, ".forgeloop"));
}

/**
 * Persist the owner before atomically publishing the exclusion directory.
 * `beforePublish` is an internal fault-injection seam used by crash tests.
 */
export async function publishMaintenanceExclusion(target, ownerData, { beforePublish } = {}) {
  const relativeStage = `${EXCLUSION_STAGING_PREFIX}${randomUUID()}`;
  const stage = await assertSafePath(target, relativeStage);
  const destination = await assertSafePath(target, EXCLUSION);
  await mkdir(stage, { mode: 0o700 });
  try {
    const ownerPath = await assertSafePath(target, `${relativeStage}/owner.json`);
    const owner = await open(ownerPath, "wx", 0o600);
    try {
      await owner.writeFile(`${JSON.stringify(ownerData)}\n`);
      await owner.sync();
    } finally { await owner.close(); }
    await syncDirectory(stage);
    await syncDirectory(await assertSafePath(target, ".forgeloop"));
    if (beforePublish) await beforePublish({ stage, destination });
    try {
      await lstat(destination);
      throw busy("A retained storage maintenance operation requires reconciliation");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    try { await rename(stage, destination); }
    catch (error) {
      try {
        await lstat(destination);
        throw busy("A retained storage maintenance operation requires reconciliation");
      } catch (inspectionError) {
        if (inspectionError.code !== "ENOENT") throw inspectionError;
        throw error;
      }
    }
    await syncDirectory(await assertSafePath(target, ".forgeloop"));
    return destination;
  } catch (error) {
    await removeUnpublishedExclusionStage(target, relativeStage).catch(() => {});
    throw error;
  }
}

/** Excludes version-aware clients. Legacy binaries still require operator exclusion. */
export async function withStorageMaintenance(target, callback, options = {}) {
  const directory = await assertSafePath(target, EXCLUSION);
  const inherited = active.getStore();
  if (inherited?.directory === directory) {
    if (!inherited.active) throw busy("Maintenance context already closed");
    if ((await readMaintenanceOwner(target)).value.ownerId !== inherited.ownerId) throw busy("Maintenance owner changed");
    return callback();
  }
  const ownerData = await createOwner();
  await publishMaintenanceExclusion(target, ownerData);
  return runOwnedMaintenance(target, directory, ownerData, callback, options);
}

async function assertLocalOwnerDead(owner) {
  if (owner.hostname !== os.hostname()) throw busy("Remote or unbound owner cannot be safely resumed on this host");
  if (owner.processIncarnation !== undefined) {
    if (process.platform !== "win32") throw busy("Maintenance owner process incarnation is unsupported or malformed");
    const { isWindowsProcessIncarnationToken, readWindowsProcessIncarnation } =
      await import("./windows-process-incarnation.js");
    if (!isWindowsProcessIncarnationToken(owner.processIncarnation, { pid: owner.pid })) {
      throw busy("Maintenance owner process incarnation is unsupported or malformed");
    }
    for (let attempt = 0; ; attempt += 1) {
      let observation;
      try { observation = await readWindowsProcessIncarnation(owner.pid); } catch { observation = null; }
      if (observation && observation.pid === owner.pid) {
        if (observation.status === "ALIVE" && observation.hasExited === false) {
          if (observation.startTimeTicks === owner.processIncarnation.startTimeTicks) throw busy("Maintenance owner process is still present; resume refused");
          return;
        }
        // Exit and kernel-absent observations carry their own proof: HasExited
        // with matching ticks, or GetProcessById rejecting the PID entirely.
        if (observation.status === "EXITED" || observation.status === "NOT_FOUND") return;
      }
      // A failed query (null/UNAVAILABLE) is ambiguous: it neither proves the
      // process died nor that it lives. One bounded re-query rides out the
      // transient kill-to-handle-lookup race; a second failure stays closed.
      if (attempt >= 1) throw busy("Owner process identity is unavailable; resume refused");
      await new Promise(resolve => setTimeout(resolve, WINDOWS_OWNER_REQUERY_DELAY_MS));
    }
  }
  try { process.kill(owner.pid, 0); }
  catch (error) { if (error.code === "ESRCH") return; throw busy("Owner liveness is unavailable; resume refused"); }
  throw busy("Maintenance owner process is still present; resume refused");
}

/** Follow only the exact persisted adoption chain; never scan or infer owners. */
export async function assertStorageMaintenanceOwnerContinuity(target, { expectedOwnerId, recordedOwnerId } = {}) {
  if (!MAINTENANCE_OWNER_ID.test(expectedOwnerId ?? "") || !MAINTENANCE_OWNER_ID.test(recordedOwnerId ?? "")) throw busy("Owner continuity requires exact identities");
  const context = active.getStore();
  const proof = context?.active && context.ownerId === expectedOwnerId
    && context.directory === await assertSafePath(target, EXCLUSION) ? context.deadOwner : null;
  let owner = (await readMaintenanceOwner(target)).value;
  if (owner.ownerId !== expectedOwnerId) throw busy("Current maintenance owner differs from continuity request");
  const visited = new Set();
  for (let depth = 0; depth < 64; depth += 1) {
    if (owner.hostname !== os.hostname() || visited.has(owner.ownerId)) throw busy("Maintenance owner history is remote or cyclic");
    visited.add(owner.ownerId);
    if (owner.ownerId === recordedOwnerId) return;
    if (!MAINTENANCE_OWNER_ID.test(owner.resumedFrom ?? "")) throw busy("Recorded operation owner is outside maintenance adoption history");
    const previousRelative = `.forgeloop/storage-maintenance-history/${owner.resumedFrom}.json`;
    const previous = await readMaintenanceOwner(target, previousRelative);
    if (previous.value.ownerId !== owner.resumedFrom) throw busy("Maintenance owner history identity differs from its pathname");
    if (context?.active && proof?.ownerId === previous.value.ownerId) {
      // Adoption already observed this exact owner's death. A later process
      // may reuse its PID; only unchanged bytes in this live scope retain proof.
      if (previous.text !== proof.text) throw busy("Verified dead owner archive changed");
    } else {
      await assertLocalOwnerDead(previous.value);
      const rechecked = await readMaintenanceOwner(target, previousRelative);
      if (rechecked.text !== previous.text || rechecked.value.ownerId !== previous.value.ownerId) {
        throw busy("Verified dead owner archive changed during liveness verification");
      }
      owner = rechecked.value;
      continue;
    }
    owner = previous.value;
  }
  throw busy("Maintenance owner history exceeds bounded recovery depth");
}

async function archiveUnboundLegacyHandoff(target, expectedOwnerId) {
  const relative = `${EXCLUSION}/handoff`;
  const source = await assertSafePath(target, relative);
  let info;
  try { info = await lstat(source); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
  if (!info.isDirectory()) throw busy("Unbound legacy handoff is not a directory; reconciliation refused");
  const entries = (await readdir(source, { withFileTypes: true }))
    .map(entry => ({ name: entry.name, type: entry.isDirectory() ? "directory" : entry.isFile() ? "file" : entry.isSymbolicLink() ? "symlink" : "other" }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const root = await assertSafePath(target, ".forgeloop/storage-maintenance-history/unbound-handoffs");
  await mkdir(root, { recursive: true });
  const archivedName = `${expectedOwnerId}-${randomUUID()}`;
  const archive = await assertSafePath(target, `.forgeloop/storage-maintenance-history/unbound-handoffs/${archivedName}`);
  const receiptPath = await assertSafePath(target, `.forgeloop/storage-maintenance-history/unbound-handoffs/${archivedName}.json`);
  try { await lstat(archive); throw busy("Legacy handoff archive identity already exists"); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  await rename(source, archive);
  const durability = await import("./file-durability.js");
  await durability.syncDirectory(await assertSafePath(target, EXCLUSION));
  await durability.syncDirectory(root);
  const receipt = {
    schemaVersion: 1,
    kind: "UNBOUND_LEGACY_MAINTENANCE_HANDOFF_ARCHIVE",
    previousOwnerId: expectedOwnerId,
    sourcePath: relative,
    archivePath: `.forgeloop/storage-maintenance-history/unbound-handoffs/${archivedName}`,
    archivedAt: new Date().toISOString(),
    entries,
    interpretation: "Opaque legacy bytes preserved by atomic rename; no ownership or liveness is inferred from the archived contents.",
  };
  const handle = await open(receiptPath, "wx", 0o600);
  try { await handle.writeFile(`${JSON.stringify(receipt)}\n`); await handle.sync(); }
  finally { await handle.close(); }
  await durability.syncDirectory(root);
  return receipt;
}

/** Adopt a retained dead local owner without dropping the exclusion. */
export async function resumeStorageMaintenance(target, { expectedOwnerId, writersQuiesced = false, acknowledgeUnboundHandoff = false } = {}, callback) {
  if (writersQuiesced !== true) throw Object.assign(new Error("Stop and exclude all writers before maintenance resume"), { code: "E_STORAGE_MIGRATION_QUIESCENCE_REQUIRED" });
  if (typeof callback !== "function" || typeof expectedOwnerId !== "string" || !MAINTENANCE_OWNER_ID.test(expectedOwnerId)) throw busy("Resume requires an exact owner identity and recovery operation");
  const previous = await readMaintenanceOwner(target);
  if (previous.value.ownerId !== expectedOwnerId) throw busy("Retained owner differs from the requested resume identity");
  await assertLocalOwnerDead(previous.value);
  const directory = await assertSafePath(target, EXCLUSION);
  let handoffPresent = false;
  try { await lstat(await assertSafePath(target, `${EXCLUSION}/handoff`)); handoffPresent = true; }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  if (handoffPresent && acknowledgeUnboundHandoff !== true) throw busy("Unbound legacy handoff requires explicit --reconcile-unbound-handoff acknowledgement");
  if (handoffPresent) await archiveUnboundLegacyHandoff(target, expectedOwnerId);
  const ownerData = await createOwner({ resumedFrom: expectedOwnerId });
  const rechecked = await readMaintenanceOwner(target);
  if (rechecked.text !== previous.text) throw busy("Owner changed during resume preparation");
  await assertLocalOwnerDead(rechecked.value);
  await archiveMaintenanceOwner(target, previous);
  if ((await readMaintenanceOwner(target)).text !== previous.text) throw busy("Owner changed during archival");
  const claimedOwner = await claimMaintenanceHandoff(target, previous, ownerData, assertLocalOwnerDead);
  if ((await readMaintenanceOwner(target)).text !== previous.text) throw busy("Owner changed during handoff");
  await publishMaintenanceOwner(target, claimedOwner);
  // Recovery failure retains this new owner's marker; later work must inspect
  // the operation state instead of reopening normal commands over partial work.
  return runOwnedMaintenance(target, directory, ownerData, callback, { retainOnError: true }, {
    ownerId: previous.value.ownerId, text: previous.text,
  });
}
