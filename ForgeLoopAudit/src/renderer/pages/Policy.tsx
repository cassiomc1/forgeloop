import { useState, useEffect } from 'react';
import type { ProjectSnapshot, TaskSummary, PolicySummary, CapabilityPolicyView } from '@shared/domain';
import { EmptyState } from '../components/ui/EmptyState';
import { cn } from '../lib/utils';
import { Shield, AlertTriangle, Lock, FileText, Activity } from 'lucide-react';
import { auditApi } from '../lib/audit-client';

interface PolicyProps {
  snapshot: ProjectSnapshot;
  selectedTaskId?: string | null;
  capabilityPolicyRefreshToken?: number;
  onSelectedTaskChange?: (taskId: string) => void;
}

export function Policy({ snapshot, selectedTaskId, capabilityPolicyRefreshToken = 0, onSelectedTaskChange }: PolicyProps) {
  const [selectedTask, setSelectedTask] = useState<TaskSummary | null>(
    snapshot.tasks.find((t) => t.taskId === snapshot.activeTaskId) || snapshot.tasks[0] || null
  );
  const [taskPolicy, setTaskPolicy] = useState<PolicySummary | null>(null);
  const [policyLoading, setPolicyLoading] = useState(false);
  const [capabilityPolicy, setCapabilityPolicy] = useState<CapabilityPolicyView | null>(null);
  useEffect(() => { setSelectedTask(snapshot.tasks.find((t) => t.taskId === selectedTaskId) || snapshot.tasks.find((t) => t.taskId === snapshot.activeTaskId) || snapshot.tasks[0] || null); }, [snapshot, selectedTaskId]);
  useEffect(() => {
    if (!selectedTask) { setTaskPolicy(null); return; }
    let cancelled = false;
    setPolicyLoading(true);
    auditApi.getPolicyStatus(selectedTask.taskId)
      .then((result) => { if (!cancelled) setTaskPolicy(result); })
      .catch(() => { if (!cancelled) setTaskPolicy(null); })
      .finally(() => { if (!cancelled) setPolicyLoading(false); });
    return () => { cancelled = true; };
  }, [selectedTask]);
  useEffect(() => {
    let cancelled = false;
    if (snapshot.protocol.featureSupport?.capabilityPolicy !== true) {
      setCapabilityPolicy(null);
      return () => { cancelled = true; };
    }
    auditApi.getCapabilityPolicy()
      .then((result) => { if (!cancelled) setCapabilityPolicy(result); })
      .catch(() => { if (!cancelled) setCapabilityPolicy(null); });
    return () => { cancelled = true; };
  }, [snapshot.protocol.featureSupport?.capabilityPolicy, capabilityPolicyRefreshToken]);

  if (snapshot.tasks.length === 0) {
    return <EmptyState title="No tasks available" description="Select a task to view policy information." />;
  }

  const policy = snapshot.policy;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-forge-text-primary">Policy</h1>
          <p className="text-sm text-forge-text-muted mt-1">Policy state and compliance</p>
        </div>
        <select
          className="input w-48"
          value={selectedTask?.taskId || ''}
          onChange={(e) => {
            const task = snapshot.tasks.find((t) => t.taskId === e.target.value);
            setSelectedTask(task || null);
            if (task) onSelectedTaskChange?.(task.taskId);
          }}
        >
          {snapshot.tasks.map((task) => (
            <option key={task.taskId} value={task.taskId}>
              {task.taskId}
            </option>
          ))}
        </select>
      </div>

      {policy ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-forge-primary-surface border border-forge-border-subtle rounded-10 p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs text-forge-text-muted uppercase tracking-wider">Mode</span>
                <Shield className="w-4 h-4 text-forge-accent" />
              </div>
              <p className="text-lg font-semibold text-forge-text-primary">{policy.complianceMode}</p>
            </div>
            <div className="bg-forge-primary-surface border border-forge-border-subtle rounded-10 p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs text-forge-text-muted uppercase tracking-wider">Rules</span>
                <FileText className="w-4 h-4 text-forge-text-muted" />
              </div>
              <p className="text-lg font-semibold text-forge-text-primary">{policy.ruleCount ?? 'Unknown'}</p>
            </div>
            <div className="bg-forge-primary-surface border border-forge-border-subtle rounded-10 p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs text-forge-text-muted uppercase tracking-wider">Overall</span>
                <Activity className="w-4 h-4 text-forge-text-muted" />
              </div>
              <div className="flex items-center gap-2">
                <span className={cn('w-2 h-2 rounded-full', {
                  'bg-forge-success': policy.overallStatus === 'valid',
                  'bg-forge-danger': policy.overallStatus === 'invalid',
                  'bg-forge-text-muted': policy.overallStatus === 'unknown',
                })} />
                <p className="text-lg font-semibold text-forge-text-primary capitalize">{policy.overallStatus}</p>
              </div>
            </div>
            <div className="bg-forge-primary-surface border border-forge-border-subtle rounded-10 p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs text-forge-text-muted uppercase tracking-wider">Policy Lock</span>
                <Lock className="w-4 h-4 text-forge-text-muted" />
              </div>
              <div className="flex items-center gap-2">
                <span className={cn('w-2 h-2 rounded-full', {
                  'bg-forge-success': policy.lockStatus === 'valid',
                  'bg-forge-danger': policy.lockStatus === 'invalid',
                  'bg-forge-text-muted': policy.lockStatus === 'unknown',
                })} />
                <p className="text-lg font-semibold text-forge-text-primary capitalize">{policy.lockStatus}</p>
              </div>
            </div>
          </div>

          {policy.drift?.detected && (
            <div className="bg-forge-warning/5 border border-forge-warning/20 rounded-10 p-4">
              <h3 className="text-sm font-semibold text-forge-warning mb-2 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" />
                Policy Drift Detected
              </h3>
              <p className="text-sm text-forge-text-secondary">
                {policy.drift.changeCount ?? 0} policy change{policy.drift.changeCount !== 1 ? 's' : ''} detected ({policy.drift.classification || 'unknown'}). Re-verification may be required.
              </p>
            </div>
          )}

          <div className="bg-forge-primary-surface border border-forge-border-subtle rounded-10 p-4">
            <h3 className="text-xs font-semibold text-forge-text-muted uppercase tracking-wider mb-3">Policy Details</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <span>Proven rules: {policy.provenRules ?? 'Unknown'}</span>
              <span>Inert rules: {policy.inertRules ?? 'Unknown'}</span>
              <span>Baseline violations: {policy.baselineViolations ?? 'Unknown'}</span>
              <span>New violations: {policy.newViolations ?? 'Unknown'}</span>
            </div>
            {policy.errors && policy.errors.length > 0 && <p className="mt-3 text-xs text-forge-danger">Errors: {policy.errors.join(' · ')}</p>}
            {policy.warnings && policy.warnings.length > 0 && <p className="mt-2 text-xs text-forge-warning">Warnings: {policy.warnings.join(' · ')}</p>}
          </div>

          {selectedTask?.policySnapshot && Object.keys(selectedTask.policySnapshot).length > 0 && (
            <div className="bg-forge-primary-surface border border-forge-border-subtle rounded-10 p-4">
              <h3 className="text-xs font-semibold text-forge-text-muted uppercase tracking-wider mb-3">Task Policy Snapshot</h3>
              <pre className="text-xs text-forge-text-secondary font-mono bg-forge-secondary-surface rounded-6 p-3 overflow-auto max-h-[300px]">
                {JSON.stringify(selectedTask.policySnapshot, null, 2)}
              </pre>
            </div>
          )}
          <div className="bg-forge-primary-surface border border-forge-border-subtle rounded-10 p-4">
            <h3 className="text-xs font-semibold text-forge-text-muted uppercase tracking-wider mb-3">Selected Task Policy Status</h3>
            {policyLoading ? <p className="text-sm text-forge-text-muted">Checking task policy…</p> : taskPolicy ? (
              <div className="text-sm space-y-2">
                <p>Status: <span className="font-medium">{taskPolicy.overallStatus}</span></p>
                <p>Lock: {taskPolicy.lockStatus}</p>
                <p>Drift: {taskPolicy.drift?.detected ? `${taskPolicy.drift.classification || 'detected'} (${taskPolicy.drift.changeCount ?? 0} changes)` : 'none'}</p>
                {taskPolicy.drift?.snapshotDigest && <p className="text-xs font-mono break-all">Snapshot: {taskPolicy.drift.snapshotDigest}</p>}
                {taskPolicy.drift?.currentDigest && <p className="text-xs font-mono break-all">Current: {taskPolicy.drift.currentDigest}</p>}
              </div>
            ) : <p className="text-sm text-forge-text-muted">Task policy status unavailable.</p>}
          </div>
        </>
      ) : (
        <div className="bg-forge-primary-surface border border-forge-border-subtle rounded-10 p-8">
          <div className="text-center text-sm text-forge-text-muted">
            <Shield className="w-8 h-8 mx-auto mb-3 text-forge-border-strong" />
            <p>No policy information available</p>
            <p className="mt-1 text-xs">Policy data will appear here when configured in ForgeLoop</p>
          </div>
        </div>
      )}

      <div className="bg-forge-primary-surface border border-forge-border-subtle rounded-10 p-4">
        <div className="flex items-center justify-between gap-3 mb-2">
          <h2 className="text-sm font-semibold text-forge-text-primary">Project capability policy</h2>
          <Shield className="w-4 h-4 text-forge-accent" />
        </div>
        <p className="text-xs text-forge-text-muted mb-4">Project capability policy controls ForgeLoop policy decisions. It does not itself grant host authority.</p>
        {snapshot.protocol.featureSupport?.capabilityPolicy !== true ? <p className="text-sm text-forge-warning">Not available with the bundled ForgeLoop capability set.</p> : !capabilityPolicy ? <p className="text-sm text-forge-text-muted">Loading canonical capability policy…</p> : !capabilityPolicy.available ? <p className="text-sm text-forge-warning">{capabilityPolicy.error?.message || 'Capability policy unavailable.'}</p> : <div className="space-y-3"><div className="flex items-center justify-between text-sm"><span className="text-forge-text-muted">Default decision</span><span className="font-mono text-forge-text-primary">{capabilityPolicy.defaultDecision || 'Unknown'}</span></div><div className="flex items-center justify-between text-sm"><span className="text-forge-text-muted">Fingerprint</span><span className="font-mono text-xs text-forge-text-secondary truncate max-w-[60%]">{capabilityPolicy.fingerprint || 'Unknown / not verified'}</span></div>{capabilityPolicy.rules.length > 0 ? <div className="divide-y divide-forge-border-subtle/50 border border-forge-border-subtle rounded-8">{capabilityPolicy.rules.map((rule) => <div key={rule.capability} className="px-3 py-2 flex items-center justify-between gap-3 text-sm"><span className="font-mono text-xs text-forge-text-secondary">{rule.capability}</span><span className={cn('text-xs font-semibold', rule.decision === 'DENY' ? 'text-forge-danger' : rule.decision === 'ALLOW' ? 'text-forge-success' : 'text-forge-warning')}>{rule.decision}</span></div>)}</div> : <p className="text-sm text-forge-text-muted">No capability-specific rules recorded.</p>}</div>}
      </div>

      {selectedTask && selectedTask.gates.length > 0 && (
        <div className="bg-forge-primary-surface border border-forge-border-subtle rounded-10">
          <div className="px-4 py-3 border-b border-forge-border-subtle">
            <h2 className="text-sm font-semibold text-forge-text-primary">Gates</h2>
          </div>
          <div className="divide-y divide-forge-border-subtle/50">
            {selectedTask.gates.map((gate) => (
              <div key={gate.id} className="px-4 py-3 flex items-center gap-4">
                <span className={cn('w-2 h-2 rounded-full', {
                  'bg-forge-success': gate.status === 'satisfied',
                  'bg-forge-text-muted': gate.status === 'unverified',
                  'bg-forge-danger': gate.status === 'blocked',
                })} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-forge-text-primary">{gate.name}</p>
                  {gate.requiredBy && gate.requiredBy.length > 0 && (
                    <p className="text-xs text-forge-text-muted mt-0.5">
                      Required by: {gate.requiredBy.join(', ')}
                    </p>
                  )}
                </div>
                <span className={cn('text-xs font-medium', {
                  'text-forge-success': gate.status === 'satisfied',
                  'text-forge-text-muted': gate.status === 'unverified',
                  'text-forge-danger': gate.status === 'blocked',
                })}>
                  {gate.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
