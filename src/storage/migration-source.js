import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { lstat, mkdir, open, opendir, readdir, rename } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { digestFile, syncDirectory } from "./file-durability.js";
import { assertSafePath, writeFileAtomic } from "../core/filesystem.js";
import { findIncompleteTransactions } from "../core/transaction.js";
import { assertOwnedStorageMaintenance, withStorageMaintenance } from "./maintenance.js";
import { readStorageMetadataJson, STORAGE_CATALOG_LIMITS } from "./metadata-json.js";
import { readStorageVersionMarker } from "./storage-marker.js";
import { LEGACY_TASK_ARTIFACT_PATHS } from "../core/task-paths.js";
import { assertNoLegacyOperationLocks } from "./legacy-maintenance-boundary.js";

export const LEGACY_SOURCE_ROOTS = Object.freeze([...new Set([
  ...Object.values(LEGACY_TASK_ARTIFACT_PATHS),
  ".forgeloop/task-state", ".forgeloop/events.ndjson.index.json",
  ".forgeloop/sessions", ".forgeloop/.txn", ".forgeloop/attachments",
  "export-index.json",
])]);
const SOURCE_ROOTS = LEGACY_SOURCE_ROOTS;

function failure(code, message) { return Object.assign(new Error(message), { code }); }

async function infoIfPresent(filename) {
  try { return await lstat(filename); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

async function syncDirectories(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) await syncDirectories(path.join(directory, entry.name));
  }
  await syncDirectory(directory);
}

function recordInventoryEntry(entries, value, budget) {
  const encoded = JSON.stringify(value);
  // Reserve pretty-print overhead and manifest status/error metadata as well
  // as encoded entry bytes. Refuse before retaining an oversized entry.
  const size = Buffer.byteLength(encoded) + 128;
  if (entries.length >= STORAGE_CATALOG_LIMITS.maxArrayLength || budget.bytes + size > STORAGE_CATALOG_LIMITS.maxBytes) {
    throw failure("E_STORAGE_MIGRATION_SOURCE_INVALID", "Source inventory exceeds the retained manifest limits");
  }
  budget.bytes += size;
  entries.push(value);
}

async function inventoryPath(target, relativePath, files, directories, budget) {
  const filename = await assertSafePath(target, relativePath);
  const info = await infoIfPresent(filename);
  if (!info) return;
  if (info.isDirectory()) {
    recordInventoryEntry(directories, relativePath, budget);
    for await (const entry of await opendir(filename)) {
      await inventoryPath(target, `${relativePath}/${entry.name}`, files, directories, budget);
    }
  } else if (info.isFile()) {
    recordInventoryEntry(files, { path: relativePath, ...await digestFile(filename, { includeSize: true }) }, budget);
  } else {
    throw failure("E_STORAGE_MIGRATION_SOURCE_INVALID", `Unsupported source entry: ${relativePath}`);
  }
}

/** Shared bounded inventory for fixed roots selected by storage maintenance. */
export async function inventoryStorageRoots(target, roots) {
  const files = [];
  const directories = [];
  const budget = { bytes: 4096 };
  for (const root of roots) await inventoryPath(target, root, files, directories, budget);
  return { files: files.sort((a, b) => a.path.localeCompare(b.path)), directories: directories.sort() };
}

export async function inventoryLegacySourceLayout(target) {
  return inventoryStorageRoots(target, SOURCE_ROOTS);
}

/** An archive is owned source storage: unexpected entries cannot be ignored. */
export async function inventoryLegacyArchiveLayout(target) {
  if (!(await infoIfPresent(target))) return { files: [], directories: [] };
  const root = await assertSafePath(target, ".");
  const files = [];
  const directories = [];
  const budget = { bytes: 4096 };
  for await (const entry of await opendir(root)) await inventoryPath(target, entry.name, files, directories, budget);
  const belongs = (name, directory) => SOURCE_ROOTS.some(source => name === source || name.startsWith(`${source}/`) || (directory && source.startsWith(`${name}/`)));
  if (files.some(file => !belongs(file.path, false)) || directories.some(directory => !belongs(directory, true))) {
    throw failure("E_STORAGE_MIGRATION_ARCHIVE_INVALID", "Archive contains entries outside the captured source roots");
  }
  return { files: files.sort((a, b) => a.path.localeCompare(b.path)), directories: directories.sort() };
}

export async function inventoryLegacySource(target) {
  return (await inventoryLegacySourceLayout(target)).files;
}

