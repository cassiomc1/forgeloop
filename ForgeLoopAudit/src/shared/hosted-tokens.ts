// Client for the forgeloop-site /api/sync-tokens API: list, issue and revoke
// cloud-sync tokens. An issued token is returned once and is only ever held in
// component state; it is never written to browser storage.

export interface SyncTokenEntry {
  id: string;
  name: string;
  repos: string[];
  createdBy: string | null;
  createdAt: string | null;
}

export type SyncTokenResult<T> = { ok: true; value: T } | { ok: false; status: number; message: string };

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export const SYNC_TOKENS_ENDPOINT = '/api/sync-tokens';
const TOKEN_ID = /^[0-9a-f]{16}$/u;
const ISSUED_TOKEN = /^[0-9a-f]{64}$/u;
const REPOSITORY = /^[a-z0-9][a-z0-9-]{0,38}\/[a-z0-9._-]{1,100}$/u;

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const optionalText = (value: unknown): string | null => (typeof value === 'string' ? value : null);

export function parseSyncTokenEntry(value: unknown): SyncTokenEntry | null {
  if (!isRecord(value) || typeof value.id !== 'string' || !TOKEN_ID.test(value.id) || typeof value.name !== 'string') return null;
  if (!Array.isArray(value.repos) || !value.repos.every((repo) => typeof repo === 'string' && REPOSITORY.test(repo))) return null;
  return { id: value.id, name: value.name, repos: value.repos as string[], createdBy: optionalText(value.createdBy), createdAt: optionalText(value.createdAt) };
}

async function failure(response: Response): Promise<{ ok: false; status: number; message: string }> {
  const body: unknown = await response.json().catch(() => null);
  const message = isRecord(body) && typeof body.error === 'string' ? body.error : `The token API returned ${response.status}.`;
  return { ok: false, status: response.status, message };
}

async function call(fetchImpl: FetchLike, url: string, init: RequestInit): Promise<Response | { ok: false; status: number; message: string }> {
  try {
    return await fetchImpl(url, { credentials: 'same-origin', ...init, headers: { accept: 'application/json', ...(init.headers ?? {}) } });
  } catch {
    return { ok: false, status: 0, message: 'The token API is unreachable.' };
  }
}

export async function listSyncTokens(fetchImpl: FetchLike = fetch): Promise<SyncTokenResult<SyncTokenEntry[]>> {
  const response = await call(fetchImpl, SYNC_TOKENS_ENDPOINT, {});
  if (!(response instanceof Response)) return response;
  if (!response.ok) return failure(response);
  const body: unknown = await response.json().catch(() => null);
  if (!isRecord(body) || !Array.isArray(body.tokens)) return { ok: false, status: response.status, message: 'Invalid token list.' };
  return { ok: true, value: body.tokens.map(parseSyncTokenEntry).filter((entry): entry is SyncTokenEntry => entry !== null) };
}

export async function issueSyncToken(name: string, repos: string[], fetchImpl: FetchLike = fetch): Promise<SyncTokenResult<{ token: string; entry: SyncTokenEntry }>> {
  const response = await call(fetchImpl, SYNC_TOKENS_ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, repos }) });
  if (!(response instanceof Response)) return response;
  if (!response.ok) return failure(response);
  const body: unknown = await response.json().catch(() => null);
  const entry = isRecord(body) ? parseSyncTokenEntry(body.entry) : null;
  if (!isRecord(body) || typeof body.token !== 'string' || !ISSUED_TOKEN.test(body.token) || !entry) return { ok: false, status: response.status, message: 'Invalid token response.' };
  return { ok: true, value: { token: body.token, entry } };
}

export async function revokeSyncToken(id: string, fetchImpl: FetchLike = fetch): Promise<SyncTokenResult<true>> {
  if (!TOKEN_ID.test(id)) return { ok: false, status: 400, message: 'Invalid token id.' };
  const response = await call(fetchImpl, `${SYNC_TOKENS_ENDPOINT}?id=${id}`, { method: 'DELETE' });
  if (!(response instanceof Response)) return response;
  return response.ok ? { ok: true, value: true } : failure(response);
}

export function syncSetupCommands(token: string): string {
  return [
    `export FORGELOOP_SYNC_TOKEN=${token}`,
    'export FORGELOOP_SYNC_KEY="<the same passphrase on every machine, 16+ characters>"',
    'forgeloop sync-push        # or: forgeloop sync-pull --writers-quiesced',
  ].join('\n');
}
