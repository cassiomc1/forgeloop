import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { AuditRuntime } from './runtime/audit-runtime';
import { AuditWebServer } from './web-server';
import { resolveApplicationDataRoot } from './storage/app-data';
import { resolveTrustedSchemaDirectory } from '@main/core/protocol/validator';
import { isFixtureProjectMode } from './runtime/fixture-mode';

interface CliOptions {
  projectPath?: string;
  port: number;
  noOpen: boolean;
  demo: boolean;
}

const packageMetadata = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as { version?: string };

export async function runServerCli(argv = process.argv.slice(2)): Promise<void> {
  const options = parseArguments(argv);
  const applicationDataRoot = resolveApplicationDataRoot();
  const schemaDirectory = resolveTrustedSchemaDirectory({
    allowEnvironmentOverride: true,
    cwd: process.cwd(),
    moduleDir: process.cwd(),
  });
  const runtime = new AuditRuntime({
    auditVersion: packageMetadata.version ?? 'unknown',
    applicationDataRoot,
    schemaDirectory,
    appPath: process.cwd(),
    demoPath: isFixtureProjectMode(false, process.env) ? process.env.FORGELOOP_AUDIT_FIXTURE_PROJECT : undefined,
  });

  if (options.projectPath) await runtime.openProjectForStartup(options.projectPath);
  else if (options.demo) await runtime.openDemoProject();

  const server = new AuditWebServer({
    runtime,
    staticRoot: resolve(process.cwd(), 'dist', 'renderer'),
    applicationDataRoot,
    host: '127.0.0.1',
    port: options.port,
  });
  const address = await server.start();
  process.stdout.write(`ForgeLoopAudit web server listening at ${address.origin}\n`);
  process.stdout.write(`Open this local URL to authenticate the browser session: ${address.bootstrapUrl}\n`);
  process.stdout.write(`Application data: ${applicationDataRoot}\n`);
  if (process.env.FORGELOOP_AUDIT_TEST_INFO_FILE) {
    writeFileSync(process.env.FORGELOOP_AUDIT_TEST_INFO_FILE, `${JSON.stringify({ ...address, projectPath: options.projectPath ?? null }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  }

  if (!options.noOpen && process.env.FORGELOOP_AUDIT_NO_OPEN !== '1') openBrowser(address.bootstrapUrl);

  const shutdown = async () => {
    await server.stop();
    await runtime.shutdown();
  };
  process.once('SIGINT', () => { void shutdown().finally(() => process.exit(0)); });
  process.once('SIGTERM', () => { void shutdown().finally(() => process.exit(0)); });
}

function parseArguments(argv: string[]): CliOptions {
  const options: CliOptions = { port: 0, noOpen: false, demo: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--project') {
      const value = argv[++index];
      if (!value) throw new Error('--project requires a path');
      options.projectPath = resolve(value);
    } else if (argument === '--port') {
      const value = Number(argv[++index]);
      if (!Number.isInteger(value) || value < 0 || value > 65535) throw new Error('--port must be an integer between 0 and 65535');
      options.port = value;
    } else if (argument === '--demo') {
      options.demo = true;
    } else if (argument === '--no-open') {
      options.noOpen = true;
    } else if (argument === '--help' || argument === '-h') {
      process.stdout.write('Usage: forgeloop-audit [--project PATH] [--demo] [--port PORT] [--no-open]\n');
      process.exit(0);
    } else if (argument === '--version' || argument === '-v') {
      process.stdout.write(`${packageMetadata.version ?? 'unknown'}\n`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (options.projectPath && options.demo) throw new Error('Use either --project or --demo, not both');
  return options;
}

function openBrowser(url: string): void {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  const child = spawn(command, args, { detached: true, stdio: 'ignore' });
  child.unref();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runServerCli().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
