import { readdir, readFile, open, realpath, lstat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { legacyAttachmentReferenceId, signatureReferencePrefix } from "../core/signing/bundle-reference.js";
import { validateAttestationStatement } from "../core/attestation.js";
import { insertVerifiedAttachmentReference, validateAttachmentReference } from "./attachment-references.js";
import { verifyAttachmentFile } from "./attachment-files.js";
import { readStorageMetadataJson } from "./metadata-json.js";
import { assertSafePath } from "../core/filesystem.js";
import { readSingletonImportSource, importSingletonSource } from "./singleton-import.js";

import { canonicalFingerprint, readPortableJsonArtifact } from "../core/artifacts.js";
import { validateLedgerEvents } from "../core/events.js";
import { claimsOverlap, normalizeWriteClaims } from "../core/task-scope.js";
import { LEGACY_TASK_ARTIFACT_PATHS, TASK_STATE_ROOT, taskArtifactPath } from "../core/task-paths.js";
import { assertTaskDescriptorIdentity } from "../core/task-identity.js";
import { openStorageDatabase } from "./connection.js";
import { resolveStoreClaimState } from "./task-guards.js";
import {
  appendEvent,
  putAction,
  putApproval,
  putArtifact,
  putExecution,
  putSession,
  reserveClaims,
  upsertTask,
} from "./repository.js";

/**
 * Deterministic filesystem -> SQLite import.
 *
 * The importer is a one-way, explicitly invoked maintenance operation. It never
 * runs during a read-only command, it never silently repairs evidence, and it
 * aborts with a diagnostic report on collisions, invalid chains, or broken
 * required relationships rather than writing a partial store.
 *
 * Artifacts are mapped by kind using the existing `taskArtifactPath` helpers, so
 * the importer resolves paths through the same boundary the rest of the
 * protocol uses rather than re-deriving directory layouts.
 */

/** Single-file artifacts imported into `task_artifacts` with their logical kind. */
const SINGLE_FILE_ARTIFACTS = Object.freeze([
  ["contract", "contract"],
  ["route", "route"],
  ["preflight", "preflight"],
  ["continuity", "continuity"],
  ["receipt", "receipt"],
  ["policySnapshot", "policySnapshot"],
  ["recovery", "recovery"],
  ["workspaceBinding", "workspaceBinding"],
  ["responsibility", "responsibility"],
  ["verificationScope", "verificationScope"],
  ["usage", "usage"],
  ["testUtility", "testUtility"],
]);

/** Directory artifacts whose members are imported under `<kind>/<artifactId>`. */
const DIRECTORY_ARTIFACTS = Object.freeze([
  ["gates", "gate"],
  ["handoffs", "handoff"],
  ["decisions", "decision"],
  ["attestations", "attestation"],
  ["evaluations", "evaluation"],
  ["structural-quality", "structuralQuality"],
]);

async function readArtifactSource(target, relativePath) {
  const bytes = await readFile(await assertSafePath(target, relativePath));
  const text = bytes.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(bytes)) {
    const error = new Error(`Artifact source is not valid UTF-8: ${relativePath}`);
    error.code = "E_STORAGE_ARTIFACT_INVALID";
    throw error;
  }
  return text;
}

