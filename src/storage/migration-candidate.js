import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdir, mkdtemp, open, readFile, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { TextDecoder } from "node:util";
import { assertSafePath, writeFileAtomic } from "../core/filesystem.js";
import { canonicalFingerprint } from "../core/artifacts.js";
import { assertJsonBytes, assertJsonLimits } from "../core/json-safety.js";
import { getPackageRoot } from "../core/templates.js";
import { captureLegacySource, inventoryLegacySourceLayout, verifyLegacySourceCapture } from "./migration-source.js";
import { assertOwnedStorageMaintenance, withStorageMaintenance } from "./maintenance.js";
import { importProjectState } from "./importer.js";
import { readSingletonImportSource, singletonExportPath } from "./singleton-import.js";
import { LEGACY_TASK_ARTIFACT_PATHS } from "../core/task-paths.js";
import { exportDatabase } from "./exporter.js";
import { checkStorageIntegrity, openStorageDatabase, readStorageMeta } from "./connection.js";
import { validateMigrationDatabase } from "./migration-validation.js";
import { inspectMigrationSourcePartition } from "./migration-source-partition.js";
import { iterateAttachmentReferences } from "./attachment-references.js";
import { readStorageVersionMarker } from "./storage-marker.js";
import { prepareMigrationAttachmentRoot, verifyMigrationAttachmentRoot } from "./migration-attachment-root.js";

const PARITY_TABLES = Object.freeze({
  tasks: "task_id", claims: "task_id, claim_norm", events: "task_id, seq",
  actions: "task_id, action_id", approvals: "task_id, approval_id",
  executions: "task_id, execution_id", task_artifacts: "task_id, kind, artifact_id", sessions: "session_id", attachment_references: "task_id, reference_id",
});

function invalid(message) { return Object.assign(new Error(message), { code: "E_STORAGE_MIGRATION_PARITY_INVALID" }); }

function validationSummary(validation) {
  return { taskCount: validation.tasks.length, taskInventoryFingerprint: canonicalFingerprint(validation.tasks), schemas: validation.schemas };
}

async function writeTaskInventory(db, directory, validation) {
  const filename = await assertSafePath(directory, "task-inventory.ndjson");
  const taskRow = db.prepare("SELECT task_key, state_json FROM tasks WHERE task_id = ?");
  async function* records() {
    for (const task of validation.tasks) {
      const row = taskRow.get(task.taskId);
      yield `${JSON.stringify({ ...task, taskKey: row.task_key, stateFingerprint: row.state_json === null ? null : canonicalFingerprint(JSON.parse(row.state_json)) })}\n`;
    }
  }
  await writeFileAtomic(filename, records());
  return { path: "task-inventory.ndjson", records: validation.tasks.length, sha256: await fileDigest(filename) };
}

export function logicalSnapshot(db) {
  const tables = {};
  for (const [table, order] of Object.entries(PARITY_TABLES)) {
    const hash = createHash("sha256");
    let count = 0;
    for (const row of db.prepare(`SELECT * FROM ${table} ORDER BY ${order}`).iterate()) {
      hash.update(`${JSON.stringify(row)}\n`);
      count += 1;
    }
    tables[table] = { count, sha256: hash.digest("hex") };
  }
  const { storage_format, storage_version, schema_version, protocol_version, active_session_id } = readStorageMeta(db);
  return { tables, metadata: { storage_format, storage_version, schema_version, protocol_version, active_session_id } };
}

async function fileDigest(filename) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest("hex");
}

async function contentFingerprint(filename, ledger) {
  if (!ledger) {
    const text = await readFile(filename);
    assertJsonBytes(text, filename);
    if (!Buffer.from(text.toString("utf8"), "utf8").equals(text)) throw invalid(`Source is not valid UTF-8: ${filename}`);
    const value = JSON.parse(text.toString("utf8"));
    assertJsonLimits(value, filename);
    return canonicalFingerprint(value);
  }
  const hash = createHash("sha256");
  const input = createReadStream(filename);
  async function* strictLines() {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let pending = "";
    for await (const bytes of input) {
      pending += decoder.decode(bytes, { stream: true });
      let newline;
      while ((newline = pending.indexOf("\n")) !== -1) {
        yield pending.slice(0, newline);
        pending = pending.slice(newline + 1);
      }
      assertJsonBytes(pending, filename);
    }
    pending += decoder.decode();
    if (pending) yield pending;
  }
  try {
    for await (const line of strictLines()) {
      if (!line.trim()) continue;
      assertJsonBytes(line, filename);
      const value = JSON.parse(line);
      assertJsonLimits(value, filename);
      hash.update(`${canonicalFingerprint(value)}\n`);
    }
  } finally { input.destroy(); }
  return hash.digest("hex");
}

