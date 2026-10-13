import { artifactByteDigest } from "./artifact-bytes.js";
import { assertStorageTopology } from "./topology.js";
import { validateAttachmentReference } from "./attachment-binding.js";
import { canonicalFingerprint } from "../core/artifacts.js";
import { eventHash, validateKnownEventDetails } from "../core/events.js";
import { loadStorageDriver } from "./runtime.js";
import { lstatSync, realpathSync } from "node:fs";
import path from "node:path";
import { isPathWithin } from "../core/filesystem.js";

import { PROTOCOL_VERSION } from "../core/protocol.js";
import { OPTIONAL_STORAGE_INDEXES, SCHEMA_MIGRATIONS, STORAGE_FORMAT, STORAGE_FORMAT_VERSION, STORAGE_SCHEMA_VERSION } from "./schema.js";

/**
 * Canonical on-disk location of the authoritative operational store for one
 * project state root. One database per state root keeps task/claim/event
 * mutations inside a single transaction without cross-database coordination.
 */
export { STORAGE_RELATIVE_PATH } from "./schema.js";

/**
 * Durability and concurrency defaults.
 *
 * `synchronous=FULL` matches the durability the filesystem transaction
 * implementation provided via fsync-before-rename, so migration does not
 * silently trade crash safety for speed. `busy_timeout` mirrors the 5s
 * transaction wait the previous write-lock loop allowed.
 */
export const BUSY_TIMEOUT_MS = 5_000;

/**
 * Pragma settings that must be confirmed after they are applied.
 *
 * `column` differs from `pragma` for busy_timeout: SQLite reports that value
 * under the key `timeout`, so asserting on the pragma name would silently read
 * `undefined` and reject every store.
 */
function pragmaAssertions(busyTimeoutMs) {
  return [
    { pragma: "journal_mode", column: "journal_mode", expected: "wal" },
    { pragma: "foreign_keys", column: "foreign_keys", expected: 1 },
    { pragma: "synchronous", column: "synchronous", expected: 2 },
    { pragma: "busy_timeout", column: "timeout", expected: busyTimeoutMs },
  ];
}

/** Stable error codes surfaced to callers and mapped by the CLI layer. */
export const STORAGE_ERROR_CODES = Object.freeze({
  CORRUPT: "E_STORAGE_CORRUPT",
  READ_ONLY: "E_STORAGE_READ_ONLY",
  BUSY: "E_STORAGE_BUSY",
  FULL: "E_STORAGE_FULL",
  INTERRUPTED: "E_STORAGE_INTERRUPTED",
  UNSUPPORTED_VERSION: "E_STORAGE_VERSION_UNSUPPORTED",
  UNSUPPORTED_RUNTIME: "E_STORAGE_UNSUPPORTED_RUNTIME",
});

/**
 * SQLite primary result codes that map to an explicitly recoverable condition.
 *
 * `node:sqlite` reports `errcode` as the numeric SQLite result code, so the
 * mapping is keyed by number. A previous implementation keyed on symbolic
 * strings and therefore never matched, letting a locked database surface as an
 * opaque `ERR_SQLITE_ERROR` instead of a documented busy condition.
 */
const SQLITE_RESULT_CODE_MAP = Object.freeze({
  5: STORAGE_ERROR_CODES.BUSY,    // SQLITE_BUSY
  6: STORAGE_ERROR_CODES.BUSY,    // SQLITE_LOCKED
  8: STORAGE_ERROR_CODES.READ_ONLY, // SQLITE_READONLY
  11: STORAGE_ERROR_CODES.CORRUPT,  // SQLITE_CORRUPT
  26: STORAGE_ERROR_CODES.CORRUPT,  // SQLITE_NOTADB (damaged database header)
  13: STORAGE_ERROR_CODES.FULL,     // SQLITE_FULL
  14: STORAGE_ERROR_CODES.INTERRUPTED, // SQLITE_CANTOPEN
  10: STORAGE_ERROR_CODES.INTERRUPTED, // SQLITE_IOERR
  9: STORAGE_ERROR_CODES.INTERRUPTED,  // SQLITE_INTERRUPT
});

/** Extended result codes that carry the same primary code in their low bits. */
function primaryResultCode(errcode) {
  if (typeof errcode === "number") return errcode & 0xff;
  if (typeof errcode === "string" && /^\d+$/.test(errcode)) return Number(errcode) & 0xff;
  return null;
}

/**
 * Detect whether this runtime can host the store at all.
 */
