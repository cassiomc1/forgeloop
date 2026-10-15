import type {
  AuditCoverage,
  AuditFinding,
  AuditFindingCounts,
  CanonicalTaskAudit,
  ProjectAuditSnapshot,
  ProjectAuditVerdict,
  StructuralQualityAuditView,
  TaskAuditSummary,
} from '@shared/audit';
import type { ForgeLoopCompatibilityMode, ProjectSummary, ProtocolSummary } from '@shared/domain';
import { createFindingFingerprint, createProjectAuditFingerprint } from './audit-fingerprint';
import { computeAuditScore } from './audit-score';

export interface AggregateProjectAuditInput {
  project: ProjectSummary;
  protocol: ProtocolSummary;
  taskAudits: CanonicalTaskAudit[];
  qualityViews: StructuralQualityAuditView[];
  findings: AuditFinding[];
  compatibilityMode: ForgeLoopCompatibilityMode;
  forgeLoopPackageVersion: string;
  forgeLoopCommit: string;
  integrationApiVersion: number | null;
  gitHead: string | null;
  auditEngineVersion?: string;
  coverage?: Partial<AuditCoverage>;
}

const severityOrder: Record<AuditFinding['severity'], number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFO: 4, UNKNOWN: 5 };

function sortFindings(findings: AuditFinding[]): AuditFinding[] {
  return [...findings].sort((left, right) => severityOrder[left.severity] - severityOrder[right.severity]
    || (left.taskId ?? '').localeCompare(right.taskId ?? '')
    || left.code.localeCompare(right.code)
    || left.fingerprint.localeCompare(right.fingerprint));
}

export function countAuditFindings(findings: AuditFinding[]): AuditFindingCounts {
  return findings.reduce<AuditFindingCounts>((counts, finding) => {
    const key = finding.severity.toLowerCase() as keyof AuditFindingCounts;
    counts[key] += 1;
    return counts;
  }, { critical: 0, high: 0, medium: 0, low: 0, info: 0, unknown: 0 });
}

/**
 * A canonical error this Audit build cannot classify carries an unknown
 * integrity impact. Treating it as no impact would let a future ForgeLoop
 * safety error pass through as a clean verdict, so it downgrades the verdict to
 * UNKNOWN instead of being ignored.
 */
function hasUnclassifiedCanonicalError(findings: AuditFinding[]): boolean {
  return findings.some((finding) => finding.unclassifiedCanonicalError === true);
}

function integrityVerdict(input: AggregateProjectAuditInput, findings: AuditFinding[]): ProjectAuditVerdict['integrity'] {
  if (input.compatibilityMode !== 'INTEGRATION_V1') return 'UNKNOWN';
  if (!input.protocol.compatible) return 'INVALID';
  if (input.taskAudits.some((audit) => !audit.available)) return 'UNKNOWN';
  const integrityFindings = findings.filter((finding) => finding.affectsIntegrity);
  if (integrityFindings.some((finding) => /INCONSIST|CONFLICT|DRIFT/u.test(finding.code))) return 'INCONSISTENT';
  if (integrityFindings.length > 0) return 'INVALID';
  if (hasUnclassifiedCanonicalError(findings)) return 'UNKNOWN';
  return 'VALID';
}

function completionVerdict(audits: CanonicalTaskAudit[]): ProjectAuditVerdict['completionReadiness'] {
  if (audits.length === 0) return 'UNKNOWN';
  const statuses = [...new Set(audits.map((audit) => audit.status))];
  if (statuses.length === 1) return statuses[0] === 'UNKNOWN' ? 'UNKNOWN' : statuses[0];
  return 'MIXED';
}

function qualityVerdict(views: StructuralQualityAuditView[]): ProjectAuditVerdict['quality'] {
  const statuses = [...new Set(views.filter((view) => view.available).map((view) => view.current.status)
    .filter((status) => status !== 'NOT_OBSERVED' && status !== 'UNKNOWN'))];
  if (statuses.length === 0) return 'NOT_OBSERVED';
  if (statuses.length === 1) return statuses[0];
  return 'MIXED';
}

function trustVerdict(input: AggregateProjectAuditInput, findings: AuditFinding[]): ProjectAuditVerdict['trust'] {
  if (input.compatibilityMode !== 'INTEGRATION_V1') return 'UNKNOWN';
  if (input.taskAudits.some((audit) => !audit.available)) return 'UNKNOWN';
  if (findings.some((finding) => finding.domain === 'ATTESTATION' && finding.affectsIntegrity)) return 'INVALID';
  if (findings.some((finding) => ['OWNERSHIP', 'POLICY', 'HANDOFF', 'RESPONSIBILITY', 'WORKSPACE'].includes(finding.domain) && finding.affectsIntegrity)) return 'DEGRADED';
  if (hasUnclassifiedCanonicalError(findings)) return 'UNKNOWN';
  return 'VALID';
}

