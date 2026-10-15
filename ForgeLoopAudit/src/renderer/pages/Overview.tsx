import { useState, useEffect } from 'react';
import type { ProjectDetectionResult, ProjectSnapshot, TaskSummary, TaskActionsView, TrajectoryMetricsView, ExecutionProfileContextView, WatcherStatus } from '@shared/domain';
import { MetricCard } from '../components/ui/MetricCard';
import { StatusBadge } from '../components/ui/StatusBadge';
import { TaskRow } from '../components/tasks/TaskRow';
import { NextSafeAction } from '../components/ui/NextSafeAction';
import { cn } from '../lib/utils';
import { Provenance } from '../components/ui/Provenance';
import { formatEvidenceSummary } from '../lib/evidence-display';
import { TaskBoundariesPanel } from '../components/tasks/TaskBoundariesPanel';
import { ExecutionProfilePanel } from '../components/tasks/ExecutionProfilePanel';
import { ProjectInformation } from '../components/project/ProjectInformation';
import { auditApi } from '../lib/audit-client';
import {
  Activity,
  AlertTriangle,
  CheckCircle,
  Shield,
  Zap,
  Box,
  ChevronRight,
} from 'lucide-react';

interface OverviewProps {
  snapshot: ProjectSnapshot;
  detection?: ProjectDetectionResult | null;
  watcherStatus?: WatcherStatus;
  onTaskSelect?: (taskId: string) => void;
  onViewAllTasks?: () => void;
  genericTaskRefreshToken?: number;
  actionsRefreshToken?: number;
  taskBoundaryRefreshTokens?: {
    workspaceBinding?: number;
    handoffs?: number;
    responsibility?: number;
  };
  selectedTaskId?: string | null;
}

