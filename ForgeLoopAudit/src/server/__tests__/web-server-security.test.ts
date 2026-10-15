import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AuditRuntime } from '../runtime/audit-runtime';
import { AuditWebServer } from '../web-server';

const servers: Array<{ server: AuditWebServer; runtime: AuditRuntime; root: string }> = [];

afterEach(async () => {
  for (const entry of servers.splice(0)) {
    await entry.server.stop();
    await entry.runtime.shutdown();
    rmSync(entry.root, { recursive: true, force: true });
  }
});

describe('local web server security boundary', () => {
  it('requires a one-time bootstrap token and same-origin session for API access', async () => {
    const root = mkdtempSync(join(tmpdir(), 'forgeloop-web-server-'));
    const staticRoot = join(root, 'static');
    mkdirSync(staticRoot, { recursive: true });
    writeFileSync(join(staticRoot, 'index.html'), '<!doctype html><title>ForgeLoopAudit</title>');
    const runtime = new AuditRuntime({ auditVersion: 'test', applicationDataRoot: join(root, 'data'), schemaDirectory: resolve('schemas') });
    const server = new AuditWebServer({ runtime, staticRoot, applicationDataRoot: join(root, 'data'), port: 0 });
    servers.push({ server, runtime, root });
    const address = await server.start();

    const unauthenticated = await fetch(`${address.origin}/api/v1/app`, { headers: { Origin: address.origin } });
    expect(unauthenticated.status).toBe(401);

    const forbidden = await fetch(`${address.origin}/api/v1/app`, { headers: { Origin: 'http://evil.example' } });
    expect(forbidden.status).toBe(403);

    const token = new URL(address.bootstrapUrl).searchParams.get('bootstrap');
    const bootstrap = await fetch(`${address.origin}/api/v1/session/bootstrap`, {
      method: 'POST',
      headers: { Origin: address.origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    expect(bootstrap.status).toBe(200);
    const cookie = bootstrap.headers.get('set-cookie');
    expect(cookie).toMatch(/HttpOnly/iu);
    expect(cookie).toMatch(/SameSite=Strict/iu);

    const authenticated = await fetch(`${address.origin}/api/v1/app`, { headers: { Origin: address.origin, Cookie: cookie?.split(';')[0] ?? '' } });
    expect(authenticated.status).toBe(200);
    await expect(authenticated.json()).resolves.toMatchObject({ ok: true, data: { version: 'test' } });
  });

  it('serves a restrictive content security policy and prevents static traversal', async () => {
    const root = mkdtempSync(join(tmpdir(), 'forgeloop-web-static-'));
    const staticRoot = join(root, 'static');
    mkdirSync(staticRoot, { recursive: true });
    writeFileSync(join(staticRoot, 'index.html'), 'ok');
    writeFileSync(join(root, 'secret.txt'), 'secret');
    const runtime = new AuditRuntime({ auditVersion: 'test', applicationDataRoot: join(root, 'data'), schemaDirectory: resolve('schemas') });
    const server = new AuditWebServer({ runtime, staticRoot, applicationDataRoot: join(root, 'data'), port: 0 });
    servers.push({ server, runtime, root });
    const address = await server.start();

    const response = await fetch(`${address.origin}/`, { headers: { Host: `127.0.0.1:${address.port}` } });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-security-policy')).toContain("object-src 'none'");
    const traversal = await fetch(`${address.origin}/../secret.txt`, { headers: { Host: `127.0.0.1:${address.port}` } });
    expect(traversal.status).toBe(404);
  });
});
