import { cp, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { readSyncCredentials, readSyncState, remoteError, strongEtag, resolveRemote, resolveRepository, syncRequest, writeSyncState } from "../core/sync/remote.js";
import { MAX_SNAPSHOT_BYTES, openSnapshot, syncError, unpackDirectory } from "../core/sync/snapshot.js";
import { buildMergedBackup, classifyTasks, readDatabaseDigests } from "../core/sync/merge.js";
import { runStorageRestore } from "./storage-restore.js";

// Downloads, decrypts and restores the repository's snapshot. Remote state is
// untrusted: it must decrypt and authenticate under FORGELOOP_SYNC_KEY, every
// file digest must match, and activation goes through the verified
// storage-restore path (a fresh project, or explicit --replace-active).
// --merge keeps local work: whole tasks are combined three-way against the
// per-task digests recorded at the last push or pull, and the merged state is
// activated through the same replace-active restore.
function assertPullOptions({ writersQuiesced, replaceActive, merge, dryRun }) {
  if (writersQuiesced !== true && !(merge && dryRun)) throw syncError("E_STORAGE_MIGRATION_QUIESCENCE_REQUIRED", "Stop every ForgeLoop writer for this project, then pass --writers-quiesced");
  if (dryRun && !merge) throw syncError("E_SYNC_CONFIG", "--dry-run applies to --merge");
  if (merge && replaceActive) throw syncError("E_SYNC_CONFIG", "Use either --merge or --replace-active");
}

async function fetchSnapshot({ target, remote, repository, env, fetchImpl }) {
  const { token, passphrase } = readSyncCredentials(env);
  const resolvedRemote = resolveRemote(remote);
  const resolvedRepository = await resolveRepository(target, repository);
  const response = await syncRequest({ remote: resolvedRemote, repository: resolvedRepository, token, method: "GET", fetchImpl });
  if (response.status === 404) throw syncError("E_SYNC_REMOTE", `No snapshot has been pushed for ${resolvedRepository}`);
  if (!response.ok) throw await remoteError(response);
  const etag = strongEtag(response.headers.get("etag"));
  const body = Buffer.from(await response.arrayBuffer());
  if (body.length > MAX_SNAPSHOT_BYTES) throw syncError("E_SYNC_TOO_LARGE", "Remote snapshot exceeds the size limit");
  const { envelope, payload } = openSnapshot(body, { passphrase, repository: resolvedRepository });
  return { remote: resolvedRemote, repository: resolvedRepository, etag, envelope, payload };
}

async function mergeSnapshot({ target, packageRoot, staging, source, remoteTasks, summary, snapshot, dryRun, writersQuiesced, env, recordPull }) {
  const local = path.join(staging, "local");
  await backupLocalState(target, local);
  const previous = await readSyncState(target, { remote: snapshot.remote, repository: snapshot.repository, env });
  const base = previous?.tasks && typeof previous.tasks === "object" ? previous.tasks : null;
  const plan = classifyTasks({ local: readDatabaseDigests(path.join(local, "state.sqlite")), remote: remoteTasks, base });
  const report = { ...summary, base: base ? "recorded" : "none", take: plan.take, keep: plan.keep, same: plan.same.length, conflicts: plan.conflicts };
  if (dryRun) return { status: plan.conflicts.length > 0 ? "CONFLICT" : "PLANNED", ...report };
  if (plan.conflicts.length > 0) {
    throw Object.assign(syncError("E_SYNC_MERGE_CONFLICT", `Tasks changed on both machines cannot be merged: ${plan.conflicts.map((item) => item.taskId).join(", ")}`), { report });
  }
  if (plan.take.length === 0) {
    await recordPull();
    return { status: "UP_TO_DATE", ...report };
  }
  const workingCopy = path.join(staging, "working");
  await cp(local, workingCopy, { recursive: true });
  const merged = path.join(staging, "merged");
  await buildMergedBackup({ localBackup: workingCopy, remoteBackup: source, take: plan.take.map((item) => item.taskId), destination: merged });
  const restore = await runStorageRestore({ target, source: merged, writersQuiesced, replaceActive: true, packageRoot });
  await recordPull();
  return { status: "MERGED", ...report, restore };
}

export async function runSyncPull({ target, packageRoot, remote, repository, writersQuiesced = false, replaceActive = false, merge = false, dryRun = false, env = process.env, fetchImpl = fetch } = {}) {
  assertPullOptions({ writersQuiesced, replaceActive, merge, dryRun });
  const snapshot = await fetchSnapshot({ target, remote, repository, env, fetchImpl });
  const staging = await mkdtemp(path.join(os.tmpdir(), "forgeloop-sync-"));
  try {
    const source = path.join(staging, "backup");
    const files = await unpackDirectory(snapshot.payload, source);
    const remoteTasks = readDatabaseDigests(path.join(source, "state.sqlite"));
    const recordPull = () => (snapshot.etag
      ? writeSyncState(target, { remote: snapshot.remote, repository: snapshot.repository, etag: snapshot.etag, direction: "pull", at: new Date().toISOString(), tasks: remoteTasks }, { env })
      : null);
    const summary = { repository: snapshot.repository, remote: snapshot.remote, etag: snapshot.etag, files: files.length, snapshotCreatedAt: snapshot.envelope.createdAt ?? null };
    if (merge) return await mergeSnapshot({ target, packageRoot, staging, source, remoteTasks, summary, snapshot, dryRun, writersQuiesced, env, recordPull });
    const restore = await runStorageRestore({ target, source, writersQuiesced, replaceActive, packageRoot });
    await recordPull();
    return { status: "PULLED", ...summary, replaceActive, restore };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

async function backupLocalState(target, destination) {
  const { withProjectStorage } = await import("../storage/project-boundary.js");
  const { getOperationalStore } = await import("../storage/operational-context.js");
  const { backupProjectStorage } = await import("../storage/project-backup.js");
  await withProjectStorage(target, () => {
    const store = getOperationalStore(target);
    if (!store) throw syncError("E_SYNC_CONFIG", "sync-pull --merge requires an existing SQLite project");
    return backupProjectStorage(store.db, target, destination);
  }, { readOnly: true, existingOnly: true });
}

export function formatSyncPullResult(result) {
  if (result.take !== undefined) {
    const lines = [`FORGELOOP SYNC MERGE: ${result.status} (${result.repository})`, `BASE: ${result.base}`];
    for (const item of result.take) lines.push(`TAKE ${item.taskId} (${item.reason})`);
    for (const item of result.keep) lines.push(`KEEP ${item.taskId} (${item.reason})`);
    for (const item of result.conflicts) lines.push(`CONFLICT ${item.taskId} (${item.reason})`);
    lines.push(`SAME: ${result.same} task(s)`);
    if (result.status === "MERGED") lines.push("The merged state is active (the outgoing state is retained). Run forgeloop sync-push to publish it.");
    lines.push("");
    return lines.join("\n");
  }
  return [
    `FORGELOOP SYNC PULLED: ${result.repository}`,
    `SNAPSHOT: ${result.snapshotCreatedAt ?? "unknown time"} (${result.files} files, ETag ${result.etag ?? "unknown"})`,
    `RESTORED: ${result.replaceActive ? "replaced the active state (outgoing state retained)" : "into a fresh project"}`,
    "Run forgeloop task-list to resume. This machine is now the one allowed to push.",
    "",
  ].join("\n");
}
