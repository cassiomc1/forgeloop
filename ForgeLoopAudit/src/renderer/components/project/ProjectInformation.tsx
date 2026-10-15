import { useState } from 'react';
import { AlertTriangle, Eye, EyeOff, FolderOpen, Radio } from 'lucide-react';
import type { ProjectDetectionResult, ProjectSnapshot, WatcherStatus } from '@shared/domain';
import { StatusBadge } from '../ui/StatusBadge';
import { cn, formatDate } from '../../lib/utils';

interface ProjectInformationProps {
  snapshot: ProjectSnapshot;
  detection?: ProjectDetectionResult | null;
  watcherStatus?: WatcherStatus;
}

function workspaceLabel(rootPath: string): string {
  const parts = rootPath.split(/[\\/]/u).filter(Boolean);
  return parts.at(-1) || rootPath;
}

function readable(value: string | undefined | null): string {
  return value || 'Unknown';
}

function canonicalStatusSummary(snapshot: ProjectSnapshot): { label: string; reasons: string[] } {
  const statuses = snapshot.tasks
    .map((task) => task.canonicalStatus?.status)
    .filter((status): status is string => Boolean(status));
  const uniqueStatuses = [...new Set(statuses)];
  const label = uniqueStatuses.length === 0
    ? 'Not reported'
    : uniqueStatuses.length === 1
      ? `${uniqueStatuses[0]} · ${statuses.length} task${statuses.length === 1 ? '' : 's'}`
      : `Mixed · ${uniqueStatuses.join(', ')}`;
  const reasons = [...new Set(snapshot.tasks.flatMap((task) => task.canonicalStatus?.reasons || []))];
  return { label, reasons };
}

export function ProjectInformation({ snapshot, detection, watcherStatus = { active: false } }: ProjectInformationProps) {
  const [showRootPath, setShowRootPath] = useState(false);
  const canonicalStatus = canonicalStatusSummary(snapshot);
  const warnings = [...new Set([...(detection?.warnings || []), ...(snapshot.diagnostics || [])])];
  const watcherState = watcherStatus.error ? 'Error' : watcherStatus.active ? 'Live' : 'Paused';

  return (
    <section className="bg-forge-primary-surface border border-forge-border-subtle rounded-10 p-4" aria-labelledby="project-information-heading">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 id="project-information-heading" className="text-sm font-semibold text-forge-text-primary flex items-center gap-2">
            <FolderOpen className="w-4 h-4 text-forge-accent" />
            Project Information
          </h2>
          <p className="text-xs text-forge-text-muted mt-1">Current project identity, canonical freshness and monitored state.</p>
        </div>
        <span className={cn(
          'inline-flex items-center gap-1.5 rounded-6 px-2.5 py-1 text-xs font-medium',
          watcherStatus.error ? 'bg-forge-danger/10 text-forge-danger' : watcherStatus.active ? 'bg-forge-success/10 text-forge-success' : 'bg-forge-border-subtle text-forge-text-muted',
        )}>
          <Radio className={cn('w-3.5 h-3.5', watcherStatus.active && !watcherStatus.error && 'animate-pulse-subtle')} />
          {watcherState}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 text-xs md:grid-cols-4">
        <InfoField label="Project" value={snapshot.project.name} />
        <InfoField label="Kind" value={detection?.projectKind} />
        <InfoField label="Branch" value={snapshot.project.branch} mono />
        <InfoField label="HEAD" value={snapshot.project.head} mono />
        <div className="col-span-2 md:col-span-4">
          <p className="text-forge-text-muted">Workspace</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="font-mono text-forge-text-primary">{workspaceLabel(snapshot.project.rootPath)}</span>
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-4 px-1.5 py-0.5 text-[11px] text-forge-accent hover:bg-forge-accent/10"
              aria-expanded={showRootPath}
              onClick={() => setShowRootPath((visible) => !visible)}
            >
              {showRootPath ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
              {showRootPath ? 'Hide full path' : 'Show full path'}
            </button>
          </div>
          {showRootPath && <code className="mt-2 block break-all rounded-6 bg-forge-secondary-surface p-2 text-[11px] text-forge-text-secondary">{snapshot.project.rootPath}</code>}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 border-t border-forge-border-subtle/50 pt-4 text-xs md:grid-cols-4">
        <InfoField label="Health" value={snapshot.health.status} badge />
        <InfoField label="Health source" value={snapshot.health.source} mono />
        <InfoField label="Protocol" value={`v${snapshot.protocol.protocolVersion} · schema v${snapshot.protocol.schemaVersion}`} mono />
        <InfoField label="Compatibility" value={`${snapshot.protocol.compatible ? 'Compatible' : 'Incompatible'} · ${readable(snapshot.protocol.compatibilityMode)}`} mono />
        <InfoField label="Canonical task status" value={canonicalStatus.label} mono />
        <InfoField label="Snapshot observed" value={formatDate(snapshot.updatedAt)} />
        <InfoField
          label="Last monitored change"
          value={watcherStatus.lastEventType && watcherStatus.lastEventAt ? `${watcherStatus.lastEventType}${watcherStatus.lastTaskId ? ` · ${watcherStatus.lastTaskId}` : ''} · ${formatDate(watcherStatus.lastEventAt)}` : 'Waiting for a file change'}
        />
        <InfoField label="ForgeLoop package" value={snapshot.protocol.packageVersion} mono />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 border-t border-forge-border-subtle/50 pt-4 text-xs md:grid-cols-4">
        <InfoField label="Tasks observed" value={String(snapshot.observations.taskCount)} />
        <InfoField label="Evidence covered" value={String(snapshot.observations.evidence.covered)} />
        <InfoField label="Continuity records" value={`${snapshot.observations.continuity.present}/${snapshot.observations.taskCount}`} />
        <InfoField label="Artifact validation errors" value={String(snapshot.observations.artifactValidationErrors)} />
      </div>

      {canonicalStatus.reasons.length > 0 && (
        <div className="mt-4 rounded-8 border border-forge-warning/20 bg-forge-warning/5 p-3">
          <p className="text-xs font-semibold text-forge-warning">Canonical freshness reasons</p>
          <p className="mt-1 text-xs text-forge-text-secondary">{canonicalStatus.reasons.join(' · ')}</p>
        </div>
      )}

      {watcherStatus.error && (
        <div className="mt-4 flex items-start gap-2 rounded-8 border border-forge-danger/20 bg-forge-danger/5 p-3 text-xs text-forge-danger">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>File watcher error: {watcherStatus.error}</span>
        </div>
      )}

      {warnings.length > 0 && (
        <div className="mt-4 rounded-8 border border-forge-border-subtle bg-forge-secondary-surface p-3">
          <p className="text-xs font-semibold text-forge-text-muted">Detection and snapshot notes</p>
          <ul className="mt-2 space-y-1">
            {warnings.map((warning) => <li key={warning} className="text-xs text-forge-text-secondary">{warning}</li>)}
          </ul>
        </div>
      )}
    </section>
  );
}

function InfoField({ label, value, mono = false, badge = false }: { label: string; value?: string | null; mono?: boolean; badge?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-forge-text-muted">{label}</p>
      {badge && value ? <div className="mt-1"><StatusBadge status={value} /></div> : <p className={cn('mt-1 truncate text-forge-text-primary', mono && 'font-mono')}>{readable(value)}</p>}
    </div>
  );
}
