import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  E_EVIDENCE_PUBLISH_CONFIG,
  E_EVIDENCE_PUBLISH_UNAUTHORIZED,
} from "../error-codes.js";
import { ensureWithin } from "../filesystem.js";
import { resolveRepository } from "../sync/remote.js";
import { DEFAULT_EVIDENCE_DIRECTORY, assertEvidenceTaskId, evidenceBundlePath, evidenceError, parseEvidenceBundle } from "./bundle-format.js";

// Opt-in evidence publishing for the team dashboard. Nothing leaves the
// machine unless `forgeloop evidence-publish` runs, and only bundles that
// evidence-export already redacted and that still match their digest are sent.
// Requested bundles enter an offline queue kept outside the repository; every
// run retries it, so a laptop that was offline publishes on its next run. The
// remote treats a repeated bundle as unchanged, which makes retries safe.

export const DEFAULT_EVIDENCE_REMOTE = "https://forgeloop.monster/api/evidence";
const REQUEST_TIMEOUT_MS = 60_000;

function publishError(code, message) {
  return evidenceError(code, message);
}

export function resolvePublishRemote(value) {
  let url;
  try {
    url = new URL(value || DEFAULT_EVIDENCE_REMOTE);
  } catch {
    throw publishError(E_EVIDENCE_PUBLISH_CONFIG, "--remote must be a URL");
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) throw publishError(E_EVIDENCE_PUBLISH_CONFIG, "--remote must use https (http is allowed only for localhost)");
  if (url.username || url.password || url.search || url.hash) throw publishError(E_EVIDENCE_PUBLISH_CONFIG, "--remote must not contain credentials, a query or a fragment");
  return url.toString();
}

export function readPublishToken(env = process.env) {
  const bearer = env.FORGELOOP_SYNC_TOKEN ?? "";
  if (!/^[A-Za-z0-9._~+/-]{32,512}$/u.test(bearer)) throw publishError(E_EVIDENCE_PUBLISH_CONFIG, "FORGELOOP_SYNC_TOKEN must be set to a ForgeLoop token for this repository");
  return bearer;
}

function queueFile(target, env) {
  const base = env.FORGELOOP_EVIDENCE_QUEUE_DIR
    || (env.XDG_CONFIG_HOME ? path.join(env.XDG_CONFIG_HOME, "forgeloop", "evidence-queue") : path.join(os.homedir(), ".config", "forgeloop", "evidence-queue"));
  const key = createHash("sha256").update(path.resolve(target)).digest("hex").slice(0, 32);
  return path.join(base, `${key}.json`);
}

export async function readPublishQueue(target, { env = process.env } = {}) {
  try {
    const parsed = JSON.parse(await readFile(queueFile(target, env), "utf8"));
    return Array.isArray(parsed?.items)
      ? parsed.items.filter((item) => typeof item?.taskId === "string" && typeof item?.path === "string" && typeof item?.remote === "string" && typeof item?.repository === "string")
      : [];
  } catch {
    return [];
  }
}

async function writePublishQueue(target, items, { env }) {
  const file = queueFile(target, env);
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify({ schemaVersion: 1, items }, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, file);
}

// Explicit task IDs must be valid; --all skips files whose names cannot be
// evidence bundles instead of aborting the run.
async function requestedItems(target, { taskIds, all, directory, remote, repository }) {
  const names = new Set(taskIds.map((taskId) => assertEvidenceTaskId(taskId)));
  const skipped = [];
  if (all) {
    let entries = [];
    try { entries = await readdir(ensureWithin(target, directory)); } catch { entries = []; }
    for (const entry of entries.filter((name) => name.endsWith(".json")).sort()) {
      const taskId = entry.slice(0, -".json".length);
      try { names.add(assertEvidenceTaskId(taskId)); } catch { skipped.push(entry); }
    }
  }
  const items = [...names].sort().map((taskId) => ({ taskId, path: evidenceBundlePath(directory, taskId), remote, repository }));
  return { items, skipped };
}

