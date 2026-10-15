import { chmod, mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ForgeCli } from '@main/core/cli/forge-cli';

async function fakeCli(body: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'forgeloop-cli-'));
  const bin = join(root, 'bin');
  await mkdir(bin);
  const script = join(bin, 'forgeloop-cli.js');
  await writeFile(script, body);
  if (process.platform === 'win32') {
    const file = join(bin, 'forgeloop.cmd');
    await writeFile(file, `@echo off\r\nnode "%~dp0\\forgeloop-cli.js" %*\r\n`);
    return file;
  }
  const file = join(bin, 'forgeloop');
  await writeFile(file, `#!/usr/bin/env node\n${body}\n`);
  await chmod(file, 0o755);
  return file;
}

describe('ForgeCli execution contract', () => {
  it('parses successful JSON output and rejects unknown commands internally', async () => {
    const executable = await fakeCli("process.stdout.write(JSON.stringify({ protocolVersion: 1 }));");
    const cli = new ForgeCli(process.cwd(), executable);
    await expect(cli.protocolInfo()).resolves.toMatchObject({ success: true, data: { protocolVersion: 1 } });
  });

  it('enforces the output-size limit', async () => {
    const executable = await fakeCli("process.stdout.write('x'.repeat(128));");
    const cli = new ForgeCli(process.cwd(), executable, { maxOutputBytes: 32 });
    await expect(cli.protocolInfo()).resolves.toMatchObject({ success: false, error: expect.stringContaining('exceeded maximum size') });
  });

  it('enforces the command timeout', async () => {
    const executable = await fakeCli('setTimeout(() => {}, 1000);');
    const cli = new ForgeCli(process.cwd(), executable, { timeoutMs: 20 });
    await expect(cli.protocolInfo()).resolves.toMatchObject({ success: false, error: expect.stringContaining('timed out after 20ms') });
  });

  it('covers every read-only command and preserves process failures', async () => {
    const executable = await fakeCli("if (process.argv.includes('policy-status')) process.stderr.write('denied'); else process.stdout.write(JSON.stringify({ ok: true })); process.exitCode = process.argv.includes('audit') || process.argv.includes('policy-status') ? 2 : 0;");
    const cli = new ForgeCli(process.cwd(), executable);
    await expect(cli.taskList()).resolves.toMatchObject({ success: true, data: { ok: true } });
    await expect(cli.taskShow('task')).resolves.toMatchObject({ success: true });
    await expect(cli.status('task')).resolves.toMatchObject({ success: true });
    await expect(cli.progress('task')).resolves.toMatchObject({ success: true });
    await expect(cli.continuity('task')).resolves.toMatchObject({ success: true });
    await expect(cli.next('task')).resolves.toMatchObject({ success: true });
    await expect(cli.audit('task')).resolves.toMatchObject({ success: false, exitCode: 2 });
    await expect(cli.report('task')).resolves.toMatchObject({ success: true });
    await expect(cli.policyStatus()).resolves.toMatchObject({ success: false, error: 'denied' });
    await expect(cli.policyStatus('task')).resolves.toMatchObject({ success: false, error: 'denied' });
    await expect(cli.checkCliAvailable()).resolves.toBe(true);
  });

  it('returns a parse error for malformed command output', async () => {
    const executable = await fakeCli("process.stdout.write('not-json');");
    await expect(new ForgeCli(process.cwd(), executable).protocolInfo()).resolves.toMatchObject({ success: false, error: expect.stringContaining('Failed to parse') });
  });
});
