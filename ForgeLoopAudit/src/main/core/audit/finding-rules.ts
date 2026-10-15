import type {
  AuditEvidenceRef,
  AuditFinding,
  AuditFindingDomain,
  AuditFindingSeverity,
  AuditRemediation,
} from '@shared/audit';
import type {
  CanonicalReflectionViewModel,
  ContextUsageView,
  EvidenceCoverageSummary,
} from '@shared/domain';
import { createFindingFingerprint } from './audit-fingerprint';
import { AUDIT_RULES_VERSION } from './finding-severity';

export interface DerivedRecoveryObservation {
  /** A canonical recovery state, not filesystem age or mtime. */
  status: string;
  unresolvedSince: string | null;
  /** Age supplied by ForgeLoop's recovery projection. */
  ageDays?: number | null;
  reasonCodes?: string[];
  artifactRefs?: string[];
}

export interface DerivedContextObservation {
  source: Exclude<ContextUsageView['source'], 'UNKNOWN'>;
  inflationStatus: string;
  baselineTotalTokens?: number | null;
  currentTotalTokens?: number | null;
  artifactRef?: string | null;
}

export interface DerivedFindingInput {
  taskId: string | null;
  reflection?: Pick<CanonicalReflectionViewModel, 'status' | 'stallAnalysis' | 'informationGain'> | null;
  evidenceCoverage?: EvidenceCoverageSummary | null;
  /** Raw usage is intentionally insufficient for an inflation finding. */
  contextUsage?: ContextUsageView | null;
  contextObservability?: DerivedContextObservation | null;
  recovery?: DerivedRecoveryObservation | null;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))].sort((left, right) => left.localeCompare(right));
}

function findingId(fingerprint: string): string {
  return `FLA-${fingerprint.slice(0, 16)}`;
}

function derivedEvidence(ref: string, label: string): AuditEvidenceRef {
  return { ref, label, kind: 'FORGELOOP_CANONICAL_RESOURCE', source: 'FORGELOOP_CANONICAL_RESOURCE' };
}

function makeDerivedFinding(input: {
  taskId: string | null;
  code: string;
  severity: AuditFindingSeverity;
  domain: AuditFindingDomain;
  title: string;
  summary: string;
  evidence: AuditEvidenceRef[];
  artifactRefs?: string[];
  reasonCodes?: string[];
  affectsIntegrity?: boolean;
  affectsCompletion?: boolean;
  remediation?: AuditRemediation | null;
}): AuditFinding {
  const artifactRefs = uniqueStrings(input.artifactRefs ?? []);
  const fingerprint = createFindingFingerprint({
    source: 'FORGELOOP_AUDIT_DERIVED',
    code: input.code,
    taskId: input.taskId,
    domain: input.domain,
    artifactRefs,
  });
  return {
    id: findingId(fingerprint),
    fingerprint,
    taskId: input.taskId,
    severity: input.severity,
    domain: input.domain,
    source: 'FORGELOOP_AUDIT_DERIVED',
    code: input.code,
    title: input.title,
    summary: input.summary,
    canonical: false,
    affectsIntegrity: input.affectsIntegrity ?? false,
    affectsCompletion: input.affectsCompletion ?? false,
    evidence: input.evidence,
    artifactRefs,
    reasonCodes: uniqueStrings(input.reasonCodes ?? []),
    remediation: input.remediation ?? null,
    ruleVersion: AUDIT_RULES_VERSION,
  };
}

function repeatedVerificationFinding(input: DerivedFindingInput): AuditFinding | null {
  const reflection = input.reflection;
  const stall = reflection?.stallAnalysis;
  const cycles = reflection?.informationGain.cyclesWithoutEffectiveGain ?? [];
  if (!reflection || !stall || stall.latestNoGain !== true) return null;
  if ((stall.consecutiveNoGainCycles ?? 0) < 2 && cycles.length < 2) return null;
  if (stall.sameFailureSurfaceAsPrevious !== true
    && stall.sameFailureSignaturesAsPrevious !== true
    && stall.sameStrategyAsPrevious !== true) return null;
  return makeDerivedFinding({
    taskId: input.taskId,
    code: 'FLA-EFF-001',
    severity: 'MEDIUM',
    domain: 'EFFICIENCY',
    title: 'Repeated verification cycles without effective information gain',
    summary: `ForgeLoop reflection recorded ${Math.max(stall.consecutiveNoGainCycles ?? 0, cycles.length)} consecutive cycle(s) without effective information gain.`,
    evidence: [derivedEvidence('task/reflection', 'Canonical reflection projection')],
    affectsCompletion: false,
  });
}