export function assertStorageRuntime() {
  return loadStorageDriver();
}

/**
 * Translate a raw `node:sqlite` failure into a stable, explicitly recoverable
 * storage error. Anything unrecognized is rethrown untouched so real defects are
 * never masked as environment conditions.
 */
export function translateStorageError(error) {
  const primary = primaryResultCode(error?.errcode);
  const mapped = primary === null ? null : SQLITE_RESULT_CODE_MAP[primary];
  if (!mapped) throw error;
  const translated = new Error(
    `SQLite storage operation failed (SQLITE_${primary}, ${error.errstr ?? error.message}): ${error.message}`,
  );
  translated.code = mapped;
  translated.sqliteResultCode = primary;
  translated.cause = error;
  throw translated;
}
/**
 * Apply the connection defaults. Extension loading is never enabled and all
 * callers bind SQL parameters, so user-authored text can never be interpreted
 * as schema or executable SQL.
 */
function applyConnectionSettings(db, busyTimeoutMs) {
  db.exec(`PRAGMA busy_timeout = ${busyTimeoutMs}`);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA synchronous = FULL");
  db.exec(`PRAGMA busy_timeout = ${busyTimeoutMs}`);
}

/**
 * Confirm the effective settings rather than trusting that the statements
 * succeeded. A filesystem that silently refuses WAL must fail loudly here
 * instead of degrading durability invisibly.
 */
function assertConnectionSettings(db, busyTimeoutMs) {
  for (const assertion of pragmaAssertions(busyTimeoutMs)) {
    const row = db.prepare(`PRAGMA ${assertion.pragma}`).get();
    const actual = row?.[assertion.column];
    const normalized = typeof actual === "string" ? actual.toLowerCase() : actual;
    if (normalized !== assertion.expected) {
      const error = new Error(
        `SQLite refused required pragma ${assertion.pragma} (expected ${assertion.expected}, got ${actual})`,
      );
      error.code = STORAGE_ERROR_CODES.UNSUPPORTED_RUNTIME;
      throw error;
    }
  }
}

/**
 * Create every table that is not yet present, then stamp the schema version.
 *
 * The whole migration runs inside one immediate transaction so that two
 * processes opening the same fresh database cannot interleave their
 * check-then-create sequence. Without that, a concurrent opener could observe
 * a partially created schema and fail with a busy or "table already exists"
 * error before it ever reached application code.
 */
function assertCompatibleMetadata(db, { readOnly = false } = {}) {
  const meta = db.prepare("SELECT * FROM storage_meta WHERE id = 1").get();
  if (!meta || !Number.isInteger(meta.schema_version) || meta.schema_version < 1
    || meta.schema_version > STORAGE_SCHEMA_VERSION || meta.storage_version !== STORAGE_FORMAT_VERSION
    || meta.storage_format !== STORAGE_FORMAT || meta.protocol_version !== PROTOCOL_VERSION) {
    const error = new Error("Storage metadata is missing or incompatible with this runtime");
    error.code = STORAGE_ERROR_CODES.UNSUPPORTED_VERSION;
    throw error;
  }
  if (readOnly && meta.schema_version !== STORAGE_SCHEMA_VERSION) {
    const error = new Error("Storage schema requires an explicit writable upgrade before read-only access");
    error.code = "E_STORAGE_MIGRATION_REQUIRED";
    throw error;
  }
}

export function assertStorageMetadataCurrent(db) {
  assertCompatibleMetadata(db, { readOnly: true });
}

function applyMigrations(db, { now = new Date().toISOString() } = {}) {
  const hasMetadata = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'storage_meta'").get();
  if (hasMetadata) {
    assertCompatibleMetadata(db);
    if (db.prepare("SELECT schema_version FROM storage_meta WHERE id = 1").get().schema_version === STORAGE_SCHEMA_VERSION) return;
  }
  db.exec("BEGIN IMMEDIATE");
  try {
    const existing = new Set(
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name),
    );
    if (existing.has("storage_meta")) assertCompatibleMetadata(db);
    for (const migration of SCHEMA_MIGRATIONS) {
      if (existing.has("storage_meta")) {
        const row = db.prepare("SELECT schema_version FROM storage_meta WHERE id = 1").get();
        if (row && Number(row.schema_version) >= migration.version) continue;
      }
      for (const statement of migration.statements) {
        if (statement.startsWith("CREATE TABLE ")) {
          const table = statement.slice("CREATE TABLE ".length).split(/[\s(]/)[0];
          if (existing.has(table)) continue;
          existing.add(table);
        }
        db.exec(statement);
      }
    }
    db.prepare(
      `INSERT INTO storage_meta (id, storage_version, schema_version, protocol_version, storage_format, created_at, updated_at)
       VALUES (1, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET schema_version = excluded.schema_version, updated_at = excluded.updated_at`,
    ).run(STORAGE_FORMAT_VERSION, STORAGE_SCHEMA_VERSION, PROTOCOL_VERSION ?? null, STORAGE_FORMAT, now, now);
    db.exec("COMMIT");
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* preserve the migration failure */ }
    throw error;
  }
}

