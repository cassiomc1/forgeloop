import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readdir, rmdir, unlink } from "node:fs/promises";
import os from "node:os";
import { assertSafePath } from "../core/filesystem.js";
import { MAINTENANCE_OWNER_ID, readMaintenanceOwner } from "./maintenance-owner.js";
import { archiveMaintenanceOwner, claimMaintenanceHandoff, publishMaintenanceOwner } from "./maintenance-handoff.js";
import {
  isWindowsProcessIncarnationToken,
  readWindowsProcessIncarnation,
  WINDOWS_PROCESS_INCARNATION_KIND,
  WINDOWS_PROCESS_INCARNATION_SCHEMA_VERSION,
} from "./windows-process-incarnation.js";

const EXCLUSION = ".forgeloop/.storage-maintenance";
const active = new AsyncLocalStorage();

function busy(message) { return Object.assign(new Error(message), { code: "E_STORAGE_MAINTENANCE_IN_PROGRESS" }); }

async function createOwner(extra = {}) {
  const owner = { schemaVersion: 1, ownerId: randomUUID(), pid: process.pid, hostname: os.hostname(), acquiredAt: new Date().toISOString(), ...extra };
  if (process.platform !== "win32") return owner;
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
  try { await mkdir(directory); }
  catch (error) { if (error.code === "EEXIST") throw busy("A retained storage maintenance operation requires reconciliation"); throw error; }
  const ownerPath = await assertSafePath(target, `${EXCLUSION}/owner.json`);
  const owner = await open(ownerPath, "wx", 0o600);
  try {
    await owner.writeFile(`${JSON.stringify(ownerData)}\n`);
    await owner.sync();
  } finally { await owner.close(); }
  return runOwnedMaintenance(target, directory, ownerData, callback, options);
}

function validatePersistedOwnerIncarnation(owner) {
  if (owner.processIncarnation === undefined) return null;
  if (process.platform !== "win32" || !isWindowsProcessIncarnationToken(owner.processIncarnation, { pid: owner.pid })) {
    throw busy("Maintenance owner process incarnation is unsupported or malformed");
  }
  return owner.processIncarnation;
}

async function assertLocalOwnerDead(owner) {
  if (owner.hostname !== os.hostname()) throw busy("Remote or unbound owner cannot be safely resumed on this host");
  const processIncarnation = validatePersistedOwnerIncarnation(owner);
  if (processIncarnation) {
    let observation;
    try { observation = await readWindowsProcessIncarnation(owner.pid); } catch { observation = null; }
    if (!observation || observation.pid !== owner.pid) throw busy("Owner process identity is unavailable; resume refused");
    if (observation.status === "ALIVE" && observation.hasExited === false) {
      if (observation.startTimeTicks === processIncarnation.startTimeTicks) throw busy("Maintenance owner process is still present; resume refused");
      return;
    }
    if (observation.status === "EXITED" || observation.status === "NOT_FOUND") return;
    throw busy("Owner process identity is unavailable; resume refused");
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

/** Adopt a retained dead local owner without dropping the exclusion. */
export async function resumeStorageMaintenance(target, { expectedOwnerId, writersQuiesced = false } = {}, callback) {
  if (writersQuiesced !== true) throw Object.assign(new Error("Stop and exclude all writers before maintenance resume"), { code: "E_STORAGE_MIGRATION_QUIESCENCE_REQUIRED" });
  if (typeof callback !== "function" || typeof expectedOwnerId !== "string" || !MAINTENANCE_OWNER_ID.test(expectedOwnerId)) throw busy("Resume requires an exact owner identity and recovery operation");
  const previous = await readMaintenanceOwner(target);
  if (previous.value.ownerId !== expectedOwnerId) throw busy("Retained owner differs from the requested resume identity");
  await assertLocalOwnerDead(previous.value);
  const directory = await assertSafePath(target, EXCLUSION);
  const handoff = await assertSafePath(target, `${EXCLUSION}/handoff`);
  try {
    await lstat(handoff);
    throw busy("Unbound legacy handoff requires reconciliation");
  } catch (error) { if (error.code !== "ENOENT") throw error; }
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
