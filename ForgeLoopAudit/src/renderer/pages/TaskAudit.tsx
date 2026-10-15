import { useEffect, useState } from 'react';
import type { ProjectAuditSnapshot, TaskAuditSummary } from '@shared/audit';
import type { ProjectSnapshot, TaskAuditViewProjection } from '@shared/domain';
import { StatusBadge } from '../components/ui/StatusBadge';
import { auditApi } from '../lib/audit-client';

interface TaskAuditProps {
  snapshot: ProjectSnapshot;
  audit: ProjectAuditSnapshot | null;
  selectedTaskId?: string | null;
  onSelectedTaskChange: (taskId: string) => void;
  onRefreshAudit: () => void;
}

export function TaskAudit({ snapshot, audit, selectedTaskId, onSelectedTaskChange, onRefreshAudit }: TaskAuditProps) {
  const task = snapshot.tasks.find((entry) => entry.taskId === selectedTaskId) ?? snapshot.tasks.find((entry) => entry.taskId === snapshot.activeTaskId) ?? snapshot.tasks[0];
  const summary: TaskAuditSummary | undefined = task && audit?.taskAudits.find((entry) => entry.taskId === task.taskId);
  const findings = task ? audit?.findings.filter((finding) => finding.taskId === task.taskId) ?? [] : [];
  const auditUxAdvertised = snapshot.protocol.featureSupport?.auditUx === true;
  const [auditView, setAuditView] = useState<TaskAuditViewProjection | null>(null);
  const [auditViewError, setAuditViewError] = useState<string | null>(null);
  const selectedTaskIdValue = task?.taskId;

  useEffect(() => {
    if (!selectedTaskIdValue || !auditUxAdvertised) {
      setAuditView(null);
      setAuditViewError(null);
      return;
    }
    let cancelled = false;
    auditApi.getTaskAuditView(selectedTaskIdValue)
      .then((result) => { if (!cancelled) { setAuditView(result); setAuditViewError(null); } })
      .catch((reason: unknown) => { if (!cancelled) setAuditViewError(reason instanceof Error ? reason.message : 'Audit UX projection unavailable.'); });
    return () => { cancelled = true; };
  }, [selectedTaskIdValue, auditUxAdvertised]);

  if (!task) return <div className="empty-state"><p className="empty-state-title">No tasks available</p></div>;

  return <div className="space-y-5 animate-fade-in">
    <div className="flex items-center justify-between gap-3">
      <div><h1 className="text-xl font-semibold text-forge-text-primary">Task Audit</h1><p className="text-sm text-forge-text-muted mt-1">Canonical audit status and traceable findings for the selected task.</p></div>
      <select className="input w-48" value={task.taskId} onChange={(event) => onSelectedTaskChange(event.target.value)}>{snapshot.tasks.map((entry) => <option key={entry.taskId} value={entry.taskId}>{entry.taskId}</option>)}</select>
    </div>
    {!audit || !summary ? <div className="bg-forge-warning/10 border border-forge-warning/30 rounded-10 p-5"><p className="font-medium text-forge-warning">Task audit unavailable</p><p className="mt-1 text-sm text-forge-text-secondary">Run the project audit before reviewing canonical task findings.</p><button className="btn-secondary mt-4" onClick={onRefreshAudit}>Run audit</button></div> : <>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3"><Metric label="Canonical audit" value={summary.status} /><Metric label="Structural quality" value={summary.structuralQualityStatus} /><Metric label="Findings" value={String(summary.findingCount)} /></div>
      <section className="bg-forge-primary-surface border border-forge-border-subtle rounded-10 p-5"><h2 className="font-semibold text-forge-text-primary">{task.taskId}</h2><p className="mt-1 text-sm text-forge-text-secondary">Phase: {task.phase} · Canonical authority remains in ForgeLoop.</p><div className="mt-4 space-y-2">{findings.length === 0 ? <p className="text-sm text-forge-text-muted">No task findings were reported.</p> : findings.map((finding) => <div key={finding.fingerprint} className="rounded-8 bg-forge-secondary-surface p-3"><div className="flex items-center gap-2"><StatusBadge status={finding.severity} /><span className="font-mono text-xs text-forge-text-muted">{finding.code}</span><span className="text-xs text-forge-text-muted">{finding.canonical ? '[C] Canonical ForgeLoop' : '[D] ForgeLoopAudit derived'}</span></div><p className="mt-1 text-sm text-forge-text-primary">{finding.title}</p><p className="mt-1 text-xs text-forge-text-secondary">{finding.summary}</p></div>)}</div></section>
      {auditUxAdvertised && <AuditUxSection projection={auditView} error={auditViewError} />}
    </>}
  </div>;
}

