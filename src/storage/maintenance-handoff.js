import { link, mkdir, open, rename } from "node:fs/promises";
import { createHash } from "node:crypto";
import { assertSafePath } from "../core/filesystem.js";
import { MAINTENANCE_OWNER_ID, readMaintenanceOwner } from "./maintenance-owner.js";
import { isWindowsProcessIncarnationToken, readWindowsProcessIncarnation } from "./windows-process-incarnation.js";

const HISTORY = ".forgeloop/storage-maintenance-history";
const busy = message => Object.assign(new Error(message), { code: "E_STORAGE_MAINTENANCE_IN_PROGRESS" });

async function assertPublishableOwner(ownerData) {
  if (process.platform !== "win32") return;
  if (ownerData.pid !== process.pid || !isWindowsProcessIncarnationToken(ownerData.processIncarnation, { pid: process.pid })) {
    throw busy("Windows process incarnation is missing or malformed; publication refused");
  }
  let observation;
  try { observation = await readWindowsProcessIncarnation(process.pid); } catch { observation = null; }
  if (!observation || observation.status !== "ALIVE" || observation.hasExited !== false
    || observation.startTimeTicks !== ownerData.processIncarnation.startTimeTicks) {
    throw busy("Windows process incarnation changed or is unavailable; publication refused");
  }
}

// Admission inspects ownership without running durable handoff writes.
// Load the shared filesystem kernel only when a handoff actually needs it.
async function syncDirectory(directory) {
  const durability = await import("./file-durability.js");
  return durability.syncDirectory(directory);
}

async function optionalClaim(target, relative) {
  try {
    const envelope = await readMaintenanceOwner(target, relative);
    return { relative, ...envelope };
  }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

async function retainedSuccessor(target, predecessor, relative) {
  const scoped = await optionalClaim(target, relative);
  const legacy = await optionalClaim(target, `${HISTORY}/handoffs/${predecessor}.json`);
  if (scoped && legacy) throw busy("Maintenance continuation has conflicting path identities");
  return scoped ?? legacy;
}

/** Each original owner has an isolated immutable dead-claimant chain. */
export async function claimMaintenanceHandoff(target, previous, ownerData, assertDead) {
  const sourceSha256 = createHash("sha256").update(previous.text).digest("hex");
  const claimedOwner = { ...ownerData, handoffSourceSha256: sourceSha256 };
  const roots = {};
  for (const name of ["handoff-intents", "handoffs"]) {
    roots[name] = await assertSafePath(target, `${HISTORY}/${name}`);
    await mkdir(roots[name], { recursive: true });
  }
  await syncDirectory(await assertSafePath(target, HISTORY));
  await syncDirectory(await assertSafePath(target, ".forgeloop"));
  const intent = await assertSafePath(target, `${HISTORY}/handoff-intents/${ownerData.ownerId}.json`);
  const handle = await open(intent, "wx", 0o600);
  try { await handle.writeFile(`${JSON.stringify(claimedOwner)}\n`); await handle.sync(); }
  finally { await handle.close(); }
  await syncDirectory(roots["handoff-intents"]);
  let predecessor = previous.value.ownerId;
  const visited = new Set();
  for (let depth = 0; depth < 64; depth += 1) {
    if (visited.has(predecessor)) throw busy("Maintenance handoff history is cyclic");
    visited.add(predecessor);
    const relative = depth === 0
      ? `${HISTORY}/handoffs/${predecessor}.json`
      : `${HISTORY}/handoffs/${previous.value.ownerId}--${predecessor}.json`;
    // Honor existing flat continuation records, including live claimants, but
    // never create a continuation at another owner's future root pathname.
    let claimant = depth === 0 ? null : await retainedSuccessor(target, predecessor, relative);
    if (!claimant) {
      const destination = await assertSafePath(target, relative);
      try {
        await link(intent, destination);
        await syncDirectory(roots.handoffs);
        return claimedOwner;
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
      }
      const envelope = await readMaintenanceOwner(target, relative);
      claimant = { relative, ...envelope };
    }
    if (!MAINTENANCE_OWNER_ID.test(claimant.value.ownerId) || claimant.value.resumedFrom !== previous.value.ownerId || claimant.value.handoffSourceSha256 !== sourceSha256) {
      throw busy("Maintenance handoff differs from the requested owner");
    }
    await assertDead(claimant.value);
    const rechecked = await readMaintenanceOwner(target, claimant.relative);
    if (rechecked.text !== claimant.text || rechecked.value.ownerId !== claimant.value.ownerId) {
      throw busy("Maintenance handoff claimant changed during liveness verification");
    }
    predecessor = rechecked.value.ownerId;
  }
  throw busy("Maintenance handoff history exceeds bounded recovery depth");
}

/** Link the already durable marker; an interrupted archive cannot be a partial file. */
export async function archiveMaintenanceOwner(target, previous) {
  const root = await assertSafePath(target, HISTORY);
  await mkdir(root, { recursive: true });
  await syncDirectory(await assertSafePath(target, ".forgeloop"));
  const archived = `${HISTORY}/${previous.value.ownerId}.json`;
  try {
    await link(await assertSafePath(target, ".forgeloop/.storage-maintenance/owner.json"), await assertSafePath(target, archived));
    await syncDirectory(root);
  } catch (error) { if (error.code !== "EEXIST") throw error; }
  if ((await readMaintenanceOwner(target, archived)).text !== previous.text) {
    throw busy("Retained owner archive differs from the owner being resumed");
  }
}

/** Promotion scratch stays outside the exclusion and every byte comes from the durable claim. */
export async function publishMaintenanceOwner(target, ownerData) {
  await assertPublishableOwner(ownerData);
  const root = await assertSafePath(target, `${HISTORY}/handoff-promotions`);
  await mkdir(root, { recursive: true });
  await syncDirectory(await assertSafePath(target, HISTORY));
  const source = await assertSafePath(target, `${HISTORY}/handoff-intents/${ownerData.ownerId}.json`);
  const promotion = await assertSafePath(target, `${HISTORY}/handoff-promotions/${ownerData.ownerId}.json`);
  if ((await readMaintenanceOwner(target, `${HISTORY}/handoff-intents/${ownerData.ownerId}.json`)).text !== `${JSON.stringify(ownerData)}\n`) {
    throw busy("Maintenance promotion differs from its durable claim");
  }
  await link(source, promotion);
  await syncDirectory(root);
  await rename(promotion, await assertSafePath(target, ".forgeloop/.storage-maintenance/owner.json"));
  await syncDirectory(root);
  await syncDirectory(await assertSafePath(target, ".forgeloop/.storage-maintenance"));
}
