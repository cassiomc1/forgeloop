import { createHash } from "node:crypto";
import { canonicalFingerprint } from "../core/artifacts.js";
import { taskStorageKey } from "../core/task-identity.js";
import { assertWritableContext, runInTransaction } from "./transaction.js";

/**
 * Query and write helpers for the operational store.
 *
 * These functions own persistence, constraints, ordering, and atomicity only.
 * Lifecycle transitions, authority, schema checks, and evidence validation stay
 * in the domain services, exactly as the migration plan requires.
 *
 * Every writer calls `assertWritableContext(db)` first, so a write attempted
 * from a callback whose transaction already closed is rejected instead of
 * silently committing outside the transaction that was supposed to cover it.
 */

/** Guard a write against an expired transaction context. */
function guard(db) {
  assertWritableContext(db);
}

/** Serialize a payload the same way every other ForgeLoop fingerprint does. */
function encode(value) {
  return JSON.stringify(value ?? null);
}

function decode(text) {
  if (text === null || text === undefined) return null;
  try { return JSON.parse(text); }
  catch { throw Object.assign(new Error("Stored operational payload is not valid JSON"), { code: "E_STORAGE_PAYLOAD_MISMATCH" }); }
}

/** Payload task identity, when present, must agree with its canonical owner. */
export function assertArtifactTaskIdentity(payload, taskId) {
  if (payload?.taskId !== undefined && payload.taskId !== taskId) throw Object.assign(new Error("Artifact payload has a mismatched task identity"), { code: "E_STORAGE_PAYLOAD_MISMATCH", taskIdentityMismatch: true });
}

/** Bind extracted record columns to their canonical payload before projection. */
export function decodeIndexedRecord(row, kind, { requireTaskIdentity = false } = {}) {
  const payload = decode(row.payload_json);
  assertArtifactTaskIdentity(payload, row.task_id);
  const fields = {
    action: { action_id: payload?.actionId, idempotency_key: payload?.idempotencyKey ?? null, status: payload?.state ?? payload?.status ?? null, revision: payload?.revision ?? null },
    approval: { approval_id: payload?.approvalId, action_id: payload?.actionId ?? null, decision: payload?.decision ?? null },
    execution: { execution_id: payload?.executionId, check_id: payload?.checkId ?? null, verification_cycle: payload?.verificationCycle ?? null },
  }[kind];
  if (!fields || (requireTaskIdentity && payload?.taskId !== row.task_id)
    || Object.entries(fields).some(([column, value]) => row[column] !== value)) {
    throw Object.assign(new Error("Indexed operational fields disagree with their canonical payload"), { code: "E_STORAGE_PAYLOAD_MISMATCH" });
  }
  return payload;
}

/* ------------------------------------------------------------------ tasks */

/**
 * Insert or replace a task snapshot. Extracted columns and the canonical
 * payloads are written in one statement so the two representations can never
 * drift apart.
 */
export function upsertTask(db, { taskId, taskKey = taskStorageKey(taskId), descriptor, state = null }) {
  guard(db);
  if (typeof taskId !== "string" || !taskId) throw new TypeError("upsertTask requires taskId");
  if (typeof taskKey !== "string" || !taskKey) throw new TypeError("upsertTask requires taskKey");
  db.prepare(
    `INSERT INTO tasks (task_id, task_key, phase, revision, created_at, updated_at, descriptor_json, state_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (task_id) DO UPDATE SET
       task_key = excluded.task_key,
       phase = excluded.phase,
       revision = excluded.revision,
       created_at = excluded.created_at,
       updated_at = excluded.updated_at,
       descriptor_json = excluded.descriptor_json,
       state_json = excluded.state_json`,
  ).run(
    taskId,
    taskKey,
    state?.phase ?? null,
    Number.isInteger(state?.revision) ? state.revision : null,
    descriptor?.createdAt ?? null,
    descriptor?.updatedAt ?? null,
    encode(descriptor),
    state === null ? null : encode(state),
  );
}

