import { describe, expect, it } from 'vitest';
import type { AuditFinding, ProjectAuditSnapshot, TaskAuditSummary } from '@shared/audit';
import { diffAuditSnapshots } from '@main/core/audit/audit-diff';

const finding = (fingerprint: string, code: string, taskId: string): AuditFinding => ({
  id: fingerprint, fingerprint, taskId, severity: 'HIGH', domain: 'EVIDENCE', source: 'FORGELOOP_CANONICAL_AUDIT', code, title: code, summary: code, canonical: true, affectsIntegrity: false, affectsCompletion: true, evidence: [], artifactRefs: [], reasonCodes: [], remediation: null,
});
const snapshot = (auditId: string, findings: AuditFinding[], score: number | null): ProjectAuditSnapshot => ({
  schemaVersion: 1, auditEngineVersion: '0.2.0-rc.1', project: { name: 'Demo', rootPath: '/tmp/demo' }, protocol: { protocolVersion: 1, schemaVersion: 1, compatible: true }, generatedAt: '2026-01-01T00:00:00.000Z', gitHead: auditId, verdict: { integrity: 'VALID', completionReadiness: 'VALID', quality: 'PASS', trust: 'VALID' }, coverage: { percent: 100, canonicalAudit: true, canonicalOwnership: true, structuredDiagnostics: true, policy: true, structuralQuality: true, codeAttestation: true, verificationScope: true, executionProvenance: true, unavailable: [] }, score: score === null ? null : { score, grade: 'B', coveragePercent: 100, observedDimensions: ['integrity'], unavailableDimensions: [], blockedByCriticalFinding: false, methodologyVersion: 'forgeloop-audit-score/v1' }, taskAudits: [], findings, counts: { critical: 0, high: findings.length, medium: 0, low: 0, info: 0, unknown: 0 }, provenance: { forgeLoopPackageVersion: '1.10.0', forgeLoopCommit: 'a'.repeat(40), integrationApiVersion: 1, auditRulesVersion: 'forgeloop-audit-rules/v1' }, fingerprint: auditId,
});

describe('audit diffs', () => {
  it('classifies new, persistent and resolved findings deterministically', () => {
    const base = snapshot('base', [finding('same', 'E_SAME', 'TASK-001'), finding('resolved', 'E_RESOLVED', 'TASK-002')], 70);
    const current = snapshot('current', [finding('same', 'E_SAME', 'TASK-001'), finding('new', 'E_NEW', 'TASK-003')], 80);
    const diff = diffAuditSnapshots(base, current);

    expect(diff).toMatchObject({ baseAuditId: 'base', currentAuditId: 'current', scoreDelta: 10 });
    expect(diff.newFindings.map((item) => item.fingerprint)).toEqual(['new']);
    expect(diff.persistentFindings.map((item) => item.fingerprint)).toEqual(['same']);
    expect(diff.resolvedFindings.map((item) => item.fingerprint)).toEqual(['resolved']);
  });

  it('separates changed findings and task/status changes while handling unavailable scores', () => {
    const baseFinding = finding('changed', 'E_CHANGED', 'TASK-001');
    const currentFinding = { ...baseFinding, summary: 'Changed canonical message.' };
    const baseTask: TaskAuditSummary = { taskId: 'TASK-001', status: 'STALE', canonicalAvailable: true, structuralQualityStatus: 'NOT_OBSERVED', findingCount: 1, criticalFindingCount: 0, highFindingCount: 1, fingerprint: 'task-base' };
    const currentTask: TaskAuditSummary = { ...baseTask, status: 'VALID', structuralQualityStatus: 'PASS', findingCount: 2, fingerprint: 'task-current' };
    const base = { ...snapshot('base', [baseFinding], null), taskAudits: [baseTask] };
    const current = { ...snapshot('current', [currentFinding], 80), verdict: { ...base.verdict, integrity: 'INVALID' as const }, taskAudits: [currentTask] };

    const diff = diffAuditSnapshots(base, current);

    expect(diff).toMatchObject({ verdictChanged: true, scoreDelta: null });
    expect(diff.changedFindings.map((item) => item.fingerprint)).toEqual(['changed']);
    expect(diff.taskChanges).toEqual([{ taskId: 'TASK-001', statusChanged: true, previousStatus: 'STALE', currentStatus: 'VALID', findingCountDelta: 1 }]);
  });
});