async function send({ remote, repository, bearer, text, fetchImpl }) {
  const url = new URL(remote);
  url.searchParams.set("repo", repository);
  try {
    return await fetchImpl(url.toString(), {
      method: "PUT",
      headers: { authorization: `Bearer ${bearer}`, accept: "application/json", "content-type": "application/json" },
      body: text,
      signal: globalThis.AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    return { networkError: error.message };
  }
}

// Publishes one queued bundle. Returns the item's outcome and whether it stays
// in the queue.
async function publishItem(target, item, context) {
  let text;
  try {
    text = await readFile(ensureWithin(target, item.path), "utf8");
  } catch {
    return { outcome: { taskId: item.taskId, status: "MISSING", message: `${item.path} no longer exists` }, keep: false };
  }
  let bundle;
  try {
    bundle = parseEvidenceBundle(text, item.taskId);
  } catch (error) {
    return { outcome: { taskId: item.taskId, status: "INVALID", code: error.code, message: error.message }, keep: false };
  }
  const response = await send({ ...context, text });
  if (response.networkError) return { outcome: { taskId: item.taskId, digest: bundle.digest, status: "QUEUED", message: `Remote unreachable: ${response.networkError}` }, keep: true };
  const detail = await response.json().catch(() => ({}));
  if (response.ok) return { outcome: { taskId: item.taskId, digest: bundle.digest, status: detail?.status === "unchanged" ? "UNCHANGED" : "PUBLISHED" }, keep: false };
  const message = typeof detail?.error === "string" ? detail.error : `HTTP ${response.status}`;
  if (response.status === 401 || response.status === 403) return { outcome: { taskId: item.taskId, digest: bundle.digest, status: "UNAUTHORIZED", message }, keep: true, unauthorized: message };
  if (response.status === 400 || response.status === 413) return { outcome: { taskId: item.taskId, digest: bundle.digest, status: "REJECTED", message }, keep: false };
  return { outcome: { taskId: item.taskId, digest: bundle.digest, status: "QUEUED", message }, keep: true };
}

export async function publishEvidence({
  target,
  taskIds = [],
  all = false,
  directory = DEFAULT_EVIDENCE_DIRECTORY,
  remote,
  repository,
  env = process.env,
  fetchImpl = fetch,
} = {}) {
  const resolvedRemote = resolvePublishRemote(remote);
  const resolvedRepository = await resolveRepository(target, repository).catch((error) => {
    throw publishError(E_EVIDENCE_PUBLISH_CONFIG, error.message);
  });
  const bearer = readPublishToken(env);
  // Queued items stay bound to the remote and repository they were queued
  // for; a run with other flags leaves them untouched.
  const queue = await readPublishQueue(target, { env });
  const matches = (item) => item.remote === resolvedRemote && item.repository === resolvedRepository;
  const elsewhere = queue.filter((item) => !matches(item));
  const queued = queue.filter(matches);
  const { items: requested, skipped } = await requestedItems(target, { taskIds, all, directory, remote: resolvedRemote, repository: resolvedRepository });
  if (queued.length === 0 && requested.length === 0) {
    throw publishError(E_EVIDENCE_PUBLISH_CONFIG, "Nothing to publish: pass --task <id> or --all, or run again after a queued publish");
  }
  const pending = [...new Map([...queued, ...requested].map((item) => [item.taskId, item])).values()];
  // Queue first, so an interrupted run still retries every requested bundle.
  await writePublishQueue(target, [...elsewhere, ...pending], { env });
  const context = { remote: resolvedRemote, repository: resolvedRepository, bearer, fetchImpl };
  const results = [];
  const remaining = [];
  let unauthorized = null;
  for (const item of pending) {
    if (unauthorized) {
      results.push({ taskId: item.taskId, status: "QUEUED", message: "Not attempted after the remote refused the token" });
      remaining.push(item);
      continue;
    }
    const { outcome, keep, unauthorized: refused } = await publishItem(target, item, context);
    results.push(outcome);
    if (keep) remaining.push(item);
    if (refused) unauthorized = refused;
  }
  await writePublishQueue(target, [...elsewhere, ...remaining], { env });
  if (unauthorized) {
    throw Object.assign(publishError(E_EVIDENCE_PUBLISH_UNAUTHORIZED, `The evidence remote refused FORGELOOP_SYNC_TOKEN: ${unauthorized}`), { results, queued: remaining.length });
  }
  const complete = results.every((result) => result.status === "PUBLISHED" || result.status === "UNCHANGED");
  return {
    schemaVersion: 1,
    status: complete ? "PUBLISHED" : remaining.length > 0 ? "QUEUED" : "INCOMPLETE",
    remote: resolvedRemote,
    repository: resolvedRepository,
    results,
    queued: remaining.length,
    skipped,
  };
}
