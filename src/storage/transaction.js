import { AsyncLocalStorage } from "node:async_hooks";

import { translateStorageError } from "./connection.js";

/**
 * Transaction state is tracked per connection object rather than in module
 * state so two independent stores (for example a project and a temporary
 * import target) can never share a nesting decision.
 *
 * The active handle is also published through AsyncLocalStorage so a write
 * performed by a callback that resumed after its transaction was closed is
 * rejected instead of silently committing outside any transaction.
 */
const STATE = new WeakMap();
const ACTIVE = new AsyncLocalStorage();

function stateOf(db) {
  let state = STATE.get(db);
  if (!state) {
    state = { depth: 0, rollbackOnly: false, project: null, active: false };
    STATE.set(db, state);
  }
  return state;
}

function transactionError(message) {
  const error = new Error(message);
  error.code = "E_STORAGE_TRANSACTION_INVALID";
  return error;
}

function asyncTransactionError() {
  const error = new TypeError(
    "runInTransaction callback must be synchronous; DatabaseSync cannot keep a transaction open across a Promise",
  );
  error.code = "E_STORAGE_ASYNC_TRANSACTION";
  return error;
}

/**
 * Run a synchronous mutation inside one database transaction.
 *
 * Contract:
 *   - The callback must be synchronous. A returned thenable causes rollback and
 *     rejection, because `DatabaseSync` would already have committed by the time
 *     an async continuation ran, silently breaking atomicity.
 *   - A declared `async` callback is rejected before invocation where that is
 *     detectable. This is a guard, not a complete protection: a non-async
 *     function that returns a thenable is still caught at return time.
 *   - Nested calls join the outer transaction. A nested failure marks the whole
 *     transaction rollback-only, so an outer `catch` that swallows the error
 *     still cannot commit partial nested work.
 *   - `BEGIN IMMEDIATE` reserves the writer before the callback inspects
 *     mutable state, so a read-then-write sequence cannot lose a race.
 *   - The callback is never held open across external work such as a checker,
 *     browser, network request, or child process.
 *
 * `project` optionally binds the transaction to a logical project identity. A
 * nested call for a different identity is rejected rather than silently joining.
 */
export function runInTransaction(db, callback, { immediate = true, project = null } = {}) {
  if (typeof callback !== "function") {
    throw new TypeError("runInTransaction requires a synchronous callback");
  }
  // Guard: an `async function` always returns a thenable, so reject it up front
  // rather than running its synchronous prefix and then rolling it back.
  if (callback.constructor?.name === "AsyncFunction") {
    throw asyncTransactionError();
  }

  // A late continuation cannot revive its closed transaction by opening a
  // new one. Active independent connections retain their existing nesting.
  if (ACTIVE.getStore()?.active === false) assertWritableContext(db);
  const state = stateOf(db);

  if (state.depth > 0) {
    if (project !== null && state.project !== null && project !== state.project) {
      throw transactionError("Cannot join a transaction bound to a different project");
    }
    state.depth += 1;
    const joinedRollbackOnly = state.rollbackOnly;
    try {
      return ACTIVE.run(state, () => finish(db, callback, state.depth));
    } finally {
      state.depth -= 1;
      if (state.rollbackOnly && !joinedRollbackOnly) state.rollbackOnly = true;
    }
  }

  if (state.active) {
    throw transactionError("A transaction is already active on this connection");
  }

  // Reserving the writer can itself fail, for example when another process holds
  // the lock past the configured busy timeout. That must surface as a
  // documented recoverable storage error, not as a raw driver error, and it must
  // not be confused with a domain revision conflict.
  try {
    db.exec(immediate ? "BEGIN IMMEDIATE" : "BEGIN");
  } catch (error) {
    return translateStorageError(error);
  }
  state.depth = 1;
  state.rollbackOnly = false;
  state.project = project;
  state.active = true;
  try {
    return ACTIVE.run(state, () => finish(db, callback, 1));
  } finally {
    state.depth = 0;
    state.rollbackOnly = false;
    state.project = null;
    state.active = false;
  }
}

function finish(db, callback, depth) {
  let result;
  try {
    result = callback();
  } catch (error) {
    // A nested failure must poison the whole transaction, even if an outer
    // callback catches it and continues.
    stateOf(db).rollbackOnly = true;
    if (depth === 1) {
      try { db.exec("ROLLBACK"); } catch { /* preserve the original failure */ }
    }
    // Only a raw driver failure is translated. Domain errors such as
    // E_STATE_REVISION_CONFLICT carry their own classification and must keep it,
    // so translation is applied only when the SQLite result code is present.
    if (error && typeof error === "object" && "errcode" in error) {
      translateStorageError(error);
    }
    throw error;
  }

  if (result && typeof result.then === "function") {
    stateOf(db).rollbackOnly = true;
    if (depth === 1) {
      try { db.exec("ROLLBACK"); } catch { /* preserve the rejection below */ }
    }
    throw asyncTransactionError();
  }

  const state = stateOf(db);
  if (state.rollbackOnly && depth === 1) {
    try { db.exec("ROLLBACK"); } catch { /* preserve the poisoning */ }
    throw transactionError("Transaction was marked rollback-only and cannot commit");
  }

  try {
    if (depth === 1) db.exec("COMMIT");
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* preserve the commit failure */ }
    return translateStorageError(error);
  }
  return result;
}

/** Whether a transaction is currently open on this connection. */
export function isInTransaction(db) {
  return stateOf(db).depth > 0;
}

/**
 * Guard called by repository writers. A write issued while no transaction is
 * active is allowed (single-statement writes remain self-contained), but a write
 * issued from a callback whose transaction has already been closed is rejected,
 * which is what stops a late async continuation from persisting.
 */
export function assertWritableContext(db) {
  const state = ACTIVE.getStore();
  if (!state) return;
  if (!state.active || STATE.get(db) !== state) {
    const error = new Error("Storage write attempted through an expired transaction context");
    error.code = "E_STORAGE_TRANSACTION_EXPIRED";
    throw error;
  }
}
