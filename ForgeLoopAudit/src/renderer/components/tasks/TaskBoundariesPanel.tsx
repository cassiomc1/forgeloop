import { useEffect, useState } from 'react';
import type {
  CanonicalHandoffView,
  ForgeLoopFeatureSupport,
  ResponsibilityView,
  TaskHandoffsView,
  TaskSummary,
  WorkspaceBindingView,
} from '@shared/domain';
import { AlertTriangle, CheckCircle, CircleHelp, GitBranch, Link2, Shield, UserRound } from 'lucide-react';
import { OwnershipBadge } from '../task/OwnershipBadge';
import { cn } from '../../lib/utils';
import { HandoffAcceptanceBadge, HandoffAcceptanceDetail } from './HandoffAcceptanceBadge';
import { auditApi } from '../../lib/audit-client';

interface TaskBoundariesPanelProps {
  task: TaskSummary;
  featureSupport?: ForgeLoopFeatureSupport;
  workspaceBindingRefreshToken?: number;
  handoffRefreshToken?: number;
  responsibilityRefreshToken?: number;
}

export interface BoundaryData {
  workspace: WorkspaceBindingView;
  responsibility: ResponsibilityView;
  handoffs: TaskHandoffsView;
}

const unavailableWorkspace = (advertised: boolean): WorkspaceBindingView => ({
  available: false,
  source: 'UNAVAILABLE',
  status: 'UNAVAILABLE',
  taskId: null,
  path: null,
  bindingFingerprint: null,
  mode: null,
  branchAtBind: null,
  headAtBind: null,
  error: { code: 'E_FEATURE_UNAVAILABLE', message: advertised ? 'Canonical workspace binding is unavailable.' : 'Workspace binding is not advertised by this ForgeLoop build.' },
});

const unavailableResponsibility = (advertised: boolean): ResponsibilityView => ({
  available: false,
  source: 'UNAVAILABLE',
  status: 'UNKNOWN',
  label: null,
  allowedPaths: [],
  readOnlyPaths: [],
  requiredCheckIds: [],
  frozenInputs: null,
  changedPaths: [],
  fingerprint: null,
  errors: [{ code: 'E_FEATURE_UNAVAILABLE', message: advertised ? 'Canonical responsibility is unavailable.' : 'Responsibility constraints are not advertised by this ForgeLoop build.' }],
});

const unavailableHandoffs = (advertised: boolean): TaskHandoffsView => ({
  available: false,
  source: 'UNAVAILABLE',
  count: null,
  handoffs: [],
  error: { code: 'E_FEATURE_UNAVAILABLE', message: advertised ? 'Canonical handoffs are unavailable.' : 'Canonical handoffs are not advertised by this ForgeLoop build.' },
});

function featureEnabled(featureSupport: ForgeLoopFeatureSupport | undefined, key: keyof ForgeLoopFeatureSupport): boolean {
  return featureSupport ? featureSupport[key] === true : true;
}

function BoundaryBadge({ label, tone = 'neutral' }: { label: string; tone?: 'success' | 'warning' | 'danger' | 'neutral' }) {
  const classes = {
    success: 'bg-forge-success/10 text-forge-success',
    warning: 'bg-forge-warning/10 text-forge-warning',
    danger: 'bg-forge-danger/10 text-forge-danger',
    neutral: 'bg-forge-border-subtle text-forge-text-muted',
  }[tone];
  return <span className={cn('inline-flex items-center gap-1 rounded-6 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide', classes)}>{label}</span>;
}

function toneForWorkspace(status: WorkspaceBindingView['status']): 'success' | 'warning' | 'danger' | 'neutral' {
  if (status === 'MATCH') return 'success';
  if (status === 'MISMATCH') return 'danger';
  if (status === 'INVALID') return 'danger';
  if (status === 'UNBOUND') return 'neutral';
  return 'warning';
}

function toneForResponsibility(status: ResponsibilityView['status']): 'success' | 'warning' | 'danger' | 'neutral' {
  if (status === 'VALID') return 'success';
  if (status === 'INVALID') return 'danger';
  if (status === 'NOT_APPLICABLE') return 'neutral';
  return 'warning';
}

