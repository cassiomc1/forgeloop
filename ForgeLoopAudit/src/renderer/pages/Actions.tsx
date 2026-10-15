import { useEffect, useState } from 'react';
import type { ProjectSnapshot, TaskActionsView, TaskSummary, DurableActionView } from '@shared/domain';
import { EmptyState } from '../components/ui/EmptyState';
import { ActionStateBadge } from '../components/actions/ActionStateBadge';
import { ApprovalBadge } from '../components/actions/ApprovalBadge';
import { ActionDetail } from '../components/actions/ActionDetail';
import { ActionReadinessSummary } from '../components/actions/ActionReadinessSummary';
import { cn } from '../lib/utils';
import { AlertTriangle, Shield } from 'lucide-react';
import { auditApi } from '../lib/audit-client';

interface ActionsProps {
  snapshot: ProjectSnapshot;
  selectedTaskId?: string | null;
  actionsRefreshToken?: number;
  onSelectedTaskChange?: (taskId: string) => void;
}

export function Actions({ snapshot, selectedTaskId, actionsRefreshToken = 0, onSelectedTaskChange }: ActionsProps) {
  const [selectedTask, setSelectedTask] = useState<TaskSummary | null>(snapshot.tasks.find((task) => task.taskId === selectedTaskId) || snapshot.tasks.find((task) => task.taskId === snapshot.activeTaskId) || snapshot.tasks[0] || null);
  const [view, setView] = useState<TaskActionsView | null>(null);
  const [selectedAction, setSelectedAction] = useState<DurableActionView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSelectedTask(snapshot.tasks.find((task) => task.taskId === selectedTaskId) || snapshot.tasks.find((task) => task.taskId === snapshot.activeTaskId) || snapshot.tasks[0] || null);
  }, [snapshot, selectedTaskId]);

  useEffect(() => {
    if (!selectedTask || snapshot.protocol.featureSupport?.durableActions !== true) {
      setView(null);
      setSelectedAction(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    auditApi.getTaskActions(selectedTask.taskId)
      .then((result) => {
        if (!cancelled) {
          setView(result);
          setSelectedAction(result.actions[0] || null);
          if (result.error) setError(result.error.message);
        }
      })
      .catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'Canonical actions are unavailable.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [selectedTask, snapshot.protocol.featureSupport?.durableActions, actionsRefreshToken]);

  if (snapshot.tasks.length === 0) return <EmptyState title="No tasks available" description="Open a ForgeLoop project with tasks to inspect canonical actions." />;

  const featureAvailable = snapshot.protocol.featureSupport?.durableActions === true;
  const pendingCount = view?.actions.filter((action) => action.state === 'PROPOSED' || action.state === 'AUTHORIZED' || action.state === 'STARTED' || action.state === 'COMMITTED').length ?? 0;
  const verifiedCount = view?.actions.filter((action) => action.state === 'VERIFIED').length ?? 0;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between gap-4">
        <div><h1 className="text-xl font-semibold text-forge-text-primary">Actions</h1><p className="text-sm text-forge-text-muted mt-1">Canonical durable actions and approvals, read-only</p></div>
        <select className="input w-48" value={selectedTask?.taskId || ''} onChange={(event) => { const task = snapshot.tasks.find((entry) => entry.taskId === event.target.value) || null; setSelectedTask(task); if (task) onSelectedTaskChange?.(task.taskId); }}>
          {snapshot.tasks.map((task) => <option key={task.taskId} value={task.taskId}>{task.taskId}</option>)}
        </select>
      </div>

      {!featureAvailable ? (
        <div className="bg-forge-primary-surface border border-forge-warning/30 rounded-10 p-8 text-center">
          <Shield className="w-8 h-8 mx-auto mb-3 text-forge-warning" />
          <p className="text-sm font-medium text-forge-text-primary">Durable actions are not available</p>
          <p className="mt-2 text-xs text-forge-text-muted">Not available with the bundled ForgeLoop capability set. ForgeLoopAudit will not infer action state from raw files.</p>
        </div>
      ) : (
        <>
          {error && <div className="border border-forge-danger/30 bg-forge-danger/10 rounded-8 p-3 text-sm text-forge-danger">{error}</div>}
          {loading ? <div className="card p-8 text-center text-sm text-forge-text-muted">Loading canonical actions…</div> : view && (
            <>
              <ActionReadinessSummary readiness={view.readiness} actionCount={view.actions.length} pendingCount={pendingCount} />
              <div className="bg-forge-primary-surface border border-forge-border-subtle rounded-10 p-4 text-xs text-forge-text-muted flex flex-wrap gap-x-5 gap-y-2">
                <span>Raw VERIFIED state: <strong className="text-forge-success">{verifiedCount}</strong></span>
                <span>Trusted readiness is calculated by ForgeLoop: <strong className="text-forge-text-primary">{view.readiness?.satisfied ?? 'Unknown'}</strong></span>
                <span>Source: <strong className="text-forge-text-primary">{view.source}</strong></span>
              </div>
              {view.warnings && view.warnings.length > 0 && (
                <div className="border border-forge-warning/40 bg-forge-warning/10 rounded-8 p-3 text-xs text-forge-warning space-y-1">
                  {view.warnings.map((w) => (
                    <p key={w.code}>{w.message}</p>
                  ))}
                </div>
              )}
              {view.actions.some((action) => action.state === 'COMMIT_UNKNOWN') && <div className="border border-forge-danger/40 bg-forge-danger/10 rounded-10 p-4 text-sm text-forge-danger flex items-start gap-3"><AlertTriangle className="w-5 h-5 shrink-0" /><div><strong>COMMIT_UNKNOWN requires external reconciliation.</strong><p className="mt-1 text-xs">This ForgeLoopAudit only displays the canonical state. No retry, reconcile, approval, or authority action is exposed here.</p></div></div>}
              <div className="grid grid-cols-1 xl:grid-cols-[1.3fr_1fr] gap-6">
                <div className="bg-forge-primary-surface border border-forge-border-subtle rounded-10 overflow-hidden">
                  <div className="px-4 py-3 border-b border-forge-border-subtle"><h2 className="text-sm font-semibold text-forge-text-primary">Durable actions</h2></div>
                  {view.actions.length === 0 ? <p className="p-6 text-sm text-forge-text-muted">No canonical actions recorded for this task.</p> : <div className="divide-y divide-forge-border-subtle/50">{view.actions.map((action) => <button key={action.actionId} className={cn('w-full text-left px-4 py-3 hover:bg-forge-hover-surface transition-colors', selectedAction?.actionId === action.actionId && 'bg-forge-accent/5')} onClick={() => setSelectedAction(action)}><div className="flex items-center justify-between gap-3"><span className="font-mono text-xs text-forge-text-primary">{action.actionId}</span><ActionStateBadge state={action.state} /></div><div className="mt-1 flex items-center gap-3 text-xs text-forge-text-muted"><span>{action.effectClass}</span><span>{action.capability || 'Capability unknown'}</span>{action.requiredForCompletion && <span className="text-forge-warning">Required</span>}</div></button>)}</div>}
                </div>
                <div className="bg-forge-primary-surface border border-forge-border-subtle rounded-10 overflow-hidden"><ActionDetail action={selectedAction} /></div>
              </div>
              <div className="bg-forge-primary-surface border border-forge-border-subtle rounded-10 overflow-hidden">
                <div className="px-4 py-3 border-b border-forge-border-subtle"><h2 className="text-sm font-semibold text-forge-text-primary">Approvals</h2></div>
                {view.approvalsAvailable === false ? <p className="p-5 text-sm text-forge-text-muted">Canonical approvals are unavailable for this task.</p> : view.approvals.length === 0 ? <p className="p-5 text-sm text-forge-text-muted">No canonical approvals recorded for this task.</p> : <div className="divide-y divide-forge-border-subtle/50">{view.approvals.map((approval) => <div key={approval.approvalId} className="px-4 py-3 flex flex-wrap items-center gap-3"><span className="font-mono text-xs text-forge-text-primary">{approval.approvalId}</span><ApprovalBadge status={approval.status} /><span className="text-xs text-forge-text-muted">{approval.actionId || 'Action unknown'}</span><span className="text-xs text-forge-text-muted">{approval.capability || 'Capability unknown'}</span><span className="text-xs text-forge-text-secondary ml-auto">{approval.reason || 'No reason recorded'}</span></div>)}</div>}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
