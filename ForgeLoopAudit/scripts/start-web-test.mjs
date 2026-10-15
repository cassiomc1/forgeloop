import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const projectPath = mkdtempSync(join(tmpdir(), 'forgeloop-audit-web-test-'));
cpSync('demo', projectPath, { recursive: true });
const infoFile = join(process.cwd(), 'test-results', 'web-server.json');
mkdirSync(join(process.cwd(), 'test-results'), { recursive: true });
rmSync(infoFile, { force: true });
const child = spawn(process.execPath, ['dist/server/cli.mjs', '--project', projectPath, '--port', '41731', '--no-open'], {
  cwd: process.cwd(),
  env: { ...process.env, FORGELOOP_AUDIT_DATA_DIR: join(projectPath, '.app-data'), FORGELOOP_AUDIT_TEST_INFO_FILE: infoFile, FORGELOOP_AUDIT_TEST_REUSABLE_BOOTSTRAP: '1' },
  stdio: 'inherit',
});

const stop = () => {
  if (!child.killed) child.kill('SIGTERM');
};
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
child.once('exit', (code, signal) => {
  rmSync(projectPath, { recursive: true, force: true });
  rmSync(infoFile, { force: true });
  process.exit(code ?? (signal ? 1 : 0));
});
