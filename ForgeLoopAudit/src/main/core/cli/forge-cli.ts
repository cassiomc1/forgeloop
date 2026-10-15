import { spawn, SpawnOptions } from 'child_process';
import { existsSync, realpathSync, readFileSync } from 'fs';
import { delimiter, dirname, isAbsolute, join, sep } from 'path';
import { ForgeLoopAuditError } from '@shared/errors';
import { ALLOWED_CLI_COMMANDS, CLI_TIMEOUT_MS, CLI_MAX_STDOUT_BYTES } from '@shared/constants';
import { parseJsonSafely } from '@main/security/resource-limits';

export interface CliResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  exitCode?: number;
}

export interface ForgeCliOptions {
  timeoutMs?: number;
  maxOutputBytes?: number;
}

export class ForgeCli {
  private readonly projectRoot: string;
  private readonly forgeLoopPath: string | null;
  private readonly timeoutMs: number;
  private readonly maxOutputBytes: number;

  constructor(projectRoot: string, forgeLoopPath: string = 'forgeloop', options: ForgeCliOptions = {}) {
    this.projectRoot = projectRoot;
    this.forgeLoopPath = resolveTrustedForgeLoopPath(forgeLoopPath, projectRoot);
    this.timeoutMs = options.timeoutMs ?? CLI_TIMEOUT_MS;
    this.maxOutputBytes = options.maxOutputBytes ?? CLI_MAX_STDOUT_BYTES;
  }

  private async executeCommand(args: string[]): Promise<CliResult<unknown>> {
    const executable = this.forgeLoopPath;
    if (!executable) return { success: false, error: 'ForgeLoop CLI unavailable', exitCode: -1 };
    const commandName = args[0];

    if (!ALLOWED_CLI_COMMANDS.includes(commandName as typeof ALLOWED_CLI_COMMANDS[number])) {
      throw ForgeLoopAuditError.cliFailed(commandName, -1, `Command not in allowlist: ${commandName}`);
    }

    const options: SpawnOptions = {
      cwd: this.projectRoot,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        FORGELOOP_NO_COLOR: '1',
      },
    };

    const invocation = resolveInvocation(executable, args);
    if (!invocation) return { success: false, error: 'ForgeLoop CLI shim has no trusted JavaScript entrypoint', exitCode: -1 };

