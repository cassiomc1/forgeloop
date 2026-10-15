import type { AuditDiff, AuditFinding, AuditTaskDiff, ProjectAuditSnapshot } from '@shared/audit';
import { stableStringify } from './audit-fingerprint';

const findingRank: Record<AuditFinding['severity'], number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFO: 4, UNKNOWN: 5 };

function sortFindings(findings: AuditFinding[]): AuditFinding[] {
  return [...findings].sort((left, right) => findingRank[left.severity] - findingRank[right.severity]
    || (left.taskId ?? '').localeCompare(right.taskId ?? '')
    || left.code.localeCompare(right.code)
    || left.fingerprint.localeCompare(right.fingerprint));
}

function comparableFinding(finding: AuditFinding): unknown {
  const { id: _id, fingerprint: _fingerprint, firstSeenAt: _firstSeenAt, lastSeenAt: _lastSeenAt, ...stable } = finding;
  return stable;
}

function auditId(snapshot: ProjectAuditSnapshot): string {
  return snapshot.auditId ?? snapshot.fingerprint;
}

export function diffAuditSnapshots(base: ProjectAuditSnapshot, current: ProjectAuditSnapshot): AuditDiff {
  const baseByFingerprint = new Map(base.findings.map((finding) => [finding.fingerprint, finding]));
  const currentByFingerprint = new Map(current.findings.map((finding) => [finding.fingerprint, finding]));
  const newFindings = sortFindings(current.findings.filter((finding) => !baseByFingerprint.has(finding.fingerprint)));
  const resolvedFindings = sortFindings(base.findings.filter((finding) => !currentByFingerprint.has(finding.fingerprint)));
  const persistentFindings = sortFindings(current.findings.filter((finding) => {
    const previous = baseByFingerprint.get(finding.fingerprint);
    return previous !== undefined && stableStringify(comparableFinding(previous)) === stableStringify(comparableFinding(finding));
  }));
  const changedFindings = sortFindings(current.findings.filter((finding) => {
    const previous = baseByFingerprint.get(finding.fingerprint);
    return previous !== undefined && stableStringify(comparableFinding(previous)) !== stableStringify(comparableFinding(finding));
  }));

  const baseTasks = new Map(base.taskAudits.map((task) => [task.taskId, task]));
  const currentTasks = new Map(current.taskAudits.map((task) => [task.taskId, task]));
  const taskIds = [...new Set([...baseTasks.keys(), ...currentTasks.keys()])].sort((left, right) => left.localeCompare(right));
  const taskChanges: AuditTaskDiff[] = taskIds.map((taskId) => {
    const previous = baseTasks.get(taskId);
    const next = currentTasks.get(taskId);
    return {
      taskId,
      statusChanged: previous?.status !== next?.status,
      previousStatus: previous?.status ?? null,
      currentStatus: next?.status ?? null,
      findingCountDelta: (next?.findingCount ?? 0) - (previous?.findingCount ?? 0),
    };
  }).filter((change) => change.statusChanged || change.findingCountDelta !== 0);

  const previousScore = base.score?.score ?? null;
  const currentScore = current.score?.score ?? null;
  return {
    baseAuditId: auditId(base),
    currentAuditId: auditId(current),
    verdictChanged: stableStringify(base.verdict) !== stableStringify(current.verdict),
    scoreDelta: previousScore !== null && currentScore !== null ? currentScore - previousScore : null,
    newFindings,
    resolvedFindings,
    persistentFindings,
    changedFindings,
    taskChanges,
  };
}

export const computeAuditDiff = diffAuditSnapshots;