function AuditUxSection({ projection, error }: { projection: TaskAuditViewProjection | null; error: string | null }) {
  return <section className="bg-forge-primary-surface border border-forge-border-subtle rounded-10 p-5" data-testid="audit-ux-section">
    <div className="flex items-center justify-between gap-2">
      <h2 className="font-semibold text-forge-text-primary">Audit UX read model</h2>
      <span className="rounded-6 bg-forge-secondary-surface px-2 py-1 text-xs text-forge-text-secondary">Canonical · read-only · presentation only</span>
    </div>
    <p className="mt-1 text-xs text-forge-text-muted">Bounded <span className="font-mono">task/audit-view</span> projection composed by ForgeLoop. It never grants lifecycle, evidence, ownership, or completion authority.</p>
    {error ? <p className="mt-3 text-sm text-forge-warning">{error}</p> : !projection
      ? <p className="mt-3 text-sm text-forge-text-muted">Loading canonical Audit UX projection…</p>
      : !projection.available
        ? <p className="mt-3 text-sm text-forge-warning">{projection.reason || 'Audit UX projection is unavailable.'}</p>
        : <div className="mt-4 space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <AuditUxMetric label="Audit status" value={projection.auditStatus ?? 'Unknown'} />
            <AuditUxMetric label="Phase" value={projection.phase ?? 'Unknown'} />
            <AuditUxMetric label="Completion" value={projection.completion ? `${projection.completion.state}${projection.completion.valid ? '' : ' (invalid)'}` : 'Unknown'} />
            <AuditUxMetric label="Ownership" value={projection.ownership?.claimState ?? 'Unknown'} />
          </div>
          <AuditUxDetails projection={projection} />
          <AuditUxTimeline projection={projection} />
        </div>}
  </section>;
}

function AuditUxDetails({ projection }: { projection: TaskAuditViewProjection }) {
  return <dl className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
    <div className="flex justify-between gap-3 rounded-8 bg-forge-secondary-surface px-3 py-2"><dt className="text-forge-text-muted">Verification checks</dt><dd className="font-mono text-forge-text-primary">{projection.verification?.checkCount ?? 0} ({projection.verification?.failedAttempts ?? 0} failed attempts)</dd></div>
    <div className="flex justify-between gap-3 rounded-8 bg-forge-secondary-surface px-3 py-2"><dt className="text-forge-text-muted">Next action</dt><dd className="truncate font-mono text-forge-text-primary max-w-[60%]">{projection.nextAction ?? '—'}</dd></div>
    <div className="flex justify-between gap-3 rounded-8 bg-forge-secondary-surface px-3 py-2"><dt className="text-forge-text-muted">Integrity</dt><dd className="font-mono text-forge-text-primary">{projection.integrity ? (projection.integrity.valid ? 'VALID' : 'INVALID') : 'UNKNOWN'}{projection.integrity && projection.integrity.reasonCodes.length > 0 ? ` · ${projection.integrity.reasonCodes.join(', ')}` : ''}</dd></div>
    <div className="flex justify-between gap-3 rounded-8 bg-forge-secondary-surface px-3 py-2"><dt className="text-forge-text-muted">Mutation allowed</dt><dd className="font-mono text-forge-text-primary">{projection.ownership ? (projection.ownership.mutationAllowed ? 'Yes (ForgeLoop decides)' : 'No') : 'Unknown'}</dd></div>
  </dl>;
}

function AuditUxTimeline({ projection }: { projection: TaskAuditViewProjection }) {
  const timeline = projection.timeline;
  if (!timeline || timeline.items.length === 0) return null;
  return <div>
    <div className="flex items-center justify-between">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-forge-text-muted">Canonical timeline</h3>
      <span className="text-xs text-forge-text-muted">{timeline.totalAvailable}{timeline.truncated ? '+ (bounded page)' : ''}</span>
    </div>
    <ol className="mt-2 space-y-1">{timeline.items.slice().reverse().slice(0, 8).map((item) => <li key={item.id} className="flex items-baseline gap-2 rounded-8 bg-forge-secondary-surface px-3 py-2 text-xs">
      <span className="w-10 shrink-0 font-mono text-forge-text-muted">#{item.sequence}</span>
      <span className="rounded-4 bg-forge-primary-surface px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-forge-text-secondary">{item.category}</span>
      <span className="text-forge-text-primary">{item.title}</span>
      <span className="ml-auto font-mono text-forge-text-muted">{item.kind}</span>
    </li>)}</ol>
    {timeline.truncated && <p className="mt-1 text-[10px] text-forge-text-muted">Bounded page only; older entries stay in ForgeLoop.</p>}
  </div>;
}

function AuditUxMetric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-8 bg-forge-secondary-surface px-3 py-2"><p className="text-[10px] uppercase tracking-wider text-forge-text-muted">{label}</p><p className="mt-1 truncate font-mono text-xs text-forge-text-primary">{value}</p></div>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="bg-forge-primary-surface border border-forge-border-subtle rounded-10 p-4"><p className="text-xs text-forge-text-muted uppercase tracking-wider">{label}</p><div className="mt-2"><StatusBadge status={value} size="md" /></div></div>;
}
