import { describe, expect, it } from 'vitest';
import {
  normalizeCanonicalTaskAudit,
  normalizeStructuralQuality,
} from '@main/core/audit/audit-normalizer';

describe('audit normalization', () => {
  it('preserves unknown canonical errors and domain outcomes', () => {
    const audit = normalizeCanonicalTaskAudit({
      ok: true,
      command: 'audit',
      taskId: 'TASK-001',
      status: 'STALE',
      errors: [{
        code: 'E_FUTURE_CANONICAL_RULE',
        message: 'A future ForgeLoop rule blocked completion.',
        next: 'Inspect the canonical evidence projection.',
        artifacts: ['.forgeloop/task-state/TASK-001/continuity.json'],
        reasonCodes: ['FUTURE_RULE'],
      }],
      completion: { ready: false },
    }, 9);

    expect(audit.available).toBe(true);
    expect(audit.status).toBe('STALE');
    expect(audit.errors[0]).toMatchObject({
      code: 'E_FUTURE_CANONICAL_RULE',
      message: 'A future ForgeLoop rule blocked completion.',
      next: 'Inspect the canonical evidence projection.',
      artifacts: ['.forgeloop/task-state/TASK-001/continuity.json'],
      reasonCodes: ['FUTURE_RULE'],
    });
    expect(audit.result).toMatchObject({ completion: { ready: false } });
    expect(audit.exitCode).toBe(9);
  });

  it('normalizes an invocation failure without inventing a canonical result', () => {
    const audit = normalizeCanonicalTaskAudit({
      ok: false,
      command: 'audit',
      taskId: 'TASK-002',
      error: { code: 'E_CANONICAL_AUDIT_UNAVAILABLE', message: 'Integration unavailable.' },
    }, 1);

    expect(audit.available).toBe(false);
    expect(audit.status).toBe('UNKNOWN');
    expect(audit.result).toBeNull();
    expect(audit.errors[0].code).toBe('E_CANONICAL_AUDIT_UNAVAILABLE');
  });

  it('consumes canonical structural quality without running a provider', () => {
    const quality = normalizeStructuralQuality({
      taskId: 'TASK-001',
      mode: 'observe',
      provider: 'sentrux',
      baseline: { status: 'PASS', qualitySignal: 0.8, artifactRef: 'baseline.json', fingerprint: 'base' },
      current: {
        status: 'FAIL',
        verificationCycle: 2,
        attempt: 1,
        qualitySignal: 0.6,
        delta: -0.2,
        bottleneck: 'duplication',
        artifactRef: 'current.json',
      },
      comparable: true,
      completionRequired: false,
      reasonCodes: ['QUALITY_BELOW_BASELINE'],
      next: 'Review the structural quality report.',
      evidenceKind: 'OBSERVED',
    }, 'TASK-001');

    expect(quality).toMatchObject({
      available: true,
      source: 'FORGELOOP_INTEGRATION',
      mode: 'observe',
      provider: 'sentrux',
      current: { status: 'FAIL', qualitySignal: 0.6, delta: -0.2 },
      completionRequired: false,
    });
  });
});
