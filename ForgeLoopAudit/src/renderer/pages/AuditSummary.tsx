import type { ProjectAuditSnapshot } from '@shared/audit';
import type { ProjectDetectionResult, ProjectSnapshot } from '@shared/domain';
import { StatusBadge } from '../components/ui/StatusBadge';

interface AuditSummaryProps {
  audit: ProjectAuditSnapshot | null;
  snapshot: ProjectSnapshot;
  detection: ProjectDetectionResult;
  onRefresh: () => void;
  onTaskSelect: (taskId: string) => void;
  onViewFindings: () => void;
}

function Verdict({ label, value }: { label: string; value: string }) {
  return <div className="bg-forge-secondary-surface border border-forge-border-subtle rounded-8 p-4"><p className="text-xs text-forge-text-muted uppercase tracking-wider">{label}</p><div className="mt-2"><StatusBadge status={value} size="md" /></div></div>;
}

export function AuditSummary({ audit, snapshot, detection, onRefresh, onTaskSelect, onViewFindings }: AuditSummaryProps) {
  if (!audit) {
    return <div className="space-y-6 animate-fade-in"><div><h1 className="text-xl font-semibold text-forge-text-primary">Audit Summary</h1><p className="text-sm text-forge-text-muted mt-1">Read-only engineering audit for {snapshot.project.name}</p></div><div className="bg-forge-warning/10 border border-forge-warning/30 rounded-10 p-5"><p className="font-medium text-forge-warning">Canonical audit unavailable</p><p className="mt-1 text-sm text-forge-text-secondary">Compatibility: {detection.compatibilityMode ?? 'UNKNOWN'}. Artifact inspection remains available, but completion authority is not available.</p><button className="btn-secondary mt-4" onClick={onRefresh}>Retry audit</button></div></div>;
  }

  const attention = audit.findings.filter((finding) => finding.severity === 'CRITICAL' || finding.severity === 'HIGH').slice(0, 5);
  return <div className="space-y-6 animate-fade-in">
    <div className="flex items-start justify-between gap-4"><div><h1 className="text-xl font-semibold text-forge-text-primary">Audit Summary</h1><p className="text-sm text-forge-text-muted mt-1">{audit.project.name} · ForgeLoop {audit.provenance.forgeLoopPackageVersion} · protocol v{audit.protocol.protocolVersion} · schema v{audit.protocol.schemaVersion}</p><p className="text-xs text-forge-text-muted mt-1 font-mono">HEAD {audit.gitHead ?? 'Unavailable'}</p></div><button className="btn-secondary" onClick={onRefresh}>Run audit</button></div>
    {audit.compatibilityMode === 'ARTIFACT_ONLY' && <div className="bg-forge-warning/10 border border-forge-warning/30 rounded-10 p-4 text-sm text-forge-warning">Audit capability limited. Canonical ForgeLoop Integration API unavailable; artifact inspection is available, but completion authority is not.</div>}
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3"><Verdict label="Integrity" value={audit.verdict.integrity} /><Verdict label="Completion readiness" value={audit.verdict.completionReadiness} /><Verdict label="Engineering quality" value={audit.verdict.quality} /><Verdict label="Trust / attestation" value={audit.verdict.trust} /></div>
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">{[['Critical', audit.counts.critical], ['High', audit.counts.high], ['Medium', audit.counts.medium], ['Info', audit.counts.info]].map(([label, count]) => <div key={String(label)} className="bg-forge-primary-surface border border-forge-border-subtle rounded-8 p-4"><p className="text-xs text-forge-text-muted">{label}</p><p className="text-2xl font-semibold text-forge-text-primary mt-1">{count}</p></div>)}</div>
    <div className="bg-forge-primary-surface border border-forge-border-subtle rounded-10 p-5"><div className="flex items-center justify-between gap-3"><div><h2 className="font-semibold text-forge-text-primary">Audit coverage</h2><p className="text-sm text-forge-text-muted mt-1">Unavailable capabilities remain visible.</p></div><span className="text-2xl font-semibold text-forge-text-primary">{audit.coverage.percent}%</span></div><div className="mt-3 h-2 bg-forge-border-subtle rounded-full overflow-hidden"><div className="h-full bg-forge-accent rounded-full" style={{ width: `${audit.coverage.percent}%` }} /></div>{audit.coverage.unavailable.length > 0 && <p className="mt-3 text-xs text-forge-warning">Unavailable: {audit.coverage.unavailable.join(', ')}</p>}<p className="mt-3 text-sm text-forge-text-secondary">{audit.score ? `Audit score ${audit.score.score ?? 'unavailable'} (${audit.score.grade}) · ${audit.score.methodologyVersion}` : 'Score unavailable — insufficient audit coverage.'}</p></div>
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4"><div className="bg-forge-primary-surface border border-forge-border-subtle rounded-10 p-5"><div className="flex items-center justify-between"><h2 className="font-semibold text-forge-text-primary">Needs attention</h2><button className="btn-secondary text-xs" onClick={onViewFindings}>View findings</button></div>{attention.length === 0 ? <p className="text-sm text-forge-text-muted mt-4">No critical or high findings.</p> : <div className="mt-3 space-y-2">{attention.map((finding) => <button key={finding.fingerprint} className="w-full text-left p-3 rounded-8 bg-forge-secondary-surface hover:bg-forge-hover-surface" onClick={() => finding.taskId && onTaskSelect(finding.taskId)}><div className="flex items-center gap-2"><StatusBadge status={finding.severity} /><span className="font-mono text-xs text-forge-text-muted">{finding.code}</span></div><p className="mt-1 text-sm text-forge-text-primary">{finding.summary}</p></button>)}</div>}</div><div className="bg-forge-primary-surface border border-forge-border-subtle rounded-10 p-5"><h2 className="font-semibold text-forge-text-primary">Tasks not ready for completion</h2><div className="mt-3 space-y-2">{audit.taskAudits.filter((task) => task.status !== 'VALID').slice(0, 6).map((task) => <button key={task.taskId} className="w-full flex items-center justify-between p-3 rounded-8 bg-forge-secondary-surface hover:bg-forge-hover-surface" onClick={() => onTaskSelect(task.taskId)}><span className="font-mono text-sm text-forge-text-primary">{task.taskId}</span><StatusBadge status={task.status} /></button>)}{audit.taskAudits.every((task) => task.status === 'VALID') && <p className="text-sm text-forge-text-muted">All audited tasks are canonically valid.</p>}</div></div></div>
  </div>;
}
