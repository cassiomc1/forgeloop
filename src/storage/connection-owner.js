import { AsyncLocalStorage } from "node:async_hooks";
import { lstat, realpath } from "node:fs/promises";
import path from "node:path";

const activeOwner = new AsyncLocalStorage();
function closed(message) { return Object.assign(new Error(message), { code: "E_STORAGE_RUNTIME_CLOSED" }); }
function storageChanged() { return Object.assign(new Error("Project database changed while other connection leases are active"), { code: "E_STORAGE_MIGRATION_REQUIRED" }); }

async function openOwnedConnection(entry, filename, options) {
  if (entry.db?.isTransaction && entry.active.size > 1) throw Object.assign(new Error("Another lease left an active native transaction; overlapping access is forbidden"), { code: "E_STORAGE_TRANSACTION_LEAKED" });
  const identity = await lstat(filename, { bigint: true });
  const sameFile = entry.identity?.dev === identity.dev && entry.identity?.ino === identity.ino;
  if (entry.db && (!sameFile || entry.readOnly !== options.readOnly)) {
    if (entry.active.size > 1) throw storageChanged();
    entry.db.close(); entry.db = null;
  }
  if (!entry.db) {
    const { openStorageDatabase } = await import("./connection.js");
    const db = openStorageDatabase(filename, options);
    const after = await lstat(filename, { bigint: true });
    if (after.dev !== identity.dev || after.ino !== identity.ino) { db.close(); throw closed("Project database changed while opening its connection"); }
    entry.db = db; entry.identity = after; entry.readOnly = options.readOnly;
  }
  const { assertStorageMetadataCurrent } = await import("./connection.js");
  assertStorageMetadataCurrent(entry.db);
  return entry.db;
}

function connectionLease(entry, scope) {
  return {
    assertUnselected() {
      if (entry.db) throw Object.assign(new Error("Previously selected project storage has lost its database; filesystem fallback is forbidden"), { code: "E_STORAGE_MIGRATION_REQUIRED" });
    },
    open(filename, options) {
      // Opening/replacing a handle includes filesystem awaits. Serialize only
      // this short admission work, never the external command callback.
      const opening = entry.openTail.then(() => openOwnedConnection(entry, filename, options));
      entry.openTail = opening.then(() => undefined, () => undefined);
      return opening.then(db => { scope.opened = true; return db; });
    },
  };
}

async function admitLease(entry, readOnly) {
  let release;
  const lifetime = new Promise(resolve => { release = resolve; });
  const admission = entry.tail.then(async () => {
    if (entry.mode !== readOnly) await Promise.all([...entry.active]);
    entry.mode = readOnly;
    entry.active.add(lifetime);
  });
  entry.tail = admission.then(() => undefined, () => undefined);
  await admission;
  return () => { entry.active.delete(lifetime); release(); };
}

async function executeLease(entry, owner, callback, readOnly) {
  const release = await admitLease(entry, readOnly);
  const scope = { owner, active: true, opened: false };
  try {
    return await activeOwner.run(scope, () => callback(connectionLease(entry, scope)));
  } finally {
    scope.active = false;
    try {
      if (scope.opened && entry.db?.isTransaction) {
        entry.db.close(); entry.db = null;
        throw Object.assign(new Error("Command left an active native storage transaction; connection was closed"), { code: "E_STORAGE_TRANSACTION_LEAKED" });
      }
    } finally { release(); }
  }
}

/** One connection per project; same-mode leases share it without external serialization. */
export function createStorageConnectionOwner() {
  const entries = new Map();
  const pending = new Set();
  let closing = false;
  let closePromise;
  const owner = {
    isActive() { return activeOwner.getStore()?.owner === owner && activeOwner.getStore()?.active === true; },
    run(target, callback, { readOnly = false } = {}) {
      if (closing) return Promise.reject(closed("Persistent storage runtime is closing or closed"));
      if (owner.isActive()) return Promise.reject(closed("Nested connection ownership must reuse the active operational scope"));
      const request = (async () => {
        let key;
        try { key = await realpath(path.resolve(target)); }
        catch (error) { if (error.code !== "ENOENT") throw error; key = path.resolve(target); }
        let entry = entries.get(key);
        if (!entry) {
          entry = { tail: Promise.resolve(), openTail: Promise.resolve(), active: new Set(), mode: null, db: null, identity: null };
          entries.set(key, entry);
        }
        return executeLease(entry, owner, callback, readOnly);
      })();
      pending.add(request);
      const finished = () => { pending.delete(request); };
      request.then(finished, finished);
      return request;
    },
    close() {
      if (owner.isActive()) return Promise.reject(closed("Close the runtime outside an active command"));
      if (closePromise) return closePromise;
      closing = true;
      closePromise = (async () => {
        await Promise.all([...pending].map(request => request.catch(() => undefined)));
        let failure;
        for (const entry of entries.values()) {
          try { entry.db?.close(); } catch (error) { failure ??= error; }
          entry.db = null;
        }
        entries.clear();
        if (failure) throw failure;
      })();
      return closePromise;
    },
  };
  return owner;
}