    return new Promise((resolve) => {
      const child = spawn(invocation.executable, invocation.args, options);
      let stdout = '';
      let stderr = '';
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let settled = false;
      const finish = (result: CliResult<unknown>) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve(result);
      };

      const timeout = setTimeout(() => {
        child.kill('SIGTERM');
        finish({
          success: false,
          error: `Command timed out after ${this.timeoutMs}ms`,
          exitCode: -1,
        });
      }, this.timeoutMs);

      child.stdout?.on('data', (chunk: Buffer) => {
        stdoutBytes += chunk.length;
        if (stdoutBytes > this.maxOutputBytes) {
          child.kill('SIGTERM');
          finish({
            success: false,
            error: `Command output exceeded maximum size of ${this.maxOutputBytes} bytes`,
            exitCode: -1,
          });
        }
        stdout += chunk.toString('utf8');
      });

      child.stderr?.on('data', (chunk: Buffer) => {
        stderrBytes += chunk.length;
        if (stderrBytes > this.maxOutputBytes) {
          child.kill('SIGTERM');
          finish({ success: false, error: `Command stderr exceeded maximum size of ${this.maxOutputBytes} bytes`, exitCode: -1 });
          return;
        }
        stderr += chunk.toString('utf8');
      });

      child.on('error', (error) => {
        const nodeError = error as NodeJS.ErrnoException;
        if (nodeError.code === 'ENOENT') {
          finish({
            success: false,
            error: `ForgeLoop CLI not found: ${this.forgeLoopPath}`,
            exitCode: -1,
          });
        } else {
          finish({
            success: false,
            error: `Failed to spawn process: ${error.message}`,
            exitCode: -1,
          });
        }
      });

      child.on('close', (code) => {
        if (code === 0) {
          finish({
            success: true,
            data: stdout,
            exitCode: code,
          });
        } else {
          finish({
            success: false,
            data: stdout,
            error: stderr || `Process exited with code ${code}`,
            exitCode: code ?? -1,
          });
        }
      });
    });
  }

  async protocolInfo<T = Record<string, unknown>>(): Promise<CliResult<T>> {
    const result = await this.executeCommand(['protocol-info', '--json']);
    if (!result.success) {
      return result as CliResult<T>;
    }
    try {
      const parsed = parseJsonSafely<T>(result.data as string);
      return { success: true, data: parsed, exitCode: result.exitCode };
    } catch (error) {
      return {
        success: false,
        error: `Failed to parse protocol-info output: ${error instanceof Error ? error.message : String(error)}`,
        exitCode: result.exitCode,
      };
    }
  }

  async taskList<T = Record<string, unknown>[]>(): Promise<CliResult<T>> {
    const result = await this.executeCommand(['task-list', '--json']);
    if (!result.success) {
      return result as CliResult<T>;
    }
    try {
      const parsed = parseJsonSafely<T>(result.data as string);
      return { success: true, data: parsed, exitCode: result.exitCode };
    } catch (error) {
      return {
        success: false,
        error: `Failed to parse task-list output: ${error instanceof Error ? error.message : String(error)}`,
        exitCode: result.exitCode,
      };
    }
  }

  async taskShow<T = Record<string, unknown>>(taskId: string): Promise<CliResult<T>> {
    const result = await this.executeCommand(['task-show', '--task', taskId, '--json']);
    if (!result.success) {
      return result as CliResult<T>;
    }
    try {
      const parsed = parseJsonSafely<T>(result.data as string);
      return { success: true, data: parsed, exitCode: result.exitCode };
    } catch (error) {
      return {
        success: false,
        error: `Failed to parse task-show output: ${error instanceof Error ? error.message : String(error)}`,
        exitCode: result.exitCode,
      };
    }
  }

  async status<T = Record<string, unknown>>(taskId: string): Promise<CliResult<T>> {
    const result = await this.executeCommand(['status', '--task', taskId, '--json']);
    if (!result.success) {
      return result as CliResult<T>;
    }
    try {
      const parsed = parseJsonSafely<T>(result.data as string);
      return { success: true, data: parsed, exitCode: result.exitCode };
    } catch (error) {
      return {
        success: false,
        error: `Failed to parse status output: ${error instanceof Error ? error.message : String(error)}`,
        exitCode: result.exitCode,
      };
    }
  }

  async progress<T = Record<string, unknown>>(taskId: string): Promise<CliResult<T>> {
    const result = await this.executeCommand(['progress', '--task', taskId, '--json']);
    if (!result.success) {
      return result as CliResult<T>;
    }
    try {
      const parsed = parseJsonSafely<T>(result.data as string);
      return { success: true, data: parsed, exitCode: result.exitCode };
    } catch (error) {
      return {
        success: false,
        error: `Failed to parse progress output: ${error instanceof Error ? error.message : String(error)}`,
        exitCode: result.exitCode,
      };
    }
  }

  async continuity<T = Record<string, unknown>>(taskId: string): Promise<CliResult<T>> {
    const result = await this.executeCommand(['continuity', '--task', taskId, '--json']);
    if (!result.success) {
      return result as CliResult<T>;
    }
    try {
      const parsed = parseJsonSafely<T>(result.data as string);
      return { success: true, data: parsed, exitCode: result.exitCode };
    } catch (error) {
      return {
        success: false,
        error: `Failed to parse continuity output: ${error instanceof Error ? error.message : String(error)}`,
        exitCode: result.exitCode,
      };
    }
  }

  async next<T = Record<string, unknown>>(taskId: string): Promise<CliResult<T>> {
    const result = await this.executeCommand(['next', '--task', taskId, '--json']);
    if (!result.success) {
      return result as CliResult<T>;
    }
    try {
      const parsed = parseJsonSafely<T>(result.data as string);
      return { success: true, data: parsed, exitCode: result.exitCode };
    } catch (error) {
      return {
        success: false,
        error: `Failed to parse next output: ${error instanceof Error ? error.message : String(error)}`,
        exitCode: result.exitCode,
      };
    }
  }

  async audit<T = Record<string, unknown>>(taskId: string): Promise<CliResult<T>> {
    const result = await this.executeCommand(['audit', '--task', taskId, '--json']);
    if (!result.success) {
      return result as CliResult<T>;
    }
    try {
      const parsed = parseJsonSafely<T>(result.data as string);
      return { success: true, data: parsed, exitCode: result.exitCode };
    } catch (error) {
      return {
        success: false,
        error: `Failed to parse audit output: ${error instanceof Error ? error.message : String(error)}`,
        exitCode: result.exitCode,
      };
    }
  }

  async report<T = Record<string, unknown>>(taskId: string): Promise<CliResult<T>> {
    const result = await this.executeCommand(['report', '--task', taskId, '--json']);
    if (!result.success) {
      return result as CliResult<T>;
    }
    try {
      const parsed = parseJsonSafely<T>(result.data as string);
      return { success: true, data: parsed, exitCode: result.exitCode };
    } catch (error) {
      return {
        success: false,
        error: `Failed to parse report output: ${error instanceof Error ? error.message : String(error)}`,
        exitCode: result.exitCode,
      };
    }
  }

  async policyStatus<T = Record<string, unknown>>(taskId?: string): Promise<CliResult<T>> {
    const args = ['policy-status'];
    if (taskId) args.push('--task', taskId);
    args.push('--json');
    const result = await this.executeCommand(args);
    if (!result.success) {
      return result as CliResult<T>;
    }
    try {
      const parsed = parseJsonSafely<T>(result.data as string);
      return { success: true, data: parsed, exitCode: result.exitCode };
    } catch (error) {
      return {
        success: false,
        error: `Failed to parse policy-status output: ${error instanceof Error ? error.message : String(error)}`,
        exitCode: result.exitCode,
      };
    }
  }

  async checkCliAvailable(): Promise<boolean> {
    try {
      const result = await new Promise<CliResult<unknown>>((resolve) => {
        if (!this.forgeLoopPath) { resolve({ success: false, error: 'ForgeLoop CLI unavailable', exitCode: -1 }); return; }
        const invocation = resolveInvocation(this.forgeLoopPath, ['--version']);
        if (!invocation) { resolve({ success: false, error: 'ForgeLoop CLI shim has no trusted JavaScript entrypoint', exitCode: -1 }); return; }
        const child = spawn(invocation.executable, invocation.args, { cwd: this.projectRoot, shell: false, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, FORGELOOP_NO_COLOR: '1' } });
        let settled = false;
        const finish = (value: CliResult<unknown>) => { if (!settled) { settled = true; resolve(value); } };
        const timeout = setTimeout(() => { child.kill('SIGTERM'); finish({ success: false, error: 'Version probe timed out', exitCode: -1 }); }, this.timeoutMs);
        child.on('error', (error) => { clearTimeout(timeout); finish({ success: false, error: error.message, exitCode: -1 }); });
        child.on('close', (code) => { clearTimeout(timeout); finish({ success: code === 0, exitCode: code ?? -1 }); });
      });
      return result.success;
    } catch { return false; }
  }
}

