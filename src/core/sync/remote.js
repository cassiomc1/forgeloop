import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { syncError } from "./snapshot.js";

// Cloud-sync transport and local bookkeeping. The bearer token and passphrase
// come only from the environment and are never written anywhere. The last
// remote ETag is kept per project outside the repository, under the user's
// config directory, so sync never adds files to the working tree.

export const DEFAULT_SYNC_REMOTE = "https://forgeloop.monster/api/sync";
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/u;
const NAME = /^[A-Za-z0-9._-]{1,100}$/u;
const REQUEST_TIMEOUT_MS = 60_000;

// The hosting edge may weaken a validator (W/"x") for the same version the
// store reports as "x"; sync always stores and sends the strong form.
export function strongEtag(value) {
  return typeof value === "string" && value ? value.replace(/^W\//u, "") : null;
}

export function normalizeRepository(value) {
  const [owner, name, extra] = String(value ?? "").split("/");
  if (extra !== undefined || !OWNER.test(owner ?? "") || !NAME.test(name ?? "") || name === "." || name === "..") return null;
  return `${owner}/${name}`.toLowerCase();
}

export function repositoryFromRemoteUrl(url) {
  const match = /github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/u.exec(String(url ?? "").trim());
  return match ? normalizeRepository(`${match[1]}/${match[2]}`) : null;
}

export async function resolveRepository(target, explicit) {
  if (explicit) {
    const repository = normalizeRepository(explicit);
    if (!repository) throw syncError("E_SYNC_CONFIG", "--repo must be owner/name");
    return repository;
  }
  try {
    const { stdout } = await promisify(execFile)("git", ["-C", target, "config", "--get", "remote.origin.url"], { timeout: 10_000 });
    const repository = repositoryFromRemoteUrl(stdout);
    if (repository) return repository;
  } catch {
    // Fall through to the explicit-repository error.
  }
  throw syncError("E_SYNC_CONFIG", "Could not derive owner/name from the git origin; pass --repo owner/name");
}

export function resolveRemote(value) {
  let url;
  try {
    url = new URL(value || DEFAULT_SYNC_REMOTE);
  } catch {
    throw syncError("E_SYNC_CONFIG", "--remote must be a URL");
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) throw syncError("E_SYNC_CONFIG", "--remote must use https (http is allowed only for localhost)");
  if (url.username || url.password || url.search || url.hash) throw syncError("E_SYNC_CONFIG", "--remote must not contain credentials, a query or a fragment");
  return url.toString();
}

export function readSyncCredentials(env = process.env) {
  const bearer = env.FORGELOOP_SYNC_TOKEN ?? "";
  if (!/^[A-Za-z0-9._~+/-]{32,512}$/u.test(bearer)) throw syncError("E_SYNC_CONFIG", "FORGELOOP_SYNC_TOKEN must be set to the sync token (32 or more URL-safe characters)");
  return { token: bearer, passphrase: env.FORGELOOP_SYNC_KEY ?? "" };
}

export async function syncRequest({ remote, repository, token, method, body, headers = {}, fetchImpl = fetch }) {
  const url = new URL(remote);
  url.searchParams.set("repo", repository);
  let response;
  try {
    response = await fetchImpl(url.toString(), {
      method,
      headers: { authorization: `Bearer ${token}`, accept: "application/json", ...headers, ...(body ? { "content-type": "application/json" } : {}) },
      ...(body ? { body } : {}),
      signal: globalThis.AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw syncError("E_SYNC_REMOTE", `Sync remote unreachable: ${error.message}`);
  }
  return response;
}

export async function remoteError(response) {
  const detail = await response.json().catch(() => ({}));
  const message = typeof detail?.error === "string" ? detail.error : `HTTP ${response.status}`;
  if (response.status === 412) return syncError("E_SYNC_CONFLICT", `${message}. Run forgeloop sync-pull first.`);
  if (response.status === 401 || response.status === 403) return syncError("E_SYNC_UNAUTHORIZED", message);
  if (response.status === 413) return syncError("E_SYNC_TOO_LARGE", message);
  return syncError("E_SYNC_REMOTE", `Sync remote refused the request: ${message}`);
}

function stateDirectory(env = process.env) {
  const base = env.FORGELOOP_SYNC_STATE_DIR
    || (env.XDG_CONFIG_HOME ? path.join(env.XDG_CONFIG_HOME, "forgeloop") : path.join(os.homedir(), ".config", "forgeloop"));
  return path.join(base, "sync");
}

function stateFile(target, env) {
  const key = createHash("sha256").update(path.resolve(target)).digest("hex").slice(0, 32);
  return path.join(stateDirectory(env), `${key}.json`);
}

export async function readSyncState(target, { remote, repository, env = process.env } = {}) {
  try {
    const state = JSON.parse(await readFile(stateFile(target, env), "utf8"));
    return state.remote === remote && state.repository === repository && typeof state.etag === "string" ? state : null;
  } catch {
    return null;
  }
}

export async function writeSyncState(target, state, { env = process.env } = {}) {
  const file = stateFile(target, env);
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, file);
}
