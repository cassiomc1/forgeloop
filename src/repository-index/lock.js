import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import path from "node:path";

import { REPOSITORY_INDEX_ERROR_CODES, repositoryIndexError } from "./errors.js";

const LOCK_POLL_INTERVAL_MS = 50;
const DEFAULT_LOCK_TIMEOUT_MS = 30_000;
const MAX_LOCK_TIMEOUT_MS = 120_000;

function readLock(lockPath) {
  return readFile(lockPath, "utf8")
    .then((value) => JSON.parse(value))
    .catch((error) => {
      if (error.code === "ENOENT") return null;
      // A competing process can observe the tiny interval between creation
      // of the exclusive lock file and completion of its metadata write. An
      // unreadable lock is never stale-released; callers retry until the
      // owner has published valid metadata or the bounded lease expires.
      if (error instanceof SyntaxError) return { invalid: true };
      throw repositoryIndexError(REPOSITORY_INDEX_ERROR_CODES.LOCK_UNSAFE, `Repository Index lock cannot be read: ${lockPath}`, { cause: error });
    });
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

async function releaseDeadLock(lockPath, observed) {
  if (observed?.invalid === true) return false;
  if (observed && processIsAlive(observed.pid)) return false;
  const quarantine = `${lockPath}.stale-${randomUUID()}`;
  try {
    await rename(lockPath, quarantine);
  } catch (error) {
    if (error.code === "ENOENT") return true;
    throw error;
  }
  const current = await readLock(quarantine);
  if (current?.invalid === true) {
    await rename(quarantine, lockPath);
    return false;
  }
  if (current && JSON.stringify(current) !== JSON.stringify(observed)) {
    await rename(quarantine, lockPath);
    return false;
  }
  await unlink(quarantine);
  return true;
}

export async function acquireRepositoryIndexLock(lockPath, operation, { timeoutMs = DEFAULT_LOCK_TIMEOUT_MS, tryOnly = false } = {}) {
  await mkdir(path.dirname(lockPath), { recursive: true });
  const lock = {
    schemaVersion: 1,
    lockId: randomUUID(),
    pid: process.pid,
    operation,
    acquiredAt: new Date().toISOString(),
  };
  const boundedTimeoutMs = Number.isSafeInteger(timeoutMs) && timeoutMs > 0
    ? Math.min(timeoutMs, MAX_LOCK_TIMEOUT_MS)
    : DEFAULT_LOCK_TIMEOUT_MS;
  const deadline = Date.now() + boundedTimeoutMs;
  while (true) {
    let handle = null;
    try {
      handle = await open(lockPath, "wx");
      await handle.writeFile(`${JSON.stringify(lock)}\n`, "utf8");
      await handle.close();
      return {
        lock,
        release: async () => {
          const current = await readLock(lockPath);
          if (current?.lockId === lock.lockId) await unlink(lockPath);
        },
      };
    } catch (error) {
      if (handle) {
        try { await handle.close(); } catch { /* preserve original failure */ }
      }
      if (error.code !== "EEXIST") throw error;
      if (tryOnly) {
        const observed = await readLock(lockPath);
        if (observed && await releaseDeadLock(lockPath, observed)) continue;
        return null;
      }
      const observed = await readLock(lockPath);
      if (!observed || !(await releaseDeadLock(lockPath, observed))) {
        if (Date.now() >= deadline) {
          throw repositoryIndexError(REPOSITORY_INDEX_ERROR_CODES.LOCK_UNSAFE, `Repository Index operation lock is busy: ${lockPath}`, { lock: observed });
        }
        await new Promise((resolve) => setTimeout(resolve, LOCK_POLL_INTERVAL_MS));
      }
    }
  }
}

export async function withRepositoryIndexLock(repoRoot, operation, callback, options = {}) {
  const lockPath = options.lockPath ?? path.join(repoRoot, ".forgeloop", "repository-index", "operation.lock");
  const lease = await acquireRepositoryIndexLock(lockPath, operation, options);
  try {
    return await callback(lease.lock);
  } finally {
    await lease.release();
  }
}
