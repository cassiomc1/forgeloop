import { ArrowRight, Activity, FileCheck2, Fingerprint, RefreshCw, ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import type { AuditFinding, ProjectAuditSnapshot } from '@shared/audit';
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

function Verdict({ label, value, icon }: { label: string; value: string; icon: ReactNode }) {
  return (
    <div className="audit-verdict">
      <div className="audit-verdict-label"><span>{label}</span>{icon}</div>
      <StatusBadge status={value} size="md" />
    </div>
  );
}

function FindingRow({ finding, onTaskSelect }: { finding: AuditFinding; onTaskSelect: (taskId: string) => void }) {
  const content = <>
    <div className="audit-finding-meta"><StatusBadge status={finding.severity} /><code>{finding.code}</code></div>
    <p>{finding.summary}</p>
  </>;
  return finding.taskId
    ? <button className="audit-finding audit-interactive-row" onClick={() => onTaskSelect(finding.taskId!)}>{content}</button>
    : <div className="audit-finding">{content}</div>;
}

export function AuditSummary({ audit, snapshot, detection, onRefresh, onTaskSelect, onViewFindings }: AuditSummaryProps) {
  const attention = audit?.findings.filter((finding) => finding.severity === 'CRITICAL' || finding.severity === 'HIGH').slice(0, 5) ?? [];
  const pendingTasks = audit?.taskAudits.filter((task) => task.status !== 'VALID') ?? [];

  return (
    <div className="audit-summary animate-fade-in">
      <header className="audit-page-header">
        <div className="min-w-0">
          <h1>Audit Summary</h1>
          <p className="audit-page-description">Read-only engineering audit for <span className="font-medium text-forge-text-primary">{audit?.project.name ?? snapshot.project.name}</span></p>
          {audit && <div className="audit-source-meta">
            <span>ForgeLoop {audit.provenance.forgeLoopPackageVersion}</span>
            <span>Protocol v{audit.protocol.protocolVersion} · Schema v{audit.protocol.schemaVersion}</span>
            <code title={audit.gitHead ?? undefined}>HEAD {audit.gitHead ?? 'Unavailable'}</code>
          </div>}
        </div>
        <button className={audit ? 'btn-primary' : 'btn-secondary'} onClick={onRefresh}>
          <RefreshCw className="h-4 w-4" aria-hidden="true" />{audit ? 'Run audit' : 'Retry audit'}
        </button>
      </header>

      {!audit ? (
        <section className="audit-limitation" aria-labelledby="audit-unavailable-title">
          <ShieldCheck className="h-6 w-6 shrink-0" aria-hidden="true" />
          <div><h2 id="audit-unavailable-title">Canonical audit unavailable</h2>
            <p>Compatibility: {detection.compatibilityMode ?? 'UNKNOWN'}. Artifact inspection remains available, but completion authority is not available.</p>
          </div>
        </section>
      ) : <>
        {audit.compatibilityMode === 'ARTIFACT_ONLY' && <div className="audit-limitation">Audit capability limited. Canonical ForgeLoop Integration API unavailable; artifact inspection is available, but completion authority is not.</div>}

        <section className="audit-verdict-grid" aria-label="Canonical audit verdicts">
          <Verdict label="Integrity" value={audit.verdict.integrity} icon={<ShieldCheck aria-hidden="true" />} />
          <Verdict label="Completion readiness" value={audit.verdict.completionReadiness} icon={<FileCheck2 aria-hidden="true" />} />
          <Verdict label="Engineering quality" value={audit.verdict.quality} icon={<Activity aria-hidden="true" />} />
          <Verdict label="Trust / attestation" value={audit.verdict.trust} icon={<Fingerprint aria-hidden="true" />} />
        </section>

        <div className="audit-evidence-grid">
          <section className="audit-panel audit-coverage" aria-labelledby="audit-coverage-title">
            <div className="audit-panel-heading">
              <div><h2 id="audit-coverage-title">Audit coverage</h2><p>Unavailable capabilities remain visible.</p></div>
              <span className="audit-coverage-value">{audit.coverage.percent}<span>%</span></span>
            </div>
            <div className="audit-coverage-track" role="progressbar" aria-label="Audit coverage" aria-valuemin={0} aria-valuemax={100} aria-valuenow={audit.coverage.percent}>
              <div style={{ width: `${audit.coverage.percent}%` }} />
            </div>
            {audit.coverage.unavailable.length > 0 && <p className="audit-unavailable-capabilities">Unavailable: {audit.coverage.unavailable.join(', ')}</p>}
            <p className="audit-score">{audit.score ? `Audit score ${audit.score.score ?? 'unavailable'} (${audit.score.grade}) · ${audit.score.methodologyVersion}` : 'Score unavailable — insufficient audit coverage.'}</p>
          </section>

          <section className="audit-panel" aria-labelledby="audit-severity-title">
            <div className="audit-panel-heading"><h2 id="audit-severity-title">Findings by severity</h2></div>
            <dl className="audit-severity-grid">
              {([
                ['Critical', audit.counts.critical, 'danger'],
                ['High', audit.counts.high, 'warning'],
                ['Medium', audit.counts.medium, 'primary'],
                ['Info', audit.counts.info, 'muted'],
              ] as const).map(([label, count, tone]) => <div key={label}>
                <dt>{label}</dt><dd className={count > 0 ? `audit-count-${tone}` : undefined}>{count}</dd>
              </div>)}
            </dl>
          </section>
        </div>

        <div className="audit-review-grid">
          <section className="audit-panel" aria-labelledby="audit-attention-title">
            <div className="audit-panel-heading">
              <h2 id="audit-attention-title">Needs attention</h2>
              <button className="audit-text-action" onClick={onViewFindings}>View findings<ArrowRight className="h-4 w-4" aria-hidden="true" /></button>
            </div>
            {attention.length === 0 ? <p className="audit-empty-message">No critical or high findings.</p> : <div className="audit-finding-list">{attention.map((finding) => <FindingRow key={finding.fingerprint} finding={finding} onTaskSelect={onTaskSelect} />)}</div>}
          </section>
          <section className="audit-panel" aria-labelledby="audit-pending-title">
            <div className="audit-panel-heading"><h2 id="audit-pending-title">Tasks not ready for completion</h2></div>
            <div className="audit-task-list">
              {pendingTasks.slice(0, 6).map((task) => <button key={task.taskId} className="audit-task-row audit-interactive-row" onClick={() => onTaskSelect(task.taskId)}>
                <code>{task.taskId}</code><span className="flex shrink-0 items-center gap-2"><StatusBadge status={task.status} /><ArrowRight className="h-4 w-4 text-forge-text-muted" aria-hidden="true" /></span>
              </button>)}
              {pendingTasks.length === 0 && <p className="audit-empty-message">All audited tasks are canonically valid.</p>}
            </div>
          </section>
        </div>
      </>}
    </div>
  );
}
