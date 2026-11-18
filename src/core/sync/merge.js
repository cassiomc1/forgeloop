import { createHash } from "node:crypto";
import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";

import { assertSafePath } from "../filesystem.js";
import { claimsOverlap } from "../task-scope.js";
import { backupProjectStorage, verifyProjectStorageBackup } from "../../storage/project-backup.js";
import { openStorageDatabase } from "../../storage/connection.js";
import { verifyAttachmentFile } from "../../storage/attachment-files.js";
import { syncError } from "./snapshot.js";

// Three-way, task-granular merge of two ForgeLoop states (this machine and the
// remote snapshot). Every table except storage_meta and sessions is keyed by
// task_id, and each task's ledger is its own hash chain, so a whole task can
// move between stores without rewriting any history. Tasks are compared by a
// digest of all their rows; the base is the digest recorded at the last push
// or pull. Nothing is ever resolved inside a task: a task changed on both
// sides is a conflict.

// Table, ordering key. The order is the insert order (tasks first, for the
// foreign keys).
export const TASK_TABLES = Object.freeze([
  ["tasks", "task_id"],
  ["claims", "task_id, claim_norm"],
  ["events", "task_id, seq"],
  ["actions", "task_id, action_id"],
  ["approvals", "task_id, approval_id"],
  ["executions", "task_id, execution_id"],
  ["task_artifacts", "task_id, kind, artifact_id"],
  ["attachment_references", "task_id, reference_id"],
]);

function rowsOf(db, table, order, taskId, schema = "main") {
  return db.prepare(`SELECT * FROM ${schema}.${table} WHERE task_id = ? ORDER BY ${order}`).all(taskId);
}

// One digest per task over every task-scoped row (attachment bytes are bound
// through attachment_references.sha256).
export function taskDigests(db, schema = "main") {
  const digests = {};
  for (const { task_id: taskId } of db.prepare(`SELECT task_id FROM ${schema}.tasks ORDER BY task_id`).all()) {
    const hash = createHash("sha256");
    for (const [table, order] of TASK_TABLES) {
      hash.update(`${table}\n`);
      for (const row of rowsOf(db, table, order, taskId, schema)) hash.update(`${JSON.stringify(row, Object.keys(row).sort())}\n`);
    }
    digests[taskId] = hash.digest("hex");
  }
  return digests;
}

export function readDatabaseDigests(databasePath) {
  const db = openStorageDatabase(databasePath, { readOnly: true });
  try { return taskDigests(db); } finally { db.close(); }
}

// local/remote/base: { taskId: digest }. base may be null (no recorded base).
export function classifyTasks({ local, remote, base = null }) {
  const result = { take: [], keep: [], same: [], conflicts: [] };
  for (const taskId of [...new Set([...Object.keys(local), ...Object.keys(remote)])].sort()) {
    const mine = local[taskId] ?? null;
    const theirs = remote[taskId] ?? null;
    const known = base ? base[taskId] ?? null : undefined;
    if (mine === theirs) result.same.push(taskId);
    else if (theirs === null) result.keep.push({ taskId, reason: "local only" });
    else if (mine === null) result.take.push({ taskId, reason: "remote only" });
    else if (known !== undefined && mine === known) result.take.push({ taskId, reason: "changed remotely" });
    else if (known !== undefined && theirs === known) result.keep.push({ taskId, reason: "changed locally" });
    else result.conflicts.push({ taskId, reason: known === undefined ? "differs and no sync base is recorded" : "changed on both machines" });
  }
  return result;
}

function activeClaims(db, schema, taskIds, include) {
  const rows = db.prepare(`SELECT task_id, claim_norm FROM ${schema}.claims WHERE reservation_state = 'ACTIVE' ORDER BY task_id, claim_norm`).all();
  return rows.filter((row) => include === taskIds.has(row.task_id));
}

// A task taken from the remote must not hold an active claim that overlaps an
// active claim of a task that stays local.
function assertNoClaimOverlap(db, taken) {
  const takenIds = new Set(taken);
  const incoming = activeClaims(db, "remote", takenIds, true);
  const staying = activeClaims(db, "main", takenIds, false);
  const overlaps = [];
  for (const left of incoming) {
    for (const right of staying) {
      if (claimsOverlap(left.claim_norm, right.claim_norm)) overlaps.push(`${left.task_id}:${left.claim_norm} ↔ ${right.task_id}:${right.claim_norm}`);
    }
  }
  if (overlaps.length > 0) throw syncError("E_SYNC_MERGE_CONFLICT", `Merged tasks would hold overlapping active claims: ${overlaps.slice(0, 5).join(", ")}`);
}

// Builds a verified backup at `destination` holding the local state plus the
// remote's version of every task in `take`. `localBackup` is a writable copy of
// the local storage backup and doubles as the attachment root.
export async function buildMergedBackup({ localBackup, remoteBackup, take, destination }) {
  const remoteDatabase = await assertSafePath(remoteBackup, "state.sqlite");
  const db = openStorageDatabase(await assertSafePath(localBackup, "state.sqlite"), { allowSchemaUpgrade: false });
  try {
    db.prepare("ATTACH DATABASE ? AS remote").run(remoteDatabase);
    assertNoClaimOverlap(db, take);
    const attachments = [];
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const taskId of take) {
        for (const [table] of [...TASK_TABLES].reverse()) db.prepare(`DELETE FROM main.${table} WHERE task_id = ?`).run(taskId);
        for (const [table, order] of TASK_TABLES) {
          db.prepare(`INSERT INTO main.${table} SELECT * FROM remote.${table} WHERE task_id = ? ORDER BY ${order}`).run(taskId);
        }
        db.prepare("INSERT OR IGNORE INTO main.sessions SELECT * FROM remote.sessions WHERE task_id = ?").run(taskId);
        attachments.push(...rowsOf(db, "attachment_references", "task_id, reference_id", taskId, "remote"));
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    db.prepare("DETACH DATABASE remote").run();
    for (const row of attachments) {
      const reference = { taskId: row.task_id, referenceId: row.reference_id, path: row.path, size: row.size, sha256: row.sha256 };
      await verifyAttachmentFile(remoteBackup, reference);
      const destinationFile = await assertSafePath(localBackup, row.path);
      await mkdir(path.dirname(destinationFile), { recursive: true });
      await copyFile(await assertSafePath(remoteBackup, row.path), destinationFile);
      await verifyAttachmentFile(localBackup, reference);
    }
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    await backupProjectStorage(db, localBackup, destination);
  } finally {
    db.close();
  }
  await verifyProjectStorageBackup(destination);
  return destination;
}
