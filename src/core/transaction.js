import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { mkdir, open, readdir, readFile, realpath, rename, stat, truncate, unlink } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import path from "node:path";

import { assertSafePath, ensureWithin, fileExists, writeFileAtomic } from "./filesystem.js";
import { withTaskLock } from "./task-lock.js";
import { E_TASK_LOCKED } from "./error-codes.js";

const TRANSACTION_ROOT = ".forgeloop/.txn";
const LOCK_WAIT_TIMEOUT_MS = 5_000;
const transactionContext = new AsyncLocalStorage();

export function getActiveTaskTransaction() {
  return transactionContext.getStore() ?? null;
}

export async function getTaskTransaction(target) {
  const transaction = getActiveTaskTransaction();
  if (transaction && transaction.target !== await realpath(target)) {
    const error = new Error("Cannot reuse a task transaction for a different project");
    error.code = "E_TASK_CONTEXT_MISMATCH";
    throw error;
  }
  return transaction;
}

const TERMINAL_STATUSES = new Set(["COMMITTED", "ROLLED_BACK", "ABORTED"]);

function transactionPath(transactionId) {
  return `${TRANSACTION_ROOT}/${transactionId}`;
}

async function writeManifest(target, relativePath, manifest) {
  await writeFileAtomic(ensureWithin(target, relativePath), `${JSON.stringify(manifest, null, 2)}\n`);
}

export async function findIncompleteTransactions(target) {
  const root = ensureWithin(target, TRANSACTION_ROOT);
  if (!(await fileExists(root))) return [];
  const entries = await readdir(root, { withFileTypes: true });
  const found = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const manifest = JSON.parse(await readFile(path.join(root, entry.name, "manifest.json"), "utf8"));
      if (!TERMINAL_STATUSES.has(manifest.status)) found.push(manifest);
    } catch {
      found.push({ transactionId: entry.name, status: "ABANDONED", malformed: true });
    }
  }
  return found;
}

function writePath(entry) {
  return typeof entry === "string" ? entry : entry.path;
}

async function rollbackPublishedWrites(target, root, manifest) {
  const writes = [...manifest.writes].reverse();
  for (const entry of writes) {
    if (!entry || typeof entry !== "object") continue;
    const relativePath = writePath(entry);
    await assertSafePath(target, relativePath);
    if (entry.kind === "APPEND") {
      if (!entry.appendStarted) continue;
      const destination = ensureWithin(target, relativePath);
      const originalSize = Number.isInteger(entry.originalSize) && entry.originalSize >= 0 ? entry.originalSize : 0;
      if (await fileExists(destination)) {
        if (originalSize === 0) await unlink(destination);
        else await truncate(destination, originalSize);
      }
      continue;
    }
    if (!entry.published && !entry.backupPending && !entry.backupCreated) continue;
    const destination = ensureWithin(target, relativePath);
    const backup = ensureWithin(target, `${root}/backup/${relativePath}`);
    if (entry.published && await fileExists(destination)) await unlink(destination);
    if (entry.hadPrevious && await fileExists(backup)) {
      await mkdir(path.dirname(destination), { recursive: true });
      await rename(backup, destination);
    }
  }
}

