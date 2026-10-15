import { describe, expect, it } from 'vitest';
import type { AuditFinding, CanonicalAuditError } from '@shared/audit';
import { applicationDiagnosticToFinding, canonicalErrorToFinding, structuralQualityToFinding } from '@main/core/audit/finding-factory';
import { createFindingFingerprint } from '@main/core/audit/audit-fingerprint';
import { severityForCanonicalError } from '@main/core/audit/finding-severity';

describe('audit findings', () => {
  const error: CanonicalAuditError = {
    code: 'E_RECEIPT_PATH_MISMATCH',
    message: 'The receipt does not describe the verified project.',
    next: 'Run the canonical completion preparation again.',
    artifacts: ['.forgeloop/task-state/TASK-001/execution-receipt.json'],
    reasonCodes: ['RECEIPT_PROJECT_MISMATCH'],
  };

  it('maps canonical errors with provenance and canonical remediation', () => {
    const finding = canonicalErrorToFinding(error, { taskId: 'TASK-001' });

    expect(finding).toMatchObject({
      code: 'E_RECEIPT_PATH_MISMATCH',
      source: 'FORGELOOP_CANONICAL_AUDIT',
      canonical: true,
      severity: 'HIGH',
      domain: 'RECEIPT',
      affectsIntegrity: true,
      remediation: { kind: 'CANONICAL_NEXT', text: error.next },
    });
    expect(finding.evidence[0]).toMatchObject({ ref: error.artifacts?.[0] });
  });

  it('keeps future canonical codes visible as UNKNOWN', () => {
    const future: CanonicalAuditError = { code: 'E_NEW_FORGELOOP_RULE', message: 'Future rule.' };
    expect(severityForCanonicalError(future)).toMatchObject({ severity: 'UNKNOWN', domain: 'PROTOCOL' });
    expect(canonicalErrorToFinding(future, { taskId: 'TASK-001' })).toMatchObject({
      severity: 'UNKNOWN',
      title: 'E_NEW_FORGELOOP_RULE',
      canonical: true,
    });
  });

  it('does not let presentation labels destabilize fingerprints', () => {
    const first = canonicalErrorToFinding(error, { taskId: 'TASK-001' });
    const second: AuditFinding = { ...first, title: 'A different UI label', summary: 'Reworded summary' };

    expect(createFindingFingerprint(first)).toBe(createFindingFingerprint(second));
  });

  it('labels observe-mode quality failures as derived presentation of canonical resource data', () => {
    const finding = structuralQualityToFinding({
      available: true,
      source: 'FORGELOOP_INTEGRATION',
      taskId: 'TASK-001',
      mode: 'observe',
      provider: 'sentrux',
      baseline: { status: 'PASS', qualitySignal: 0.8, artifactRef: null, fingerprint: null },
      current: { status: 'FAIL', verificationCycle: 1, attempt: 1, qualitySignal: 0.4, delta: -0.4, bottleneck: 'duplication', artifactRef: 'quality.json' },
      comparable: true,
      completionRequired: false,
      reasonCodes: [],
      next: null,
      evidenceKind: 'OBSERVED',
      error: null,
    });

    expect(finding).toMatchObject({
      source: 'FORGELOOP_CANONICAL_RESOURCE',
      canonical: true,
      severity: 'MEDIUM',
      domain: 'STRUCTURAL_QUALITY',
      affectsCompletion: false,
    });
  });

  it('raises canonical quality errors to a completion-affecting gate finding', () => {
    const finding = canonicalErrorToFinding({ code: 'E_STRUCTURAL_QUALITY_FAIL', message: 'Quality gate failed.' }, { taskId: 'TASK-001', structuralQualityMode: 'gate' });
    expect(finding).toMatchObject({ severity: 'HIGH', domain: 'STRUCTURAL_QUALITY', affectsCompletion: true });
  });

  it('keeps blocked quality canonical and application diagnostics distinct', () => {
    const blocked = structuralQualityToFinding({
      available: true,
      source: 'FORGELOOP_INTEGRATION',
      taskId: 'TASK-001',
      mode: 'unknown',
      provider: null,
      baseline: { status: 'PASS', qualitySignal: null, artifactRef: null, fingerprint: null },
      current: { status: 'BLOCKED', verificationCycle: null, attempt: null, qualitySignal: null, delta: null, bottleneck: null, artifactRef: null },
      comparable: null,
      completionRequired: false,
      reasonCodes: ['QUALITY_BLOCKED'],
      next: null,
      evidenceKind: 'BLOCKED',
      error: null,
    });
    expect(blocked).toMatchObject({ code: 'FLA-QUALITY-002', severity: 'HIGH', affectsCompletion: false });
    expect(structuralQualityToFinding({ ...blockedView(), current: { ...blockedView().current, status: 'PASS' } })).toBeNull();
    expect(structuralQualityToFinding({ ...blockedView(), available: false })).toBeNull();

    const application = applicationDiagnosticToFinding({ code: 'APP_UNAVAILABLE', message: 'Optional runtime capability is unavailable.', artifactRefs: ['b.json', 'a.json', 'a.json'] });
    expect(application).toMatchObject({ source: 'LOCAL_APP_DIAGNOSTIC', canonical: false, severity: 'INFO', domain: 'APPLICATION', artifactRefs: ['a.json', 'b.json'] });
  });
});

function blockedView() {
  return {
    available: true as const,
    source: 'FORGELOOP_INTEGRATION' as const,
    taskId: 'TASK-001',
    mode: 'observe' as const,
    provider: null,
    baseline: { status: 'PASS' as const, qualitySignal: null, artifactRef: null, fingerprint: null },
    current: { status: 'PASS' as const, verificationCycle: null, attempt: null, qualitySignal: null, delta: null, bottleneck: null, artifactRef: null },
    comparable: null,
    completionRequired: false,
    reasonCodes: [],
    next: null,
    evidenceKind: null,
    error: null,
  };
}
