import { describe, expect, it } from 'vitest';
import type { AuditFinding, ProjectAuditSnapshot } from '@shared/audit';
import { buildAuditJsonReport, buildAuditMarkdownReport, buildAuditReport, buildAuditSarifReport } from '@main/core/audit/audit-report';
import { snapshotFixture } from './fixtures/audit-fixtures';

describe('audit reports', () => {
  it('serializes deterministic JSON with canonical and derived provenance', () => {
    const json = buildAuditJsonReport(snapshotFixture());
    const parsed = JSON.parse(json) as Record<string, unknown>;
    expect(parsed).toMatchObject({ reportType: 'ForgeLoopAudit', schemaVersion: 1 });
    expect(json).toContain('FORGELOOP_CANONICAL_AUDIT');
  });

  it('emits the required report sections and trust legend', () => {
    const markdown = buildAuditMarkdownReport(snapshotFixture());
    for (const section of ['# ForgeLoopAudit Report', '## Audit Provenance', '## Executive Verdict', '## Audit Coverage', '## Findings Summary', '## Limitations / Unavailable Capabilities']) {
      expect(markdown).toContain(section);
    }
    expect(markdown).toContain('[C] Canonical ForgeLoop');
    expect(markdown).toContain('[D] ForgeLoopAudit derived');
  });

  it('exports SARIF with stable rule metadata and no fabricated source locations', () => {
    const sarif = JSON.parse(buildAuditSarifReport(snapshotFixture())) as { runs: Array<{ tool: { driver: { name: string } }; results: Array<Record<string, unknown>> }> };
    expect(sarif.runs[0].tool.driver.name).toBe('ForgeLoopAudit');
    expect(sarif.runs[0].results[0]).toMatchObject({ ruleId: 'E_CANONICAL_NOTE', level: 'note' });
    expect(sarif.runs[0].results[0]).not.toHaveProperty('locations');
    expect(buildAuditReport(snapshotFixture(), 'SARIF')).toContain('sarif-2.1.0');
  });

  it('renders unavailable capabilities, task rows and every trust-source label', () => {
    const base = snapshotFixture();
    const richFindings: AuditFinding[] = [
      { ...base.findings[0], severity: 'CRITICAL', source: 'FORGELOOP_CANONICAL_RESOURCE', taskId: null, code: 'E_CRITICAL' },
      { ...base.findings[0], severity: 'MEDIUM', source: 'FORGELOOP_AUDIT_DERIVED', taskId: 'TASK-002', code: 'FLA-DERIVED' },
      { ...base.findings[0], severity: 'LOW', source: 'LOCAL_APP_DIAGNOSTIC', taskId: null, code: 'A-LOCAL' },
      { ...base.findings[0], severity: 'INFO', source: 'FORGELOOP_CANONICAL_AUDIT', taskId: 'TASK-003', code: 'I-CANONICAL' },
    ];
    const rich: ProjectAuditSnapshot = {
      ...base,
      gitHead: null,
      compatibilityMode: undefined,
      protocol: { ...base.protocol, compatibilityMode: undefined },
      coverage: { ...base.coverage, percent: 50, unavailable: ['policy'] },
      taskAudits: [{ taskId: 'TASK-002', status: 'STALE', canonicalAvailable: true, structuralQualityStatus: 'NOT_OBSERVED', findingCount: 1, criticalFindingCount: 0, highFindingCount: 0, fingerprint: 'task-2' }],
      findings: richFindings,
    };

    const markdown = buildAuditMarkdownReport(rich);
    expect(markdown).toContain('Git HEAD: Unavailable');
    expect(markdown).toContain('Compatibility: Unknown');
    expect(markdown).toContain('`TASK-002`: STALE');
    expect(markdown).toContain('Unavailable:\n- policy');
    expect(markdown).toContain('[A] Application/runtime diagnostic');

    const sarif = JSON.parse(buildAuditSarifReport(rich)) as { runs: Array<{ results: Array<{ level: string }> }> };
    expect(sarif.runs[0].results.map((result) => result.level)).toEqual(expect.arrayContaining(['error', 'warning', 'note']));
  });
});
