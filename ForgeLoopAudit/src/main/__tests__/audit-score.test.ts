import { describe, expect, it } from 'vitest';
import type { AuditCoverage, AuditFinding, ProjectAuditVerdict } from '@shared/audit';
import { computeAuditScore } from '@main/core/audit/audit-score';

const coverage: AuditCoverage = {
  percent: 100,
  canonicalAudit: true,
  canonicalOwnership: true,
  structuredDiagnostics: true,
  policy: true,
  structuralQuality: true,
  codeAttestation: true,
  verificationScope: true,
  executionProvenance: true,
  unavailable: [],
};
const verdict: ProjectAuditVerdict = { integrity: 'VALID', completionReadiness: 'VALID', quality: 'PASS', trust: 'VALID' };
const finding = (severity: AuditFinding['severity']): AuditFinding => ({
  id: severity,
  fingerprint: severity,
  taskId: null,
  severity,
  domain: 'APPLICATION',
  source: 'LOCAL_APP_DIAGNOSTIC',
  code: `APP_${severity}`,
  title: severity,
  summary: severity,
  canonical: false,
  affectsIntegrity: false,
  affectsCompletion: false,
  evidence: [],
  artifactRefs: [],
  reasonCodes: [],
  remediation: null,
});

describe('audit score methodology', () => {
  it('uses deterministic A through F grade thresholds', () => {
    expect(computeAuditScore({ coverage, findings: [], verdict }).grade).toBe('A');
    expect(computeAuditScore({ coverage, findings: [finding('HIGH')], verdict }).grade).toBe('B');
    expect(computeAuditScore({ coverage, findings: [finding('HIGH'), finding('MEDIUM')], verdict }).grade).toBe('C');
    expect(computeAuditScore({ coverage, findings: [finding('HIGH'), finding('HIGH')], verdict }).grade).toBe('D');
    expect(computeAuditScore({ coverage, findings: [finding('CRITICAL'), finding('HIGH')], verdict }).grade).toBe('F');
  });

  it('suppresses scores when coverage or integrity is unavailable', () => {
    const result = computeAuditScore({
      coverage: { ...coverage, percent: 50, unavailable: ['policy'] },
      findings: [finding('UNKNOWN')],
      verdict: { ...verdict, integrity: 'UNKNOWN' },
    });
    expect(result).toMatchObject({ score: null, grade: 'UNAVAILABLE', blockedByCriticalFinding: false, observedDimensions: expect.arrayContaining(['canonicalAudit']) });
  });
});
