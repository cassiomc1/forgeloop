import { describe, expect, it } from 'vitest';
import type { ProjectSummary, ProtocolSummary } from '@shared/domain';
import type { AuditFinding, CanonicalTaskAudit, StructuralQualityAuditView } from '@shared/audit';
import { aggregateProjectAudit } from '@main/core/audit/audit-aggregator';

const project: ProjectSummary = { name: 'Demo', rootPath: '/tmp/demo', head: 'abc123' };
const protocol: ProtocolSummary = { protocolVersion: 1, schemaVersion: 1, packageVersion: '1.10.0', compatible: true, compatibilityMode: 'INTEGRATION_V1' };
const task = (taskId: string, status: CanonicalTaskAudit['status']): CanonicalTaskAudit => ({
  available: true,
  source: 'FORGELOOP_INTEGRATION',
  taskId,
  status,
  errors: [],
  warnings: [],
  result: { status },
  command: 'audit',
  exitCode: 0,
  error: null,
});
const quality = (status: StructuralQualityAuditView['current']['status']): StructuralQualityAuditView => ({
  available: true,
  source: 'FORGELOOP_INTEGRATION',
  taskId: 'TASK-001',
  mode: 'observe',
  provider: 'sentrux',
  baseline: { status: 'PASS', qualitySignal: 1, artifactRef: null, fingerprint: null },
  current: { status, verificationCycle: 1, attempt: 1, qualitySignal: 1, delta: 0, bottleneck: null, artifactRef: null },
  comparable: true,
  completionRequired: false,
  reasonCodes: [],
  next: null,
  evidenceKind: 'OBSERVED',
  error: null,
});

describe('project audit aggregation', () => {
  it('keeps integrity and completion readiness as separate verdicts', () => {
    const result = aggregateProjectAudit({
      project,
      protocol,
      taskAudits: [task('TASK-001', 'VALID'), task('TASK-002', 'INCOMPLETE')],
      qualityViews: [],
      findings: [],
      compatibilityMode: 'INTEGRATION_V1',
      forgeLoopPackageVersion: '1.10.0',
      forgeLoopCommit: 'a'.repeat(40),
      integrationApiVersion: 1,
      gitHead: 'abc123',
      coverage: {
        canonicalOwnership: false,
        structuredDiagnostics: false,
        policy: false,
        structuralQuality: false,
        codeAttestation: false,
        verificationScope: false,
        executionProvenance: false,
      },
    });

    expect(result.verdict).toMatchObject({ integrity: 'VALID', completionReadiness: 'MIXED', quality: 'NOT_OBSERVED' });
    expect(result.coverage.canonicalAudit).toBe(true);
  });

  it('marks critical findings invalid and suppresses a low-coverage score', () => {
    const finding: AuditFinding = {
      id: 'finding-1', fingerprint: 'fp-1', taskId: 'TASK-001', severity: 'CRITICAL', domain: 'OWNERSHIP', source: 'FORGELOOP_CANONICAL_AUDIT', code: 'E_OWNERSHIP_INCONSISTENT', title: 'Ownership inconsistent', summary: 'Canonical ownership is inconsistent.', canonical: true, affectsIntegrity: true, affectsCompletion: true, evidence: [], artifactRefs: [], reasonCodes: [], remediation: null,
    };
    const result = aggregateProjectAudit({
      project,
      protocol,
      taskAudits: [task('TASK-001', 'INVALID')],
      qualityViews: [quality('PASS')],
      findings: [finding],
      compatibilityMode: 'INTEGRATION_V1',
      forgeLoopPackageVersion: '1.10.0',
      forgeLoopCommit: 'a'.repeat(40),
      integrationApiVersion: 1,
      gitHead: 'abc123',
      coverage: {
        canonicalOwnership: false,
        structuredDiagnostics: false,
        policy: false,
        structuralQuality: false,
        codeAttestation: false,
        verificationScope: false,
        executionProvenance: false,
      },
    });

    expect(result.verdict.integrity).toMatch(/INVALID|INCONSISTENT/);
    expect(result.score).toBeNull();
    expect(result.counts.critical).toBe(1);
  });

  it('fails closed for artifact-only audits', () => {
    const result = aggregateProjectAudit({
      project,
      protocol: { ...protocol, compatibilityMode: 'ARTIFACT_ONLY' },
      taskAudits: [],
      qualityViews: [],
      findings: [],
      compatibilityMode: 'ARTIFACT_ONLY',
      forgeLoopPackageVersion: '1.10.0',
      forgeLoopCommit: 'a'.repeat(40),
      integrationApiVersion: null,
      gitHead: null,
    });

    expect(result.verdict.integrity).toBe('UNKNOWN');
    expect(result.score).toBeNull();
    expect(result.coverage.canonicalAudit).toBe(false);
  });
});
