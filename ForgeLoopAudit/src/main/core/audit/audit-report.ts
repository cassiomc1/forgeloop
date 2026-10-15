import type { AuditFinding, AuditReportFormat, ProjectAuditSnapshot } from '@shared/audit';
import { stableStringify } from './audit-fingerprint';

function sourceLabel(source: AuditFinding['source']): string {
  if (source === 'FORGELOOP_CANONICAL_AUDIT' || source === 'FORGELOOP_CANONICAL_RESOURCE') return '[C] Canonical ForgeLoop';
  if (source === 'FORGELOOP_AUDIT_DERIVED') return '[D] ForgeLoopAudit derived';
  return '[A] Application/runtime diagnostic';
}

function sortedFindings(findings: AuditFinding[]): AuditFinding[] {
  return [...findings].sort((left, right) => left.severity.localeCompare(right.severity)
    || (left.taskId ?? '').localeCompare(right.taskId ?? '')
    || left.code.localeCompare(right.code)
    || left.fingerprint.localeCompare(right.fingerprint));
}

export function buildAuditJsonReport(snapshot: ProjectAuditSnapshot): string {
  const report = {
    reportType: 'ForgeLoopAudit',
    schemaVersion: 1,
    trustLegend: {
      C: 'Canonical ForgeLoop result',
      D: 'ForgeLoopAudit derived analysis',
      A: 'Application/runtime diagnostic',
    },
    provenance: snapshot.provenance,
    auditEngineVersion: snapshot.auditEngineVersion,
    auditRulesVersion: snapshot.provenance.auditRulesVersion,
    integrationApiVersion: snapshot.provenance.integrationApiVersion,
    projectGitHead: snapshot.gitHead,
    generatedAt: snapshot.generatedAt,
    auditFingerprint: snapshot.fingerprint,
    verdict: snapshot.verdict,
    coverage: snapshot.coverage,
    score: snapshot.score,
    counts: snapshot.counts,
    taskAudits: snapshot.taskAudits,
    findings: sortedFindings(snapshot.findings).map((finding) => ({
      ...finding,
      sourceLabel: sourceLabel(finding.source),
    })),
  };
  return `${JSON.stringify(JSON.parse(stableStringify(report)), null, 2)}\n`;
}

function findingLine(finding: AuditFinding): string {
  const task = finding.taskId ? ` (${finding.taskId})` : '';
  return `- **${finding.severity}** ${sourceLabel(finding.source)} \`${finding.code}\`${task}: ${finding.summary}`;
}

