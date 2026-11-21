import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { assertSafePath, assertRegularProjectFileIdentity, isPathWithin, realpathWithTransientWindowsRetry } from "../core/filesystem.js";

export const MAINTENANCE_OWNER_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;

async function readOwnerBytes(handle) {
    const buffer = Buffer.alloc(65537);
    let bytesRead = 0;
    while (bytesRead < buffer.length) {
      const result = await handle.read(buffer, bytesRead, buffer.length - bytesRead, bytesRead);
      if (result.bytesRead === 0) break;
      bytesRead += result.bytesRead;
    }
  return buffer.subarray(0, bytesRead);
}

const OWNER_READ_ATTEMPTS = 3;
const replacedSignal = Symbol("maintenance owner replaced");

function parseOwner(bytes, invalid) {
  if (bytes.length > 65536) throw invalid();
  const text = bytes.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(bytes)) throw invalid();
  let value;
  try { value = JSON.parse(text); } catch { throw invalid(); }
  if (!value || typeof value !== "object" || Array.isArray(value)
    || value.schemaVersion !== 1 || typeof value.ownerId !== "string" || !MAINTENANCE_OWNER_ID.test(value.ownerId)
    || !Number.isInteger(value.pid) || value.pid < 1
    || typeof value.acquiredAt !== "string" || !Number.isFinite(Date.parse(value.acquiredAt))
    || (value.hostname !== undefined && (typeof value.hostname !== "string" || !value.hostname || value.hostname.length > 255))) throw invalid();
  return { value, text };
}

// True only when the path now names a different regular file inside the root:
// an atomic rename by a concurrent owner, which a fresh read resolves.
async function replacedByRegularFile(filename, observed, root) {
  let current;
  try { current = await lstat(filename, { bigint: true }); } catch { return false; }
  return current.isFile() && !current.isSymbolicLink()
    && (current.dev !== observed.dev || current.ino !== observed.ino)
    && isPathWithin(root, await realpathWithTransientWindowsRetry(filename));
}

async function readOwnerOnce(filename, root, invalid, afterObserve) {
  const observed = await lstat(filename, { bigint: true });
  if (!observed.isFile() || !isPathWithin(root, await realpathWithTransientWindowsRetry(filename))) throw invalid();
  if (afterObserve) await afterObserve();
  let handle;
  try { handle = await open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)); }
  catch (error) { if (error.code === "ELOOP") throw invalid(); throw error; }
  try {
    const identityMismatch = () => Object.assign(invalid(), { [replacedSignal]: true });
    try { await assertRegularProjectFileIdentity(handle, filename, observed, root, identityMismatch); }
    catch (error) {
      if (error[replacedSignal] && await replacedByRegularFile(filename, observed, root)) throw error;
      if (error[replacedSignal]) throw invalid();
      throw error;
    }
    return parseOwner(await readOwnerBytes(handle), invalid);
  } finally { await handle.close(); }
}

/**
 * Reads a maintenance owner record. An owner atomically replaced by another
 * regular in-root file between observation and open is re-read (bounded);
 * every other identity failure, and a record that keeps changing, fails closed.
 * `afterObserve` is a test seam that runs between the lstat and the open.
 */
export async function readMaintenanceOwner(target, relativePath = ".forgeloop/.storage-maintenance/owner.json", { afterObserve } = {}) {
  const filename = await assertSafePath(target, relativePath);
  const invalid = () => Object.assign(new Error("Maintenance owner identity is malformed or unsupported"), { code: "E_STORAGE_MAINTENANCE_OWNER_INVALID" });
  const root = await realpathWithTransientWindowsRetry(target);
  for (let attempt = 1; ; attempt += 1) {
    try { return await readOwnerOnce(filename, root, invalid, afterObserve); }
    catch (error) {
      if (!error[replacedSignal]) throw error;
      if (attempt >= OWNER_READ_ATTEMPTS) throw invalid();
    }
  }
}