function buildCoverage(input: AggregateProjectAuditInput): AuditCoverage {
  const defaults: AuditCoverage = {
    percent: 0,
    canonicalAudit: input.compatibilityMode === 'INTEGRATION_V1',
    canonicalOwnership: input.compatibilityMode === 'INTEGRATION_V1',
    structuredDiagnostics: input.compatibilityMode === 'INTEGRATION_V1',
    policy: input.compatibilityMode === 'INTEGRATION_V1',
    structuralQuality: input.qualityViews.some((view) => view.available),
    codeAttestation: input.compatibilityMode === 'INTEGRATION_V1',
    verificationScope: input.compatibilityMode === 'INTEGRATION_V1',
    executionProvenance: input.compatibilityMode === 'INTEGRATION_V1',
    unavailable: [],
  };
  const coverage = { ...defaults, ...input.coverage };
  const dimensions: Array<keyof Omit<AuditCoverage, 'percent' | 'unavailable'>> = [
    'canonicalAudit', 'canonicalOwnership', 'structuredDiagnostics', 'policy', 'structuralQuality', 'codeAttestation', 'verificationScope', 'executionProvenance',
  ];
  coverage.unavailable = dimensions.filter((dimension) => !coverage[dimension]);
  coverage.percent = Math.round((dimensions.filter((dimension) => coverage[dimension]).length / dimensions.length) * 100);
  return coverage;
}

function buildTaskSummary(audit: CanonicalTaskAudit, quality: StructuralQualityAuditView | undefined, findings: AuditFinding[]): TaskAuditSummary {
  const taskFindings = findings.filter((finding) => finding.taskId === audit.taskId);
  const fingerprint = createFindingFingerprint({
    source: 'FORGELOOP_CANONICAL_AUDIT',
    code: `TASK_STATUS_${audit.status}`,
    taskId: audit.taskId,
    domain: 'COMPLETION',
    artifactRefs: taskFindings.flatMap((finding) => finding.artifactRefs),
  });
  return {
    taskId: audit.taskId ?? 'UNKNOWN',
    status: audit.status,
    canonicalAvailable: audit.available,
    structuralQualityStatus: quality?.current.status ?? 'NOT_OBSERVED',
    findingCount: taskFindings.length,
    criticalFindingCount: taskFindings.filter((finding) => finding.severity === 'CRITICAL').length,
    highFindingCount: taskFindings.filter((finding) => finding.severity === 'HIGH').length,
    fingerprint,
  };
}

export function aggregateProjectAudit(input: AggregateProjectAuditInput): ProjectAuditSnapshot {
  const findings = sortFindings(input.findings);
  const verdict: ProjectAuditVerdict = {
    integrity: integrityVerdict(input, findings),
    completionReadiness: input.compatibilityMode === 'ARTIFACT_ONLY' ? 'UNKNOWN' : completionVerdict(input.taskAudits),
    quality: qualityVerdict(input.qualityViews),
    trust: trustVerdict(input, findings),
  };
  const coverage = buildCoverage(input);
  const scoreResult = computeAuditScore({ coverage, findings, verdict });
  const score = scoreResult.score === null ? null : scoreResult;
  const taskAudits = input.taskAudits
    .filter((audit) => audit.taskId !== null)
    .map((audit) => buildTaskSummary(audit, input.qualityViews.find((view) => view.taskId === audit.taskId), findings))
    .sort((left, right) => left.taskId.localeCompare(right.taskId));
  const generatedAt = new Date().toISOString();
  const base = {
    schemaVersion: 1 as const,
    auditEngineVersion: input.auditEngineVersion ?? '0.2.0-rc.1',
    project: input.project,
    protocol: input.protocol,
    generatedAt,
    gitHead: input.gitHead,
    verdict,
    coverage,
    score,
    taskAudits,
    findings,
    counts: countAuditFindings(findings),
    provenance: {
      forgeLoopPackageVersion: input.forgeLoopPackageVersion,
      forgeLoopCommit: input.forgeLoopCommit,
      integrationApiVersion: input.integrationApiVersion,
      auditRulesVersion: 'forgeloop-audit-rules/v1',
    },
    compatibilityMode: input.compatibilityMode,
  };
  return { ...base, fingerprint: createProjectAuditFingerprint(base) };
}