export async function recoverIncompleteTransactions(target) {
  const rootPath = ensureWithin(target, TRANSACTION_ROOT);
  if (!(await fileExists(rootPath))) return [];
  const recovered = [];
  for (const entry of await readdir(rootPath, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const root = transactionPath(entry.name);
    const manifestPath = `${root}/manifest.json`;
    try {
      const manifest = JSON.parse(await readFile(ensureWithin(target, manifestPath), "utf8"));
      if (manifest.status !== "COMMITTING") continue;
      await withTaskLock(target, manifest.lockTaskId ?? manifest.taskId ?? "transaction-recovery", "recover-transaction", async () => {
        const current = JSON.parse(await readFile(ensureWithin(target, manifestPath), "utf8"));
        if (current.status !== "COMMITTING") return;
        await rollbackPublishedWrites(target, root, current);
        current.status = "ROLLED_BACK";
        current.recoveredAt = new Date().toISOString();
        await writeManifest(target, manifestPath, current);
        recovered.push({ transactionId: current.transactionId, status: current.status });
      });
    } catch (error) {
      recovered.push({ transactionId: entry.name, status: "RECOVERY_FAILED", error: error.message });
    }
  }
  return recovered;
}

export async function withTaskTransaction({
  target,
  taskId,
  lockTaskId = taskId,
  operation = "mutation",
  packageRoot,
  recordCommitEvent = false,
} = {}, callback) {
  if (!target || !taskId) throw new Error("target and taskId are required for a task transaction");
  target = await realpath(target);
  const activeTransaction = await getTaskTransaction(target);
  if (activeTransaction) {
    if (activeTransaction.taskId !== taskId) {
      throw new Error(`cannot nest task transaction for ${taskId} inside ${activeTransaction.taskId}`);
    }
    return callback(activeTransaction);
  }
  const started = Date.now();
  const runWithLock = async () => withTaskLock(target, lockTaskId, operation, async (lock) => {
    const transactionId = `txn-${randomUUID()}`;
    const root = transactionPath(transactionId);
    const stageRoot = `${root}/stage`;
    const manifestPath = `${root}/manifest.json`;
    await assertSafePath(target, manifestPath);
    await mkdir(ensureWithin(target, stageRoot), { recursive: true });
    const manifest = { schemaVersion: 1, transactionId, taskId, lockTaskId, operation, lockId: lock.lockId, startedAt: new Date().toISOString(), status: "STAGING", writes: [] };
    await writeManifest(target, manifestPath, manifest);
    const tx = {
      target,
      transactionId,
      taskId,
      operation,
      lock,
      async readText(relativePath) {
        await assertSafePath(target, relativePath);
        if (manifest.writes.some((entry) => writePath(entry) === relativePath && entry.kind === "DELETE")) {
          return null;
        }
        const staged = ensureWithin(target, `${stageRoot}/${relativePath}`);
        if (await fileExists(staged)) return readFile(staged, "utf8");
        const appendStaged = ensureWithin(target, `${stageRoot}/${relativePath}.append`);
        const appendText = await fileExists(appendStaged) ? await readFile(appendStaged, "utf8") : "";
        const destination = ensureWithin(target, relativePath);
        if (!(await fileExists(destination))) return appendText || null;
        return `${await readFile(destination, "utf8")}${appendText}`;
      },
      async stageText(relativePath, text) {
        await assertSafePath(target, relativePath);
        const conflicting = manifest.writes.find((entry) => writePath(entry) === relativePath);
        if (conflicting?.kind === "APPEND" || conflicting?.kind === "DELETE") {
          throw new Error(`cannot replace ${conflicting.kind.toLowerCase()}-staged path: ${relativePath}`);
        }
        const staged = `${stageRoot}/${relativePath}`;
        await assertSafePath(target, staged);
        await writeFileAtomic(ensureWithin(target, staged), text);
        if (!manifest.writes.some((entry) => writePath(entry) === relativePath)) {
          manifest.writes.push({ path: relativePath, hadPrevious: false, published: false });
        }
        await writeManifest(target, manifestPath, manifest);
      },
      async appendText(relativePath, text) {
        await assertSafePath(target, relativePath);
        if (typeof text !== "string" || text.length === 0) throw new Error("transaction append text must be a non-empty string");
        if (manifest.writes.some((entry) => writePath(entry) === relativePath && entry.kind !== "APPEND")) {
          throw new Error(`cannot append to replace-staged path: ${relativePath}`);
        }
        const destination = ensureWithin(target, relativePath);
        const staged = ensureWithin(target, `${stageRoot}/${relativePath}.append`);
        const existing = await fileExists(staged) ? await readFile(staged, "utf8") : "";
        await writeFileAtomic(staged, `${existing}${text}`);
        let entry = manifest.writes.find((candidate) => writePath(candidate) === relativePath);
        if (!entry) {
          entry = {
            path: relativePath,
            kind: "APPEND",
            originalSize: (await fileExists(destination)) ? (await stat(destination)).size : 0,
            appendStarted: false,
            published: false,
          };
          manifest.writes.push(entry);
        }
        await writeManifest(target, manifestPath, manifest);
      },
      async stageDelete(relativePath) {
        await assertSafePath(target, relativePath);
        if (manifest.writes.some((entry) => writePath(entry) === relativePath)) {
          throw new Error(`cannot delete write-staged path: ${relativePath}`);
        }
        const destination = ensureWithin(target, relativePath);
        if (!(await fileExists(destination))) {
          throw new Error(`transaction delete target is missing: ${relativePath}`);
        }
        manifest.writes.push({
          path: relativePath,
          kind: "DELETE",
          hadPrevious: false,
          published: false,
        });
        await writeManifest(target, manifestPath, manifest);
      },
    };
    try {
      const result = await transactionContext.run(tx, async () => {
        const callbackResult = await callback(tx);
        if (recordCommitEvent) {
          // Import lazily to keep the transaction/event dependency directional
          // at module initialization. The event is staged while this task's
          // transaction context is still active and is published last below.
          const { appendProtocolEvent } = await import("./events.js");
          await appendProtocolEvent(target, {
            taskId,
            event: "TRANSACTION_COMMITTED",
            details: { transactionId, operation },
          }, packageRoot, { taskId });
        }
        return callbackResult;
      });
      manifest.status = "COMMITTING";
      await writeManifest(target, manifestPath, manifest);
      // The ledger is the commit witness. Publishing it last means that a
      // visible TRANSACTION_COMMITTED event cannot precede a required staged
      // artifact in the same transaction.
      const writes = [...manifest.writes].sort((left, right) => {
        const leftIsLedger = writePath(left).endsWith("events.ndjson");
        const rightIsLedger = writePath(right).endsWith("events.ndjson");
        return Number(leftIsLedger) - Number(rightIsLedger);
      });
      for (const entry of writes) {
        const relativePath = writePath(entry);
        const staged = ensureWithin(target, `${stageRoot}/${relativePath}`);
        const destination = ensureWithin(target, relativePath);
        if (entry.kind === "APPEND") {
          const appendStaged = ensureWithin(target, `${stageRoot}/${relativePath}.append`);
          const appendText = await readFile(appendStaged, "utf8");
          await mkdir(path.dirname(destination), { recursive: true });
          entry.appendStarted = true;
          await writeManifest(target, manifestPath, manifest);
          const handle = await open(destination, "a", 0o644);
          try {
            await handle.writeFile(appendText);
            await handle.sync();
          } finally {
            await handle.close();
          }
          entry.published = true;
          await writeManifest(target, manifestPath, manifest);
          continue;
        }
        const backup = ensureWithin(target, `${root}/backup/${relativePath}`);
        await mkdir(path.dirname(destination), { recursive: true });
        entry.hadPrevious = await fileExists(destination);
        if (entry.hadPrevious) {
          entry.backupPending = true;
          await writeManifest(target, manifestPath, manifest);
          await mkdir(path.dirname(backup), { recursive: true });
          await rename(destination, backup);
          entry.backupCreated = true;
        }
        await writeManifest(target, manifestPath, manifest);
        if (entry.kind === "DELETE") {
          entry.published = true;
          await writeManifest(target, manifestPath, manifest);
          continue;
        }
        await rename(staged, destination);
        entry.published = true;
        await writeManifest(target, manifestPath, manifest);
      }
      manifest.status = "COMMITTED";
      manifest.committedAt = new Date().toISOString();
      await writeManifest(target, manifestPath, manifest);
      return result;
    } catch (error) {
      if (manifest.status === "COMMITTING") {
        try {
          await rollbackPublishedWrites(target, root, manifest);
          manifest.status = "ROLLED_BACK";
          manifest.recoveredAt = new Date().toISOString();
        } catch (rollbackError) {
          manifest.status = "ABANDONED";
          manifest.rollbackError = { message: rollbackError.message };
        }
      } else {
        // Staging has not published any writes; retain the diagnostic record
        // without requiring recovery of a project that was never modified.
        manifest.status = "ABORTED";
      }
      manifest.failedAt = new Date().toISOString();
      manifest.error = { message: error.message };
      await writeManifest(target, manifestPath, manifest);
      throw error;
    }
  });
  while (true) {
    try {
      return await runWithLock();
    } catch (error) {
      if (error.code !== E_TASK_LOCKED || Date.now() - started >= LOCK_WAIT_TIMEOUT_MS) throw error;
      await delay(20);
    }
  }
}