async function capturedSingletonTaskId(captured) {
  const singletonPaths = new Set(Object.entries(LEGACY_TASK_ARTIFACT_PATHS).filter(([kind]) => kind !== "session").map(([, filename]) => filename));
  const hasSingleton = captured.manifest.files.some(file => [...singletonPaths].some(root => file.path === root || file.path.startsWith(`${root}/`)))
    || captured.manifest.directories.some(directory => singletonPaths.has(directory));
  return hasSingleton ? (await readSingletonImportSource(captured.source)).taskId : null;
}

async function verifyHistoricalManifestFiles(files, sourceRoot) {
  const names=new Set();
  for (const file of files) {
    if (!file || typeof file.path !== "string" || file.path.split("/").some(part=>!part || part === "." || part === "..")
      || file.path.includes("\\") || file.path.includes("\u0000") || names.has(file.path)
      || !Number.isSafeInteger(file.size) || file.size < 0 || !/^[a-f0-9]{64}$/.test(file.sha256 ?? "")) throw invalid("Historical export manifest file binding is invalid");
    names.add(file.path);
    await lstat(await assertSafePath(sourceRoot,file.path));
  }
  return names;
}

/** Validate retained export metadata as a historical ledger prefix, never current authority. */
async function verifyHistoricalExportManifest(source, reproduced) {
  const read = async filename => {
    const bytes=await readFile(filename);assertJsonBytes(bytes,"export manifest");
    const value=JSON.parse(bytes.toString("utf8"));assertJsonLimits(value,"export manifest");return value;
  };
  const prior=await read(source), current=await read(reproduced);
  if (prior.schemaVersion !== 1 || prior.taskId !== current.taskId || prior.taskKey !== current.taskKey
    || !Number.isSafeInteger(prior.events) || prior.events < 0 || prior.events > current.events
    || !Array.isArray(prior.claims) || prior.claims.some(claim=>typeof claim !== "string")
    || !Array.isArray(prior.files) || !Array.isArray(prior.included)) throw invalid("Historical export manifest identity or shape is invalid");
  const names = await verifyHistoricalManifestFiles(prior.files, path.dirname(source));
  if (canonicalFingerprint([...names].sort()) !== canonicalFingerprint([...prior.included].sort())) throw invalid("Historical export manifest membership differs");
  const ledger=prior.files.find(file=>file.path === "events.ndjson");
  if (!ledger) throw invalid("Historical export manifest omits its ledger binding");
  const hash=createHash("sha256");let remaining=ledger.size,lines=0,last=null;
  const input=createReadStream(await assertSafePath(path.dirname(source),"events.ndjson"));
  try {
    for await (const chunk of input) {
      if (!remaining) break;
      const bytes=chunk.subarray(0,Math.min(chunk.length,remaining));hash.update(bytes);remaining-=bytes.length;
      for (const byte of bytes) if (byte === 10) lines+=1;
      last=bytes.at(-1);
    }
  } finally {input.destroy();}
  if (remaining || hash.digest("hex") !== ledger.sha256 || lines !== prior.events || (ledger.size && last !== 10)) throw invalid("Historical export manifest ledger prefix differs");
}

