import { publishAttachmentFile, verifyAttachmentFile } from "./attachment-files.js";
import { insertVerifiedAttachmentReference, validateAttachmentReference } from "./attachment-references.js";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { operationalContext, getOperationalStore } from "./operational-context.js";
import { canonicalFingerprint } from "../core/artifacts.js";
import { taskStorageKey } from "../core/task-identity.js";
import { TASK_ARTIFACT_FILES } from "../core/task-paths.js";
import { artifactByteDigest } from "./artifact-bytes.js";
import { runInTransaction } from "./transaction.js";
import { assertArtifactTaskIdentity, decodeIndexedEvent, appendEvent, putArtifact, putAction, putApproval, putExecution, putSession, upsertTask } from "./repository.js";
import { resolveStoreReservationState } from "./task-guards.js";
import { isOwnedStorageSnapshot } from "./snapshot.js";

const SINGLE = Object.fromEntries(Object.entries(TASK_ARTIFACT_FILES)
  .filter(([, filename]) => filename.endsWith(".json"))
  .map(([kind, filename]) => [filename, kind]));
const COLLECTIONS = Object.freeze({ gates: "gate", actions: "action", approvals: "approval", executions: "execution", evaluations: "evaluation", decisions: "decision", handoffs: "handoff", attestations: "attestation", "structural-quality": "structuralQuality" });
const RECORD_TABLES = Object.freeze({ action: ["actions", "action_id", putAction], approval: ["approvals", "approval_id", putApproval], execution: ["executions", "execution_id", putExecution] });
const taskRowStatements = new WeakMap();

function queryTaskRow(db, taskKey) {
  if (!taskRowStatements.has(db)) taskRowStatements.set(db, db.prepare("SELECT * FROM tasks WHERE task_key = ?"));
  return taskRowStatements.get(db).get(taskKey) ?? null;
}

function storageError(code, message) {
  return Object.assign(new Error(message), { code });
}

function locator(relativePath) {
  if (typeof relativePath !== "string" || relativePath.includes("\\")) return null;
  if (relativePath === ".forgeloop/session.json") return { kind: "activeSession" };
  const session = /^\.forgeloop\/sessions\/([^/]+)\.json$/.exec(relativePath);
  if (session && !session[1].includes("..") && !session[1].includes("\u0000")) return { kind: "session", sessionId: session[1] };
  const match = /^\.forgeloop\/task-state\/([a-f0-9]{64})\/(.+)$/.exec(relativePath);
  if (!match) return null;
  const [, taskKey, name] = match;
  if (name.split("/").some(segment => !segment || segment === "." || segment === ".." || segment.includes("\u0000"))) {
    throw storageError("ARTIFACT_PATH_INVALID", "Operational artifact path escapes its logical namespace");
  }
  if (name === "events.ndjson") return { taskKey, kind: "events", artifactId: "current" };
  if (SINGLE[name]) return { taskKey, kind: SINGLE[name], artifactId: "current" };
  const separator = name.indexOf("/");
  const kind = COLLECTIONS[name.slice(0, separator)];
  if (separator > 0 && kind && name.endsWith(".json")) return { taskKey, kind, artifactId: name.slice(separator + 1, -5) };
  throw storageError("E_STORAGE_OPERATION_UNSUPPORTED", `Unsupported operational artifact: ${relativePath}`);
}

function serialized(payload) { return `${JSON.stringify(payload, null, 2)}\n`; }

function recordPayload(row, kind) {
  const payload = JSON.parse(row.payload_json);
  const fields = {
    action: { action_id: payload.actionId, idempotency_key: payload.idempotencyKey ?? null, status: payload.state ?? payload.status ?? null, revision: payload.revision ?? null },
    approval: { approval_id: payload.approvalId, action_id: payload.actionId ?? null, decision: payload.decision ?? null },
    execution: { execution_id: payload.executionId, check_id: payload.checkId ?? null, verification_cycle: payload.verificationCycle ?? null },
  }[kind];
  if (payload.taskId !== row.task_id || Object.entries(fields).some(([column, value]) => row[column] !== value)) throw storageError("E_STORAGE_PAYLOAD_MISMATCH", "Indexed operational fields disagree with their canonical payload");
  return payload;
}