export async function verifyLegacySourceCapture(target, destination) {
  const retained = await assertSafePath(target, destination);
  const filename = await assertSafePath(retained, "source-manifest.json");
  const manifest = await readCaptureManifest(filename);
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)
    || manifest.schemaVersion !== 2 || manifest.kind !== "LEGACY_SOURCE_CAPTURE"
    || manifest.status !== "CAPTURED" || manifest.writersQuiesced !== true || !Array.isArray(manifest.files) || !Array.isArray(manifest.directories)) {
    throw failure("E_STORAGE_MIGRATION_CAPTURE_INVALID", "Capture manifest is incomplete or unsupported");
  }
  const source = await assertSafePath(retained, "source");
  if (JSON.stringify(await inventoryRetainedSource(source)) !== JSON.stringify({ files: manifest.files, directories: manifest.directories })) {
    throw failure("E_STORAGE_MIGRATION_CAPTURE_INVALID", "Retained source membership or digests disagree with capture manifest");
  }
  return { path: retained, source, manifest };
}

async function assertLegacyIdle(target) {
  if (await infoIfPresent(await assertSafePath(target, ".forgeloop/state.sqlite"))) {
    throw failure("E_STORAGE_MIGRATION_SOURCE_INVALID", "Legacy capture cannot replace SQLite snapshot backup");
  }
  await assertNoLegacyOperationLocks(target, { code: "E_STORAGE_MIGRATION_BUSY" });
  await assertSafePath(target, ".forgeloop/.txn");
  if ((await findIncompleteTransactions(target)).length) {
    throw failure("E_STORAGE_MIGRATION_SOURCE_INVALID", "Incomplete transactions require supported recovery before capture");
  }
}

/** Retained source capture only. Operator quiescence is necessary, not inferred. */
export async function captureLegacySource(target, destination, { writersQuiesced = false } = {}) {
  if (writersQuiesced !== true) throw failure("E_STORAGE_MIGRATION_QUIESCENCE_REQUIRED", "Stop and exclude all legacy writers before capture");
  return withStorageMaintenance(target, () => captureExcludedLegacySource(target, destination));
}