async function checkSourceParity(captured, exported, db, mappings = []) {
  const externalAttachments = [];
  const signatureSources = new Map();
  let filesCompared = 0;
  const singletonTaskId = await capturedSingletonTaskId(captured);
  for (const file of captured.manifest.files) {
    if (file.path.endsWith("/statement.sigstore.json")) signatureSources.set(file.path, file);
    if (file.path.startsWith(".forgeloop/.txn/") || file.path.endsWith("/events.ndjson.index.json")) continue;
    if (file.path.startsWith(".forgeloop/attachments/")) { externalAttachments.push(file); continue; }
    // The portable index is regenerated with session byte bindings. Imported
    // session selection/association is compared through the canonical tables.
    if (file.path === "export-index.json") continue;
    const original = await assertSafePath(captured.source, file.path);
    const reproduced = await assertSafePath(exported, singletonTaskId ? singletonExportPath(singletonTaskId, file.path) : file.path);
    if (/^\.forgeloop\/task-state\/[a-f0-9]{64}\/export-manifest\.json$/.test(file.path)) {
      await verifyHistoricalExportManifest(original,reproduced);filesCompared+=1;continue;
    }
    try { await lstat(reproduced); }
    catch (error) {
      if (error.code !== "ENOENT") throw error;
      throw Object.assign(new Error(`Source has no canonical export mapping: ${file.path}`), { code: "E_STORAGE_MIGRATION_UNMAPPED_SOURCE" });
    }
    const ledger = file.path.endsWith("/events.ndjson");
    const signature = file.path.endsWith("/statement.sigstore.json");
    const fingerprint = filename => signature ? fileDigest(filename) : contentFingerprint(filename, ledger);
    if (await fingerprint(original) !== await fingerprint(reproduced)) throw invalid(`Source/export payload differs: ${file.path}`);
    filesCompared += 1;
  }
  const sourceFiles = new Map(externalAttachments.map(file => [file.path, file]));
  const covered = new Set();
  const generated = new Map(mappings.flatMap(mapping => mapping.references.map(reference => [JSON.stringify([reference.taskId, reference.referenceId]), { reference, sourcePath: mapping.sourcePath }])));
  let references = 0;
  for (const reference of iterateAttachmentReferences(db)) {
    references += 1;
    const file = sourceFiles.get(reference.path);
    if (file) {
      if (file.size !== reference.size || file.sha256 !== reference.sha256) throw invalid("Canonical attachment reference disagrees with captured bytes");
      covered.add(reference.path);
    } else {
      const binding = generated.get(JSON.stringify([reference.taskId, reference.referenceId]));
      const source = binding && signatureSources.get(binding.sourcePath);
      if (!source || canonicalFingerprint(binding.reference) !== canonicalFingerprint(reference) || source.size !== reference.size || source.sha256 !== reference.sha256) throw invalid("Generated attachment has no captured signature binding");
    }
  }
  const attachmentReferenceValidation = externalAttachments.length || references
    ? (covered.size === externalAttachments.length ? "VERIFIED" : "NOT_VERIFIED") : "NOT_REQUIRED";
  return { filesCompared, externalAttachments, attachmentReferenceValidation };
}

/** Prepare a closed private candidate; active layout publication is separate. */
export async function prepareMigrationCandidate(target, { destination, writersQuiesced = false, packageRoot = getPackageRoot() } = {}) {
  if (writersQuiesced !== true) throw Object.assign(new Error("Stop and exclude all writers before candidate preparation"), { code: "E_STORAGE_MIGRATION_QUIESCENCE_REQUIRED" });
  return withStorageMaintenance(target, async () => {
    const captured = await captureLegacySource(target, destination, { writersQuiesced });
    return prepareCapturedCandidate(target, destination, captured, { packageRoot });
  }, { retainOnError: true });
}

