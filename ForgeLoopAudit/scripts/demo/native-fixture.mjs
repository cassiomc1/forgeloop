import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

let windowsPowerShellReady = false;
function warmWindowsPowerShell() {
  if (process.platform !== 'win32' || windowsPowerShellReady) return;
  const systemRoot = process.env.SystemRoot;
  if (!systemRoot) throw new Error('Windows fixture preparation requires SystemRoot');
  const executable = join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  // Hosted Windows cold startup can exceed ForgeLoop's five-second identity
  // query budget. Warm the system shell before invoking maintenance. ForgeLoop
  // still performs its own bounded, kernel-backed admission on every operation.
  const ticks = execFileSync(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
    `[Console]::Out.Write([System.Diagnostics.Process]::GetProcessById(${process.pid}).StartTime.ToUniversalTime().Ticks)`],
  { encoding: 'utf8', timeout: 30_000, windowsHide: true }).trim();
  if (!/^\d+$/u.test(ticks)) throw new Error('Windows PowerShell process observation is unavailable');
  windowsPowerShellReady = true;
}

// Test preparation only. Never pass an inspected project as the destination.
export function createNativeDemoFixture(source = resolve('demo')) {
  warmWindowsPowerShell();
  const parent = mkdtempSync(join(tmpdir(), 'forgeloop-audit-native-demo-'));
  const root = join(parent, 'demo');
  try {
    cpSync(source, root, { recursive: true });
    const tasks = join(root, '.forgeloop', 'task-state');
    for (const key of readdirSync(tasks)) {
      const executions = join(tasks, key, 'executions');
      let names;
      try { names = readdirSync(executions); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      for (const name of names) {
        const file = join(executions, name);
        const value = JSON.parse(readFileSync(file, 'utf8'));
        if (value.cwd === value.protocolProjectRoot) value.cwd = root;
        value.protocolProjectRoot = root;
        writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
      }
    }
    const output = execFileSync(process.execPath, [fileURLToPath(import.meta.resolve('@cassiomc1/forgeloop')), 'storage-migrate', '--path', root, '--destination', '.retained-migration', '--writers-quiesced', '--json'], { encoding: 'utf8' });
    const result = JSON.parse(output);
    if (result.phase !== 'PUBLISHED' || result.currentStateVerified !== true) throw new Error(`Native fixture migration failed: ${output}`);
    return { root, cleanup: () => rmSync(parent, { recursive: true, force: true }) };
  } catch (error) {
    rmSync(parent, { recursive: true, force: true });
    throw error;
  }
}