function observeEventRows(db, taskId, limit, consume = null) {
  const statement = limit === null
    ? db.prepare("SELECT * FROM events WHERE task_id = ? ORDER BY seq")
    : db.prepare("SELECT * FROM events WHERE task_id = ? ORDER BY seq DESC LIMIT ?");
  const rows = limit === null ? statement.iterate(taskId) : statement.iterate(taskId, limit);
  const digest = createHash("sha256");
  for (const row of rows) {
    const event = decodeIndexedEvent(row);
    digest.update(canonicalFingerprint(row));
    if (consume) consume(event);
  }
  return digest.digest("hex");
}

/**
 * A preparation scope holds validated proposed records, never a database lock.
 * Its read set is checked again under BEGIN IMMEDIATE before any SQL mutation.
 * Each existing domain transaction remains one atomic database commit; external
 * work between transactions is neither replayed nor held under a writer lock.
 */
class OperationalStore {
  constructor(db, target, { readOnly = false, parent = null } = {}) {
    this.db = db;
    this.target = path.resolve(target);
    this.readOnly = readOnly;
    this.parent = parent;
    this.reads = new Map();
    this.snapshotTaskRows = new Map();
    this.writes = new Map();
    this.events = new Map();
    this.attachments = new Map();
    this.transaction = null;
    this.active = true;
    this.ownedLeases = new Map();
  }

  recognizes(relativePath) { return locator(relativePath) !== null; }

  artifactExists(relativePath) {
    const location = locator(relativePath);
    // Every canonical task has a logical ledger, including an empty one.
    // Presence is discovery only; readEvents still validates actual evidence.
    if (location?.kind === "events") return this.taskId(location) !== null;
    return this.readText(relativePath) !== null;
  }

  assertWritable() {
    if (this.readOnly) throw storageError("E_STORAGE_READ_ONLY", "Read-only operational scope cannot stage mutations");
  }

  observe(key, query, conflictCode = null) {
    const value = query();
    const previous = this.reads.get(key);
    // The atomic apply phase may reread its own just-written rows. Its complete
    // read set was already checked before the first write under BEGIN IMMEDIATE.
    if (this.transaction && !this.db.isTransaction && previous && canonicalFingerprint(value ?? null) !== previous.fingerprint) {
      throw storageError(previous.conflictCode ?? "E_STATE_REVISION_CONFLICT", "Operational records changed between preparation reads");
    }
    if (!this.reads.has(key)) {
      // Task writes need the observed revision, while conflict detection binds
      // the entire row through its fingerprint and live query. Do not retain
      // every descriptor/state payload alongside an immutable discovery copy.
      const retained = key.startsWith("task:") && value ? { revision: value.revision } : Array.isArray(value) ? null : value;
      this.reads.set(key, { query, value: retained, conflictCode, fingerprint: canonicalFingerprint(value ?? null) });
    }
    return value;
  }

  taskRow(taskKey) {
    const immutable = isOwnedStorageSnapshot(this.db);
    if (immutable && this.snapshotTaskRows.has(taskKey)) return this.snapshotTaskRows.get(taskKey);
    // Cache the statement, never the row; detached observations rebind this.db to the live parent.
    const row = this.observe(`task:${taskKey}`, () => queryTaskRow(this.db, taskKey));
    if (row) {
      let descriptor;
      let state;
      try {
        descriptor = JSON.parse(row.descriptor_json);
        state = row.state_json === null ? null : JSON.parse(row.state_json);
      } catch {
        throw storageError("E_STORAGE_PAYLOAD_MISMATCH", "Canonical task payload is malformed JSON");
      }
      if (descriptor.taskId !== row.task_id || descriptor.taskKey !== row.task_key
        || taskStorageKey(row.task_id) !== row.task_key || (state && state.taskId !== row.task_id)
        || row.phase !== (state?.phase ?? null) || row.revision !== (state?.revision ?? null)) {
        throw storageError("E_STORAGE_PAYLOAD_MISMATCH", "Indexed task fields disagree with canonical task payloads");
      }
    }
    // Reuse only successfully validated bytes from a live owned read-only copy.
    // Observation queries remain uncached and rebind to the parent at commit.
    if (immutable) {
      // Eviction is safe only for this owned immutable snapshot. Re-reading an
      // evicted row repeats payload validation and preserves its observation.
      if (this.snapshotTaskRows.size >= 64) this.snapshotTaskRows.delete(this.snapshotTaskRows.keys().next().value);
      this.snapshotTaskRows.set(taskKey, row ? Object.freeze(row) : null);
    }
    return row;
  }