async function captureExcludedLegacySource(target, destination) {
  await assertLegacyIdle(target);
  const retained = await assertSafePath(target, destination);
  // Destination must not overlap any source root in either direction.
  const normalized = path.relative(path.resolve(target), path.resolve(retained)).split(path.sep).join("/");
  if (!normalized || SOURCE_ROOTS.some(root => normalized === root || normalized.startsWith(`${root}/`) || root.startsWith(`${normalized}/`))) {
    throw failure("E_STORAGE_MIGRATION_DESTINATION_INVALID", "Capture destination overlaps retained operational sources");
  }
  const inventory = await inventoryLegacySourceLayout(target);
  const { files, directories } = inventory;
  await mkdir(path.dirname(retained), { recursive: true });
  await mkdir(retained); // Exclusive: never replace or reuse an earlier capture.
  const source = path.join(retained, "source");
  await mkdir(source);
  const manifestPath = path.join(retained, "source-manifest.json");
  const manifest = { schemaVersion: 2, kind: "LEGACY_SOURCE_CAPTURE", status: "CAPTURING", writersQuiesced: true, files, directories };
  const persist = () => writeFileAtomic(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await persist();
  try {
    for (const directory of directories) await mkdir(await assertSafePath(source, directory), { recursive: true });
    for (const file of files) {
      await copyCapturedFile(target, source, file);
    }
    await assertLegacyIdle(target);
    if (JSON.stringify(await inventoryLegacySourceLayout(target)) !== JSON.stringify(inventory)) {
      throw failure("E_STORAGE_MIGRATION_SOURCE_CHANGED", "Source membership or bytes changed during capture");
    }
    await syncDirectories(source);
    manifest.status = "CAPTURED";
    await persist();
    return { path: retained, source, manifest };
  } catch (error) {
    manifest.status = "FAILED";
    manifest.error = { code: error.code ?? "E_STORAGE_MIGRATION_SOURCE_INVALID", message: error.message };
    try { await persist(); } catch { /* Retain CAPTURING if failure metadata cannot be persisted. */ }
    throw error;
  }
}

async function readCaptureManifest(filename) {
  try { return await readStorageMetadataJson(path.dirname(filename), path.basename(filename)); }
  catch (error) {
    if (["JSON_LIMIT_EXCEEDED", "E_STORAGE_METADATA_INVALID"].includes(error.code)) throw failure("E_STORAGE_MIGRATION_CAPTURE_INVALID", error.message);
    throw error;
  }
}

async function inventoryRetainedSource(source) {
  let inventory;
  try { inventory = await inventoryLegacyArchiveLayout(source); }
  catch (error) {
    if (error.code === "E_STORAGE_MIGRATION_ARCHIVE_INVALID") throw failure("E_STORAGE_MIGRATION_CAPTURE_INVALID", error.message);
    throw error;
  }
  return { files: inventory.files, directories: inventory.directories.filter(name => SOURCE_ROOTS.some(root => name === root || name.startsWith(`${root}/`))) };
}

async function copyCapturedFile(target, source, file) {
  const copied = await assertSafePath(source, file.path);
  await mkdir(path.dirname(copied), { recursive: true });
  await pipeline(createReadStream(await assertSafePath(target, file.path)), createWriteStream(copied, { flags: "wx", mode: 0o600 }));
  const handle = await open(copied, "r+");
  try { await handle.sync(); } finally { await handle.close(); }
  const copiedDigest = await digestFile(copied, { includeSize: true });
  if (copiedDigest.size !== file.size || copiedDigest.sha256 !== file.sha256) throw failure("E_STORAGE_MIGRATION_SOURCE_CHANGED", `Source bytes changed during recovery: ${file.path}`);
}

/** Complete recorded capture only while the original source inventory is unchanged. */
export async function resumeLegacySourceCapture(target, destination, { writersQuiesced = false } = {}) {
  if (writersQuiesced !== true) throw failure("E_STORAGE_MIGRATION_QUIESCENCE_REQUIRED", "Capture recovery requires excluded writers");
  await assertOwnedStorageMaintenance(target);
  const retained = await assertSafePath(target, destination);
  const manifestPath = await assertSafePath(retained, "source-manifest.json");
  const manifest = await readCaptureManifest(manifestPath);
  if (manifest?.status === "CAPTURED") return verifyLegacySourceCapture(target, destination);
  if (manifest?.schemaVersion !== 2 || manifest.kind !== "LEGACY_SOURCE_CAPTURE" || !["CAPTURING", "FAILED"].includes(manifest.status)
    || manifest.writersQuiesced !== true || !Array.isArray(manifest.files) || !Array.isArray(manifest.directories)) throw failure("E_STORAGE_MIGRATION_CAPTURE_INVALID", "Capture recovery requires a recorded source inventory");
  await assertLegacyIdle(target);
  if (await readStorageVersionMarker(target)) throw failure("E_STORAGE_MIGRATION_CAPTURE_INVALID", "Capture cannot resume after cutover begins");
  for (const name of ["candidate-manifest.json", "candidate.sqlite", "publication"]) {
    if (await infoIfPresent(await assertSafePath(retained, name))) throw failure("E_STORAGE_MIGRATION_CAPTURE_INVALID", "Capture cannot resume after candidate preparation begins");
  }
  const expected = { files: manifest.files, directories: manifest.directories };
  if (JSON.stringify(await inventoryLegacySourceLayout(target)) !== JSON.stringify(expected)) throw failure("E_STORAGE_MIGRATION_SOURCE_CHANGED", "Original source inventory changed after capture began");
  const source = await assertSafePath(retained, "source");
  const partial = await inventoryRetainedSource(source);
  const expectedPaths = new Set(manifest.files.map(file => file.path));
  const expectedDirectories = new Set(manifest.directories);
  if (partial.files.some(file => !expectedPaths.has(file.path)) || partial.directories.some(name => !expectedDirectories.has(name))) throw failure("E_STORAGE_MIGRATION_CAPTURE_INVALID", "Partial capture contains unrecorded entries");
  const history = await assertSafePath(retained, "source-history");
  await mkdir(history, { recursive: true });
  const attempt = await assertSafePath(history, randomUUID());
  await mkdir(attempt);
  await writeFileAtomic(await assertSafePath(attempt, "source-manifest.json"), `${JSON.stringify(manifest)}\n`);
  await syncDirectory(retained); await syncDirectory(history); await syncDirectory(attempt);
  await mkdir(source, { recursive: true });
  for (const name of manifest.directories) await mkdir(await assertSafePath(source, name), { recursive: true });
  await completeCaptureFiles(target, source, attempt, manifest.files, partial.files);
  await assertLegacyIdle(target);
  if (JSON.stringify(await inventoryLegacySourceLayout(target)) !== JSON.stringify(expected)
    || JSON.stringify(await inventoryRetainedSource(source)) !== JSON.stringify(expected)) throw failure("E_STORAGE_MIGRATION_SOURCE_CHANGED", "Source or capture changed during recovery");
  await syncDirectories(source);
  await assertOwnedStorageMaintenance(target);
  delete manifest.error;
  manifest.status = "CAPTURED";
  await writeFileAtomic(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return verifyLegacySourceCapture(target, destination);
}

async function completeCaptureFiles(target, source, attempt, files, partialFiles) {
  const current = new Map(partialFiles.map(file => [file.path, file]));
  for (const file of files) {
    const previous = current.get(file.path);
    if (previous?.size === file.size && previous.sha256 === file.sha256) continue;
    if (previous) {
      await assertOwnedStorageMaintenance(target);
      const forensic = await assertSafePath(attempt, `partial/${file.path}`);
      await mkdir(path.dirname(forensic), { recursive: true });
      await syncDirectories(attempt);
      await rename(await assertSafePath(source, file.path), forensic);
      await syncDirectory(path.dirname(forensic));
      await syncDirectory(path.dirname(await assertSafePath(source, file.path)));
    }
    await copyCapturedFile(target, source, file);
  }
}