function hydrateTask(row) {
  if (!row) return null;
  return {
    taskId: row.task_id,
    taskKey: row.task_key,
    phase: row.phase,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    descriptor: decode(row.descriptor_json),
    state: decode(row.state_json),
  };
}

/**
 * Direct indexed lookup. This is the query that replaces the previous
 * `findTaskById()` -> `discoverTasks()` project-wide traversal.
 */
export function findTaskById(db, taskId) {
  const row = db.prepare("SELECT * FROM tasks WHERE task_id = ?").get(taskId);
  return hydrateTask(row);
}

export function findTaskByKey(db, taskKey) {
  const row = db.prepare("SELECT * FROM tasks WHERE task_key = ?").get(taskKey);
  return hydrateTask(row);
}

/** Paginated listing with a stable ordering, for discovery projections. */
export function listTasks(db, { phase = null, limit = 50, offset = 0 } = {}) {
  if (!Number.isInteger(limit) || limit < 1) throw new TypeError("limit must be a positive integer");
  if (!Number.isInteger(offset) || offset < 0) throw new TypeError("offset must be a non-negative integer");
  const rows = phase
    ? db.prepare("SELECT * FROM tasks WHERE phase = ? ORDER BY updated_at, task_id LIMIT ? OFFSET ?").all(phase, limit, offset)
    : db.prepare("SELECT * FROM tasks ORDER BY updated_at, task_id LIMIT ? OFFSET ?").all(limit, offset);
  return rows.map(hydrateTask);
}

export function countTasks(db) {
  return db.prepare("SELECT COUNT(*) AS total FROM tasks").get().total;
}

/**
 * Apply a state snapshot only when the stored revision still matches
 * `expectedRevision`, mirroring the existing optimistic-concurrency contract.
 * Returns false when the conditional update matched no row.
 */
export function mutateTaskState(db, { taskId, expectedRevision, state }) {
  guard(db);
  const result = db.prepare(
    "UPDATE tasks SET phase = ?, revision = ?, state_json = ?, updated_at = ? WHERE task_id = ? AND revision IS ?",
  ).run(
    state?.phase ?? null,
    Number.isInteger(state?.revision) ? state.revision : null,
    encode(state),
    state?.lastUpdated ?? new Date().toISOString(),
    taskId,
    expectedRevision,
  );
  return result.changes === 1;
}

/* ----------------------------------------------------------------- claims */

/**
 * Reserve claims for a task. Callers must evaluate `claimsOverlap()` over the
 * candidate rows first: exact-path uniqueness in the database cannot detect
 * directory, wildcard, or ancestor/descendant conflicts.
 */
export function reserveClaims(db, { taskId, claims, createdAt = new Date().toISOString() }) {
  guard(db);
  const insert = db.prepare(
    "INSERT INTO claims (task_id, claim_norm, reservation_state, created_at) VALUES (?, ?, 'ACTIVE', ?)",
  );
  for (const claim of claims) {
    insert.run(taskId, claim, createdAt);
  }
  return claims.length;
}

/** Candidate rows whose normalized claim matches any supplied value. */
export function findOverlappingClaims(db, claims) {
  if (!claims.length) return [];
  const placeholders = claims.map(() => "?").join(", ");
  return db.prepare(
    `SELECT c.task_id, c.claim_norm, c.reservation_state, t.phase
       FROM claims c JOIN tasks t ON t.task_id = c.task_id
      WHERE c.claim_norm IN (${placeholders}) AND c.reservation_state = 'ACTIVE'
      ORDER BY c.task_id, c.claim_norm`,
  ).all(...claims);
}

export function listClaims(db, taskId) {
  return [...iterateClaims(db, taskId)];
}

export function* iterateClaims(db, taskId) {
  yield* db.prepare("SELECT * FROM claims WHERE task_id = ? ORDER BY claim_norm").iterate(taskId);
}

export function releaseClaims(db, taskId) {
  guard(db);
  return db.prepare("DELETE FROM claims WHERE task_id = ?").run(taskId).changes;
}


/* ----------------------------------------------------------------- events */

/**
 * Append one event to the canonical ledger. The stored `hash` and
 * `previous_hash` are taken from the caller unchanged: this store never
 * rehashes or rewrites historical evidence, it only preserves it.
 */
