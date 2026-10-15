import { ForgeLoopAuditError } from '@shared/errors';
import type { ForgeLoopCanonicalError, ForgeLoopReadOnlyResult } from './types';
import { AUDIT_READ_ONLY_COMMANDS } from './forgeloop-integration';

export { AUDIT_READ_ONLY_COMMANDS };

export function isAuditReadOnlyCommand(command: string): boolean {
  return AUDIT_READ_ONLY_COMMANDS.has(command);
}

export type AuditReadOutcome<T> =
  | { kind: 'DOMAIN_OUTCOME'; exitCode: number; data: T | null; error: null }
  | { kind: 'INVOCATION_FAILURE'; exitCode: number; data: null; error: ForgeLoopCanonicalError | null };

interface AuditReadCommandAdapter {
  executeReadOnly<T>(
    projectRoot: string,
    command: string,
    input?: Record<string, unknown>,
  ): Promise<ForgeLoopReadOnlyResult<T>>;
}

/**
 * Run a canonical ForgeLoop read command through the bundled Integration API.
 *
 * `ok:true` means the command executed and its exit code is a domain
 * outcome (the loop may legitimately report "nothing to do" with a non-zero
 * exit code). `ok:false` is an invocation failure. Commands outside the
 * ForgeLoopAudit allowlist are refused before ever reaching the ForgeLoop runtime.
 */
export async function runAuditReadCommand<T = Record<string, unknown>>(
  adapter: AuditReadCommandAdapter,
  projectRoot: string,
  command: string,
  input: Record<string, unknown> = {},
): Promise<AuditReadOutcome<T>> {
  if (!isAuditReadOnlyCommand(command)) {
    throw ForgeLoopAuditError.cliFailed(command, -1, `Command not in ForgeLoopAudit read allowlist: ${command}`);
  }

  const result = await adapter.executeReadOnly<T>(projectRoot, command, input);
  if (result.ok) {
    return { kind: 'DOMAIN_OUTCOME', exitCode: result.exitCode, data: result.result, error: null };
  }
  return { kind: 'INVOCATION_FAILURE', exitCode: result.exitCode, data: null, error: result.error };
}
