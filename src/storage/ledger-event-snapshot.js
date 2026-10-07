import { LedgerEventCollection } from "../core/ledger-event-collection.js";
import { decodeIndexedEvent } from "./repository.js";
import { runInTransaction } from "./transaction.js";
import { withStorageSnapshot } from "./snapshot.js";
import { withSpilledLedgerRelations, withSpilledLedgerRelationsSync } from "./ledger-relations.js";
import { createHash } from "node:crypto";
import { canonicalFingerprint } from "../core/artifacts.js";

const typedStatements = new WeakMap();
const activeTypedStatements = new WeakSet();

function* iterateTypedRows(db, query, arity, parameters) {
  let statements = typedStatements.get(db);
  if (!statements) { statements = new Map(); typedStatements.set(db, statements); }
  let statement = statements.get(arity);
  // A nested scan cannot rebind the statement backing its still-active outer cursor.
  if (!statement || activeTypedStatements.has(statement)) {
    statement = db.prepare(query);
    if (!statements.has(arity) && statements.size < 16) statements.set(arity, statement);
  }
  activeTypedStatements.add(statement);
  try { yield* statement.iterate(...parameters); }
  finally { activeTypedStatements.delete(statement); }
}

function ownCollection(db, taskId, { validate = event => event, onFullScan = null } = {}) {
  let active = true;
  let indexedFieldsValidated = false;
  const assertActive = () => {
    if (!active) throw Object.assign(new Error("Ledger snapshot has expired"), { code: "E_STORAGE_TRANSACTION_EXPIRED" });
  };
  const { count, first, last } = db.prepare("SELECT COUNT(*) AS count, MIN(seq) AS first, MAX(seq) AS last FROM events WHERE task_id = ?").get(taskId);
  // Contiguity only selects an access path. Every decoded payload still proves its indexed fields.
  const contiguous = count === 0 || (first === 1 && last === count);
  const at = db.prepare(contiguous
    ? "SELECT * FROM events WHERE task_id = ? AND seq = ?"
    : "SELECT * FROM events WHERE task_id = ? ORDER BY seq LIMIT 1 OFFSET ?");
  const rangeSql = contiguous
    ? "SELECT * FROM events WHERE task_id = ? AND seq > ? AND seq <= ? ORDER BY seq"
    : "SELECT * FROM events WHERE task_id = ? ORDER BY seq LIMIT ? OFFSET ?";
  const decode = (row, index) => {
    const event = decodeIndexedEvent(row);
    return indexedFieldsValidated ? event : validate(event, index);
  };
  const events = new LedgerEventCollection({
    length: count,
    readAt(index) {
      assertActive();
      return decode(at.get(taskId, contiguous ? index + 1 : index), index);
    },
    *iterateRange(start, end) {
      assertActive();
      // Nested proof scans need independent statements; reusing one invalidates its outer cursor.
      const range = end > start ? db.prepare(rangeSql) : null;
      const rows = !range ? [] : contiguous ? range.iterate(taskId, start, end) : range.iterate(taskId, end - start, start);
      const digest = onFullScan && !indexedFieldsValidated && start === 0 && end === count ? createHash("sha256") : null;
      let index = start;
      for (const row of rows) {
        assertActive();
        const event = decode(row, index++);
        if (digest) digest.update(canonicalFingerprint(row));
        yield event;
        assertActive();
      }
      assertActive();
      if (start === 0 && end === count) {
        if (digest) onFullScan(digest.digest("hex"));
        indexedFieldsValidated = true;
      }
    },
    *iterateTypes(start, end, types) {
      assertActive();
      if (start === end) return;
      if (!contiguous || !indexedFieldsValidated) {
        for (const [index, event] of events.slice(start, end).entries()) {
          if (types.includes(event.event)) yield { index: start + index, event };
          assertActive();
        }
        return;
      }
      if (!types.length) return;
      const query = `SELECT * FROM events INDEXED BY events_type_idx WHERE task_id = ? AND seq > ? AND seq <= ? AND event_type IN (${types.map(() => "?").join(",")}) ORDER BY seq`;
      for (const row of iterateTypedRows(db, query, types.length, [taskId, start, end, ...types])) {
        assertActive();
        yield { index: row.seq - 1, event: decode(row, row.seq - 1) };
        assertActive();
      }
      assertActive();
    },
  });
  return { events, close() { active = false; } };
}

/** Synchronous evidence reads share one SQLite snapshot, including caller transactions. */
export function withLedgerEventSnapshot(db, taskId, callback) {
  const read = () => {
    const owner = ownCollection(db, taskId);
    try {
      const result = withSpilledLedgerRelationsSync(() => callback(owner.events));
      if (result && typeof result.then === "function") {
        throw Object.assign(new TypeError("Ledger snapshot callback must be synchronous"), { code: "E_STORAGE_ASYNC_TRANSACTION" });
      }
      return result;
    } finally { owner.close(); }
  };
  if (callback.constructor?.name === "AsyncFunction") {
    throw Object.assign(new TypeError("Ledger snapshot callback must be synchronous"), { code: "E_STORAGE_ASYNC_TRANSACTION" });
  }
  return db.isTransaction ? read() : runInTransaction(db, read, { immediate: false });
}

/** Async proof work uses an owned read-only backup, never a live WAL transaction. */
export async function withDetachedLedgerSnapshot(db, taskId, callback, options = {}) {
  return withStorageSnapshot(db, async snapshot => {
    const owner = ownCollection(snapshot, taskId, options);
    try { return await withSpilledLedgerRelations(() => callback(owner.events, snapshot)); }
    finally { owner.close(); }
  });
}
