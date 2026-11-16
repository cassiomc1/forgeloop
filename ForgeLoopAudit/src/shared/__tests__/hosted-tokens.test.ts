import { describe, expect, it } from 'vitest';
import { issueSyncToken, listSyncTokens, parseSyncTokenEntry, revokeSyncToken, syncSetupCommands } from '../hosted-tokens';

const entry = { id: 'a'.repeat(16), name: 'laptop', repos: ['acme/app'], createdBy: 'owner@example.com', createdAt: '2026-11-16T00:00:00.000Z' };
const respond = (status: number, body?: unknown) => async () => new Response(body === undefined ? null : JSON.stringify(body), { status });

describe('hosted sync token client', () => {
  it('parses only well-formed entries', () => {
    expect(parseSyncTokenEntry(entry)).toEqual(entry);
    expect(parseSyncTokenEntry({ ...entry, id: 'short' })).toBeNull();
    expect(parseSyncTokenEntry({ ...entry, repos: ['../x'] })).toBeNull();
    expect(parseSyncTokenEntry({ ...entry, createdBy: 1 })).toEqual({ ...entry, createdBy: null });
  });

  it('lists, issues and revokes through the API', async () => {
    expect(await listSyncTokens(respond(200, { tokens: [entry, { id: 'bad' }] }))).toEqual({ ok: true, value: [entry] });
    expect(await listSyncTokens(respond(401, { error: 'Sign in required' }))).toEqual({ ok: false, status: 401, message: 'Sign in required' });
    const calls: RequestInit[] = [];
    const issued = await issueSyncToken('laptop', ['acme/app'], async (_url, init) => { calls.push(init ?? {}); return new Response(JSON.stringify({ token: 'f'.repeat(64), entry }), { status: 201 }); });
    expect(issued).toEqual({ ok: true, value: { token: 'f'.repeat(64), entry } });
    expect(calls[0].method).toBe('POST');
    expect(calls[0].credentials).toBe('same-origin');
    expect(await issueSyncToken('x', ['acme/app'], respond(201, { token: 'not-hex', entry }))).toMatchObject({ ok: false });
    expect(await revokeSyncToken('a'.repeat(16), respond(200, { ok: true }))).toEqual({ ok: true, value: true });
    expect(await revokeSyncToken('../x', respond(200))).toMatchObject({ ok: false, status: 400 });
    expect(await listSyncTokens(async () => { throw new Error('offline'); })).toEqual({ ok: false, status: 0, message: 'The token API is unreachable.' });
  });

  it('prints setup commands without a passphrase', () => {
    const text = syncSetupCommands('f'.repeat(64));
    expect(text).toContain(`FORGELOOP_SYNC_TOKEN=${'f'.repeat(64)}`);
    expect(text).toContain('FORGELOOP_SYNC_KEY="<');
  });
});
