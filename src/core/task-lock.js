import { needsExistingProjectScope, withExistingProjectScope } from "../storage/existing-project-scope.js";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import os from "node:os";
import { assertSafePath, ensureWithin, fileExists } from "./filesystem.js";
import { taskLockPath } from "./task-paths.js";
import { getOperationalStore } from "../storage/operational-context.js";
import { assertStorageMaintenanceInactive } from "../storage/maintenance.js";

export async function readLockInfo(target, taskId) {
  if (await needsExistingProjectScope(target)) {
    return withExistingProjectScope(target, () => readLockInfo(target, taskId), { readOnly: true });
  }
  const store = getOperationalStore(target);
  if (store) {
    const { readOperationalLease } = await import("../storage/leases.js");
    return readOperationalLease(store, taskId);
  }
  const relativePath = taskLockPath(taskId);
  await assertSafePath(target, relativePath);
  const fullPath = ensureWithin(target, relativePath);

  if (!(await fileExists(fullPath))) {
    return null;
  }

  try {
    const raw = await readFile(fullPath, "utf8");
    return JSON.parse(raw);
  } catch {
    return { taskId, corrupted: true };
  }
}

/**
 * Structural identity requirements shared by every persisted lease lock.
 * Incomplete identity is UNKNOWN and is never eligible for stale release;
 * default lease values belong at creation time, never validation time.
 */
function hasLeaseIdentity(lock) {
  return typeof lock.lockId === "string"
    && lock.lockId !== ""
    && typeof lock.ownerInstanceId === "string"
    && lock.ownerInstanceId !== ""
    && typeof lock.operation === "string"
    && lock.operation !== ""
    && Number.isInteger(lock.leaseMs)
    && lock.leaseMs > 0;
}

export function isValidTaskLockIdentity(lock) {
  return Boolean(lock)
    && !lock.corrupted
    && typeof lock.taskId === "string"
    && lock.taskId !== ""
    && hasLeaseIdentity(lock);
}

function classifyLeaseWindow(lock, now) {
  const heartbeat = Date.parse(lock.heartbeatAt ?? lock.acquiredAt);
  if (!Number.isFinite(heartbeat)) return { status: "UNKNOWN", stale: false };
  return now > heartbeat + lock.leaseMs
    ? { status: "STALE", stale: true, expiresAt: new Date(heartbeat + lock.leaseMs).toISOString() }
    : { status: "LIVE", stale: false, expiresAt: new Date(heartbeat + lock.leaseMs).toISOString() };
}

export function classifyLockStaleness(lock, now = Date.now()) {
  if (!lock) return { status: "NONE", stale: false };
  if (lock.corrupted) return { status: "CORRUPT", stale: false };
  if (!isValidTaskLockIdentity(lock)) return { status: "UNKNOWN", stale: false };
  return classifyLeaseWindow(lock, now);
}

/**
 * PID values can be reused. Pairing the PID with the process start epoch gives
 * a portable, serializable ownership token without a daemon or platform-only
 * process inspector. Consumers must still treat remote owners as unknown.
 */
export function currentProcessStartToken(now = Date.now(), uptimeSeconds = process.uptime()) {
  return `${process.pid}:${Math.max(0, Math.floor(now - (uptimeSeconds * 1000)))}`;
}

export async function withProjectClaimsLock(target, operationOrCallback, callback) {
  if (!getOperationalStore(target)) {
    const { withProjectStorage } = await import("../storage/project-boundary.js");
    return withProjectStorage(target, () => withProjectClaimsLock(target, operationOrCallback, callback));
  }
  let operation = operationOrCallback;
  let fn = callback;
  if (typeof operationOrCallback === "function" && callback === undefined) {
    fn = operationOrCallback;
    operation = "claim-reservation";
  }
  // The preparation scope records the authoritative claim inputs; its short
  // BEGIN IMMEDIATE commit rechecks those inputs and reserves claims atomically.
  return fn({ kind: "sqlite-claim-reservation", operation });
}