function valueOrUnknown(value: string | null | undefined): string {
  return value || 'Unknown / not verified';
}

function compactHash(value: string | null | undefined): string {
  if (!value) return 'Not recorded';
  return value.length > 18 ? `${value.slice(0, 10)}…${value.slice(-8)}` : value;
}

function BoundedList({ label, values }: { label: string; values: string[] }) {
  const visible = values.slice(0, 6);
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-forge-text-muted">{label}</p>
      {visible.length === 0 ? <p className="mt-1 text-xs text-forge-text-muted">None recorded</p> : (
        <ul className="mt-1 space-y-1">
          {visible.map((value) => <li key={value} className="break-all text-xs font-mono text-forge-text-secondary">{value}</li>)}
          {values.length > visible.length && <li className="text-xs text-forge-text-muted">+{values.length - visible.length} more</li>}
        </ul>
      )}
    </div>
  );
}

function HandoffRow({ handoff }: { handoff: CanonicalHandoffView }) {
  return (
    <div className="rounded-8 bg-forge-secondary-surface p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-forge-text-primary">{handoff.handoffId || 'Unnamed handoff'}</span>
        <HandoffAcceptanceBadge acceptance={handoff.acceptance} />
        <span className="text-[11px] text-forge-text-muted">{handoff.createdAt || 'Unknown time'}</span>
        {handoff.phase && <span className="text-[11px] text-forge-text-muted">· {handoff.phase}</span>}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-forge-text-secondary md:grid-cols-4">
        <span>Revision: <strong>{handoff.revision ?? 'Unknown'}</strong></span>
        <span>Cycle: <strong>{handoff.verificationCycle ?? 'Unknown'}</strong></span>
        <span>Recipient: <strong>{handoff.recipientHint || 'Not recorded'}</strong></span>
        <span>Digest: <strong className="font-mono">{compactHash(handoff.digest)}</strong></span>
      </div>
      {handoff.note && <p className="mt-2 text-xs text-forge-text-muted">Note: {handoff.note}</p>}
      <div className="mt-2 border-t border-forge-border-subtle/60 pt-2"><HandoffAcceptanceDetail acceptance={handoff.acceptance} /></div>
    </div>
  );
}

export function TaskBoundariesPanel({
  task,
  featureSupport,
  workspaceBindingRefreshToken = 0,
  handoffRefreshToken = 0,
  responsibilityRefreshToken = 0,
}: TaskBoundariesPanelProps) {
  const [workspace, setWorkspace] = useState<WorkspaceBindingView | null>(null);
  const [responsibility, setResponsibility] = useState<ResponsibilityView | null>(null);
  const [handoffs, setHandoffs] = useState<TaskHandoffsView | null>(null);
  const workspaceAdvertised = featureEnabled(featureSupport, 'workspaceBinding');
  const handoffsAdvertised = featureEnabled(featureSupport, 'canonicalHandoffs');
  const responsibilityAdvertised = featureEnabled(featureSupport, 'responsibilityConstraints');

  useEffect(() => {
    let cancelled = false;
    const api = auditApi;
    const workspacePromise = workspaceAdvertised && typeof api?.getTaskWorkspaceBinding === 'function'
      ? api.getTaskWorkspaceBinding(task.taskId).catch(() => unavailableWorkspace(true))
      : Promise.resolve(unavailableWorkspace(workspaceAdvertised));
    workspacePromise.then((result) => { if (!cancelled) setWorkspace(result); });

    return () => { cancelled = true; };
  }, [task.taskId, workspaceAdvertised, workspaceBindingRefreshToken]);

  useEffect(() => {
    let cancelled = false;
    const api = auditApi;
    const handoffsPromise = handoffsAdvertised && typeof api?.getTaskHandoffs === 'function'
      ? api.getTaskHandoffs(task.taskId).catch(() => unavailableHandoffs(true))
      : Promise.resolve(unavailableHandoffs(handoffsAdvertised));
    handoffsPromise.then((result) => { if (!cancelled) setHandoffs(result); });

    return () => { cancelled = true; };
  }, [handoffsAdvertised, handoffRefreshToken, task.taskId]);

  useEffect(() => {
    let cancelled = false;
    const api = auditApi;
    const responsibilityPromise = responsibilityAdvertised && typeof api?.getTaskResponsibility === 'function'
      ? api.getTaskResponsibility(task.taskId).catch(() => unavailableResponsibility(true))
      : Promise.resolve(unavailableResponsibility(responsibilityAdvertised));
    responsibilityPromise.then((result) => { if (!cancelled) setResponsibility(result); });

    return () => { cancelled = true; };
  }, [responsibilityAdvertised, responsibilityRefreshToken, task.taskId]);

  if (!workspace || !responsibility || !handoffs) {
    return <div className="rounded-10 border border-forge-border-subtle bg-forge-primary-surface p-4 text-sm text-forge-text-muted">Loading task boundaries…</div>;
  }

  return <TaskBoundariesContent task={task} data={{ workspace, responsibility, handoffs }} />;
}