  listTaskKeys() {
    return this.observe("task-catalog", () => this.db.prepare("SELECT task_key FROM tasks ORDER BY task_key").all()).map(row => row.task_key);
  }

  taskId(location) {
    const descriptorPath = `.forgeloop/task-state/${location.taskKey}/task.json`;
    const staged = this.writes.get(descriptorPath);
    const taskId = staged ? JSON.parse(staged.text).taskId : this.taskRow(location.taskKey)?.task_id;
    if (!taskId) return null;
    if (taskStorageKey(taskId) !== location.taskKey) throw storageError("E_TASK_KEY_MISMATCH", "Stored task identity disagrees with its namespace");
    return taskId;
  }

  artifactRow(location, taskId) {
    const table = RECORD_TABLES[location.kind];
    if (table) {
      const [name, idColumn] = table;
      const conflictCode = { action: "E_ACTION_STATE_MISMATCH", approval: "E_APPROVAL_ALREADY_RESOLVED" }[location.kind] ?? null;
      return this.observe(`record:${JSON.stringify([taskId, location.kind, location.artifactId])}`, () => this.db.prepare(`SELECT * FROM ${name} WHERE task_id = ? AND ${idColumn} = ?`).get(taskId, location.artifactId) ?? null, conflictCode);
    }
    return this.observe(`artifact:${JSON.stringify([taskId, location.kind, location.artifactId])}`, () => this.db.prepare("SELECT * FROM task_artifacts WHERE task_id = ? AND kind = ? AND artifact_id = ?").get(taskId, location.kind, location.artifactId) ?? null);
  }

  listRecords(taskId, kind) {
    const [table, idColumn] = RECORD_TABLES[kind];
    const rows = this.observe(`record-list:${taskId}:${kind}`, () => this.db.prepare(`SELECT * FROM ${table} WHERE task_id = ? ORDER BY ${idColumn}`).all(taskId));
    const records = new Map(rows.map(row => [row[idColumn], recordPayload(row, kind)]));
    for (const write of this.writes.values()) {
      if (write.location.taskKey === taskStorageKey(taskId) && write.location.kind === kind) records.set(write.location.artifactId, write.payload);
    }
    return [...records.values()];
  }

  listArtifactNames(taskId, collection) {
    const [directory, ...segments] = collection.split("/");
    const kind = COLLECTIONS[directory];
    if (!kind) throw storageError("E_STORAGE_OPERATION_UNSUPPORTED", `Unknown operational collection: ${collection}`);
    if (segments.some(segment => !segment || segment === "." || segment === ".." || segment.includes("\\") || segment.includes("\u0000"))) throw storageError("ARTIFACT_PATH_INVALID", "Invalid operational collection path");
    const prefix = segments.length ? `${segments.join("/")}/` : "";
    const record = RECORD_TABLES[kind];
    const rows = this.observe(`collection:${JSON.stringify([taskId, kind])}`, () => record
      ? this.db.prepare(`SELECT ${record[1]} AS artifact_id FROM ${record[0]} WHERE task_id = ? ORDER BY ${record[1]}`).all(taskId)
      : this.db.prepare("SELECT artifact_id FROM task_artifacts WHERE task_id = ? AND kind = ? ORDER BY artifact_id").all(taskId, kind));
    const names = new Set(rows.map(row => `${row.artifact_id}.json`));
    for (const write of this.writes.values()) {
      if (write.location.taskKey === taskStorageKey(taskId) && write.location.kind === kind) names.add(`${write.location.artifactId}.json`);
    }
    return [...names].filter(name => name.startsWith(prefix) && !name.slice(prefix.length).includes("/")).map(name => name.slice(prefix.length)).sort();
  }