interface SpawnInvocation { executable: string; args: string[]; }

function resolveInvocation(executable: string | null, args: string[]): SpawnInvocation | null {
  if (!executable) return null;
  if (process.platform === 'win32' && executable.toLowerCase().endsWith('.cmd')) {
    try {
      const shim = readFileSync(executable, 'utf8');
      const match = shim.match(/(?:%~dp0|%dp0%)[\\/]+([^"\r\n]+?\.js)/i);
      if (!match) return null;
      const script = realpathSync(join(dirname(executable), match[1].replaceAll('\\', sep)));
      return { executable: process.execPath, args: [script, ...args] };
    } catch { return null; }
  }
  return { executable, args };
}

export function resolveTrustedForgeLoopPath(requested: string, projectRoot: string): string | null {
  const candidates = isAbsolute(requested) ? [requested] : (process.env.PATH || '').split(delimiter).flatMap((dir) => [join(dir, requested), ...(process.platform === 'win32' ? [join(dir, `${requested}.exe`), join(dir, `${requested}.cmd`)] : [])]);
  const projectReal = realpathSync(projectRoot);
  const resolved = candidates.find((candidate) => {
    try { return existsSync(candidate) && !realpathSync(candidate).startsWith(`${projectReal}${sep}`); } catch { return false; }
  });
  return resolved ? realpathSync(resolved) : null;
}
