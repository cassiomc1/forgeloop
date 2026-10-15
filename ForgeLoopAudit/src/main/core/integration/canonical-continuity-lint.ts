import { runAuditReadCommand } from './audit-read-commands';
import type { ForgeLoopIntegrationAdapter } from './forgeloop-integration';
import type { CanonicalProjectionError, ContinuityLintFindingView, ContinuityLintView } from '@shared/domain';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function invalid(message: string): ContinuityLintView {
  return {
    available: false,
    source: 'UNAVAILABLE',
    classification: null,
    status: null,
    findings: [],
    reasonCodes: [],
    authority: 'OPERATIONAL_CONTEXT_ONLY',
    evidenceAuthority: 'NONE',
    error: { code: 'E_CANONICAL_CONTINUITY_LINT_INVALID', message },
  };
}

function unavailable(error: CanonicalProjectionError): ContinuityLintView {
  return {
    available: false,
    source: 'UNAVAILABLE',
    classification: null,
    status: null,
    findings: [],
    reasonCodes: [],
    authority: 'OPERATIONAL_CONTEXT_ONLY',
    evidenceAuthority: 'NONE',
    error,
  };
}

function normalizeFinding(value: unknown): ContinuityLintFindingView {
  if (!isRecord(value)) {
    return { code: 'CONTINUITY_FINDING_UNKNOWN', severity: 'UNKNOWN', field: null, itemId: null };
  }
  const severity = value.severity === 'INFO' || value.severity === 'WARN' || value.severity === 'UNKNOWN'
    ? value.severity
    : 'UNKNOWN';
  return {
    code: stringValue(value.code) ?? 'CONTINUITY_FINDING_UNKNOWN',
    severity,
    field: stringValue(value.field),
    itemId: stringValue(value.itemId),
  };
}

export function normalizeContinuityLint(value: unknown): ContinuityLintView {
  if (!isRecord(value)) return invalid('Canonical reconciliation did not return an object.');
  if (value.authority !== 'OPERATIONAL_CONTEXT_ONLY' || value.evidenceAuthority !== 'NONE') {
    return invalid('Canonical reconciliation authority contract is invalid.');
  }
  if (!isRecord(value.lint)) return invalid('Canonical reconciliation lint projection is missing.');
  if (value.lint.status !== 'PASS' && value.lint.status !== 'WARN') {
    return invalid('Canonical reconciliation lint status is invalid.');
  }
  return {
    available: true,
    source: 'FORGELOOP_INTEGRATION',
    classification: stringValue(value.classification),
    status: value.lint.status,
    findings: Array.isArray(value.lint.findings) ? value.lint.findings.map(normalizeFinding) : [],
    reasonCodes: stringArray(value.reasonCodes),
    authority: 'OPERATIONAL_CONTEXT_ONLY',
    evidenceAuthority: 'NONE',
    error: null,
  };
}

export interface CanonicalContinuityLintService {
  getLint(projectRoot: string, taskId: string): Promise<ContinuityLintView>;
}

export function createCanonicalContinuityLintService(options: {
  integration: ForgeLoopIntegrationAdapter;
}): CanonicalContinuityLintService {
  const { integration } = options;
  return {
    async getLint(projectRoot, taskId): Promise<ContinuityLintView> {
      try {
        const outcome = await runAuditReadCommand<Record<string, unknown>>(
          integration,
          projectRoot,
          'reconcile-continuity',
          { taskId },
        );
        if (outcome.kind === 'INVOCATION_FAILURE') {
          return unavailable(outcome.error ?? {
            code: 'E_CANONICAL_CONTINUITY_LINT_UNAVAILABLE',
            message: 'Canonical continuity reconciliation is unavailable.',
          });
        }
        return normalizeContinuityLint(outcome.data);
      } catch (error) {
        return unavailable({
          code: 'E_CANONICAL_CONTINUITY_LINT_INVOCATION',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
  };
}