  /** A finite collection capture never holds a native transaction across validation. */
  captureDecisionTexts(taskId) {
    const capture = () => {
      const entries = [];
      for (const name of this.listArtifactNames(taskId, "decisions").filter(value => /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}\.json$/.test(value)).sort()) {
        const relativePath = `.forgeloop/task-state/${taskStorageKey(taskId)}/decisions/${name}`;
        // Defer a later storage error until preceding captured values have had
        // their schema validation, preserving the existing first-error order.
        try { entries.push({ relativePath, text: this.readText(relativePath) }); }
        catch (error) { entries.push({ error }); break; }
      }
      return entries;
    };
    if (this.transaction || this.writes.size || this.events.size || this.attachments.size) return capture();
    if (this.db.isTransaction) throw storageError("E_STORAGE_SNAPSHOT_TRANSACTION", "Decision capture requires committed operational records");
    return runInTransaction(this.db, capture, { immediate: false });
  }

  actionByIdempotencyKey(taskId, idempotencyKey) {
    for (const write of this.writes.values()) {
      if (write.location.taskKey === taskStorageKey(taskId) && write.location.kind === "action" && write.payload.idempotencyKey === idempotencyKey) return write.payload;
    }
    const row = this.observe(`idempotency:${JSON.stringify([taskId, idempotencyKey])}`, () => this.db.prepare("SELECT * FROM actions WHERE task_id = ? AND idempotency_key = ?").get(taskId, idempotencyKey) ?? null, "E_ACTION_IDEMPOTENCY_CONFLICT");
    if (!row) return null;
    return recordPayload(row, "action");
  }

  executionTaskId(executionId) {
    const rows = this.observe(`execution-reference:${executionId}`, () => this.db.prepare("SELECT task_id FROM executions WHERE execution_id = ? ORDER BY task_id LIMIT 2").all(executionId));
    const taskIds = new Set(rows.map(row => row.task_id));
    for (const write of this.writes.values()) {
      if (write.location.kind === "execution" && write.location.artifactId === executionId) taskIds.add(this.taskId(write.location));
    }
    if (taskIds.size !== 1) throw storageError("E_EXECUTION_REF_INVALID", taskIds.size ? "Execution reference is ambiguous across tasks" : "Execution reference does not resolve to a canonical record");
    return [...taskIds][0];
  }

  readText(relativePath) {
    if (this.writes.has(relativePath)) return this.writes.get(relativePath).text;
    const location = locator(relativePath);
    if (!location) throw storageError("E_STORAGE_OPERATION_UNSUPPORTED", `Not an operational artifact: ${relativePath}`);
    if (location.kind === "session" || location.kind === "activeSession") {
      const row = this.observe(`session:${location.sessionId ?? "active"}`, () => location.kind === "session"
        ? this.db.prepare("SELECT * FROM sessions WHERE session_id = ?").get(location.sessionId) ?? null
        : this.db.prepare("SELECT s.* FROM sessions s JOIN storage_meta m ON m.active_session_id = s.session_id WHERE m.id = 1").get() ?? null);
      return row ? serialized(JSON.parse(row.activation_json)) : null;
    }
    const row = this.taskRow(location.taskKey);
    if (location.kind === "descriptor") return row ? serialized(JSON.parse(row.descriptor_json)) : null;
    if (location.kind === "state") return row?.state_json ? serialized(JSON.parse(row.state_json)) : null;
    const taskId = this.taskId(location);
    if (!taskId) return null;
    if (location.kind === "events") return this.readEvents(relativePath).map(event => `${JSON.stringify(event)}\n`).join("");
    const artifact = this.artifactRow(location, taskId);
    if (!artifact) return null;
    if (RECORD_TABLES[location.kind]) return serialized(recordPayload(artifact, location.kind));
    const payload = JSON.parse(artifact.payload_json);
    assertArtifactTaskIdentity(payload, taskId);
    if (artifact.fingerprint !== undefined && artifact.fingerprint !== canonicalFingerprint(payload)) throw storageError("E_STORAGE_PAYLOAD_MISMATCH", "Stored artifact fingerprint disagrees with its payload");
    if (artifact.source_json !== undefined && (artifact.source_json !== null || artifact.byte_digest !== null)) {
      artifactByteDigest({ sourceText: artifact.source_json, byteDigest: artifact.byte_digest, payload });
    }
    return artifact.source_json ?? serialized(payload);
  }

  readEvents(relativePath, limit = null) {
    if (limit === null) return [...this.iterateEvents(relativePath)];
    const location = locator(relativePath);
    if (location?.kind !== "events") throw storageError("E_EVENT_INVALID", "Expected logical ledger path");
    const taskId = this.taskId(location);
    if (!taskId) return [];
    // Audit authority still checks actual events. A tail head alone is not a
    // validation cursor; full reads bind every observed row against tampering.
    const key = `events:${taskId}:${limit ?? "all"}`;
    const storedEvents = [];
    const digest = observeEventRows(this.db, taskId, limit, event => storedEvents.push(event));
    if (!this.reads.has(key)) this.reads.set(key, { query: () => observeEventRows(this.db, taskId, limit), value: null,
      conflictCode: null, fingerprint: canonicalFingerprint(digest) });
    if (limit !== null) storedEvents.reverse();
    for (const event of this.events.get(taskId) ?? []) storedEvents.push(event);
    return limit === null ? storedEvents : storedEvents.slice(-limit);
  }

  /** A collection owner may complete this observation only after its full canonical row scan. */
  beginEventSnapshotObservation(relativePath) {
    const location = locator(relativePath);
    if (location?.kind !== "events") throw storageError("E_EVENT_INVALID", "Expected logical ledger path");
    const taskId = this.taskId(location);
    if (!taskId) throw storageError("E_TASK_NOT_FOUND", "Snapshot ledger requires its canonical task");
    const key = `events:${taskId}:all`;
    const firstObservation = !this.reads.has(key);
    if (firstObservation) this.reads.set(key, { query: () => { throw storageError("E_STORAGE_OBSERVATION_INCOMPLETE", "Event iteration was not fully consumed"); }, value: null, fingerprint: null });
    return digest => {
      if (!this.active) throw storageError("E_STORAGE_TRANSACTION_EXPIRED", "Snapshot observation scope has closed");
      if (typeof digest !== "string" || !/^[a-f0-9]{64}$/.test(digest)) throw storageError("E_STORAGE_OBSERVATION_INCOMPLETE", "Snapshot observation requires a complete row digest");
      if (firstObservation) this.reads.set(key, { query: () => observeEventRows(this.db, taskId, null), value: null,
        conflictCode: null, fingerprint: canonicalFingerprint(digest) });
    };
  }

  /** Full consumption binds every observed row; partial reads cannot authorize a commit. */
  *iterateEvents(relativePath) {
    if (!this.active) throw storageError("E_STORAGE_TRANSACTION_INVALID", "Operational iterator scope already closed");
    const location = locator(relativePath);
    if (location?.kind !== "events") throw storageError("E_EVENT_INVALID", "Expected logical ledger path");
    const taskId = this.taskId(location);
    if (!taskId) return;
    const key = `events:${taskId}:all`;
    const firstObservation = !this.reads.has(key);
    if (firstObservation) this.reads.set(key, { query: () => { throw storageError("E_STORAGE_OBSERVATION_INCOMPLETE", "Event iteration was not fully consumed"); }, value: null, fingerprint: null });
    const digest = createHash("sha256");
    for (const row of this.db.prepare("SELECT * FROM events WHERE task_id = ? ORDER BY seq").iterate(taskId)) {
      if (!this.active) throw storageError("E_STORAGE_TRANSACTION_INVALID", "Operational iterator scope already closed");
      const event = decodeIndexedEvent(row);
      digest.update(canonicalFingerprint(row));
      yield event;
    }
    if (!this.active) throw storageError("E_STORAGE_TRANSACTION_INVALID", "Operational iterator scope already closed");
    if (firstObservation) this.reads.set(key, { query: () => observeEventRows(this.db, taskId, null), value: null,
      conflictCode: null, fingerprint: canonicalFingerprint(digest.digest("hex")) });
    for (const event of this.events.get(taskId) ?? []) {
      if (!this.active) throw storageError("E_STORAGE_TRANSACTION_INVALID", "Operational iterator scope already closed");
      yield event;
    }
  }

  assertMutationTask(location) {
    if (location?.taskKey && location.taskKey !== taskStorageKey(this.transaction.taskId)) {
      throw storageError("E_TASK_CONTEXT_MISMATCH", "Operational mutation targets another task than its transaction");
    }
  }

  stageText(relativePath, text) {
    this.assertWritable();
    if (!this.transaction) throw storageError("E_STORAGE_TRANSACTION_INVALID", "Operational writes require a domain transaction");
    const location = locator(relativePath);
    if (!location || location.kind === "events") throw storageError("E_STORAGE_OPERATION_UNSUPPORTED", "Only structured operational records can be replaced");
    this.assertMutationTask(location);
    this.readText(relativePath);
    const payload = JSON.parse(text);
    if (location.kind === "descriptor" && (payload.taskKey !== location.taskKey || taskStorageKey(payload.taskId) !== location.taskKey)) {
      throw storageError("E_TASK_KEY_MISMATCH", "Proposed descriptor disagrees with its namespace");
    }
    this.writes.set(relativePath, { location, text, payload });
  }

  appendText(relativePath, text) {
    this.assertWritable();
    if (!this.transaction) throw storageError("E_STORAGE_TRANSACTION_INVALID", "Operational appends require a domain transaction");
    const location = locator(relativePath);
    this.assertMutationTask(location);
    const taskId = this.taskId(location);
    if (location?.kind !== "events" || !taskId) throw storageError("E_TASK_NOT_FOUND", "Ledger append requires an existing task descriptor");
    this.readEvents(relativePath, 1);
    const events = text.trim().split("\n").map(line => JSON.parse(line));
    if (events.some(event => event.taskId !== taskId)) throw storageError("E_EVENT_INVALID", "Ledger append has a mismatched task identity");
    this.events.set(taskId, [...(this.events.get(taskId) ?? []), ...events]);
  }

  stageDelete(relativePath) {
    this.assertWritable();
    if (!this.transaction) throw storageError("E_STORAGE_TRANSACTION_INVALID", "Operational deletion requires a domain transaction");
    const location = locator(relativePath);
    if (!location || !["state", "recovery", "continuity"].includes(location.kind)) throw storageError("E_STORAGE_OPERATION_UNSUPPORTED", "Audit records cannot be deleted through the mutation overlay");
    this.assertMutationTask(location);
    if (this.readText(relativePath) === null) {
      const taskId = this.taskId(location);
      const observed = this.reads.get(`artifact:${JSON.stringify([taskId, location.kind, location.artifactId])}`);
      if (observed?.value) throw storageError("E_STATE_REVISION_CONFLICT", "Operational deletion target changed during preparation");
      throw storageError("ARTIFACT_MISSING", "Operational deletion target is missing");
    }
    this.writes.set(relativePath, { location, text: null, payload: null, deleted: true });
  }

  commit() {
    this.assertWritable();
    runInTransaction(this.db, () => {
      for (const [key, observation] of this.reads) {
        if (canonicalFingerprint(observation.query() ?? null) !== observation.fingerprint) {
          if (key === "task-catalog" && [...this.writes.values()].some(write => write.location.kind === "descriptor")) {
            throw storageError("E_STORAGE_CATALOG_CHANGED", "Claim candidates changed before reservation");
          }
          if (observation.conflictCode) throw storageError(observation.conflictCode, "Operational binding changed during preparation");
          throw storageError("E_STATE_REVISION_CONFLICT", "Operational records changed while this mutation was prepared");
        }
      }
      const descriptors = [...this.writes.values()].filter(write => write.location.kind === "descriptor");
      for (const write of descriptors) {
        const descriptor = write.payload;
        const previous = this.db.prepare("SELECT state_json FROM tasks WHERE task_id = ?").get(descriptor.taskId);
        upsertTask(this.db, { taskId: descriptor.taskId, descriptor, state: previous?.state_json ? JSON.parse(previous.state_json) : null });
        this.db.prepare("DELETE FROM claims WHERE task_id = ?").run(descriptor.taskId);
        const insert = this.db.prepare("INSERT INTO claims (task_id, claim_norm, reservation_state, created_at) VALUES (?, ?, 'ACTIVE', ?)");
        for (const claim of descriptor.writeClaims) insert.run(descriptor.taskId, claim, descriptor.updatedAt);
      }
      for (const write of this.writes.values()) this.apply(write);
      for (const reference of this.attachments.values()) insertVerifiedAttachmentReference(this.db, reference);
      for (const [taskId, events] of this.events) for (const event of events) appendEvent(this.db, { taskId, event });
      const affectedTasks = new Set(this.events.keys());
      for (const write of this.writes.values()) if (write.location.taskKey) affectedTasks.add(this.taskId(write.location));
      for (const taskId of affectedTasks) {
        const reservationState = resolveStoreReservationState(this.db, taskId);
        this.db.prepare("UPDATE claims SET reservation_state = ? WHERE task_id = ?").run(reservationState, taskId);
      }
    });
    this.reads.clear();
    this.writes.clear();
    this.events.clear();
    this.attachments.clear();
  }

  apply({ location, payload, text, deleted = false }) {
    if (location.kind === "session") {
      if (payload.sessionId !== location.sessionId) throw storageError("E_STORAGE_PAYLOAD_MISMATCH", "Activation belongs to another session");
      putSession(this.db, { sessionId: location.sessionId, activation: payload });
      return;
    }
    if (location.kind === "activeSession") {
      this.db.prepare("UPDATE storage_meta SET active_session_id = ? WHERE id = 1").run(payload.sessionId);
      return;
    }
    const taskId = this.taskId(location);
    if (!taskId) throw storageError("E_TASK_NOT_FOUND", "Operational mutation requires its canonical descriptor");
    if (deleted) {
      if (location.kind === "state") this.db.prepare("UPDATE tasks SET phase = NULL, revision = NULL, state_json = NULL WHERE task_id = ?").run(taskId);
      else this.db.prepare("DELETE FROM task_artifacts WHERE task_id = ? AND kind = ? AND artifact_id = ?").run(taskId, location.kind, location.artifactId);
      return;
    }
    if (location.kind === "descriptor") return;
    if (location.kind === "state") {
      if (payload.taskId !== taskId) throw storageError("E_TASK_ID_MISMATCH", "State belongs to another task");
      const expectedRevision = this.reads.get(`task:${location.taskKey}`)?.value?.revision ?? null;
      const changed = this.db.prepare("UPDATE tasks SET phase = ?, revision = ?, state_json = ? WHERE task_id = ? AND revision IS ?").run(payload.phase, payload.revision ?? null, JSON.stringify(payload), taskId, expectedRevision);
      if (changed.changes !== 1) throw storageError("E_STATE_REVISION_CONFLICT", "State mutation lost its task");
      return;
    }
    const table = RECORD_TABLES[location.kind];
    if (table) {
      if (payload.taskId !== taskId || payload[`${location.kind}Id`] !== location.artifactId) throw storageError("E_STORAGE_PAYLOAD_MISMATCH", "Proposed operational record has a mismatched identity");
      table[2](this.db, { taskId, [location.kind]: payload });
    }
    else putArtifact(this.db, { taskId, kind: location.kind, artifactId: location.artifactId, payload, sourceText: text });
  }
}

