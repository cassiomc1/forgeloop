import type { TaskSummary, ForgeLoopPhase } from '@shared/domain';
import type { TaskAuditSummary } from '@shared/audit';
import { cn } from '../../lib/utils';
import { classifyDemoScenario } from '../../lib/demo-scenarios';
import { DemoScenarioBadge } from '../demo/DemoScenarioBadge';
import { OwnershipBadge } from '../task/OwnershipBadge';
import { ChevronRight, AlertTriangle } from 'lucide-react';

interface TaskRowProps {
  task: TaskSummary;
  auditSummary?: TaskAuditSummary;
  isActive?: boolean;
  isDemoProject?: boolean;
  onClick?: () => void;
}

export function TaskRow({ task, auditSummary, isActive, isDemoProject, onClick }: TaskRowProps) {
  const demoScenario = isDemoProject
    ? classifyDemoScenario(task)
    : ({ kind: 'unknown' } as const);
  const abandoned = task.recovery?.classificationAtRecovery === 'ABANDONED';
  const getPhaseIcon = (phase: ForgeLoopPhase) => {
    switch (phase) {
      case 'COMPLETE':
        return <span className="text-forge-success">✓</span>;
      case 'BLOCKED':
        return <span className="text-forge-danger">✗</span>;
      case 'EXECUTING':
      case 'VERIFYING':
        return <span className="text-forge-accent animate-pulse-subtle">●</span>;
      default:
        return <span className="text-forge-text-muted">○</span>;
    }
  };

  return (
    <button
      className={cn(
        'w-full px-4 py-3 flex items-center gap-4 hover:bg-forge-hover-surface transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forge-accent focus-visible:ring-inset',
        isActive && 'bg-forge-accent/5'
      )}
      onClick={onClick}
    >
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <span className="text-sm">{getPhaseIcon(task.phase)}</span>
        <div className="min-w-0">
          <p className="text-sm font-medium text-forge-text-primary truncate">{task.taskId}</p>
          {task.objective && (
            <p className="text-xs text-forge-text-muted truncate mt-0.5 max-w-[300px]">{task.objective}</p>
          )}
          {task.artifactErrors && task.artifactErrors.length > 0 && <p className="text-xs text-forge-warning mt-1">Artifact validation warning</p>}
          {task.gateErrors && task.gateErrors.length > 0 && <p className="text-xs text-forge-danger mt-1">Gate validation error</p>}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <span className={cn('phase-badge', {
          'phase-badge-completed': task.phase === 'COMPLETE',
          'phase-badge-current': task.phase === 'EXECUTING' || task.phase === 'VERIFYING',
          'phase-badge-blocked': task.phase === 'BLOCKED',
          'phase-badge-pending': !['COMPLETE', 'EXECUTING', 'VERIFYING', 'BLOCKED'].includes(task.phase),
        })}>
          {task.phase}
        </span>

        {/* Abandonment is a distinct terminal-for-the-task outcome: it is never
            completion, publication, or evidence. Render it as its own label. */}
        {abandoned && (
          <span className="phase-badge phase-badge-failed" title="ForgeLoop TASK_ABANDONED — not completed, claims released by recovery" aria-label="Abandoned task">
            ABANDONED
          </span>
        )}

        <OwnershipBadge state={task.operationalState} />

        {auditSummary ? (
          <span className="text-xs text-forge-text-muted" aria-label={`Canonical audit ${auditSummary.status}; ${auditSummary.findingCount} findings`}>
            Audit {auditSummary.status} · {auditSummary.findingCount} finding{auditSummary.findingCount === 1 ? '' : 's'}
          </span>
        ) : (
          <span className="text-xs text-forge-text-muted" aria-label="Canonical audit pending">Audit pending</span>
        )}

        <DemoScenarioBadge match={demoScenario} />

        {task.evidenceCoverage && (
          <span title="ForgeLoopAudit Coverage Score" aria-label="ForgeLoopAudit Coverage Score" className="text-xs text-forge-text-muted font-mono w-10 text-right">
            {task.evidenceCoverage.coveragePercent}%
          </span>
        )}

        {task.blockers.length > 0 && (
          <span className="flex items-center gap-1 text-xs text-forge-danger">
            <AlertTriangle className="w-3 h-3" />
            {task.blockers.length}
          </span>
        )}

        {task.verificationCycle && task.verificationCycle > 1 && (
          <span className="text-xs text-forge-text-muted font-mono">
            C{task.verificationCycle}
          </span>
        )}

        <ChevronRight className="w-4 h-4 text-forge-text-muted" />
      </div>
    </button>
  );
}
