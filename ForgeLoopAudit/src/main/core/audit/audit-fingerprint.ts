import { createHash } from 'node:crypto';
import type { AuditFinding, ProjectAuditSnapshot } from '@shared/audit';

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, normalize(entry)]));
  }
  return value;
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(normalize(value));
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function createFindingFingerprint(finding: Pick<AuditFinding, 'source' | 'code' | 'taskId' | 'artifactRefs'> & Partial<Pick<AuditFinding, 'domain'>>): string {
  const subject = {
    schemaVersion: 1,
    source: finding.source,
    code: finding.code,
    taskId: finding.taskId,
    domain: finding.domain ?? null,
    artifactRefs: [...finding.artifactRefs].sort((left, right) => left.localeCompare(right)),
  };
  return sha256(stableStringify(subject));
}

export function createProjectAuditFingerprint(snapshot: Omit<ProjectAuditSnapshot, 'fingerprint'> | ProjectAuditSnapshot): string {
  const { generatedAt: _generatedAt, auditId: _auditId, fingerprint: _fingerprint, ...stableSnapshot } = snapshot as ProjectAuditSnapshot;
  return sha256(stableStringify(stableSnapshot));
}

export function createProjectFingerprint(projectRoot: string, repositoryIdentity = ''): string {
  return sha256(stableStringify({ projectRoot, repositoryIdentity }));
}
