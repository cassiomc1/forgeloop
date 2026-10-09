import { readdir, readFile } from "node:fs/promises";

import { assertSafePath, fileExists } from "./filesystem.js";
import { getOperationalStore } from "../storage/operational-context.js";

const TRANSACTION_ROOT = ".forgeloop/.txn";

export async function getTaskTransaction(target) {
  return getOperationalStore(target)?.transaction ?? null;
}

const TERMINAL_STATUSES = new Set(["COMMITTED", "ROLLED_BACK", "ABORTED"]);

export async function findIncompleteTransactions(target) {
  const root = await assertSafePath(target, TRANSACTION_ROOT);
  if (!(await fileExists(root))) return [];
  const entries = await readdir(root, { withFileTypes: true });
  const found = [];
  for (const entry of entries) {
    await assertSafePath(target, `${TRANSACTION_ROOT}/${entry.name}`);
    if (!entry.isDirectory()) continue;
    const filename = await assertSafePath(target, `${TRANSACTION_ROOT}/${entry.name}/manifest.json`);
    try {
      const manifest = JSON.parse(await readFile(filename, "utf8"));
      if (!TERMINAL_STATUSES.has(manifest.status)) found.push(manifest);
    } catch {
      found.push({ transactionId: entry.name, status: "ABANDONED", malformed: true });
    }
  }
  return found;
}

export async function withTaskTransaction({ target, taskId, operation = "mutation", packageRoot, recordCommitEvent = false } = {}, callback) {
  if (!target || !taskId) throw new Error("target and taskId are required for a task transaction");
  if (!getOperationalStore(target)) {
    const { withProjectStorage } = await import("../storage/project-boundary.js");
    return withProjectStorage(target, () => withTaskTransaction({ target, taskId, operation, packageRoot, recordCommitEvent }, callback));
  }
  const { withOperationalTransaction } = await import("../storage/unit-of-work.js");
  return withOperationalTransaction({ target, taskId, operation, packageRoot, recordCommitEvent }, callback);
}