function ensureOptionalIndexes(db) {
  const exists = db.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'index' AND name = ?");
  for (const index of OPTIONAL_STORAGE_INDEXES) {
    if (!exists.get(index.name)) db.exec(index.statement);
  }
}

/** Check SQLite's opened filename before configuration or reuse of a project handle. */
export function assertProjectDatabaseAdmission(db, admission) {
  if (!admission) return;
  const expected = path.join(admission.root, ".forgeloop/state.sqlite");
  const changed = () => Object.assign(new Error("Project database path changed while opening or reusing its connection"), { code: "E_STORAGE_MIGRATION_REQUIRED" });
  try {
    const root = lstatSync(admission.target, { bigint: true });
    if (!root.isDirectory() || root.isSymbolicLink()) throw changed();
    if (admission.rootIdentity && ["dev", "ino", "mtimeNs", "ctimeNs"].some(key => root[key] !== admission.rootIdentity[key])) throw changed();
    const opened = realpathSync.native(db.location());
    const resolvedExpected = realpathSync.native(expected);
    const current = lstatSync(expected, { bigint: true });
    if (!isPathWithin(resolvedExpected, opened) || !isPathWithin(opened, resolvedExpected)
      || !current.isFile() || current.isSymbolicLink()
      || current.dev !== admission.dev || current.ino !== admission.ino) throw changed();
    for (const suffix of ["-wal", "-shm"]) {
      try {
        const sidecar = lstatSync(`${expected}${suffix}`);
        if (!sidecar.isFile() || sidecar.isSymbolicLink()) throw changed();
      } catch (error) { if (error.code !== "ENOENT") throw error; }
    }
  } catch (error) {
    if (["ENOENT", "ENOTDIR", "ELOOP"].includes(error.code)) throw changed();
    throw error;
  }
}

/**
 * Open the operational store, apply durability defaults, and ensure the schema
 * is current. The caller owns the returned handle and must `close()` it.
 */
export function openStorageDatabase(databasePath, {
  readOnly = false,
  allowSchemaUpgrade = true,
  allowOptionalIndexCreation = allowSchemaUpgrade,
  now = new Date().toISOString(),
  busyTimeoutMs = BUSY_TIMEOUT_MS,
  projectAdmission = null,
} = {}) {
  const { DatabaseSync } = assertStorageRuntime();
  if (!Number.isInteger(busyTimeoutMs) || busyTimeoutMs < 0 || busyTimeoutMs > 2_147_483_647) {
    const error = new Error("busyTimeoutMs must be a non-negative SQLite timeout integer");
    error.code = "E_STORAGE_CONFIGURATION_INVALID";
    throw error;
  }
  assertStorageTopology(databasePath);
  let db;
  try {
    db = new DatabaseSync(databasePath, { readOnly, open: true, enableForeignKeyConstraints: true });
    assertProjectDatabaseAdmission(db, projectAdmission);
    applyConnectionSettings(db, busyTimeoutMs);
    assertConnectionSettings(db, busyTimeoutMs);
    if (!readOnly && allowSchemaUpgrade) applyMigrations(db, { now });
    else assertCompatibleMetadata(db, { readOnly: true });
    // Optional indexes preserve the marker-bound schema and exact fallback query.
    // Inspect first: opening an indexed store needs no DDL writer reservation.
    if (!readOnly && allowOptionalIndexCreation) ensureOptionalIndexes(db);
  } catch (error) {
    if (db) {
      try { db.close(); } catch { /* preserve the original failure */ }
    }
    if (typeof error?.code === "string" && error.code.startsWith("E_STORAGE_")) throw error;
    return translateStorageError(error);
  }
  return db;
}