export function appendEvent(db, { taskId, event }) {
  guard(db);
  if (typeof event?.seq !== "number" || typeof event?.hash !== "string" || typeof event?.event !== "string") {
    throw new TypeError("appendEvent requires a complete event with seq, event, and hash");
  }
  db.prepare(
    `INSERT INTO events (task_id, seq, event_type, at, previous_hash, hash, event_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    taskId,
    event.seq,
    event.event,
    event.at ?? null,
    event.previousHash ?? null,
    event.hash,
    encode(event),
  );
  return event.seq;
}

/** Read a bounded tail, the access path that replaces the sidecar index. */
export function readEventTail(db, taskId, limit = 50) {
  if (!Number.isInteger(limit) || limit < 1) throw new TypeError("limit must be a positive integer");
  return db
    .prepare("SELECT event_json FROM events WHERE task_id = ? ORDER BY seq DESC LIMIT ?")
    .all(taskId, limit)
    .map((row) => decode(row.event_json))
    .reverse();
}

export function listEvents(db, taskId) {
  return db
    .prepare("SELECT event_json FROM events WHERE task_id = ? ORDER BY seq")
    .all(taskId)
    .map((row) => decode(row.event_json));
}

export function listEventsByType(db, taskId, eventType) {
  return db
    .prepare("SELECT event_json FROM events WHERE task_id = ? AND event_type = ? ORDER BY seq")
    .all(taskId, eventType)
    .map((row) => decode(row.event_json));
}

export function decodeIndexedEvent(row) {
  const event = decode(row.event_json);
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    throw Object.assign(new Error("Stored event payload must be an object"), { code: "E_STORAGE_PAYLOAD_MISMATCH" });
  }
  if (event.taskId !== row.task_id || event.seq !== row.seq || event.event !== row.event_type || event.hash !== row.hash
    || (event.previousHash ?? null) !== row.previous_hash || (event.at ?? null) !== row.at) {
    throw Object.assign(new Error("Indexed event fields disagree with canonical evidence"), { code: "E_STORAGE_PAYLOAD_MISMATCH" });
  }
  return event;
}

/** Stream canonical evidence without collecting a second ledger-sized row array. */
export function* iterateCanonicalEvents(db, taskId) {
  for (const row of db.prepare("SELECT * FROM events WHERE task_id = ? ORDER BY seq").iterate(taskId)) yield decodeIndexedEvent(row);
}

export function readLedgerHead(db, taskId) {
  const row = db.prepare("SELECT seq, hash FROM events WHERE task_id = ? ORDER BY seq DESC LIMIT 1").get(taskId);
  return row ? { seq: row.seq, hash: row.hash } : null;
}

export function countEvents(db, taskId) {
  return db.prepare("SELECT COUNT(*) AS total FROM events WHERE task_id = ?").get(taskId).total;
}

/* ---------------------------------------------------------------- actions */

/**
 * Record an action. A duplicate task-local idempotency key raises a SQLite
 * uniqueness violation, which the caller reports as the existing conflict
 * error rather than creating a second accepted action.
 */
export function putAction(db, { taskId, action }) {
  guard(db);
  db.prepare(
    `INSERT INTO actions (task_id, action_id, idempotency_key, status, revision, payload_json)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (task_id, action_id) DO UPDATE SET
       idempotency_key = excluded.idempotency_key,
       status = excluded.status,
       revision = excluded.revision,
       payload_json = excluded.payload_json`,
  ).run(
    taskId,
    action.actionId,
    action.idempotencyKey ?? null,
    action.state ?? action.status ?? null,
    Number.isInteger(action.revision) ? action.revision : null,
    encode(action),
  );
}

/** Indexed replacement for the previous filesystem idempotency scan. */
export function findActionByIdempotencyKey(db, taskId, idempotencyKey) {
  const row = db
    .prepare("SELECT * FROM actions WHERE task_id = ? AND idempotency_key = ?")
    .get(taskId, idempotencyKey);
  return row ? decodeIndexedRecord(row, "action") : null;
}

export function findActionById(db, taskId, actionId) {
  const row = db.prepare("SELECT * FROM actions WHERE task_id = ? AND action_id = ?").get(taskId, actionId);
  return row ? decodeIndexedRecord(row, "action") : null;
}

export function listActions(db, taskId, options = {}) {
  return [...iterateActions(db, taskId, options)];
}

export function* iterateActions(db, taskId, { status = null } = {}) {
  const rows = status
    ? db.prepare("SELECT * FROM actions WHERE task_id = ? AND status = ? ORDER BY action_id").iterate(taskId, status)
    : db.prepare("SELECT * FROM actions WHERE task_id = ? ORDER BY action_id").iterate(taskId);
  for (const row of rows) yield decodeIndexedRecord(row, "action");
}

/* -------------------------------------------------------------- approvals */

export function putApproval(db, { taskId, approval }) {
  guard(db);
  db.prepare(
    `INSERT INTO approvals (task_id, approval_id, action_id, decision, payload_json)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (task_id, approval_id) DO UPDATE SET
       action_id = excluded.action_id,
       decision = excluded.decision,
       payload_json = excluded.payload_json`,
  ).run(taskId, approval.approvalId, approval.actionId ?? null, approval.decision ?? null, encode(approval));
}

export function findApprovalById(db, taskId, approvalId) {
  const row = db.prepare("SELECT * FROM approvals WHERE task_id = ? AND approval_id = ?").get(taskId, approvalId);
  return row ? decodeIndexedRecord(row, "approval") : null;
}

export function listApprovals(db, taskId, options = {}) {
  return [...iterateApprovals(db, taskId, options)];
}

export function* iterateApprovals(db, taskId, { actionId = null } = {}) {
  const rows = actionId
    ? db.prepare("SELECT * FROM approvals WHERE task_id = ? AND action_id = ? ORDER BY approval_id").iterate(taskId, actionId)
    : db.prepare("SELECT * FROM approvals WHERE task_id = ? ORDER BY approval_id").iterate(taskId);
  for (const row of rows) yield decodeIndexedRecord(row, "approval");
}

/* ------------------------------------------------------------- executions */

export function putExecution(db, { taskId, execution }) {
  guard(db);
  db.prepare(
    `INSERT INTO executions (task_id, execution_id, check_id, verification_cycle, payload_json)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (task_id, execution_id) DO UPDATE SET
       check_id = excluded.check_id,
       verification_cycle = excluded.verification_cycle,
       payload_json = excluded.payload_json`,
  ).run(
    taskId,
    execution.executionId,
    execution.checkId ?? null,
    Number.isInteger(execution.verificationCycle) ? execution.verificationCycle : null,
    encode(execution),
  );
}

export function findExecutionById(db, taskId, executionId) {
  const row = db.prepare("SELECT * FROM executions WHERE task_id = ? AND execution_id = ?").get(taskId, executionId);
  return row ? decodeIndexedRecord(row, "execution") : null;
}

export function listExecutions(db, taskId, options = {}) {
  return [...iterateExecutions(db, taskId, options)];
}

export function* iterateExecutions(db, taskId, { checkId = null, verificationCycle = null } = {}) {
  const clauses = ["task_id = ?"];
  const params = [taskId];
  if (checkId !== null) { clauses.push("check_id = ?"); params.push(checkId); }
  if (verificationCycle !== null) { clauses.push("verification_cycle = ?"); params.push(verificationCycle); }
  const rows = db
    .prepare(`SELECT * FROM executions WHERE ${clauses.join(" AND ")} ORDER BY execution_id`)
    .iterate(...params);
  for (const row of rows) yield decodeIndexedRecord(row, "execution");
}

/* ------------------------------------------------------- generic artifacts */

/**
 * Store a typed artifact. Replaceable current snapshots use the fixed
 * `CURRENT_ARTIFACT_ID`; immutable history passes distinct IDs. The fingerprint
 * is derived with the repository's canonical function so parity with existing
 * evidence checks is exact.
 */
export const CURRENT_ARTIFACT_ID = "current";

export function putArtifact(db, { taskId, kind, artifactId = CURRENT_ARTIFACT_ID, payload, sourceText = `${JSON.stringify(payload, null, 2)}\n` }) {
  guard(db);
  assertArtifactTaskIdentity(payload, taskId);
  if (canonicalFingerprint(JSON.parse(sourceText)) !== canonicalFingerprint(payload)) {
    const error = new Error("Artifact source bytes do not represent its canonical payload");
    error.code = "E_STORAGE_ARTIFACT_INVALID";
    throw error;
  }
  const byteDigest = createHash("sha256").update(sourceText).digest("hex");
  db.prepare(
    `INSERT INTO task_artifacts (task_id, kind, artifact_id, payload_json, fingerprint, source_json, byte_digest)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (task_id, kind, artifact_id) DO UPDATE SET
       payload_json = excluded.payload_json,
       fingerprint = excluded.fingerprint,
       source_json = excluded.source_json,
       byte_digest = excluded.byte_digest`,
  ).run(taskId, kind, artifactId, encode(payload), canonicalFingerprint(payload), sourceText, byteDigest);
}

export function findArtifact(db, taskId, kind, artifactId = CURRENT_ARTIFACT_ID) {
  const row = db
    .prepare("SELECT payload_json FROM task_artifacts WHERE task_id = ? AND kind = ? AND artifact_id = ?")
    .get(taskId, kind, artifactId);
  if (!row) return null;
  const payload = decode(row.payload_json);
  assertArtifactTaskIdentity(payload, taskId);
  return payload;
}

export function listArtifacts(db, taskId, kind = null) {
  return [...iterateArtifacts(db, taskId, kind)];
}

export function* iterateArtifacts(db, taskId, kind = null) {
  const rows = kind
    ? db.prepare("SELECT kind, artifact_id, payload_json, fingerprint, source_json, byte_digest FROM task_artifacts WHERE task_id = ? AND kind = ? ORDER BY artifact_id").iterate(taskId, kind)
    : db.prepare("SELECT kind, artifact_id, payload_json, fingerprint, source_json, byte_digest FROM task_artifacts WHERE task_id = ? ORDER BY kind, artifact_id").iterate(taskId);
  for (const row of rows) {
    const payload = decode(row.payload_json);
    assertArtifactTaskIdentity(payload, taskId);
    yield {
      kind: row.kind,
      artifactId: row.artifact_id,
      payload,
      fingerprint: row.fingerprint,
      sourceText: row.source_json,
      byteDigest: row.byte_digest,
    };
  }
}

/* --------------------------------------------------------------- sessions */

export function putSession(db, { sessionId, taskId = null, activation }) {
  guard(db);
  db.prepare(
    `INSERT INTO sessions (session_id, task_id, activation_json) VALUES (?, ?, ?)
     ON CONFLICT (session_id) DO UPDATE SET task_id = excluded.task_id, activation_json = excluded.activation_json`,
  ).run(sessionId, taskId, encode(activation));
}

export function findSession(db, sessionId) {
  const row = db.prepare("SELECT * FROM sessions WHERE session_id = ?").get(sessionId);
  return row ? { sessionId: row.session_id, taskId: row.task_id, activation: decode(row.activation_json) } : null;
}

export function listSessions(db, taskId) {
  return db.prepare("SELECT session_id FROM sessions WHERE task_id = ? ORDER BY session_id").all(taskId)
    .map((row) => row.session_id);
}

/* ---------------------------------------------------- composite operations */

/**
 * Commit a lifecycle mutation and its audit event as one unit: a visible event
 * can never precede the state it describes, and a failed mutation leaves no
 * partial write behind.
 *
 * The revision check runs first and the event is only appended once the
 * conditional update is known to have matched, so a rejected revision cannot
 * leave a committed event describing a change that never happened.
 */
export function commitTaskMutation(db, { taskId, expectedRevision, state, event }) {
  return runInTransaction(db, () => {
    if (state) {
      const applied = mutateTaskState(db, { taskId, expectedRevision, state });
      if (!applied) return false;
    }
    if (event) appendEvent(db, { taskId, event });
    return true;
  });
}