async function prepareCapturedCandidate(target, destination, captured, { packageRoot }) {
    const candidatePath = await assertSafePath(captured.path, "candidate.sqlite");
    const manifestPath = await assertSafePath(captured.path, "candidate-manifest.json");
    const manifest = { schemaVersion: 2, status: "PREPARING", publicationReady: false, sourceInventoryFingerprint: canonicalFingerprint({ files: captured.manifest.files, directories: captured.manifest.directories }) };
    const persist = () => writeFileAtomic(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    await persist();
    let db;
    let roundTrip;
    try {
      const attachments = await prepareMigrationAttachmentRoot(captured, await assertSafePath(captured.path, "candidate-attachments"), { packageRoot });
      if (attachments.summary) manifest.attachmentPreparation = attachments.summary;
      await persist();
      const imported = await importProjectState(captured.source, candidatePath, { provenance: captured.manifest, preparedAttachments: attachments.preparedAttachments, convertSingleton: true });
      db = imported.db;
      const validation = await validateMigrationDatabase(db, { target, packageRoot });
      const taskInventory = await writeTaskInventory(db, captured.path, validation);
      const integrity = checkStorageIntegrity(db);
      if (!integrity.ok) throw invalid("Candidate storage integrity failed");
      const exported = await assertSafePath(captured.path, "parity-export");
      await exportDatabase(db, exported, { attachmentRoot: attachments.root });
      const parity = await checkSourceParity(captured, exported, db, attachments.mappings);
      roundTrip = (await importProjectState(exported, await assertSafePath(captured.path, "parity.sqlite"))).db;
      const logical = logicalSnapshot(db);
      if (JSON.stringify(logical) !== JSON.stringify(logicalSnapshot(roundTrip))) throw invalid("Portable round trip changed canonical rows or metadata");
      roundTrip.close(); roundTrip = null;
      await verifyLegacySourceCapture(target, destination);
      if (canonicalFingerprint(await inventoryLegacySourceLayout(target)) !== manifest.sourceInventoryFingerprint) throw invalid("Active legacy source changed during preparation");
      const checkpoint = db.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get();
      if (checkpoint.busy !== 0 || checkpoint.log !== 0) throw invalid("Candidate checkpoint did not close all WAL contents");
      const metadata = readStorageMeta(db);
      db.close(); db = null;
      const file = await open(candidatePath, "r+");
      try { await file.sync(); } finally { await file.close(); }
      manifest.status = "PREPARED";
      Object.assign(manifest, { candidateSha256: await fileDigest(candidatePath), metadata, logical, validation: validationSummary(validation), taskInventory, parity, importReport: { totals: imported.report.totals, importedTasks: imported.report.imported.length, skipped: imported.report.skipped, errors: imported.report.errors } });
      await persist();
      return { path: captured.path, candidatePath, manifest, attachmentRoot: attachments.root };
    } catch (error) {
      manifest.status = "FAILED";
      manifest.error = { code: error.code ?? "E_STORAGE_MIGRATION_VALIDATION_FAILED", message: error.message, ...(error.errors ? { errors: error.errors } : {}), ...(error.report ? { report: error.report } : {}) };
      try { await persist(); } catch { /* A retained PREPARING marker is never accepted as prepared. */ }
      throw error;
    } finally { roundTrip?.close(); db?.close(); }
}

async function readPreparedCandidateManifest(target, captured, allowSignatureObjectGrowth) {
  const manifestBytes = await readFile(await assertSafePath(captured.path, "candidate-manifest.json"));
  assertJsonBytes(manifestBytes, "candidate manifest");
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  assertJsonLimits(manifest, "candidate manifest");
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)
    || manifest.schemaVersion !== 2 || manifest.status !== "PREPARED" || manifest.publicationReady !== false
    || manifest.sourceInventoryFingerprint !== canonicalFingerprint({ files: captured.manifest.files, directories: captured.manifest.directories })) throw invalid("Retained candidate manifest is incomplete or inconsistent");
  if (allowSignatureObjectGrowth) {
    const marker = await readStorageVersionMarker(target);
    if (!marker || !["CUTOVER_PENDING", "ACTIVE"].includes(marker.phase) || marker.sourceInventoryFingerprint !== manifest.sourceInventoryFingerprint) throw invalid("Pending signature growth requires a matching cutover marker");
  }
  return manifest;
}