function writableAncestor(store) {
  let current = store;
  while (current && current.readOnly) current = current.parent;
  return current ?? null;
}

async function commitPreparedStore(store, packageRoot) {
  // A new task can appear during preparation. Refresh only the claim inputs,
  // through the shared domain validator, before trying to reserve the writer
  // again. Do not replay the command callback or any external operation.
  for (let refresh = 0; ; refresh += 1) {
    try { store.commit(); return; }
    catch (error) {
      if (error.code !== "E_STORAGE_CATALOG_CHANGED" || refresh >= 3) throw error;
      store.reads.delete("task-catalog");
      const { discoverTasks } = await import("../core/task-discovery.js");
      const { assertNoScopeConflicts } = await import("../core/task-scope.js");
      const tasks = await discoverTasks(store.target, packageRoot);
      for (const write of store.writes.values()) {
        if (write.location.kind === "descriptor") assertNoScopeConflicts(write.payload.writeClaims, tasks, write.payload.taskId);
      }
    }
  }
}

export async function withOperationalStore({ db, target, readOnly = false }, callback) {
  const existing = getOperationalStore(target);
  if (existing) {
    if (existing.db !== db) throw storageError("E_TASK_CONTEXT_MISMATCH", "Cannot switch stores in an active project scope");
    return callback(existing);
  }
  const store = new OperationalStore(db, target, { readOnly });
  try { return await operationalContext.run(store, () => callback(store)); }
  finally { store.active = false; }
}

