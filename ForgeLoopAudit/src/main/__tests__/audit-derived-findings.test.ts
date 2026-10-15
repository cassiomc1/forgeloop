import { describe, expect, it } from 'vitest';
import { deriveAuditFindings } from '@main/core/audit/finding-rules';

describe('derived audit findings', () => {
  it('reports repeated verification only when canonical reflection records no information gain', () => {
    const findings = deriveAuditFindings({
      taskId: 'TASK-001',
      reflection: {
        status: 'STALLED',
        stallAnalysis: {
          latestNoGain: true,
          consecutiveNoGainCycles: 3,
          sameStrategyAsPrevious: true,
          sameFailureSurfaceAsPrevious: true,
          sameFailureSignaturesAsPrevious: false,
        },
        informationGain: { cyclesWithoutEffectiveGain: [2, 3, 4] },
      },
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      code: 'FLA-EFF-001',
      source: 'FORGELOOP_AUDIT_DERIVED',
      severity: 'MEDIUM',
      domain: 'EFFICIENCY',
      ruleVersion: 'forgeloop-audit-rules/v1',
    });
  });

  it('does not infer evidence gaps or context inflation without canonical observations', () => {
    expect(deriveAuditFindings({ taskId: 'TASK-001' })).toEqual([]);
    expect(deriveAuditFindings({
      taskId: 'TASK-001',
      evidenceCoverage: { total: 0, covered: 0, partial: 0, notVerified: 0, blocked: 0, coveragePercent: 0 },
      contextUsage: { source: 'UNKNOWN', inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null, totalTokens: null, costUsd: null, model: null, provider: null },
    })).toEqual([]);
  });

  it('reports a canonical evidence coverage gap as a derived, non-authoritative finding', () => {
    const findings = deriveAuditFindings({
      taskId: 'TASK-002',
      evidenceCoverage: { total: 4, covered: 2, partial: 1, notVerified: 1, blocked: 0, coveragePercent: 50 },
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      code: 'FLA-EVID-001',
      source: 'FORGELOOP_AUDIT_DERIVED',
      canonical: false,
      affectsIntegrity: false,
      affectsCompletion: true,
    });
  });

  it('reports long-lived recovery only from a supplied canonical timestamp', () => {
    const findings = deriveAuditFindings({
      taskId: 'TASK-003',
      recovery: { status: 'RESUME_REQUIRED', unresolvedSince: '2026-09-01T00:00:00.000Z', ageDays: 3 },
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ code: 'FLA-REC-001', domain: 'RECOVERY', severity: 'MEDIUM' });
    expect(deriveAuditFindings({ taskId: 'TASK-003', recovery: { status: 'RESUME_REQUIRED', unresolvedSince: null, ageDays: 99 } })).toEqual([]);
  });
});
