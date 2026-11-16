import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { readSyncCredentials, remoteError, resolveRemote, resolveRepository, syncRequest, writeSyncState } from "../core/sync/remote.js";
import { MAX_SNAPSHOT_BYTES, openSnapshot, syncError, unpackDirectory } from "../core/sync/snapshot.js";
import { runStorageRestore } from "./storage-restore.js";

// Downloads, decrypts and restores the repository's snapshot. Remote state is
// untrusted: it must decrypt and authenticate under FORGELOOP_SYNC_KEY, every
// file digest must match, and activation goes through the verified
// storage-restore path (a fresh project, or explicit --replace-active).
export async function runSyncPull({ target, packageRoot, remote, repository, writersQuiesced = false, replaceActive = false, env = process.env, fetchImpl = fetch } = {}) {
  if (writersQuiesced !== true) throw syncError("E_STORAGE_MIGRATION_QUIESCENCE_REQUIRED", "Stop every ForgeLoop writer for this project, then pass --writers-quiesced");
  const { token, passphrase } = readSyncCredentials(env);
  const resolvedRemote = resolveRemote(remote);
  const resolvedRepository = await resolveRepository(target, repository);
  const response = await syncRequest({ remote: resolvedRemote, repository: resolvedRepository, token, method: "GET", fetchImpl });
  if (response.status === 404) throw syncError("E_SYNC_REMOTE", `No snapshot has been pushed for ${resolvedRepository}`);
  if (!response.ok) throw await remoteError(response);
  const etag = response.headers.get("etag");
  const body = Buffer.from(await response.arrayBuffer());
  if (body.length > MAX_SNAPSHOT_BYTES) throw syncError("E_SYNC_TOO_LARGE", "Remote snapshot exceeds the size limit");
  const { envelope, payload } = openSnapshot(body, { passphrase, repository: resolvedRepository });

  const staging = await mkdtemp(path.join(os.tmpdir(), "forgeloop-sync-"));
  try {
    const source = path.join(staging, "backup");
    const files = await unpackDirectory(payload, source);
    const restore = await runStorageRestore({ target, source, writersQuiesced, replaceActive, packageRoot });
    if (etag) await writeSyncState(target, { remote: resolvedRemote, repository: resolvedRepository, etag, direction: "pull", at: new Date().toISOString() }, { env });
    return { status: "PULLED", repository: resolvedRepository, remote: resolvedRemote, etag, files: files.length, snapshotCreatedAt: envelope.createdAt ?? null, replaceActive, restore };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

export function formatSyncPullResult(result) {
  return [
    `FORGELOOP SYNC PULLED: ${result.repository}`,
    `SNAPSHOT: ${result.snapshotCreatedAt ?? "unknown time"} (${result.files} files, ETag ${result.etag ?? "unknown"})`,
    `RESTORED: ${result.replaceActive ? "replaced the active state (outgoing state retained)" : "into a fresh project"}`,
    "Run forgeloop task-list to resume. This machine is now the one allowed to push.",
    "",
  ].join("\n");
}
