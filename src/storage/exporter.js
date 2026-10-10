import { PORTABLE_ARTIFACT_MAPPINGS } from "../core/artifact-registry.js";
import { artifactByteDigest } from "./artifact-bytes.js";
import { canonicalFingerprint } from "../core/artifacts.js";
import { withStorageSnapshot } from "./snapshot.js";
import { assertPortableExportDestination } from "./export-destination.js";
import { mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { iterateAttachmentReferences } from "./attachment-references.js";
import { publishAttachmentFile, verifyAttachmentFile, withVerifiedAttachmentFile } from "./attachment-files.js";
import { validateAttachmentReference } from "./attachment-binding.js";
import { STORAGE_CATALOG_LIMITS } from "./metadata-json.js";
import { assertJsonBytes, assertJsonLimits } from "../core/json-safety.js";
import { legacyAttachmentReferenceId, signatureReferencePrefix } from "../core/signing/bundle-reference.js";

import { assertSafePath, writeFileAtomic } from "../core/filesystem.js";
import { taskStorageKey } from "../core/task-identity.js";
import { TASK_STATE_ROOT } from "../core/task-paths.js";
import {
  CURRENT_ARTIFACT_ID,
  findTaskById,
  iterateActions,
  iterateApprovals,
  iterateArtifacts,
  iterateClaims,
  iterateCanonicalEvents,
  iterateExecutions,
} from "./repository.js";

/**
 * Deterministic store -> filesystem export.
 *
 * Export is an interchange operation, not a mirror of live state. It runs from
 * a consistent read snapshot, emits events in sequence order, and writes a
 * manifest that binds the included artifacts so a consumer can tell exactly
 * what a portable bundle contains. Export failure is reported independently of
 * any state mutation.
 */

const ARTIFACT_FILENAMES = Object.freeze(Object.fromEntries(
  PORTABLE_ARTIFACT_MAPPINGS.singletons.map(({ kind, filename }) => [kind, filename]),
));
const ARTIFACT_DIRECTORIES = Object.freeze(Object.fromEntries(
  PORTABLE_ARTIFACT_MAPPINGS.collections.map(({ kind, directory }) => [kind, directory]),
));

function serialize(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function portableId(id) {
  if (typeof id !== "string" || !id || id === "." || id === ".." || /[\\/\u0000]/u.test(id)) {
    const error = new Error("Stored artifact identity cannot be exported as a portable filename");
    error.code = "E_STORAGE_EXPORT_IDENTITY";
    throw error;
  }
  return id;
}

function portableArtifactId(kind, id) {
  if (kind !== "attestation" && kind !== "structuralQuality") return portableId(id);
  if (typeof id !== "string" || id.split("/").length > 5) return portableId(id);
  return id.split("/").map(portableId).join("/");
}

/**
 * Export one task into `destination`, which is a task-state root. The layout
 * matches `TASK_STATE_ROOT` so an exported bundle can be re-imported by the
 * same importer without a translation step.
 */
export async function exportTask(db, taskId, destination) {
  await assertPortableExportDestination(destination);
  return withStorageSnapshot(db, snapshot => exportTaskSnapshot(snapshot, taskId, destination));
}

async function exportTaskSnapshot(db, taskId, destination) {
  const task = findTaskById(db, taskId);
  if (!task) {
    const error = new Error(`Unknown task: ${taskId}`);
    error.code = "E_TASK_NOT_FOUND";
    throw error;
  }
  if (task.taskKey !== taskStorageKey(taskId)) {
    const error = new Error("Stored task key disagrees with its canonical identity");
    error.code = "E_STORAGE_EXPORT_IDENTITY";
    throw error;
  }

  await mkdir(destination, { recursive: true });
  const directory = await assertSafePath(destination, task.taskKey);
  await mkdir(directory, { recursive: true });
  const files = [];
  let manifestBytes = 4096;
  function reserveFile(name) {
    const entry = { path: name, size: Number.MAX_SAFE_INTEGER, sha256: "0".repeat(64) };
    assertJsonLimits(entry, "export manifest entry", STORAGE_CATALOG_LIMITS);
    const projectedBytes = manifestBytes + Buffer.byteLength(serialize(entry)) + Buffer.byteLength(serialize(name)) + 128;
    assertJsonBytes({ byteLength: projectedBytes }, "export manifest", STORAGE_CATALOG_LIMITS);
    if (files.length >= STORAGE_CATALOG_LIMITS.maxArrayLength) {
      throw Object.assign(new Error("Export manifest exceeds its array entry limit"), { code: "JSON_LIMIT_EXCEEDED" });
    }
    manifestBytes = projectedBytes;
  }
  async function publish(name, bytes, { manifest = false } = {}) {
    if (!manifest) reserveFile(name);
    const filename = await assertSafePath(directory, name);
    const digest = createHash("sha256");
    let size = 0;
    async function* countedBytes() {
      const chunks = typeof bytes === "string" ? [bytes] : bytes;
      for await (const chunk of chunks) {
        digest.update(chunk);
        size += Buffer.byteLength(chunk);
        yield chunk;
      }
    }
    await writeFileAtomic(filename, countedBytes());
    if (!manifest) files.push({ path: name, size, sha256: digest.digest("hex") });
  }

  await publish("task.json", serialize(task.descriptor));
  if (task.state) {
    await publish("work-state.json", serialize(task.state));
  }

  // Events are emitted in sequence order with one object per line so a
  // re-import reproduces byte-identical ledger semantics.
  let eventCount = 0;
  async function* ledgerBytes() {
    for (const event of iterateCanonicalEvents(db, taskId)) {
      eventCount += 1;
      yield `${JSON.stringify(event)}\n`;
    }
  }
  await publish("events.ndjson", ledgerBytes());

  for (const artifact of iterateArtifacts(db, taskId)) {
    // Runtime reservations are coordination state, not portable task evidence.
    if (artifact.kind === "operationLease") continue;
    if (artifact.fingerprint !== canonicalFingerprint(artifact.payload)) throw Object.assign(new Error("Stored artifact fingerprint disagrees with its payload"), { code: "E_STORAGE_ARTIFACT_INVALID" });
    if (artifact.sourceText !== null || artifact.byteDigest !== null) artifactByteDigest(artifact);
    const filename = ARTIFACT_FILENAMES[artifact.kind];
    if (filename) {
      // Single-file kinds hold a replaceable current snapshot.
      if (artifact.artifactId !== CURRENT_ARTIFACT_ID) continue;
      await publish(filename, artifact.sourceText ?? serialize(artifact.payload));
      continue;
    }
    const subdirectory = ARTIFACT_DIRECTORIES[artifact.kind];
    if (!subdirectory) {
      const error = new Error(`No portable mapping exists for stored artifact kind: ${artifact.kind}`);
      error.code = "E_STORAGE_EXPORT_UNSUPPORTED";
      throw error;
    }
    const name = `${portableArtifactId(artifact.kind, artifact.artifactId)}.json`;
    await publish(`${subdirectory}/${name}`, artifact.sourceText ?? serialize(artifact.payload));
  }

  for (const [records, subdirectory, identityField] of [
    [iterateActions(db, taskId), "actions", "actionId"],
    [iterateApprovals(db, taskId), "approvals", "approvalId"],
    [iterateExecutions(db, taskId), "executions", "executionId"],
  ]) {
    for (const record of records) {
      const id = record[identityField];
      const name = `${portableId(id)}.json`;
      await publish(`${subdirectory}/${name}`, serialize(record));
    }
  }

  const claims = [];
  for (const claim of iterateClaims(db, taskId)) {
    assertJsonLimits(claim.claim_norm, "export claim", STORAGE_CATALOG_LIMITS);
    const projectedBytes = manifestBytes + Buffer.byteLength(serialize(claim.claim_norm)) + 128;
    assertJsonBytes({ byteLength: projectedBytes }, "export manifest", STORAGE_CATALOG_LIMITS);
    if (claims.length >= STORAGE_CATALOG_LIMITS.maxArrayLength) {
      throw Object.assign(new Error("Export claims exceed the array entry limit"), { code: "JSON_LIMIT_EXCEEDED" });
    }
    manifestBytes = projectedBytes;
    claims.push(claim.claim_norm);
  }
  const manifest = {
    schemaVersion: 1,
    taskId,
    taskKey: task.taskKey,
    events: eventCount,
    claims,
    included: files.map(file => file.path).sort(),
    files: files.sort((left, right) => left.path.localeCompare(right.path, "en")),
  };
  assertJsonLimits(manifest, "export manifest", STORAGE_CATALOG_LIMITS);
  const manifestText = serialize(manifest);
  assertJsonBytes(manifestText, "export manifest", STORAGE_CATALOG_LIMITS);
  await publish("export-manifest.json", manifestText, { manifest: true });

  return { taskId, taskKey: task.taskKey, directory, events: eventCount, manifest };
}

/**
 * Export every task in the store. Each task is written from the same read
 * snapshot so a bundle is internally consistent. The bundle index sits beside
 * the task-state root rather than inside it, so the exported directory is a
 * valid re-importable project state.
 */
export async function exportDatabase(db, destination, { attachmentRoot } = {}) {
  await assertPortableExportDestination(destination);
  return withStorageSnapshot(db, snapshot => exportDatabaseSnapshot(snapshot, destination, attachmentRoot));
}

async function exportDatabaseSnapshot(db, destination, attachmentRoot) {
  await mkdir(destination, { recursive: true });
  const taskStateRoot = await assertSafePath(destination, TASK_STATE_ROOT);
  await mkdir(taskStateRoot, { recursive: true });
  const index = {
    schemaVersion: 1,
    tasks: [],
    sessions: [],
    activeSessionId: null,
    attachments: [],
  };
  let catalogBytes = 4096;
  function appendCatalogEntry(entries, value) {
    assertJsonLimits(value, "export catalog entry", STORAGE_CATALOG_LIMITS);
    const size = Buffer.byteLength(serialize(value)) + 128;
    assertJsonBytes({ byteLength: catalogBytes + size }, "export catalog", STORAGE_CATALOG_LIMITS);
    if (entries.length >= STORAGE_CATALOG_LIMITS.maxArrayLength) {
      throw Object.assign(new Error("Export catalog exceeds its array entry limit"), { code: "JSON_LIMIT_EXCEEDED" });
    }
    catalogBytes += size;
    entries.push(value);
  }
  for (const row of db.prepare("SELECT task_id FROM tasks ORDER BY task_id").iterate()) {
    const result = await exportTaskSnapshot(db, row.task_id, taskStateRoot);
    appendCatalogEntry(index.tasks, { taskId: result.taskId, taskKey: result.taskKey, events: result.events });
  }
  for (const reference of iterateAttachmentReferences(db)) {
    if (!attachmentRoot) throw Object.assign(new Error("Attachment export requires its source project root"), { code: "E_STORAGE_ATTACHMENT_INVALID" });
    await verifyAttachmentFile(attachmentRoot, reference);
    const copied = await publishAttachmentFile(destination, createReadStream(await assertSafePath(attachmentRoot, reference.path)));
    if (copied.size !== reference.size || copied.sha256 !== reference.sha256) throw Object.assign(new Error("Attachment changed during export"), { code: "E_STORAGE_ATTACHMENT_INVALID" });
    appendCatalogEntry(index.attachments, reference);
  }
  await exportLegacySignatureMirrors(db, destination);
  for (const row of db.prepare("SELECT * FROM sessions ORDER BY session_id").iterate()) {
    const activation = JSON.parse(row.activation_json);
    if (activation.sessionId !== row.session_id) throw Object.assign(new Error("Session identity disagrees with activation payload"), { code: "E_STORAGE_PAYLOAD_MISMATCH" });
    const relativePath = `.forgeloop/sessions/${portableId(row.session_id)}.json`;
    const bytes = serialize(activation);
    await writeFileAtomic(await assertSafePath(destination, relativePath), bytes);
    appendCatalogEntry(index.sessions, { sessionId: row.session_id, taskId: row.task_id, path: relativePath, size: Buffer.byteLength(bytes), sha256: createHash("sha256").update(bytes).digest("hex") });
  }
  const active = db.prepare("SELECT s.* FROM sessions s JOIN storage_meta m ON m.active_session_id = s.session_id WHERE m.id = 1").get();
  if (active) {
    index.activeSessionId = active.session_id;
    await writeFileAtomic(await assertSafePath(destination, ".forgeloop/session.json"), serialize(JSON.parse(active.activation_json)));
  }
  assertJsonLimits(index, "export catalog", STORAGE_CATALOG_LIMITS);
  const catalog = serialize(index);
  assertJsonBytes(catalog, "export catalog", STORAGE_CATALOG_LIMITS);
  await writeFileAtomic(await assertSafePath(destination, "export-index.json"), catalog);
  return { destination, tasks: index.tasks.length, index };
}

/** Legacy mirrors belong only to explicit portable exports, never live storage. */
async function exportLegacySignatureMirrors(db, destination) {
  const binding = db.prepare("SELECT * FROM attachment_references WHERE task_id = ? AND reference_id = ?");
  for (const row of db.prepare("SELECT task_id, artifact_id, source_json, payload_json FROM task_artifacts WHERE kind = 'attestation' ORDER BY task_id, artifact_id").iterate()) {
    if (!/^(?:history\/cycle-[1-9][0-9]*\/)?statement$/u.test(row.artifact_id)) continue;
    const relativePath = `.forgeloop/task-state/${taskStorageKey(row.task_id)}/attestations/${row.artifact_id}.sigstore.json`;
    const referenceRow = binding.get(row.task_id, legacyAttachmentReferenceId(relativePath));
    if (!referenceRow) continue;
    const text = row.source_json ?? serialize(JSON.parse(row.payload_json));
    const statementBinding = binding.get(row.task_id, `${signatureReferencePrefix(text)}${legacyAttachmentReferenceId(relativePath)}`);
    // Keep old aliases in the canonical index, but do not attach an old bundle
    // to a replacement statement in the legacy filesystem representation.
    if (!statementBinding) continue;
    if (statementBinding.path !== referenceRow.path || statementBinding.size !== referenceRow.size || statementBinding.sha256 !== referenceRow.sha256) {
      throw Object.assign(new Error("Legacy signature alias disagrees with its statement binding"), { code: "E_STORAGE_ATTACHMENT_INVALID" });
    }
    const reference = validateAttachmentReference({ taskId: referenceRow.task_id, referenceId: referenceRow.reference_id, path: referenceRow.path, size: referenceRow.size, sha256: referenceRow.sha256 });
    const filename = await assertSafePath(destination, relativePath);
    await withVerifiedAttachmentFile(destination, reference, source => writeFileAtomic(filename, createReadStream(source)));
  }
}