export async function acquireTaskLock(target, taskId, operation = "mutation") {
  await assertStorageMaintenanceInactive(target);
  const acquiredAt = new Date().toISOString();
  const lockData = {
    lockId: randomUUID(),
    taskId,
    operation,
    pid: process.pid,
    hostname: os.hostname(),
    processStartToken: currentProcessStartToken(),
    ownerInstanceId: randomUUID(),
    acquiredAt,
    heartbeatAt: acquiredAt,
    leaseMs: 300000,
  };
  const store = getOperationalStore(target);
  if (store) {
    const { acquireOperationalLease } = await import("../storage/leases.js");
    return acquireOperationalLease(store, taskId, lockData);
  }
  return acquireStandaloneOperationalLease(target, taskId, operation);
}

/** Keep only the connection scope alive; acquisition/release hold no SQL transaction. */
async function acquireStandaloneOperationalLease(target, taskId, operation) {
  let resolveReady;
  let rejectReady;
  let releaseScope;
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const released = new Promise(resolve => { releaseScope = resolve; });
  const { withProjectStorage } = await import("../storage/project-boundary.js");
  const completion = withProjectStorage(target, async () => {
    const handle = await acquireTaskLock(target, taskId, operation);
    resolveReady(handle.lockData);
    await released;
    return handle.release();
  }, { existingOnly: true });
  completion.catch(rejectReady);
  const lockData = await ready;
  return { lockData, release: () => { releaseScope(); return completion; } };
}

export async function forceUnlockTask(target, taskId, { staleOnly = false } = {}) {
  if (!getOperationalStore(target)) {
    const { withProjectStorage } = await import("../storage/project-boundary.js");
    return withProjectStorage(target, () => forceUnlockTask(target, taskId, { staleOnly }), { existingOnly: true });
  }
  const store = getOperationalStore(target);
  const existing = await readLockInfo(target, taskId);
  if (!existing) return { unlocked: false, message: "No active lock found" };
  const classification = classifyLockStaleness(existing);
  if (staleOnly && !classification.stale) return { unlocked: false, previousLock: existing, classification };
  const { releaseOperationalLeaseIfUnchanged } = await import("../storage/leases.js");
  const released = releaseOperationalLeaseIfUnchanged(store, taskId, existing, { force: !staleOnly, classify: classifyLockStaleness, sameIdentity: sameObservedTaskLock });
  return { unlocked: released.released, previousLock: released.previousLock ?? existing, classification: released.classification ?? classification, ...(released.reason ? { reason: released.reason } : {}) };
}

function sameObservedLock(left, right, { identityIsValid = isValidTaskLockIdentity } = {}) {
  if (!identityIsValid(left) || !identityIsValid(right)) return false;
  return left.lockId === right.lockId
    && left.heartbeatAt === right.heartbeatAt
    && left.ownerInstanceId === right.ownerInstanceId;
}

function sameObservedTaskLock(left, right, taskId) {
  return taskId !== null
    && sameObservedLock(left, right)
    && left.taskId === right.taskId
    && right.taskId === taskId;
}

export async function releaseStaleTaskLockIfUnchanged(target, taskId, expectedLock, { now = Date.now() } = {}) {
  if (!getOperationalStore(target)) {
    const { withProjectStorage } = await import("../storage/project-boundary.js");
    return withProjectStorage(target, () => releaseStaleTaskLockIfUnchanged(target, taskId, expectedLock, { now }), { existingOnly: true });
  }
  const store = getOperationalStore(target);
  const expectedClassification = classifyLockStaleness(expectedLock, now);
  if (expectedClassification.status !== "STALE") return { released: false, reason: "EXPECTED_LOCK_NOT_STALE", classification: expectedClassification };
  const { releaseOperationalLeaseIfUnchanged } = await import("../storage/leases.js");
  return releaseOperationalLeaseIfUnchanged(store, taskId, expectedLock, { now, classify: classifyLockStaleness, sameIdentity: sameObservedTaskLock });
}

export async function withTaskLock(target, taskId, operationOrCallback, callback) {
  if (!getOperationalStore(target)) {
    const { withProjectStorage } = await import("../storage/project-boundary.js");
    return withProjectStorage(target, () => withTaskLock(target, taskId, operationOrCallback, callback));
  }
  let operation = operationOrCallback;
  let fn = callback;
  if (typeof operationOrCallback === "function" && callback === undefined) {
    fn = operationOrCallback;
    operation = "mutation";
  }
  const lock = await acquireTaskLock(target, taskId, operation);
  try {
    return await fn(lock.lockData);
  } finally {
    await lock.release();
  }
}