export function buildAuditMarkdownReport(snapshot: ProjectAuditSnapshot): string {
  const findings = sortedFindings(snapshot.findings);
  const unavailable = snapshot.coverage.unavailable.length > 0
    ? snapshot.coverage.unavailable.map((item) => `- ${item}`).join('\n')
    : '- None';
  const criticalHigh = findings.filter((finding) => finding.severity === 'CRITICAL' || finding.severity === 'HIGH');
  const taskLines = snapshot.taskAudits.length > 0
    ? snapshot.taskAudits.map((task) => `- \`${task.taskId}\`: ${task.status}; ${task.findingCount} finding(s); structural quality ${task.structuralQualityStatus}`).join('\n')
    : '- No canonical task audits recorded.';
  return [
    '# ForgeLoopAudit Report',
    '',
    'Trust legend: [C] Canonical ForgeLoop · [D] ForgeLoopAudit derived · [A] Application/runtime diagnostic.',
    '',
    '## Project',
    '',
    `- Name: ${snapshot.project.name}`,
    `- Git HEAD: ${snapshot.gitHead ?? 'Unavailable'}`,
    `- Compatibility: ${snapshot.compatibilityMode ?? snapshot.protocol.compatibilityMode ?? 'Unknown'}`,
    '',
    '## Audit Provenance',
    '',
    `- ForgeLoop version: ${snapshot.provenance.forgeLoopPackageVersion}`,
    `- ForgeLoop source commit: ${snapshot.provenance.forgeLoopCommit}`,
    `- ForgeLoopAudit version: ${snapshot.auditEngineVersion}`,
    `- Audit rules version: ${snapshot.provenance.auditRulesVersion}`,
    `- Integration API version: ${snapshot.provenance.integrationApiVersion ?? 'Unavailable'}`,
    `- Timestamp: ${snapshot.generatedAt}`,
    `- Audit fingerprint: ${snapshot.fingerprint}`,
    '',
    '## Executive Verdict',
    '',
    `- Integrity: ${snapshot.verdict.integrity}`,
    `- Completion readiness: ${snapshot.verdict.completionReadiness}`,
    `- Engineering quality: ${snapshot.verdict.quality}`,
    `- Trust / attestation: ${snapshot.verdict.trust}`,
    '',
    '## Audit Coverage',
    '',
    `Audit coverage: ${snapshot.coverage.percent}%`,
    '',
    'Unavailable:',
    unavailable,
    '',
    '## Findings Summary',
    '',
    `- Critical: ${snapshot.counts.critical}`,
    `- High: ${snapshot.counts.high}`,
    `- Medium: ${snapshot.counts.medium}`,
    `- Low: ${snapshot.counts.low}`,
    `- Info: ${snapshot.counts.info}`,
    `- Unknown: ${snapshot.counts.unknown}`,
    '',
    '## Critical / High Findings',
    '',
    criticalHigh.length > 0 ? criticalHigh.map(findingLine).join('\n') : '- None',
    '',
    '## Task Audit Results',
    '',
    taskLines,
    '',
    '## Evidence & Verification',
    '',
    'Canonical evidence is reported only when supplied by ForgeLoop projections. ForgeLoopAudit does not infer requirement coverage from raw artifact text.',
    '',
    '## Ownership & Recovery',
    '',
    'Ownership and recovery findings retain their canonical ForgeLoop source and remediation.',
    '',
    '## Policy & Trust',
    '',
    'Policy, attestation and compatibility signals are kept separate from completion readiness.',
    '',
    '## Structural Quality',
    '',
    'Structural quality is consumed from the canonical ForgeLoop structural-quality resource; no provider is executed by ForgeLoopAudit.',
    '',
    '## Attestation',
    '',
    'Attestation status is canonical when available and otherwise explicitly unavailable.',
    '',
    '## Execution / Diagnostic Signals',
    '',
    'Execution diagnostics are observations and do not authorize protocol mutations.',
    '',
    '## Changes Since Baseline',
    '',
    '- No baseline comparison was supplied for this report.',
    '',
    '## Limitations / Unavailable Capabilities',
    '',
    unavailable,
    '',
  ].join('\n');
}

export function buildAuditSarifReport(snapshot: ProjectAuditSnapshot): string {
  const results = sortedFindings(snapshot.findings).map((finding) => ({
    ruleId: finding.code,
    level: finding.severity === 'CRITICAL' || finding.severity === 'HIGH' ? 'error' : finding.severity === 'INFO' ? 'note' : 'warning',
    message: { text: `${sourceLabel(finding.source)} ${finding.summary}` },
    properties: { taskId: finding.taskId, domain: finding.domain, fingerprint: finding.fingerprint, canonical: finding.canonical },
  }));
  return `${JSON.stringify({
    version: '2.1.0',
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    runs: [{
      tool: { driver: { name: 'ForgeLoopAudit', version: snapshot.auditEngineVersion, informationUri: 'https://github.com/cassiomc1/ForgeLoopAudit' } },
      results,
      properties: { auditFingerprint: snapshot.fingerprint, forgeLoopVersion: snapshot.provenance.forgeLoopPackageVersion },
    }],
  }, null, 2)}\n`;
}

export function buildAuditReport(snapshot: ProjectAuditSnapshot, format: AuditReportFormat): string {
  if (format === 'JSON') return buildAuditJsonReport(snapshot);
  if (format === 'MARKDOWN') return buildAuditMarkdownReport(snapshot);
  return buildAuditSarifReport(snapshot);
}