async function readJsonIfPresent(target, relativePath) {
  try {
    return JSON.parse(await readFile(await assertSafePath(target, relativePath), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function listJsonFiles(target, relativeDirectory, recursive = false, depth = 0) {
  const absolute = await assertSafePath(target, relativeDirectory);
  let entries;
  try {
    entries = await readdir(absolute, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const files = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      throw new Error(`Refusing to import symlinked artifact: ${relativeDirectory}/${entry.name}`);
    }
    if (entry.isFile() && entry.name.endsWith(".json")) {
      files.push({ id: entry.name.replace(/\.json$/, ""), path: `${relativeDirectory}/${entry.name}` });
    }
    if (recursive && entry.isDirectory()) {
      if (depth >= 4) throw new Error(`Operational artifact nesting exceeds the supported layout: ${relativeDirectory}`);
      for (const file of await listJsonFiles(target, `${relativeDirectory}/${entry.name}`, true, depth + 1)) {
        files.push({ ...file, id: `${entry.name}/${file.id}` });
      }
    }
  }
  return files.sort((left, right) => left.id.localeCompare(right.id));
}

/**
 * Parse a ledger and verify it is internally consistent before any row is
 * written. Sequence gaps, unstable task identity, and broken hash links are
 * import-time failures: a ledger that does not validate here would silently
 * weaken every later ownership decision that trusts it.
 */
function parseLedger(taskId, text) {
  const events = [];
  const errors = [];
  const lines = text.split("\n").filter((line) => line.trim().length > 0);
  for (const [index, line] of lines.entries()) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      errors.push({ code: "E_EVENT_INVALID", message: `event ${index + 1} is not valid JSON` });
      continue;
    }
    if (!event || typeof event !== "object" || Array.isArray(event)) {
      errors.push({ code: "E_EVENT_INVALID", message: `event ${index + 1} must be an object` });
      continue;
    }
    if (event.taskId !== taskId) {
      errors.push({ code: "E_EVENT_INVALID", message: `event ${index + 1} task ID does not match its namespace` });
    }
    events.push(event);
  }
  return { events, errors: [...errors, ...validateLedgerEvents(events).errors] };
}

async function verifyPreparedAttachments(target, preparedAttachments) {
  const references = new Map();
  if (preparedAttachments === null) return references;
  if (!preparedAttachments || typeof preparedAttachments.root !== "string" || !Array.isArray(preparedAttachments.references)) {
    throw Object.assign(new Error("Invalid prepared attachment input"), { code: "E_STORAGE_ATTACHMENT_INVALID" });
  }
  const source = await realpath(target);
  const root = await realpath(preparedAttachments.root);
  if (root === source || root.startsWith(`${source}${path.sep}`) || source.startsWith(`${root}${path.sep}`)) {
    throw Object.assign(new Error("Prepared attachments must be separate from retained source"), { code: "E_STORAGE_ATTACHMENT_INVALID" });
  }
  const copied = preparedAttachments.references.map(reference => validateAttachmentReference({ ...reference }));
  for (const reference of copied) {
    const key = JSON.stringify([reference.taskId, reference.referenceId]);
    if (references.has(key)) throw Object.assign(new Error("Duplicate prepared attachment identity"), { code: "E_STORAGE_ATTACHMENT_INVALID" });
    await verifyAttachmentFile(root, reference);
    references.set(key, reference);
  }
  return references;
}

function importAborted(report) {
  const error = new Error("Import aborted: source state did not validate");
  error.code = "E_STORAGE_IMPORT_ABORTED";
  error.report = report;
  return error;
}

async function assertPreparedSignatureSource(target, taskId, relativePath, prepared) {
  const unmapped = () => Object.assign(new Error(`Legacy signature requires verified attachment preparation: ${relativePath}`), { code: "E_STORAGE_IMPORT_SIGNATURE_UNMAPPED" });
  const alias = legacyAttachmentReferenceId(relativePath);
  const reference = prepared.get(JSON.stringify([taskId, alias]));
  if (!reference) throw unmapped();
  const statementText = await readArtifactSource(target, relativePath.replace(/statement\.sigstore\.json$/u, "statement.json"));
  const statement = await validateAttestationStatement(JSON.parse(statementText));
  if (statement.predicate.task.taskId !== taskId) throw unmapped();
  const bound = prepared.get(JSON.stringify([taskId, `${signatureReferencePrefix(statementText)}${alias}`]));
  if (!bound || bound.path !== reference.path || bound.size !== reference.size || bound.sha256 !== reference.sha256) throw unmapped();
  const hash = createHash("sha256");
  let size = 0;
  for await (const bytes of createReadStream(await assertSafePath(target, relativePath))) {
    size += bytes.length;
    if (size > reference.size) throw unmapped();
    hash.update(bytes);
  }
  if (size !== reference.size || hash.digest("hex") !== reference.sha256) throw unmapped();
}

/**
 * Import one task namespace within the unpublished project transaction.
 */
async function importTask(db, target, taskKey, report, prepared) {
  const descriptor = await readJsonIfPresent(target, `${TASK_STATE_ROOT}/${taskKey}/task.json`);
  if (!descriptor) {
    report.errors.push({ code: "E_TASK_DESCRIPTOR_INVALID", message: `Task directory ${taskKey} has no descriptor; refusing to discard retained operational state` });
    return;
  }

  assertTaskDescriptorIdentity(descriptor, null, taskKey);

  const taskId = descriptor.taskId;
  const state = await readJsonIfPresent(target, taskArtifactPath(taskId, "state"));
  if (state && state.taskId !== taskId) {
    throw Object.assign(new Error("Work-state identity disagrees with its task namespace"), { code: "E_STORAGE_PAYLOAD_MISMATCH" });
  }

  let rawLedger = null;
  try {
    rawLedger = await readFile(await assertSafePath(target, taskArtifactPath(taskId, "events")), "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  let events = [];
  if (rawLedger !== null) {
    const parsed = parseLedger(taskId, rawLedger);
    events = parsed.events;
    report.errors.push(...parsed.errors);
  }
  if (report.errors.length) return;

  upsertTask(db, { taskId, taskKey, descriptor, state });

  const claims = normalizeWriteClaims(descriptor.writeClaims);
  if (claims.length) {
    reserveClaims(db, { taskId, claims, createdAt: descriptor.createdAt ?? null });
  }

  for (const event of events) {
    appendEvent(db, { taskId, event });
  }

  for (const [artifactKey, kind] of SINGLE_FILE_ARTIFACTS) {
    const payload = await readJsonIfPresent(target, taskArtifactPath(taskId, artifactKey));
    if (payload !== null) putArtifact(db, { taskId, kind, payload, sourceText: await readArtifactSource(target, taskArtifactPath(taskId, artifactKey)) });
  }

  await importDirectoryArtifacts(db, target, taskKey, taskId, prepared);

  for (const file of await listJsonFiles(target, `${TASK_STATE_ROOT}/${taskKey}/executions`)) {
    const execution = await readJsonIfPresent(target, file.path);
    if (execution) putExecution(db, { taskId, execution });
  }

  for (const file of await listJsonFiles(target, `${TASK_STATE_ROOT}/${taskKey}/actions`)) {
    const action = await readJsonIfPresent(target, file.path);
    if (action) putAction(db, { taskId, action });
  }

  for (const file of await listJsonFiles(target, `${TASK_STATE_ROOT}/${taskKey}/approvals`)) {
    const approval = await readJsonIfPresent(target, file.path);
    if (approval) putApproval(db, { taskId, approval });
  }

  report.imported.push({
    taskId,
    taskKey,
    events: events.length,
    stateFingerprint: state ? canonicalFingerprint(state) : null,
  });
}

/**
 * Import a project state root into a fresh database.
 *
 * The import is refused when the ledger of any task fails validation, so an
 * operator must resolve the ambiguity through the supported ForgeLoop repair
 * commands before the conversion can proceed. Nothing is silently repaired.
 */
async function selectSingletonSource(target, convertSingleton) {
  // Singleton conversion is explicit; ordinary namespace imports must refuse
  // before allocation rather than silently omit these source artifacts.
  // session.json is handled separately by importActiveSession.
  for (const [kind, relativePath] of Object.entries(LEGACY_TASK_ARTIFACT_PATHS)) {
    if (kind === "session") continue;
    try { await lstat(await assertSafePath(target, relativePath)); }
    catch (error) { if (error.code === "ENOENT") continue; throw error; }
    if (convertSingleton === true) return readSingletonImportSource(target);
    throw Object.assign(new Error(`Singleton task artifact requires explicit conversion before namespace import: ${relativePath}`), {
      code: "E_STORAGE_IMPORT_SINGLETON_UNSUPPORTED",
    });
  }
  return null;
}

function importSelectedSingleton(db, singleton, report) {
  if (!singleton) return;
  try { report.imported.push(importSingletonSource(db, singleton)); }
  catch (error) { report.errors.push({ code: error.code ?? "E_STORAGE_IMPORT_FAILED", message: error.message }); }
}

export async function importProjectState(target, databasePath, { provenance = null, preparedAttachments = null, convertSingleton = false } = {}) {
  const singleton = await selectSingletonSource(target, convertSingleton);
  try {
    const destination = await open(databasePath, "wx", 0o600);
    await destination.close();
  } catch (error) {
    if (error.code === "EEXIST") throw Object.assign(new Error("Import requires a fresh destination database"), { code: "E_STORAGE_IMPORT_DESTINATION_EXISTS" });
    throw error;
  }
  const report = { imported: [], skipped: [], errors: [] };
  let prepared;
  let index;
  const sourceBindings = new Map();
  try {
    prepared = await verifyPreparedAttachments(target, preparedAttachments);
    index = await readStorageMetadataJson(target, "export-index.json", { optional: true });
    await verifyImportAttachmentBindings(target, prepared, index, sourceBindings);
  } catch (error) {
    report.errors.push({ code: error.code ?? "E_STORAGE_IMPORT_FAILED", message: error.message });
    throw importAborted(report);
  }
  let entries = [];
  try {
    entries = await readdir(await assertSafePath(target, TASK_STATE_ROOT), { withFileTypes: true });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const taskKeys = entries
    .filter((entry) => (entry.isDirectory() || entry.isSymbolicLink()) && /^[a-f0-9]{64}$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^[a-f0-9]{64}$/.test(entry.name)) {
      report.errors.push({ code: "E_STORAGE_IMPORT_NAMESPACE_INVALID", message: `Unsupported task namespace entry: ${entry.name}; refusing to discard retained source membership` });
    }
  }

  const db = openStorageDatabase(databasePath);
  try {
    // This is an unpublished maintenance database. All imported namespaces
    // and session relationships commit together, or none of them survive.
    db.exec("BEGIN IMMEDIATE");
    for (const taskKey of taskKeys) {
      try {
        // Sequential on purpose: a rejected namespace must abort before any
        // later namespace is written.
        await importTask(db, target, taskKey, report, sourceBindings);
      } catch (error) {
        report.errors.push({ code: error.code ?? "E_STORAGE_IMPORT_FAILED", message: `${taskKey}: ${error.message}` });
      }
    }

    importSelectedSingleton(db, singleton, report);
    try { await importSessions(db, target, prepared, index); }
    catch (error) { report.errors.push({ code: error.code ?? "E_STORAGE_IMPORT_FAILED", message: error.message }); }

    await validateImportedClaims(db, report);

    if (report.errors.length) {
      throw importAborted(report);
    }

    if (provenance) {
      db.prepare("UPDATE storage_meta SET import_provenance = ? WHERE id = 1")
        .run(canonicalFingerprint(provenance));
    }

    report.totals = {
      tasks: db.prepare("SELECT COUNT(*) AS total FROM tasks").get().total,
      events: db.prepare("SELECT COUNT(*) AS total FROM events").get().total,
      claims: db.prepare("SELECT COUNT(*) AS total FROM claims").get().total,
      actions: db.prepare("SELECT COUNT(*) AS total FROM actions").get().total,
      approvals: db.prepare("SELECT COUNT(*) AS total FROM approvals").get().total,
      executions: db.prepare("SELECT COUNT(*) AS total FROM executions").get().total,
      artifacts: db.prepare("SELECT COUNT(*) AS total FROM task_artifacts").get().total,
      sessions: db.prepare("SELECT COUNT(*) AS total FROM sessions").get().total,
    };
    db.exec("COMMIT");
    return { db, report };
  } catch (error) {
    if (db.isTransaction) db.exec("ROLLBACK");
    db.close();
    throw error;
  }
}

async function importSessions(db, target, prepared, index) {
  await importAttachmentBindings(db, prepared, index);
  const bindings = index?.sessions ?? [];
  if (!Array.isArray(bindings)) throw new Error("Invalid portable session manifest");
  for (const file of await listJsonFiles(target, ".forgeloop/sessions")) {
    const { value } = await readPortableJsonArtifact(target, file.path, "activation");
    if (value.sessionId !== file.id) throw new Error("Session filename disagrees with activation identity");
    const matches = bindings.filter(binding => binding.sessionId === file.id);
    if (matches.length > 1) throw new Error("Duplicate portable session identity");
    const binding = matches[0];
    if (binding && (binding.path !== file.path || (binding.taskId !== null && typeof binding.taskId !== "string"))) throw new Error("Invalid portable session binding");
    if (binding) {
      const bytes = await readFile(await assertSafePath(target, file.path));
      const { createHash } = await import("node:crypto");
      if (binding.size !== bytes.length || binding.sha256 !== createHash("sha256").update(bytes).digest("hex")) throw new Error("Portable session bytes disagree with manifest");
    }
    putSession(db, { sessionId: file.id, taskId: binding?.taskId ?? null, activation: value });
  }
  if (bindings.some(binding => !db.prepare("SELECT session_id FROM sessions WHERE session_id = ?").get(binding.sessionId))) throw new Error("Portable session manifest references a missing activation");
  await importActiveSession(db, target, index);
}

async function importDirectoryArtifacts(db, target, taskKey, taskId, prepared) {
  for (const [directoryKey, kind] of DIRECTORY_ARTIFACTS) {
    const files = await listJsonFiles(target, `${TASK_STATE_ROOT}/${taskKey}/${directoryKey}`, kind === "attestation" || kind === "structuralQuality");
    for (const file of files) {
      if (kind === "attestation" && file.path.endsWith("/statement.sigstore.json")) {
        await assertPreparedSignatureSource(target, taskId, file.path, prepared);
        continue;
      }
      const payload = await readJsonIfPresent(target, file.path);
      if (payload !== null) putArtifact(db, { taskId, kind, artifactId: file.id, payload, sourceText: await readArtifactSource(target, file.path) });
    }
  }

}

async function validateImportedClaims(db, report) {
    for (const { taskId } of report.imported) {
      const ownership = resolveStoreClaimState(db, taskId);
      if (!ownership.valid) {
        report.errors.push(...ownership.errors.map(error => ({ ...error, message: `${taskId}: ${error.message}` })));
      } else {
        db.prepare("UPDATE claims SET reservation_state = ? WHERE task_id = ?")
          .run(ownership.claimState === "ACTIVE" ? "ACTIVE" : "RELEASED", taskId);
      }
    }
    const laterClaims = db.prepare("SELECT task_id, claim_norm FROM claims WHERE reservation_state = 'ACTIVE' AND task_id > ? ORDER BY task_id, claim_norm");
    for (const claim of db.prepare("SELECT task_id, claim_norm FROM claims WHERE reservation_state = 'ACTIVE' ORDER BY task_id, claim_norm").iterate()) {
      for (const other of laterClaims.iterate(claim.task_id)) {
        if (claimsOverlap(claim.claim_norm, other.claim_norm)) {
          report.errors.push({ code: "E_TASK_CLAIM_CONFLICT", message: `Imported active claims overlap: ${claim.task_id} (${claim.claim_norm}) and ${other.task_id} (${other.claim_norm})` });
          break;
        }
      }
      if (report.errors.length) break;
    }

}

async function importAttachmentBindings(db, prepared, index) {
  const attachments = index?.attachments ?? [];
  if (!Array.isArray(attachments)) throw new Error("Invalid portable attachment manifest");
  const identities = new Set();
  for (const reference of attachments) {
    validateAttachmentReference(reference);
    const identity = JSON.stringify([reference.taskId, reference.referenceId]);
    if (identities.has(identity)) throw new Error("Duplicate portable attachment identity");
    identities.add(identity);
    insertVerifiedAttachmentReference(db, reference);
  }
  for (const reference of prepared.values()) {
    const identity = JSON.stringify([reference.taskId, reference.referenceId]);
    if (identities.has(identity)) throw new Error("Duplicate prepared/portable attachment identity");
    identities.add(identity);
    insertVerifiedAttachmentReference(db, reference);
  }
}

async function importActiveSession(db, target, index) {
  const active = await readJsonIfPresent(target, ".forgeloop/session.json");
  if (!active) {
    if (index?.activeSessionId) throw new Error("Portable active session is missing");
    return;
  }
  const { value } = await readPortableJsonArtifact(target, ".forgeloop/session.json", "activation");
  const row = db.prepare("SELECT activation_json FROM sessions WHERE session_id = ?").get(value.sessionId);
  if (!row || canonicalFingerprint(JSON.parse(row.activation_json)) !== canonicalFingerprint(value)
    || (index?.activeSessionId !== undefined && index.activeSessionId !== value.sessionId)) throw new Error("Active session disagrees with canonical activation");
  db.prepare("UPDATE storage_meta SET active_session_id = ? WHERE id = 1").run(value.sessionId);}


async function verifyImportAttachmentBindings(target, prepared, index, sourceBindings) {
    const portableReferences = index?.attachments ?? [];
    if (!Array.isArray(portableReferences)) throw new Error("Invalid portable attachment manifest");
    for (const [key, reference] of prepared) sourceBindings.set(key, reference);
    for (const reference of portableReferences) {
      validateAttachmentReference(reference);
      const key = JSON.stringify([reference.taskId, reference.referenceId]);
      if (sourceBindings.has(key)) throw Object.assign(new Error("Duplicate import attachment identity"), { code: "E_STORAGE_ATTACHMENT_INVALID" });
      await verifyAttachmentFile(target, reference);
      sourceBindings.set(key, reference);
    }
}
