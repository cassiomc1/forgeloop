import type { AuditFindingSeverity, CanonicalAuditError, StructuralQualityMode } from '@shared/audit';
import { mapCanonicalError, type CanonicalErrorMapping } from './canonical-error-mapping';

export const AUDIT_RULES_VERSION = 'forgeloop-audit-rules/v1';

export function severityForCanonicalError(
  error: CanonicalAuditError,
  options: { structuralQualityMode?: StructuralQualityMode } = {},
): CanonicalErrorMapping & { severity: AuditFindingSeverity } {
  return mapCanonicalError(error, options);
}
