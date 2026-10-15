import type { CanonicalTaskAudit } from '@shared/audit';
import type { ForgeLoopIntegrationAdapter } from '@main/core/integration/forgeloop-integration';
import { runAuditReadCommand } from '@main/core/integration/audit-read-commands';
import { normalizeCanonicalTaskAudit } from './audit-normalizer';

export interface CanonicalAuditService {
  auditTask(taskId: string): Promise<CanonicalTaskAudit>;
}

export interface CanonicalAuditServiceOptions {
  projectRoot: string;
  integration: ForgeLoopIntegrationAdapter;
}

export function createCanonicalAuditService(options: CanonicalAuditServiceOptions): CanonicalAuditService {
  return {
    async auditTask(taskId: string): Promise<CanonicalTaskAudit> {
      try {
        // `taskId` is the bundled Integration API contract. The adapter guard
        // still classifies the command at runtime before ForgeLoop executes it.
        const outcome = await runAuditReadCommand<Record<string, unknown>>(
          options.integration,
          options.projectRoot,
          'audit',
          { taskId },
        );
        if (outcome.kind === 'INVOCATION_FAILURE') {
          return normalizeCanonicalTaskAudit({
            ok: false,
            command: 'audit',
            taskId,
            error: outcome.error,
          }, outcome.exitCode);
        }
        return normalizeCanonicalTaskAudit({
          ...(outcome.data ?? {}),
          command: 'audit',
          taskId,
        }, outcome.exitCode);
      } catch (error) {
        return normalizeCanonicalTaskAudit({
          ok: false,
          command: 'audit',
          taskId,
          error: {
            code: 'E_CANONICAL_AUDIT_UNAVAILABLE',
            message: error instanceof Error ? error.message : String(error),
          },
        }, -1);
      }
    },
  };
}
