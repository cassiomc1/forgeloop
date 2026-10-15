import type { ProjectAuditSnapshot } from '@shared/audit';

export function snapshotFixture(): ProjectAuditSnapshot {
  return {
    schemaVersion: 1,
    auditEngineVersion: '0.2.0-rc.1',
    project: { name: 'Demo', rootPath: '/tmp/demo', branch: 'main', head: 'abc123' },
    protocol: { protocolVersion: 1, schemaVersion: 1, packageVersion: '1.10.0', compatible: true, compatibilityMode: 'INTEGRATION_V1' },
    generatedAt: '2026-01-01T00:00:00.000Z',
    gitHead: 'abc123',
    verdict: { integrity: 'VALID', completionReadiness: 'VALID', quality: 'PASS', trust: 'VALID' },
    coverage: { percent: 100, canonicalAudit: true, canonicalOwnership: true, structuredDiagnostics: true, policy: true, structuralQuality: true, codeAttestation: true, verificationScope: true, executionProvenance: true, unavailable: [] },
    score: { score: 92, grade: 'A', coveragePercent: 100, observedDimensions: ['integrity'], unavailableDimensions: [], blockedByCriticalFinding: false, methodologyVersion: 'forgeloop-audit-score/v1' },
    taskAudits: [],
    findings: [{ id: 'f1', fingerprint: 'fp1', taskId: 'TASK-001', severity: 'INFO', domain: 'EVIDENCE', source: 'FORGELOOP_CANONICAL_AUDIT', code: 'E_CANONICAL_NOTE', title: 'Canonical note', summary: 'A canonical note.', canonical: true, affectsIntegrity: false, affectsCompletion: false, evidence: [], artifactRefs: [], reasonCodes: [], remediation: null }],
    counts: { critical: 0, high: 0, medium: 0, low: 0, info: 1, unknown: 0 },
    provenance: { forgeLoopPackageVersion: '1.10.0', forgeLoopCommit: 'a'.repeat(40), integrationApiVersion: 1, auditRulesVersion: 'forgeloop-audit-rules/v1' },
    fingerprint: 'audit-fingerprint',
  };
}