/** A detached immutable audit scope cannot stage mutations or replace caller observations. */
export async function withOperationalReadSnapshot({ db, target }, callback) {
  const source = getOperationalStore(target);
  if (source?.transaction || source?.writes.size || source?.events.size || source?.attachments.size) {
    throw storageError("E_STORAGE_SNAPSHOT_TRANSACTION", "Detached audit requires committed operational records");
  }
  // A detached scope is an immutable audit view even when its parent owns a
  // writable leased connection. Its observations may still be merged into a
  // writable parent after the view closes, but the view itself must never
  // prepare or commit mutations against its snapshot handle.
  const store = new OperationalStore(db, target, { readOnly: true, parent: source });
  store.stageText = store.appendText = store.stageDelete = () => {
    throw storageError("E_STORAGE_READ_ONLY", "Detached audit cannot stage operational writes");
  };
  try { return await operationalContext.run(store, () => callback(store)); }
  finally {
    store.active = false;
    store.snapshotTaskRows.clear();
    const writable = writableAncestor(source);
    if (writable) {
      // Observation queries resolve this store's db at commit time. Preserve
      // snapshot fingerprints, but query the live parent connection on recheck.
      Object.defineProperty(store, "db", { configurable: true, get: () => writable.db });
      for (const [key, observation] of store.reads) {
        if (!writable.reads.has(key)) writable.reads.set(key, observation);
      }
    }
    // The detached scope is closed now. Any observations needed by a writable
    // ancestor were copied above; release this scope's query closures and
    // fingerprints so the closed snapshot cannot be retained by its map.
    store.reads.clear();
    // Closed detached scopes no longer need their parent chain. The deferred
    // observations retain this store and resolve through the writable db getter
    // above, so releasing the chain avoids retaining closed snapshot handles.
    store.parent = null;
  }
}