export function TaskBoundariesContent({ task, data }: { task: TaskSummary; data: BoundaryData }) {
  const { workspace, responsibility, handoffs } = data;
  const ownership = task.ownership;

  return (
    <section className="space-y-4" aria-labelledby="task-boundaries-heading">
      <div>
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-forge-accent" />
          <h2 id="task-boundaries-heading" className="text-sm font-semibold text-forge-text-primary">Task Boundaries</h2>
        </div>
        <p className="mt-1 text-xs text-forge-text-muted">Selected-task safety and provenance projections from the canonical ForgeLoop Integration API.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div className="rounded-10 border border-forge-border-subtle bg-forge-primary-surface p-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-forge-text-muted"><UserRound className="h-4 w-4" />Ownership</h3>
            <OwnershipBadge state={task.operationalState} />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
            <div><span className="text-forge-text-muted">Claim state</span><p className="mt-1 font-mono text-forge-text-primary">{ownership.claimState}</p></div>
            <div><span className="text-forge-text-muted">Mutation allowed</span><p className="mt-1 font-mono text-forge-text-primary">{ownership.mutationAllowed === null ? 'UNKNOWN' : String(ownership.mutationAllowed)}</p></div>
            <div><span className="text-forge-text-muted">Effective claims</span><p className="mt-1 font-mono text-forge-text-primary">{ownership.effectiveWriteClaims.length}</p></div>
            <div><span className="text-forge-text-muted">Authority</span><p className="mt-1 text-forge-text-primary">{ownership.source === 'FORGELOOP_INTEGRATION' ? 'ForgeLoop' : 'Unavailable'}</p></div>
          </div>
        </div>

        <div className={cn('rounded-10 border bg-forge-primary-surface p-4', workspace.status === 'MISMATCH' || workspace.status === 'INVALID' ? 'border-forge-danger/40' : 'border-forge-border-subtle')}>
          <div className="flex items-center justify-between gap-3">
            <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-forge-text-muted"><GitBranch className="h-4 w-4" />Workspace Binding</h3>
            <BoundaryBadge label={workspace.status} tone={toneForWorkspace(workspace.status)} />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
            <div><span className="text-forge-text-muted">Mode</span><p className="mt-1 text-forge-text-primary">{valueOrUnknown(workspace.mode)}</p></div>
            <div><span className="text-forge-text-muted">Bound branch</span><p className="mt-1 font-mono text-forge-text-primary">{valueOrUnknown(workspace.branchAtBind)}</p></div>
            <div><span className="text-forge-text-muted">Bound head</span><p className="mt-1 font-mono text-forge-text-primary">{compactHash(workspace.headAtBind)}</p></div>
            <div><span className="text-forge-text-muted">Binding fingerprint</span><p className="mt-1 font-mono text-forge-text-primary">{compactHash(workspace.bindingFingerprint)}</p></div>
          </div>
          {workspace.status === 'UNBOUND' && <p className="mt-3 text-xs text-forge-text-muted">No workspace binding is configured for this task. This is valid because workspace binding is optional.</p>}
          {workspace.status === 'MATCH' && <p className="mt-3 flex items-center gap-1.5 text-xs text-forge-success"><CheckCircle className="h-3.5 w-3.5" />Current Git worktree matches the task binding.</p>}
          {workspace.status === 'MISMATCH' && <p className="mt-3 flex items-center gap-1.5 text-xs text-forge-danger"><AlertTriangle className="h-3.5 w-3.5" />Current Git worktree does not match the task binding. ForgeLoop mutations and verification may be blocked.</p>}
          {workspace.status === 'UNAVAILABLE' && <p className="mt-3 flex items-center gap-1.5 text-xs text-forge-warning"><CircleHelp className="h-3.5 w-3.5" />ForgeLoop could not resolve the current Git worktree identity.</p>}
          {workspace.error && workspace.status !== 'MISMATCH' && workspace.status !== 'UNAVAILABLE' && <p className="mt-3 text-xs text-forge-warning">{workspace.error.message}</p>}
        </div>

        <div className={cn('rounded-10 border bg-forge-primary-surface p-4', responsibility.status === 'INVALID' ? 'border-forge-danger/40' : 'border-forge-border-subtle')}>
          <div className="flex items-center justify-between gap-3">
            <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-forge-text-muted"><Link2 className="h-4 w-4" />Responsibility</h3>
            <BoundaryBadge label={responsibility.status} tone={toneForResponsibility(responsibility.status)} />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
            <div><span className="text-forge-text-muted">Responsibility label</span><p className="mt-1 text-forge-text-primary">{valueOrUnknown(responsibility.label)}</p></div>
            <div><span className="text-forge-text-muted">Fingerprint</span><p className="mt-1 font-mono text-forge-text-primary">{compactHash(responsibility.fingerprint)}</p></div>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
            <BoundedList label="Allowed paths" values={responsibility.allowedPaths} />
            <BoundedList label="Read-only paths" values={responsibility.readOnlyPaths} />
            <BoundedList label="Required checks" values={responsibility.requiredCheckIds} />
            <BoundedList label="Current changed paths" values={responsibility.changedPaths} />
          </div>
          {responsibility.frozenInputs && <p className="mt-3 text-xs text-forge-text-muted">Frozen inputs: contract {String(responsibility.frozenInputs.contract)}, route {String(responsibility.frozenInputs.route)}, claims {String(responsibility.frozenInputs.claims)}</p>}
          {responsibility.status === 'INVALID' && <p className="mt-3 flex items-center gap-1.5 text-xs text-forge-danger"><AlertTriangle className="h-3.5 w-3.5" />ForgeLoop rejected this responsibility contract; ForgeLoopAudit preserves the canonical fail-closed result.</p>}
          {responsibility.errors.length > 0 && <div className="mt-3 space-y-1 text-xs text-forge-danger">{responsibility.errors.slice(0, 4).map((error, index) => <p key={`${error.code}-${index}`}>{error.code}: {error.message}</p>)}</div>}
        </div>

        <div className="rounded-10 border border-forge-border-subtle bg-forge-primary-surface p-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-forge-text-muted"><Link2 className="h-4 w-4" />Canonical Handoffs</h3>
            <BoundaryBadge label={handoffs.available ? `${handoffs.count ?? 0} recorded` : 'Unavailable'} tone={handoffs.available ? 'neutral' : 'warning'} />
          </div>
          <div className="mt-3 space-y-2">
            {!handoffs.available ? <p className="text-sm text-forge-warning">Canonical handoff snapshots are unavailable.</p> : handoffs.handoffs.length === 0 ? <p className="text-sm text-forge-text-muted">No canonical handoff snapshots recorded.</p> : handoffs.handoffs.slice(0, 5).map((handoff) => <HandoffRow key={handoff.handoffId || `${handoff.createdAt}-${handoff.revision}`} handoff={handoff} />)}
          </div>
          {handoffs.error && <p className="mt-3 text-xs text-forge-warning">{handoffs.error.message}</p>}
          <p className="mt-3 border-t border-forge-border-subtle/60 pt-3 text-[11px] text-forge-text-muted">Immutable protocol snapshot — not review, completion, delegation, or authority evidence.</p>
        </div>
      </div>
    </section>
  );
}
