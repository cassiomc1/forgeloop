import { canonicalFingerprint } from "../core/artifacts.js";
import { artifactByteDigest } from "./artifact-bytes.js";
import { putArtifact } from "./repository.js";
import { runInTransaction } from "./transaction.js";

function leaseRow(db, taskId) {
  return db.prepare("SELECT * FROM task_artifacts WHERE task_id = ? AND kind = 'operationLease' AND artifact_id = 'current'").get(taskId) ?? null;
}

export function readOperationalLease(store, taskId) {
  const row = store.observe(`lease:${taskId}`, () => leaseRow(store.db, taskId));
  if (!row) return null;
  try {
    const payload = JSON.parse(row.payload_json);
    if (payload.taskId !== taskId) throw new Error("Lease task identity mismatch");
    if (row.fingerprint !== canonicalFingerprint(payload)) throw new Error("Lease fingerprint mismatch");
    artifactByteDigest({ payload, sourceText: row.source_json, byteDigest: row.byte_digest });
    return payload;
  } catch { return { taskId, corrupted: true }; }
}

export function releaseOperationalLeaseIfUnchanged(store, taskId, expectedLock, { force = false, now = Date.now(), classify, sameIdentity }) {
  const original = store.reads.get(`lease:${taskId}`)?.value ?? null;
  const result = runInTransaction(store.db, () => {
    const row = leaseRow(store.db, taskId);
    if (!row) return { released: false, reason: "LOCK_MISSING" };
    let current;
    try { current = JSON.parse(row.payload_json); }
    catch {
      if (!force || canonicalFingerprint(row) !== canonicalFingerprint(original)) return { released: false, reason: "LOCK_CORRUPT" };
    }
    if (force && canonicalFingerprint(row) !== canonicalFingerprint(original)) return { released: false, reason: "LOCK_CHANGED", currentLock: current };
    if (!force && current && !sameIdentity(current, expectedLock, taskId)) return { released: false, reason: "LOCK_CHANGED", currentLock: current };
    const classification = current ? classify(current, now) : null;
    if (!force && classification?.status !== "STALE") return { released: false, reason: "LOCK_NOT_STALE", classification };
    store.db.prepare("DELETE FROM task_artifacts WHERE task_id = ? AND kind = 'operationLease' AND artifact_id = 'current' AND payload_json = ?").run(taskId, row.payload_json);
    return { released: true, previousLock: current ?? expectedLock, classification };
  });
  if (result.released) store.reads.delete(`lease:${taskId}`);
  return result;
}

export function acquireOperationalLease(store, taskId, lockData) {
  runInTransaction(store.db, () => {
    if (leaseRow(store.db, taskId)) {
      const error = new Error(`Task ${taskId} has an active operation reservation`);
      error.code = "E_TASK_LOCKED";
      throw error;
    }
    putArtifact(store.db, { taskId, kind: "operationLease", payload: lockData });
  });
  store.ownedLeases.set(taskId, lockData.lockId);
  store.reads.delete(`lease:${taskId}`);
  return {
    lockData,
    release: async () => {
      const released = runInTransaction(store.db, () => store.db.prepare("DELETE FROM task_artifacts WHERE task_id = ? AND kind = 'operationLease' AND artifact_id = 'current' AND payload_json = ?").run(taskId, JSON.stringify(lockData)).changes === 1);
      store.ownedLeases.delete(taskId);
      store.reads.delete(`lease:${taskId}`);
      return released;
    },
  };
}
