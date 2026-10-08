import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { assertSafePath, assertRegularProjectFileIdentity, isPathWithin, realpathWithTransientWindowsRetry } from "../core/filesystem.js";

export const MAINTENANCE_OWNER_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;

export async function readMaintenanceOwner(target, relativePath = ".forgeloop/.storage-maintenance/owner.json") {
  const filename = await assertSafePath(target, relativePath);
  const invalid = () => Object.assign(new Error("Maintenance owner identity is malformed or unsupported"), { code: "E_STORAGE_MAINTENANCE_OWNER_INVALID" });
  const root = await realpathWithTransientWindowsRetry(target);
  const observed = await lstat(filename, { bigint: true });
  if (!observed.isFile() || !isPathWithin(root, await realpathWithTransientWindowsRetry(filename))) throw invalid();
  let handle;
  try { handle = await open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)); }
  catch (error) { if (error.code === "ELOOP") throw invalid(); throw error; }
  try {
    await assertRegularProjectFileIdentity(handle, filename, observed, root, invalid);
    const buffer = Buffer.alloc(65537);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > 65536) throw invalid();
    const text = buffer.subarray(0, bytesRead).toString("utf8");
    if (!Buffer.from(text, "utf8").equals(buffer.subarray(0, bytesRead))) throw invalid();
    let value;
    try { value = JSON.parse(text); } catch { throw invalid(); }
    if (!value || typeof value !== "object" || Array.isArray(value)
      || value.schemaVersion !== 1 || typeof value.ownerId !== "string" || !MAINTENANCE_OWNER_ID.test(value.ownerId)
      || !Number.isInteger(value.pid) || value.pid < 1
      || typeof value.acquiredAt !== "string" || !Number.isFinite(Date.parse(value.acquiredAt))
      || (value.hostname !== undefined && (typeof value.hostname !== "string" || !value.hostname || value.hostname.length > 255))) throw invalid();
    return { value, text };
  } finally { await handle.close(); }
}