function evidenceCoverageFinding(input: DerivedFindingInput): AuditFinding | null {
  const coverage = input.evidenceCoverage;
  if (!coverage || coverage.total <= 0 || coverage.coveragePercent >= 100) return null;
  const uncovered = coverage.partial + coverage.notVerified + coverage.blocked;
  if (uncovered <= 0) return null;
  return makeDerivedFinding({
    taskId: input.taskId,
    code: 'FLA-EVID-001',
    severity: 'MEDIUM',
    domain: 'EVIDENCE',
    title: 'Verification requirements contain unverified evidence',
    summary: `${uncovered} of ${coverage.total} canonical verification requirement(s) are partial, blocked or not verified.`,
    evidence: [derivedEvidence('task/evidence', 'Canonical evidence coverage projection')],
    affectsCompletion: true,
  });
}

function contextInflationFinding(input: DerivedFindingInput): AuditFinding | null {
  const observation = input.contextObservability;
  if (!observation || observation.inflationStatus.toUpperCase() === 'NOT_MEASURED') return null;
  const status = observation.inflationStatus.toUpperCase();
  if (!['INFLATED', 'INCREASED', 'REGRESSION', 'WARN', 'WARNING'].includes(status)) return null;
  const artifactRefs = observation.artifactRef ? [observation.artifactRef] : [];
  const baseline = observation.baselineTotalTokens;
  const current = observation.currentTotalTokens;
  const numericDetail = typeof baseline === 'number' && typeof current === 'number'
    ? ` (${current} reported tokens versus ${baseline} at baseline)`
    : '';
  return makeDerivedFinding({
    taskId: input.taskId,
    code: 'FLA-EFF-002',
    severity: 'MEDIUM',
    domain: 'EFFICIENCY',
    title: 'Observed context usage increased materially without matching task complexity',
    summary: `ForgeLoop reported context inflation or regression${numericDetail}.`,
    evidence: [derivedEvidence('task/context', 'Canonical host/provider-reported context observability')],
    artifactRefs,
  });
}

function longLivedRecoveryFinding(input: DerivedFindingInput): AuditFinding | null {
  const recovery = input.recovery;
  if (!recovery || !recovery.unresolvedSince || typeof recovery.ageDays !== 'number' || recovery.ageDays < 1) return null;
  if (!/RESUME|RECOVERY|UNRESOLVED/u.test(recovery.status)) return null;
  return makeDerivedFinding({
    taskId: input.taskId,
    code: 'FLA-REC-001',
    severity: 'MEDIUM',
    domain: 'RECOVERY',
    title: 'Recovery has remained unresolved',
    summary: `ForgeLoop has reported ${recovery.status} since ${recovery.unresolvedSince} (${recovery.ageDays} day(s)).`,
    evidence: [derivedEvidence('task/recovery', 'Canonical recovery projection')],
    artifactRefs: recovery.artifactRefs,
    reasonCodes: recovery.reasonCodes,
    affectsCompletion: true,
  });
}

/**
 * Apply the small, evidence-backed derived rule set. Missing projections do
 * not produce findings; raw artifact timestamps and event counts are never
 * used as substitutes for canonical observations.
 */
export function deriveAuditFindings(input: DerivedFindingInput): AuditFinding[] {
  return [
    repeatedVerificationFinding(input),
    evidenceCoverageFinding(input),
    contextInflationFinding(input),
    longLivedRecoveryFinding(input),
  ].filter((finding): finding is AuditFinding => finding !== null);
}