async function assertCandidateFiles(captured, candidatePath, manifest) {
  for (const suffix of ["-wal", "-shm"]) {
    const sidecar = await assertSafePath(captured.path, `candidate.sqlite${suffix}`);
    try { if (suffix === "-wal" && (await lstat(sidecar)).size !== 0) throw invalid("Candidate has unshipped WAL contents"); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  if (await fileDigest(candidatePath) !== manifest.candidateSha256) throw invalid("Candidate database bytes disagree with retained digest");
  if (manifest.taskInventory?.path !== "task-inventory.ndjson"
    || await fileDigest(await assertSafePath(captured.path, manifest.taskInventory.path)) !== manifest.taskInventory.sha256) throw invalid("Task inventory bytes disagree with retained digest");
}

/** Revalidate a retained private candidate; never treat its manifest as authority alone. */
export async function verifyMigrationCandidate(target, destination, { packageRoot = getPackageRoot(), sourcePartition = false, allowAttachmentGrowth = false, allowSignatureObjectGrowth = false } = {}) {
  const captured = await verifyLegacySourceCapture(target, destination);
  const manifest = await readPreparedCandidateManifest(target, captured, allowSignatureObjectGrowth);
  const currentSourceFingerprint = async () => sourcePartition
    ? (await inspectMigrationSourcePartition(target, destination, { allowAttachmentGrowth, allowSignatureObjectGrowth })).sourceInventoryFingerprint
    : canonicalFingerprint(await inventoryLegacySourceLayout(target));
  if (await currentSourceFingerprint() !== manifest.sourceInventoryFingerprint) throw invalid("Active legacy source changed after candidate preparation");
  const candidatePath = await assertSafePath(captured.path, "candidate.sqlite");
  await assertCandidateFiles(captured, candidatePath, manifest);
  const db = openStorageDatabase(candidatePath, { readOnly: true });
  let recheck;
  let sourceDb;
  try {
    recheck = await mkdtemp(path.join(captured.path, ".candidate-verification-"));
    const integrity = checkStorageIntegrity(db);
    if (!integrity.ok || canonicalFingerprint(logicalSnapshot(db)) !== canonicalFingerprint(manifest.logical)) throw invalid("Retained candidate failed integrity or logical parity");
    const validation = await validateMigrationDatabase(db, { target, packageRoot });
    if (canonicalFingerprint(validationSummary(validation)) !== canonicalFingerprint(manifest.validation)) throw invalid("Retained candidate domain projection changed");
    const inventory = await writeTaskInventory(db, recheck, validation);
    if (canonicalFingerprint(inventory) !== canonicalFingerprint(manifest.taskInventory)) throw invalid("Retained task inventory disagrees with canonical tasks");
    const attachments = await prepareMigrationAttachmentRoot(captured, path.join(recheck, "attachments"), { packageRoot });
    if (canonicalFingerprint(attachments.summary) !== canonicalFingerprint(manifest.attachmentPreparation ?? null)) throw invalid("Candidate attachment preparation disagrees with captured signatures");
    const attachmentRoot = attachments.summary ? await assertSafePath(captured.path, "candidate-attachments") : captured.source;
    if (attachments.summary) await verifyMigrationAttachmentRoot(attachmentRoot, attachments.references);
    else if (await info(await assertSafePath(captured.path, "candidate-attachments"))) throw invalid("Unbound candidate attachment root");
    sourceDb = (await importProjectState(captured.source, path.join(recheck, "source.sqlite"), { preparedAttachments: attachments.preparedAttachments, convertSingleton: true })).db;
    if (canonicalFingerprint(logicalSnapshot(sourceDb)) !== canonicalFingerprint(logicalSnapshot(db))) throw invalid("Retained source/candidate canonical rows differ");
    const exported = path.join(recheck, "export");
    await exportDatabase(db, exported, { attachmentRoot });
    if (canonicalFingerprint(await checkSourceParity(captured, exported, db, attachments.mappings)) !== canonicalFingerprint(manifest.parity)) throw invalid("Retained source/export parity changed");
    await verifyLegacySourceCapture(target, destination);
    if (await currentSourceFingerprint() !== manifest.sourceInventoryFingerprint) throw invalid("Active legacy source changed during candidate verification");
    return { path: captured.path, candidatePath, manifest, attachmentRoot };
  } finally { try { sourceDb?.close(); db.close(); } finally { if (recheck) await rm(recheck, { recursive: true, force: true }); } }
}


const CANDIDATE_FILES = Object.freeze(["candidate-manifest.json", "candidate.sqlite", "candidate.sqlite-wal", "candidate.sqlite-shm", "candidate-attachments", "task-inventory.ndjson", "parity-export", "parity.sqlite", "parity.sqlite-wal", "parity.sqlite-shm"]);
async function info(filename) {
  try { return await lstat(filename); } catch (error) { if (error.code === "ENOENT") return null; throw error; }
}
async function syncRecoveryDirectory(directory) {
  const handle = await open(directory, "r");
  try { await handle.sync(); }
  catch (error) { if (!["EINVAL", "EPERM", "EISDIR", "ENOTSUP", "UNKNOWN"].includes(error.code)) throw error; }
  finally { await handle.close(); }
}
async function readRecoveryJson(filename, label) {
  const bytes = await readFile(filename);
  assertJsonBytes(bytes, label);
  if (!Buffer.from(bytes.toString("utf8")).equals(bytes)) throw invalid(`${label} is not UTF-8`);
  const value = JSON.parse(bytes.toString("utf8"));
  assertJsonLimits(value, label);
  return value;
}

/** Preserve interrupted candidate work using a resumable rename intent. */
export async function resumeMigrationCandidate(target, destination, { writersQuiesced = false, packageRoot = getPackageRoot() } = {}) {
  if (writersQuiesced !== true) throw invalid("Candidate recovery requires excluded writers");
  await assertOwnedStorageMaintenance(target);
  const captured = await verifyLegacySourceCapture(target, destination);
  const root = captured.path;
  const intentPath = await assertSafePath(root, "candidate-recovery.json");
  let intent = await info(intentPath) ? await readRecoveryJson(intentPath, "candidate recovery") : null;
  const manifestPath = await assertSafePath(root, "candidate-manifest.json");
  const manifest = await info(manifestPath) ? await readRecoveryJson(manifestPath, "candidate manifest") : null;
  if (!intent && manifest?.status === "PREPARED") return; // Publication verification remains authoritative.
  if (await readStorageVersionMarker(target) || await info(await assertSafePath(target, ".forgeloop/state.sqlite"))
    || await info(await assertSafePath(root, "publication"))) throw invalid("Candidate rebuild is forbidden after staging or cutover begins");
  const fingerprint = canonicalFingerprint({ files: captured.manifest.files, directories: captured.manifest.directories });
  if (canonicalFingerprint(await inventoryLegacySourceLayout(target)) !== fingerprint) throw invalid("Active legacy source differs from the capture");
  if (!intent) {
    if (manifest && (manifest.schemaVersion !== 2 || !["PREPARING", "FAILED"].includes(manifest.status)
      || manifest.publicationReady !== false || manifest.sourceInventoryFingerprint !== fingerprint)) throw invalid("Interrupted candidate has unsupported source bindings");
    const files = [];
    for (const name of CANDIDATE_FILES) if (await info(await assertSafePath(root, name))) files.push(name);
    if (!manifest && files.length) throw invalid("Candidate files without a preparation identity require reconciliation");
    if (!files.length) return prepareCapturedCandidate(target, destination, captured, { packageRoot });
    intent = { schemaVersion: 1, kind: "CANDIDATE_RECOVERY", operationId: randomUUID(), sourceInventoryFingerprint: fingerprint, files };
    await writeFileAtomic(intentPath, `${JSON.stringify(intent)}\n`);
  }
  await retainInterruptedCandidate(target, root, intent, fingerprint);
  return prepareCapturedCandidate(target, destination, captured, { packageRoot });
}

async function retainInterruptedCandidate(target, root, intent, fingerprint) {
  const intentPath = await assertSafePath(root, "candidate-recovery.json");
  if (intent.schemaVersion !== 1 || intent.kind !== "CANDIDATE_RECOVERY" || intent.sourceInventoryFingerprint !== fingerprint
    || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(intent.operationId ?? "")
    || !Array.isArray(intent.files) || !intent.files.length || intent.files.length !== new Set(intent.files).size
    || intent.files.some(name => !CANDIDATE_FILES.includes(name))) throw invalid("Candidate recovery intent is malformed or changed");
  const history = await assertSafePath(root, "candidate-history");
  await mkdir(history, { recursive: true });
  const attempt = await assertSafePath(history, intent.operationId);
  await mkdir(attempt, { recursive: true });
  await syncRecoveryDirectory(root);
  await syncRecoveryDirectory(history);
  await syncRecoveryDirectory(attempt);
  if ((await readdir(attempt)).some(name => !intent.files.includes(name))) throw invalid("Candidate history has unexpected entries");
  for (const name of CANDIDATE_FILES) {
    const source = await assertSafePath(root, name);
    const destinationPath = await assertSafePath(attempt, name);
    const from = await info(source);
    const to = await info(destinationPath);
    if (!intent.files.includes(name)) { if (from || to) throw invalid("Unexpected candidate files appeared during recovery"); continue; }
    if (Boolean(from) === Boolean(to)) throw invalid("Candidate recovery file is missing or duplicated");
    if (from) {
      await assertOwnedStorageMaintenance(target);
      await rename(source, destinationPath);
      await syncRecoveryDirectory(root);
      await syncRecoveryDirectory(attempt);
    }
  }
  await syncRecoveryDirectory(history);
  const receipt = await assertSafePath(attempt, "recovery.json");
  if (await info(receipt)) throw invalid("Candidate recovery receipt already exists");
  await rename(intentPath, receipt);
  await syncRecoveryDirectory(root);
  await syncRecoveryDirectory(attempt);

}