/** Read the store metadata singleton, or `null` for an uninitialized database. */
export function readStorageMeta(db) {
  const table = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'storage_meta'")
    .get();
  if (!table) return null;
  return db.prepare("SELECT * FROM storage_meta WHERE id = 1").get() ?? null;
}

function validateStoredEvent(row, sequence, previousHash) {
  const event = JSON.parse(row.event_json);
  if (event.taskId !== row.task_id || event.seq !== row.seq || event.event !== row.event_type
    || event.at !== row.at || event.hash !== row.hash || event.previousHash !== row.previous_hash
    || event.seq !== sequence || event.previousHash !== previousHash || event.hash !== eventHash(event)) {
    throw Object.assign(new Error("Stored ledger identity, ordering or hash mismatch"), { code: "E_LEDGER_HASH_INVALID" });
  }
  validateKnownEventDetails(event);
}

function collectNativeFindings(statement, project = row => row) {
  const findings = [];
  let total = 0;
  for (const row of statement.iterate()) {
    total += 1;
    if (findings.length < 100) findings.push(project(row));
  }
  return { findings, total };
}

function nativeIntegrityFindings(db) {
  const integrity = collectNativeFindings(db.prepare("PRAGMA integrity_check"), row => row.integrity_check);
  const foreignKeys = collectNativeFindings(db.prepare("PRAGMA foreign_key_check"));
  const truncatedFindings = {};
  for (const [name, result] of Object.entries({ integrity, foreignKeys })) {
    if (result.total > result.findings.length) truncatedFindings[name] = { total: result.total, reported: result.findings.length };
  }
  return {
    integrity: integrity.findings,
    foreignKeys: foreignKeys.findings,
    ...(Object.keys(truncatedFindings).length ? { truncatedFindings } : {}),
  };
}

/**
 * Run the integrity and foreign-key checks the plan requires before a cutover
 * is published. Scans all rows but retains at most 100 native findings per
 * check, reporting truncation instead of silently dropping diagnostics.
 */
export function checkStorageIntegrity(db) {
  const native = nativeIntegrityFindings(db);
  const { integrity, foreignKeys } = native;
  const artifactErrors = [];
  const eventErrors = [];
  const attachmentErrors = [];
  let taskId = null;
  let sequence = 0;
  let previousHash = null;
  for (const row of db.prepare("SELECT * FROM events ORDER BY task_id, seq").iterate()) {
    if (row.task_id !== taskId) { taskId = row.task_id; sequence = 0; previousHash = null; }
    sequence += 1;
    try {
      validateStoredEvent(row, sequence, previousHash);
    } catch (error) {
      // Findings are bounded even when every event of a large ledger is bad.
      if (eventErrors.length < 100) eventErrors.push({ taskId, sequence: row.seq, code: error.code ?? "E_EVENT_INVALID" });
    }
    previousHash = row.hash;
  }
  for (const row of db.prepare("SELECT task_id, kind, artifact_id, payload_json, fingerprint, source_json, byte_digest FROM task_artifacts").iterate()) {
    try {
      if (row.fingerprint !== canonicalFingerprint(JSON.parse(row.payload_json))) throw Object.assign(new Error("Artifact fingerprint mismatch"), { code: "E_STORAGE_ARTIFACT_INVALID" });
      if (row.source_json === null && row.byte_digest === null) continue;
      artifactByteDigest({ sourceText: row.source_json, byteDigest: row.byte_digest, payload: JSON.parse(row.payload_json) });
    } catch (error) {
      if (artifactErrors.length < 100) artifactErrors.push({ taskId: row.task_id, kind: row.kind, artifactId: row.artifact_id, code: error.code ?? "E_STORAGE_ARTIFACT_INVALID" });
    }
  }
  for (const row of db.prepare("SELECT * FROM attachment_references ORDER BY task_id, reference_id").iterate()) {
    try {
      validateAttachmentReference({ taskId: row.task_id, referenceId: row.reference_id, path: row.path, size: row.size, sha256: row.sha256 });
    } catch (error) {
      if (attachmentErrors.length < 100) attachmentErrors.push({ taskId: row.task_id, referenceId: row.reference_id, code: error.code ?? "E_STORAGE_ATTACHMENT_INVALID" });
    }
  }
  return {
    artifactErrors,
    eventErrors,
    attachmentErrors,
    ok: attachmentErrors.length === 0 && eventErrors.length === 0 && artifactErrors.length === 0 && integrity.length === 1 && integrity[0] === "ok" && foreignKeys.length === 0,
    integrity,
    foreignKeys,
    ...native,
  };
}
