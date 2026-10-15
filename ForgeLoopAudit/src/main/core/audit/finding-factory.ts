import type {
  AuditEvidenceRef,
  AuditFinding,
  AuditFindingDomain,
  AuditFindingSource,
  AuditRemediation,
  CanonicalAuditError,
  StructuralQualityAuditView,
} from '@shared/audit';
import { AUDIT_RULES_VERSION } from './finding-severity';
import { severityForCanonicalError } from './finding-severity';
import { createFindingFingerprint } from './audit-fingerprint';

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function canonicalEvidence(artifactRefs: string[], source: AuditFindingSource): AuditEvidenceRef[] {
  return artifactRefs.map((ref) => ({ ref, source, kind: 'FORGELOOP_ARTIFACT' }));
}

function findingId(fingerprint: string): string {
  return `FLA-${fingerprint.slice(0, 16)}`;
}

function remediationFor(next: string | null | undefined, reasonCodes: string[]): AuditRemediation | null {
  if (typeof next !== 'string' || next.trim().length === 0) return null;
  return { kind: 'CANONICAL_NEXT', text: next, reasonCodes: [...reasonCodes] };
}

export interface CanonicalFindingOptions {
  taskId: string | null;
  structuralQualityMode?: 'off' | 'observe' | 'gate' | 'unknown';
  firstSeenAt?: string;
  lastSeenAt?: string;
  /**
   * Which canonical channel supplied the entry. ForgeLoop warnings are advisory
   * by contract, so an unclassified warning must not block a positive verdict,
   * while an unclassified error must.
   */
  channel?: 'ERROR' | 'WARNING';
}

export function canonicalErrorToFinding(error: CanonicalAuditError, options: CanonicalFindingOptions): AuditFinding {
  const mapping = severityForCanonicalError(error, { structuralQualityMode: options.structuralQualityMode });
  const artifactRefs = uniqueStrings(error.artifacts ?? []);
  const fingerprint = createFindingFingerprint({
    source: 'FORGELOOP_CANONICAL_AUDIT',
    code: error.code,
    taskId: options.taskId,
    domain: mapping.domain,
    artifactRefs,
  });
  const reasonCodes = uniqueStrings(error.reasonCodes ?? []);
  const unclassifiedCanonicalError = !mapping.classified && (options.channel ?? 'ERROR') === 'ERROR';
  return {
    id: findingId(fingerprint),
    fingerprint,
    taskId: options.taskId,
    severity: mapping.severity,
    domain: mapping.domain,
    source: 'FORGELOOP_CANONICAL_AUDIT',
    code: error.code,
    title: mapping.title || error.code,
    summary: error.message,
    canonicalMessage: error.canonicalMessage ?? error.message,
    presentationSummary: error.message,
    canonical: true,
    affectsIntegrity: mapping.affectsIntegrity,
    affectsCompletion: mapping.affectsCompletion,
    ...(unclassifiedCanonicalError ? { unclassifiedCanonicalError: true } : {}),
    evidence: canonicalEvidence(artifactRefs, 'FORGELOOP_CANONICAL_AUDIT'),
    artifactRefs,
    reasonCodes,
    remediation: remediationFor(error.next, reasonCodes),
    ...(options.firstSeenAt ? { firstSeenAt: options.firstSeenAt } : {}),
    ...(options.lastSeenAt ? { lastSeenAt: options.lastSeenAt } : {}),
    ruleVersion: AUDIT_RULES_VERSION,
  };
}

export function structuralQualityToFinding(view: StructuralQualityAuditView): AuditFinding | null {
  const status = view.current.status;
  if (!view.available || (status !== 'FAIL' && status !== 'BLOCKED')) return null;
  const artifactRefs = uniqueStrings([view.baseline.artifactRef, view.current.artifactRef].filter((ref): ref is string => Boolean(ref)));
  const code = status === 'BLOCKED' ? 'FLA-QUALITY-002' : 'FLA-QUALITY-001';
  const domain: AuditFindingDomain = 'STRUCTURAL_QUALITY';
  const fingerprint = createFindingFingerprint({ source: 'FORGELOOP_CANONICAL_RESOURCE', code, taskId: view.taskId, domain, artifactRefs });
  const reasonCodes = uniqueStrings(view.reasonCodes);
  const severity = view.mode === 'gate' || status === 'BLOCKED' ? 'HIGH' : 'MEDIUM';
  return {
    id: findingId(fingerprint),
    fingerprint,
    taskId: view.taskId,
    severity,
    domain,
    source: 'FORGELOOP_CANONICAL_RESOURCE',
    code,
    title: status === 'BLOCKED' ? 'Structural quality verification is blocked' : 'Structural quality is below the canonical threshold',
    summary: `ForgeLoop reported structural quality ${status.toLowerCase()} in ${view.mode} mode.`,
    canonicalMessage: `ForgeLoop structural quality status: ${status}`,
    presentationSummary: `Canonical structural quality is ${status.toLowerCase()}.`,
    canonical: true,
    affectsIntegrity: false,
    affectsCompletion: view.completionRequired || view.mode === 'gate',
    evidence: canonicalEvidence(artifactRefs, 'FORGELOOP_CANONICAL_RESOURCE'),
    artifactRefs,
    reasonCodes,
    remediation: remediationFor(view.next, reasonCodes),
    ruleVersion: AUDIT_RULES_VERSION,
  };
}

export function applicationDiagnosticToFinding(input: {
  code: string;
  message: string;
  taskId?: string | null;
  artifactRefs?: string[];
  domain?: AuditFindingDomain;
}): AuditFinding {
  const source: AuditFindingSource = 'LOCAL_APP_DIAGNOSTIC';
  const artifactRefs = uniqueStrings(input.artifactRefs ?? []);
  const domain = input.domain ?? 'APPLICATION';
  const fingerprint = createFindingFingerprint({ source, code: input.code, taskId: input.taskId ?? null, domain, artifactRefs });
  return {
    id: findingId(fingerprint),
    fingerprint,
    taskId: input.taskId ?? null,
    severity: 'INFO',
    domain,
    source,
    code: input.code,
    title: input.code,
    summary: input.message,
    presentationSummary: input.message,
    canonical: false,
    affectsIntegrity: false,
    affectsCompletion: false,
    evidence: canonicalEvidence(artifactRefs, source),
    artifactRefs,
    reasonCodes: [],
    remediation: null,
    ruleVersion: AUDIT_RULES_VERSION,
  };
}