export async function withOperationalTransaction({ target, taskId, operation, packageRoot, recordCommitEvent }, callback) {
  const store = getOperationalStore(target);
  if (!store) throw storageError("E_STORAGE_OPERATION_UNSUPPORTED", "No operational store selected");
  if (store.readOnly) throw storageError("E_STORAGE_READ_ONLY", "Read-only operational scope cannot prepare mutations");
  if (store.transaction) {
    if (store.transaction.taskId !== taskId) throw storageError("E_TASK_CONTEXT_MISMATCH", "Nested transaction targets another task");
    return callback(store.transaction);
  }
  const { readOperationalLease } = await import("./leases.js");
  const lease = readOperationalLease(store, taskId);
  if (lease && store.ownedLeases.get(taskId) !== lease.lockId) throw storageError("E_TASK_LOCKED", "Task is reserved by another external operation");
  const assertCurrent = () => {
    if (!store.active || store.transaction !== transaction) throw storageError("E_STORAGE_TRANSACTION_EXPIRED", "Operational preparation transaction has already closed");
  };
  const transaction = {
    target: store.target, taskId, operation, kind: "sqlite", transactionId: `txn-${randomUUID()}`,
    readText: relativePath => { assertCurrent(); return store.readText(relativePath); },
    stageText: (relativePath, text) => { assertCurrent(); return store.stageText(relativePath, text); },
    appendText: (relativePath, text) => { assertCurrent(); return store.appendText(relativePath, text); },
    stageDelete: relativePath => { assertCurrent(); return store.stageDelete(relativePath); },
    stageAttachment: async ({ referenceId, readable }) => {
      assertCurrent();
      const binding = await publishAttachmentFile(store.target, readable, { db: store.db });
      const reference = validateAttachmentReference({ taskId, referenceId, ...binding });
      await verifyAttachmentFile(store.target, reference);
      assertCurrent();
      const key = JSON.stringify([taskId, referenceId]);
      const prior = store.attachments.get(key);
      if (prior && canonicalFingerprint(prior) !== canonicalFingerprint(reference)) throw storageError("E_STORAGE_ATTACHMENT_INVALID", "Staged immutable attachment identity names different bytes");
      store.attachments.set(key, reference);
      return reference;
    },
  };
  store.transaction = transaction;
  try {
    const result = await callback(transaction);
    if (recordCommitEvent) {
      const { appendProtocolEvent } = await import("../core/events.js");
      await appendProtocolEvent(target, { taskId, event: "TRANSACTION_COMMITTED", details: { transactionId: transaction.transactionId, operation } }, packageRoot, { taskId });
    }
    await commitPreparedStore(store, packageRoot);
    return result;
  } catch (error) {
    store.reads.clear(); store.writes.clear(); store.events.clear(); store.attachments.clear();
    throw error;
  } finally { store.transaction = null; }
}
