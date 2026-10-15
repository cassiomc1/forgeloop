import type { AuditFindingDomain, AuditFindingSeverity, CanonicalAuditError, StructuralQualityMode } from '@shared/audit';

export interface CanonicalErrorMapping {
  severity: AuditFindingSeverity;
  domain: AuditFindingDomain;
  title: string;
  affectsIntegrity: boolean;
  affectsCompletion: boolean;
  /**
   * False when no rule recognised the canonical code. An unclassified canonical
   * error has an unknown integrity impact, which is not the same as no impact,
   * so callers must not read `affectsIntegrity: false` as a clean result.
   */
  classified: boolean;
}

interface MappingRule {
  test: (code: string, message: string) => boolean;
  mapping: Omit<CanonicalErrorMapping, 'title' | 'classified'> & { title: string };
}

const rules: MappingRule[] = [
  {
    test: (code) => /OWNERSHIP|CLAIM.*INCONSIST|WRITE.*CLAIM|OWNER/u.test(code),
    mapping: { severity: 'CRITICAL', domain: 'OWNERSHIP', title: 'Ownership is inconsistent', affectsIntegrity: true, affectsCompletion: true },
  },
  {
    // ForgeLoop raises E_TASK_CONTEXT_MISMATCH when an active task
    // transaction is reused against a different physical project. Writes could
    // otherwise be attributed across a project boundary, so this is an
    // integrity failure and not a workflow hint.
    test: (code) => /TASK.*CONTEXT.*MISMATCH/u.test(code),
    mapping: { severity: 'CRITICAL', domain: 'WORKSPACE', title: 'A task transaction was bound to a different project', affectsIntegrity: true, affectsCompletion: true },
  },
  {
    test: (code) => /PROTOCOL|SCHEMA|CONTRACT.*INVALID|INVALID.*CONTRACT/u.test(code),
    mapping: { severity: 'CRITICAL', domain: 'PROTOCOL', title: 'Protocol or schema validation failed', affectsIntegrity: true, affectsCompletion: true },
  },
  {
    test: (code, message) => /ATTEST|SIGNATURE|REVISION.*MISMATCH/u.test(`${code} ${message}`),
    mapping: { severity: 'CRITICAL', domain: 'ATTESTATION', title: 'Code attestation is invalid', affectsIntegrity: true, affectsCompletion: true },
  },
  {
    test: (code) => /ACTION.*LEDGER|LEDGER.*ACTION|ACTION.*INCONSIST/u.test(code),
    mapping: { severity: 'HIGH', domain: 'ACTIONS', title: 'Action ledger is inconsistent', affectsIntegrity: true, affectsCompletion: true },
  },
  {
    test: (code) => /ACTION.*(AMBIG|UNTRUST|REQUIRED|RECONCILIATION|VERIFICATION)|RECONCILIATION.*ACTION/u.test(code),
    mapping: { severity: 'HIGH', domain: 'ACTIONS', title: 'Required action needs canonical reconciliation', affectsIntegrity: false, affectsCompletion: true },
  },
  {
    test: (code, message) => /RECEIPT|EXECUTION.*(REF|PROJECT|CWD)|PROJECT.*MISMATCH/u.test(`${code} ${message}`),
    mapping: { severity: 'HIGH', domain: 'RECEIPT', title: 'Execution receipt does not match the audited project', affectsIntegrity: true, affectsCompletion: true },
  },
  {
    test: (code) => /STALE|OUTDATED|COMPLETION.*EVIDENCE|EVIDENCE.*STALE/u.test(code),
    mapping: { severity: 'HIGH', domain: 'COMPLETION', title: 'Completion evidence is stale', affectsIntegrity: false, affectsCompletion: true },
  },
  {
    test: (code) => /POLICY.*INVALID|INVALID.*POLICY|CAPABILITY.*POLICY/u.test(code),
    mapping: { severity: 'HIGH', domain: 'POLICY', title: 'Canonical policy validation failed', affectsIntegrity: true, affectsCompletion: true },
  },
  {
    test: (code) => /POLICY.*DRIFT|DRIFT.*POLICY/u.test(code),
    mapping: { severity: 'MEDIUM', domain: 'POLICY', title: 'Policy drift was detected', affectsIntegrity: false, affectsCompletion: true },
  },
  {
    test: (code) => /HANDOFF/u.test(code),
    mapping: { severity: 'HIGH', domain: 'HANDOFF', title: 'Canonical handoff requires attention', affectsIntegrity: true, affectsCompletion: true },
  },
  {
    test: (code) => /RESPONSIBILITY/u.test(code),
    mapping: { severity: 'HIGH', domain: 'RESPONSIBILITY', title: 'Responsibility constraints are inconsistent', affectsIntegrity: true, affectsCompletion: true },
  },
  {
    test: (code) => /WORKSPACE|BINDING/u.test(code),
    mapping: { severity: 'HIGH', domain: 'WORKSPACE', title: 'Workspace binding is inconsistent', affectsIntegrity: true, affectsCompletion: true },
  },
  {
    test: (code) => /RECOVERY|RESUME/u.test(code),
    mapping: { severity: 'MEDIUM', domain: 'RECOVERY', title: 'Recovery or resume is required', affectsIntegrity: false, affectsCompletion: true },
  },
  {
    test: (code) => /EVIDENCE|VERIFICATION/u.test(code),
    mapping: { severity: 'MEDIUM', domain: 'EVIDENCE', title: 'Evidence coverage is incomplete', affectsIntegrity: false, affectsCompletion: true },
  },
  {
    test: (code) => /STRUCTURAL|QUALITY/u.test(code),
    mapping: { severity: 'MEDIUM', domain: 'STRUCTURAL_QUALITY', title: 'Structural quality requires attention', affectsIntegrity: false, affectsCompletion: false },
  },
  {
    test: (code) => /CONTINUITY|HISTORY|TRACE|REFLECTION/u.test(code),
    mapping: { severity: 'INFO', domain: 'CONTINUITY', title: 'Continuity information is incomplete', affectsIntegrity: false, affectsCompletion: false },
  },
];

const unknownMapping: CanonicalErrorMapping = {
  severity: 'UNKNOWN',
  domain: 'PROTOCOL',
  title: '',
  affectsIntegrity: false,
  affectsCompletion: false,
  classified: false,
};

export function mapCanonicalError(
  error: CanonicalAuditError,
  options: { structuralQualityMode?: StructuralQualityMode } = {},
): CanonicalErrorMapping {
  const code = error.code.toUpperCase();
  const message = error.message.toUpperCase();
  const match = rules.find((rule) => rule.test(code, message));
  if (!match) return { ...unknownMapping, title: error.code };
  const mapping: CanonicalErrorMapping = { ...match.mapping, classified: true };
  if (mapping.domain === 'STRUCTURAL_QUALITY' && options.structuralQualityMode === 'gate') {
    mapping.severity = 'HIGH';
    mapping.affectsCompletion = true;
  }
  return mapping;
}

export const getCanonicalErrorMapping = mapCanonicalError;