export function Overview({ snapshot, detection, watcherStatus = { active: false }, onTaskSelect, onViewAllTasks, genericTaskRefreshToken = 0, actionsRefreshToken = 0, taskBoundaryRefreshTokens, selectedTaskId }: OverviewProps) {
  const [activeTask, setActiveTask] = useState<TaskSummary | null>(null);
  const [canonicalMetrics, setCanonicalMetrics] = useState<TrajectoryMetricsView | null>(null);
  const [canonicalActions, setCanonicalActions] = useState<TaskActionsView | null>(null);
  const [executionProfileContext, setExecutionProfileContext] = useState<ExecutionProfileContextView | null>(null);

  useEffect(() => {
    if (snapshot.activeTaskId) {
      const task = snapshot.tasks.find((t) => t.taskId === snapshot.activeTaskId);
      setActiveTask(task || null);
    } else if (snapshot.tasks.length > 0) {
      setActiveTask(snapshot.tasks[0]);
    }
  }, [snapshot]);

  useEffect(() => {
    if (!activeTask) {
      setCanonicalMetrics(null);
      setCanonicalActions(null);
      setExecutionProfileContext(null);
      return;
    }
    let cancelled = false;
    const featureSupport = snapshot.protocol.featureSupport;
    Promise.all([
      featureSupport?.trajectoryMetrics === true ? auditApi.getTaskMetrics(activeTask.taskId) : Promise.resolve(null),
      featureSupport?.durableActions === true ? auditApi.getTaskActions(activeTask.taskId) : Promise.resolve(null),
      auditApi.getTaskExecutionProfileContext(activeTask.taskId),
    ]).then(([metrics, actions, context]) => {
      if (!cancelled) {
        setCanonicalMetrics(metrics);
        setCanonicalActions(actions);
        setExecutionProfileContext(context);
      }
    }).catch(() => {
      if (!cancelled) {
        setCanonicalMetrics(null);
        setCanonicalActions(null);
        setExecutionProfileContext(null);
      }
    });
    return () => { cancelled = true; };
  }, [activeTask, snapshot.protocol.featureSupport, genericTaskRefreshToken, actionsRefreshToken]);

  const activeTasks = snapshot.tasks.filter((t) => t.phase !== 'COMPLETE' && t.phase !== 'BLOCKED');
  const blockedTasks = snapshot.tasks.filter((t) => t.phase === 'BLOCKED');
  const completedTasks = snapshot.tasks.filter((t) => t.phase === 'COMPLETE');
  const totalTasks = snapshot.tasks.length;
  const boundaryTask = (selectedTaskId ? snapshot.tasks.find((task) => task.taskId === selectedTaskId) : undefined) || activeTask;

  const avgCoverage = totalTasks > 0
    ? Math.round(snapshot.tasks.reduce((acc, t) => acc + t.evidenceCoverage.coveragePercent, 0) / totalTasks)
    : 0;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-forge-text-primary">Project Overview</h1>
          <p className="text-sm text-forge-text-muted mt-1">Real-time engineering state for {snapshot.project.name}</p>
        </div>
        <div className="flex items-center gap-3">
          <StatusBadge status={snapshot.health.status} />
          <span className="text-xs text-forge-text-muted">Source: {snapshot.health.source === 'FORGELOOP_STATUS_AGGREGATE' ? 'ForgeLoop task status aggregate' : snapshot.health.source}</span>
          <Provenance source="ForgeLoop status aggregate" authority="FORGELOOP" observedAt={snapshot.updatedAt} />
        </div>
      </div>

      <ProjectInformation snapshot={snapshot} detection={detection} watcherStatus={watcherStatus} />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard
          label="Active Tasks"
          value={activeTasks.length}
          icon={<Activity className="w-4 h-4" />}
          color="accent"
        />
        <MetricCard
          label="Blocked"
          value={blockedTasks.length}
          icon={<AlertTriangle className="w-4 h-4" />}
          color="danger"
          alert={blockedTasks.length > 0}
        />
        <MetricCard
          label="Completed"
          value={completedTasks.length}
          icon={<CheckCircle className="w-4 h-4" />}
          color="success"
        />
        <MetricCard
          label="ForgeLoopAudit Coverage Score"
          value={`${avgCoverage}%`}
          icon={<Shield className="w-4 h-4" />}
          color="info"
        />
      </div>

      {snapshot.protocol.featureSupport && (snapshot.protocol.featureSupport.trajectoryMetrics || snapshot.protocol.featureSupport.durableActions) && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MetricCard label="Canonical trajectory cycles" value={canonicalMetric(canonicalMetrics?.metrics?.trajectory, 'verificationCycles')} icon={<Activity className="w-4 h-4" />} color="info" />
          <MetricCard label="No effective gain" value={canonicalMetric(canonicalMetrics?.metrics?.trajectory, 'noEffectiveInformationGainCycles')} icon={<AlertTriangle className="w-4 h-4" />} color="warning" />
          <MetricCard label="Trusted actions" value={canonicalActions?.readiness?.satisfied ?? 'Unknown'} icon={<CheckCircle className="w-4 h-4" />} color="success" />
          <MetricCard label="Ambiguous actions" value={canonicalActions?.readiness?.ambiguous ?? 'Unknown'} icon={<Shield className="w-4 h-4" />} color="danger" alert={(canonicalActions?.readiness?.ambiguous ?? 0) > 0} />
        </div>
      )}

      {boundaryTask && (
        <TaskBoundariesPanel
          task={boundaryTask}
          featureSupport={snapshot.protocol.featureSupport}
          workspaceBindingRefreshToken={taskBoundaryRefreshTokens?.workspaceBinding}
          handoffRefreshToken={taskBoundaryRefreshTokens?.handoffs}
          responsibilityRefreshToken={taskBoundaryRefreshTokens?.responsibility}
        />
      )}

      {boundaryTask && (
        <ExecutionProfilePanel
          context={executionProfileContext}
          metrics={canonicalMetrics}
          observedAt={snapshot.updatedAt}
        />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-forge-primary-surface border border-forge-border-subtle rounded-10">
          <div className="px-4 py-3 border-b border-forge-border-subtle flex items-center justify-between">
            <h2 className="text-sm font-semibold text-forge-text-primary flex items-center gap-2">
              <Box className="w-4 h-4 text-forge-text-muted" />
              Active Tasks
            </h2>
            <span className="text-xs text-forge-text-muted">{activeTasks.length} of {totalTasks}</span>
          </div>
          <div className="divide-y divide-forge-border-subtle/50">
            {activeTasks.length === 0 ? (
              <div className="p-6 text-center text-sm text-forge-text-muted">No active tasks</div>
            ) : (
              activeTasks.slice(0, 5).map((task) => (
                <TaskRow
                  key={task.taskId}
                  task={task}
                  isActive={task.taskId === snapshot.activeTaskId}
                  onClick={() => onTaskSelect?.(task.taskId)}
                />
              ))
            )}
          </div>
          {activeTasks.length > 5 && (
            <div className="p-3 border-t border-forge-border-subtle">
              <button onClick={onViewAllTasks} className="text-xs text-forge-accent hover:text-forge-accent-hover flex items-center gap-1">
                View all {activeTasks.length} active tasks <ChevronRight className="w-3 h-3" />
              </button>
            </div>
          )}
        </div>

        <div className="space-y-6">
          {activeTask && (
            <NextSafeAction task={activeTask} />
          )}

          <div className="bg-forge-primary-surface border border-forge-border-subtle rounded-10 p-4">
            <h3 className="text-xs font-semibold text-forge-text-muted uppercase tracking-wider mb-3">Project Health</h3>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-forge-text-secondary flex items-center gap-2">
                  <span className={cn('w-1.5 h-1.5 rounded-full', snapshot.protocol.compatible ? 'bg-forge-success' : 'bg-forge-danger')} />
                  Protocol
                </span>
                <span className="text-forge-text-primary">{snapshot.protocol.compatible ? '✓' : '✗'}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-forge-text-secondary flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-forge-text-muted" />
                  Observed tasks
                </span>
                <span className="text-forge-text-primary">{snapshot.observations.taskCount}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-forge-text-secondary flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-forge-text-muted" />
                  Evidence coverage
                </span>
                <span className="text-forge-text-primary">{formatEvidenceSummary(snapshot.observations.evidence)}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-forge-text-secondary flex items-center gap-2">
                  <span className={cn('w-1.5 h-1.5 rounded-full', snapshot.policy?.overallStatus === 'valid' ? 'bg-forge-success' : snapshot.policy?.overallStatus === 'invalid' ? 'bg-forge-danger' : 'bg-forge-text-muted')} />
                  Policy
                </span>
                <span className="text-forge-text-primary">{snapshot.policy?.overallStatus === 'valid' ? '✓' : snapshot.policy?.overallStatus === 'invalid' ? '✗' : '?'}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-forge-text-secondary flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-forge-text-muted" />
                  Continuity records
                </span>
                <span className="text-forge-text-primary">{snapshot.observations.continuity.present}/{snapshot.observations.taskCount}</span>
              </div>
              <div className="flex items-center justify-between text-sm pt-2 border-t border-forge-border-subtle/50">
                <span className="text-forge-text-secondary flex items-center gap-2">
                  <span className={cn('w-1.5 h-1.5 rounded-full', snapshot.observations.ownership.inconsistentCount > 0 ? 'bg-forge-danger' : 'bg-forge-success')} />
                  Active ownership
                </span>
                <span className="text-forge-text-primary">{snapshot.observations.ownership.activeCount}</span>
              </div>
              {snapshot.observations.ownership.recoveredResumeRequiredCount > 0 && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-forge-text-secondary flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-forge-warning" />
                    Recovered — resume required
                  </span>
                  <span className="text-forge-warning">{snapshot.observations.ownership.recoveredResumeRequiredCount}</span>
                </div>
              )}
              {snapshot.observations.ownership.inconsistentCount > 0 && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-forge-text-secondary flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-forge-danger" />
                    Ownership inconsistent
                  </span>
                  <span className="text-forge-danger">{snapshot.observations.ownership.inconsistentCount}</span>
                </div>
              )}
              {snapshot.observations.ownership.unavailableCount > 0 && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-forge-text-secondary flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-forge-text-muted" />
                    Ownership unavailable
                  </span>
                  <span className="text-forge-text-muted">{snapshot.observations.ownership.unavailableCount}</span>
                </div>
              )}
            </div>
          </div>

          <div className="bg-forge-primary-surface border border-forge-border-subtle rounded-10 p-4">
            <h3 className="text-xs font-semibold text-forge-text-muted uppercase tracking-wider mb-3">Sessions</h3>
            <div className="space-y-2">
              {snapshot.sessions.length === 0 ? (
                <p className="text-xs text-forge-text-muted">No sessions recorded</p>
              ) : (
                snapshot.sessions.slice(0, 3).map((session) => (
                  <div key={session.id} className="flex items-center justify-between text-sm">
                    <span className="font-mono text-forge-text-secondary truncate max-w-[120px]">{session.id.slice(0, 8)}</span>
                    <span className="text-xs text-forge-text-muted">{session.activationMarker || session.createdAt || 'Unknown'}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {snapshot.tasks.some((task) => task.artifactErrors && task.artifactErrors.length > 0) && (
        <div className="bg-forge-warning/5 border border-forge-warning/20 rounded-10 p-4">
          <h2 className="text-sm font-semibold text-forge-warning">Artifact validation warning</h2>
          <p className="text-xs text-forge-text-secondary mt-1">An invalid artifact was detected. The last valid task snapshot is retained while the artifact is repaired.</p>
        </div>
      )}

      {snapshot.tasks.some((task) => task.gateErrors && task.gateErrors.length > 0) && (
        <div className="bg-forge-danger/5 border border-forge-danger/20 rounded-10 p-4">
          <h2 className="text-sm font-semibold text-forge-danger">Gate validation error</h2>
          <p className="text-xs text-forge-text-secondary mt-1">A gate artifact is invalid and was not treated as a satisfied or absent gate.</p>
        </div>
      )}

      {snapshot.tasks.some((task) => task.protocolConflicts && task.protocolConflicts.length > 0) && (
        <div className="bg-forge-danger/5 border border-forge-danger/20 rounded-10 p-4">
          <h2 className="text-sm font-semibold text-forge-danger">CLI/artifact contradiction</h2>
          <p className="text-xs text-forge-text-secondary mt-1">ForgeLoop artifacts and the optional CLI observation disagree. Review the authoritative artifact before acting.</p>
        </div>
      )}

      {snapshot.tasks.some((t) => t.nextAction) && (
        <div className="bg-forge-primary-surface border border-forge-border-subtle rounded-10">
          <div className="px-4 py-3 border-b border-forge-border-subtle">
            <h2 className="text-sm font-semibold text-forge-text-primary flex items-center gap-2">
              <Zap className="w-4 h-4 text-forge-accent" />
              Next Safe Actions
            </h2>
          </div>
          <div className="divide-y divide-forge-border-subtle/50">
            {snapshot.tasks
              .filter((t) => t.nextAction && t.phase !== 'COMPLETE')
              .slice(0, 3)
              .map((task) => (
                <div key={task.taskId} className="px-4 py-3 flex items-center gap-4">
                  <span className="font-mono text-xs text-forge-text-muted w-24 truncate">{task.taskId.slice(0, 12)}</span>
                  <span className={cn('text-xs font-medium', {
                    'text-forge-accent': task.nextAction?.type === 'progress',
                    'text-forge-warning': task.nextAction?.type === 'recovery',
                    'text-forge-danger': task.nextAction?.type === 'blocker' || task.nextAction?.type === 'inconsistency',
                  })}>
                    {task.nextAction?.action}
                  </span>
                  {task.nextAction?.expectedPhase && (
                    <span className="text-xs text-forge-text-muted ml-auto">
                      → {task.nextAction.expectedPhase}
                    </span>
                  )}
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

function canonicalMetric(value: unknown, key: string): string | number {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'Unknown';
  const metric = (value as Record<string, unknown>)[key];
  return typeof metric === 'number' || typeof metric === 'string' ? metric : 'Unknown';
}
