import { lstat, open } from "node:fs/promises";
import { assertSafePath, writeFileAtomic } from "../core/filesystem.js";
import { assertOwnedStorageMaintenance } from "./maintenance.js";

const MARKER = ".forgeloop/storage-version.json";
function invalid(message) { return Object.assign(new Error(message), { code: "E_STORAGE_VERSION_MARKER_INVALID" }); }

export function validateStorageVersionMarker(value) {
  if (!value || value.schemaVersion !== 1 || value.storageFormat !== "sqlite" || value.storageVersion !== 1
    || !Number.isSafeInteger(value.databaseSchemaVersion) || value.databaseSchemaVersion < 1
    || !["CUTOVER_PENDING", "ACTIVE"].includes(value.phase)
    || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value.operationId ?? "")
    || !/^[a-f0-9]{64}$/.test(value.sourceInventoryFingerprint ?? "")) throw invalid("Storage marker is incomplete or unsupported");
  return value;
}

export async function readStorageVersionMarker(target) {
  const filename = await assertSafePath(target, MARKER);
  let bytes;
  try {
    if (!(await lstat(filename)).isFile()) throw invalid("Storage marker must be a regular file");
    const file = await open(filename, "r");
    try {
      if ((await file.stat()).size > 65536) throw invalid("Storage marker exceeds its byte limit");
      bytes = await file.readFile();
    } finally { await file.close(); }
  } catch (error) { if (error.code === "ENOENT") return null; throw error; }
  if (bytes.length > 65536 || !Buffer.from(bytes.toString("utf8")).equals(bytes)) throw invalid("Storage marker encoding or size is invalid");
  let value;
  try { value = JSON.parse(bytes.toString("utf8")); } catch { throw invalid("Storage marker is not valid JSON"); }
  return validateStorageVersionMarker(value);
}

/** Exclusive pending marker; activation must be a separately validated step. */
export async function writePendingStorageVersionMarker(target, marker) {
  await assertOwnedStorageMaintenance(target);
  const filename = await assertSafePath(target, MARKER);
  const expected = validateStorageVersionMarker({ schemaVersion: 1, storageFormat: "sqlite", storageVersion: 1, phase: "CUTOVER_PENDING",
    databaseSchemaVersion: marker.databaseSchemaVersion, operationId: marker.operationId, sourceInventoryFingerprint: marker.sourceInventoryFingerprint });
  const existing = await readStorageVersionMarker(target);
  if (existing) {
    if (JSON.stringify(existing) !== JSON.stringify(expected)) throw invalid("Existing storage marker differs from this cutover operation");
    return existing;
  }
  const file = await open(filename, "wx", 0o600);
  try { await file.writeFile(`${JSON.stringify(expected)}\n`); await file.sync(); } finally { await file.close(); }
  try {
    const directory = await open(await assertSafePath(target, ".forgeloop"), "r");
    try { await directory.sync(); } finally { await directory.close(); }
  } catch (error) { if (!["EINVAL", "EPERM", "EISDIR", "ENOTSUP", "UNKNOWN"].includes(error.code)) throw error; }
  return readStorageVersionMarker(target);
}

/** Called only after the cutover service validates its published database. */
export async function activateStorageVersionMarker(target, expected) {
  await assertOwnedStorageMaintenance(target);
  const current = await readStorageVersionMarker(target);
  if (!current || current.phase !== "CUTOVER_PENDING" || current.operationId !== expected.operationId
    || current.sourceInventoryFingerprint !== expected.sourceInventoryFingerprint
    || current.databaseSchemaVersion !== expected.databaseSchemaVersion) throw invalid("Pending marker does not belong to this validated activation");
  const active = { ...current, phase: "ACTIVE" };
  await writeFileAtomic(await assertSafePath(target, MARKER), `${JSON.stringify(active)}\n`);
  return active;
}
