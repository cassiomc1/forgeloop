import type { AuditCoverage, AuditFinding, AuditScore, ProjectAuditVerdict } from '@shared/audit';

export const AUDIT_SCORE_METHODOLOGY_VERSION = 'forgeloop-audit-score/v1';
export const MINIMUM_SCORE_COVERAGE_PERCENT = 60;

const severityPenalty: Record<AuditFinding['severity'], number> = {
  CRITICAL: 35,
  HIGH: 18,
  MEDIUM: 7,
  LOW: 2,
  INFO: 0,
  UNKNOWN: 12,
};

export function computeAuditScore(input: {
  coverage: AuditCoverage;
  findings: AuditFinding[];
  verdict: ProjectAuditVerdict;
}): AuditScore {
  const unavailableDimensions = input.coverage.unavailable.length > 0
    ? [...input.coverage.unavailable]
    : [];
  const dimensionObservations: Array<[string, boolean]> = [
    ['canonicalAudit', input.coverage.canonicalAudit],
    ['canonicalOwnership', input.coverage.canonicalOwnership],
    ['structuredDiagnostics', input.coverage.structuredDiagnostics],
    ['policy', input.coverage.policy],
    ['structuralQuality', input.coverage.structuralQuality],
    ['codeAttestation', input.coverage.codeAttestation],
    ['verificationScope', input.coverage.verificationScope],
    ['executionProvenance', input.coverage.executionProvenance],
  ];
  const observedDimensions = dimensionObservations.filter(([, observed]) => observed).map(([name]) => name);
  const coveragePercent = input.coverage.percent;
  const blockedByCriticalFinding = input.findings.some((finding) => finding.severity === 'CRITICAL');
  if (coveragePercent < MINIMUM_SCORE_COVERAGE_PERCENT || input.verdict.integrity === 'UNKNOWN') {
    return {
      score: null,
      grade: 'UNAVAILABLE',
      coveragePercent,
      observedDimensions,
      unavailableDimensions,
      blockedByCriticalFinding,
      methodologyVersion: AUDIT_SCORE_METHODOLOGY_VERSION,
    };
  }

  const score = Math.max(0, Math.min(100, Math.round(100 - input.findings.reduce((total, finding) => total + severityPenalty[finding.severity], 0))));
  const grade = score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : score >= 60 ? 'D' : 'F';
  return {
    score,
    grade,
    coveragePercent,
    observedDimensions,
    unavailableDimensions,
    blockedByCriticalFinding,
    methodologyVersion: AUDIT_SCORE_METHODOLOGY_VERSION,
  };
}
