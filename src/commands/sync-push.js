import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";

import { readSyncCredentials, readSyncState, remoteError, resolveRemote, resolveRepository, syncRequest, writeSyncState } from "../core/sync/remote.js";
import { packDirectory, sealSnapshot } from "../core/sync/snapshot.js";
import { runStorageBackup } from "./storage-backup.js";

// Uploads an encrypted, attachment-inclusive backup of this project's ForgeLoop
// state. The write is conditional: the first push only creates, later pushes
// must match the ETag this machine last pushed or pulled.
export async function runSyncPush({ target, packageRoot, remote, repository, env = process.env, fetchImpl = fetch } = {}) {
  const { token, passphrase } = readSyncCredentials(env);
  const resolvedRemote = resolveRemote(remote);
  const resolvedRepository = await resolveRepository(target, repository);
  const staging = path.join(".forgeloop", `sync-staging-${randomUUID()}`);
  let body;
  let files;
  try {
    await runStorageBackup({ target, destination: staging, includeAttachments: true });
    const payload = await packDirectory(path.join(target, staging));
    files = payload.files.length;
    const version = packageRoot ? JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8")).version ?? null : null;
    body = sealSnapshot(payload, { passphrase, repository: resolvedRepository, forgeloopVersion: version });
  } finally {
    await rm(path.join(target, staging), { recursive: true, force: true });
  }
  const previous = await readSyncState(target, { remote: resolvedRemote, repository: resolvedRepository, env });
  const response = await syncRequest({
    remote: resolvedRemote, repository: resolvedRepository, token, method: "PUT", body, fetchImpl,
    headers: previous ? { "if-match": previous.etag } : { "if-none-match": "*" },
  });
  if (!response.ok) throw await remoteError(response);
  const result = await response.json().catch(() => ({}));
  const etag = typeof result.etag === "string" ? result.etag : response.headers.get("etag");
  if (etag) await writeSyncState(target, { remote: resolvedRemote, repository: resolvedRepository, etag, direction: "push", at: new Date().toISOString() }, { env });
  return { status: "PUSHED", repository: resolvedRepository, remote: resolvedRemote, etag, files, bytes: body.length, firstPush: previous === null };
}

export function formatSyncPushResult(result) {
  return [
    `FORGELOOP SYNC PUSHED: ${result.repository}`,
    `REMOTE: ${result.remote}`,
    `FILES: ${result.files} (${result.bytes} encrypted bytes)`,
    `ETAG: ${result.etag ?? "unknown"}`,
    "Another machine can now run forgeloop sync-pull. Pushes from machines that have not pulled this version are refused.",
    "",
  ].join("\n");
}
