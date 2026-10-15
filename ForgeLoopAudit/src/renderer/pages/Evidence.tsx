import { useState, useEffect } from 'react';
import type { ProjectSnapshot, TaskSummary, TaskAttestationView, VerificationScopeView } from '@shared/domain';
import { NoEvidenceState } from '../components/ui/EmptyState';
import { cn, getEvidenceKindColor, getEvidenceKindLabel } from '../lib/utils';
import { AlertTriangle, FileCheck2, ShieldCheck } from 'lucide-react';
import { auditApi } from '../lib/audit-client';

interface EvidenceProps {
  snapshot: ProjectSnapshot;
  selectedTaskId?: string | null;
  genericTaskRefreshToken?: number;
  verificationScopeRefreshToken?: number;
  attestationRefreshToken?: number;
  onSelectedTaskChange?: (taskId: string) => void;
  onOpenActions?: () => void;
}

export function Evidence({ snapshot, selectedTaskId, genericTaskRefreshToken = 0, verificationScopeRefreshToken = 0, attestationRefreshToken = 0, onSelectedTaskChange, onOpenActions }: EvidenceProps) {
  const [selectedTask, setSelectedTask] = useState<TaskSummary | null>(
    snapshot.tasks.find((t) => t.taskId === snapshot.activeTaskId) || snapshot.tasks[0] || null
  );
  useEffect(() => { setSelectedTask(snapshot.tasks.find((t) => t.taskId === selectedTaskId) || snapshot.tasks.find((t) => t.taskId === snapshot.activeTaskId) || snapshot.tasks[0] || null); }, [snapshot, selectedTaskId]);
  const [executionReceipt, setExecutionReceipt] = useState<Record<string, unknown> | null>(null);
  const [verificationScope, setVerificationScope] = useState<VerificationScopeView | null>(null);
  const [attestation, setAttestation] = useState<TaskAttestationView | null>(null);
  const selectedTaskKey = selectedTask?.taskId ?? null;
  const scopeFeatureAvailable = snapshot.protocol.featureSupport?.differentialVerificationScope === true;
  const attestationFeatureAvailable = snapshot.protocol.featureSupport?.codeAttestation === true;
  useEffect(() => {
    if (!selectedTaskKey) { setExecutionReceipt(null); return; }
    let cancelled = false;
    auditApi.getTask(selectedTaskKey).then((task) => { if (!cancelled) setExecutionReceipt(task.executionReceipt || null); }).catch(() => { if (!cancelled) setExecutionReceipt(null); });
    return () => { cancelled = true; };
  }, [genericTaskRefreshToken, selectedTaskKey]);

  useEffect(() => {
    if (!selectedTaskKey) { setVerificationScope(null); return; }
    let cancelled = false;
    const scopeUnavailable: VerificationScopeView = {
      available: false,
      source: 'UNAVAILABLE',
      requestedMode: 'UNKNOWN',
      resolvedMode: 'UNKNOWN',
      verificationCycle: null,
      changedPaths: [],
      claimedPaths: [],
      selectedPaths: [],
      reasons: [],
      fallback: null,
      fingerprint: null,
      checkerCapabilityFingerprint: null,
      createdAt: null,
      error: { code: 'E_FEATURE_UNAVAILABLE', message: 'Differential Verification Scope is not advertised by this ForgeLoop build.' },
    };
    const scopePromise = scopeFeatureAvailable
      ? auditApi.getTaskVerificationScope(selectedTaskKey).catch(() => scopeUnavailable)
      : Promise.resolve(scopeUnavailable);
    scopePromise.then((scope) => { if (!cancelled) setVerificationScope(scope); });
    return () => { cancelled = true; };
  }, [scopeFeatureAvailable, selectedTaskKey, verificationScopeRefreshToken]);

  useEffect(() => {
    if (!selectedTaskKey) { setAttestation(null); return; }
    let cancelled = false;
    const attestationUnavailable: TaskAttestationView = {
      available: false,
      source: 'UNAVAILABLE',
      status: 'UNKNOWN',
      level: 'UNKNOWN',
      content: null,
      receipt: null,
      ledger: null,
      signature: null,
      signer: null,
      files: null,
      subject: null,
      errors: [{ code: 'E_FEATURE_UNAVAILABLE', message: 'Code attestation is not advertised by this ForgeLoop build.' }],
    };
    const attestationPromise = attestationFeatureAvailable
      ? auditApi.getTaskAttestation(selectedTaskKey).catch(() => attestationUnavailable)
      : Promise.resolve(attestationUnavailable);
    attestationPromise.then((attestationView) => { if (!cancelled) setAttestation(attestationView); });
    return () => { cancelled = true; };
  }, [attestationFeatureAvailable, attestationRefreshToken, selectedTaskKey]);

  if (snapshot.tasks.length === 0) {
    return <NoEvidenceState />;
  }

  const evidence = selectedTask?.evidenceCoverage;
  const receiptActions = executionReceipt?.actions && typeof executionReceipt.actions === 'object' && !Array.isArray(executionReceipt.actions) ? executionReceipt.actions as Record<string, unknown> : null;
  const actionRefs = Array.isArray(receiptActions?.actionRefs) ? receiptActions.actionRefs.filter((value): value is string => typeof value === 'string') : [];

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-forge-text-primary">Evidence Matrix</h1>
          <p className="text-sm text-forge-text-muted mt-1">Verification evidence coverage</p>
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

      {evidence && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div className="bg-forge-primary-surface border border-forge-border-subtle rounded-10 p-4">
            <p className="text-xs text-forge-text-muted mb-1">ForgeLoopAudit Coverage Score</p>
            <p className="text-2xl font-semibold text-forge-text-primary">{evidence.coveragePercent}%</p>
            <div className="mt-2 h-1.5 bg-forge-border-subtle rounded-full overflow-hidden">
              <div
                className="h-full bg-forge-accent rounded-full"
                style={{ width: `${evidence.coveragePercent}%` }}
              />
            </div>
          </div>
          <div className="bg-forge-primary-surface border border-forge-border-subtle rounded-10 p-4">
            <p className="text-xs text-forge-text-muted mb-1">Covered</p>
            <p className="text-2xl font-semibold text-forge-success">{evidence.covered}</p>
          </div>
          <div className="bg-forge-primary-surface border border-forge-border-subtle rounded-10 p-4">
            <p className="text-xs text-forge-text-muted mb-1">Partial</p>
            <p className="text-2xl font-semibold text-forge-info">{evidence.partial}</p>
          </div>
          <div className="bg-forge-primary-surface border border-forge-border-subtle rounded-10 p-4">
            <p className="text-xs text-forge-text-muted mb-1">Not Verified</p>
            <p className="text-2xl font-semibold text-forge-text-muted">{evidence.notVerified}</p>
          </div>
          <div className="bg-forge-primary-surface border border-forge-border-subtle rounded-10 p-4">
            <p className="text-xs text-forge-text-muted mb-1">Blocked</p>
            <p className="text-2xl font-semibold text-forge-danger">{evidence.blocked}</p>
          </div>
        </div>
      )}

      <div className="bg-forge-primary-surface border border-forge-border-subtle rounded-10 p-4">
        <div className="flex items-center justify-between gap-3 mb-3"><div><h2 className="text-sm font-semibold text-forge-text-primary">Durable action evidence</h2><p className="text-xs text-forge-text-muted mt-1">Receipt counts are displayed as recorded; canonical trusted readiness belongs to ForgeLoop.</p></div>{onOpenActions && <button className="btn-secondary text-xs" onClick={onOpenActions}>Open Actions</button>}</div>
        {receiptActions ? <div className="grid grid-cols-2 md:grid-cols-6 gap-3 text-sm"><ReceiptMetric label="Required" value={receiptActions.required} /><ReceiptMetric label="Trusted satisfied" value={receiptActions.trustedSatisfied} /><ReceiptMetric label="Unresolved required" value={receiptActions.unresolvedRequired} /><ReceiptMetric label="Failed" value={receiptActions.failed} /><ReceiptMetric label="Ambiguous" value={receiptActions.ambiguous} /><ReceiptMetric label="Pending" value={receiptActions.pending} /><div className="col-span-full"><p className="text-[11px] uppercase tracking-wider text-forge-text-muted mb-1">Action references</p><p className="text-xs font-mono text-forge-text-secondary">{actionRefs.length ? actionRefs.join(' · ') : 'None recorded'}</p></div></div> : <p className="text-sm text-forge-text-muted">No action summary is recorded in this execution receipt.</p>}
      </div>

      {selectedTask && (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <VerificationScopeCard scope={verificationScope} />
          <AttestationCard attestation={attestation} />
        </div>
      )}

      {selectedTask && selectedTask.checks.length > 0 && (
        <div className="bg-forge-primary-surface border border-forge-border-subtle rounded-10 overflow-hidden">
          <div className="px-4 py-3 border-b border-forge-border-subtle">
            <h2 className="text-sm font-semibold text-forge-text-primary">Verification Checks</h2>
          </div>
          <div className="divide-y divide-forge-border-subtle/50">
            {selectedTask.checks.map((check) => (
              <div key={check.id} className="px-4 py-3 flex items-center gap-4">
                <span className={cn('text-sm font-medium w-6', {
                  'text-forge-success': check.status === 'passed',
                  'text-forge-danger': check.status === 'failed',
                  'text-forge-accent': check.status === 'not-run',
                  'text-forge-text-muted': check.status === 'blocked',
                })}>
                  {check.status === 'passed' ? '✓' : check.status === 'failed' ? '✗' : '○'}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-forge-text-primary">{check.requirement}</p>
                  <p className="text-xs text-forge-text-muted mt-0.5 font-mono">{check.id}</p>
                </div>
                <span className={cn('text-xs font-medium', getEvidenceKindColor(check.evidenceKind))}>
                  {getEvidenceKindLabel(check.evidenceKind)}
                </span>
                {check.timestamp && (
                  <span className="text-xs text-forge-text-muted font-mono">
                    {new Date(check.timestamp).toLocaleTimeString()}
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

function ReceiptMetric({ label, value }: { label: string; value: unknown }) {
  return <div className="rounded-8 bg-forge-secondary-surface p-3"><p className="text-[11px] uppercase tracking-wider text-forge-text-muted">{label}</p><p className="mt-1 text-lg font-semibold text-forge-text-primary">{typeof value === 'number' ? value : 'Unknown'}</p></div>;
}

function BoundedEvidenceList({ label, values }: { label: string; values: string[] }) {
  const visible = values.slice(0, 8);
  return <div><p className="text-[11px] font-semibold uppercase tracking-wider text-forge-text-muted">{label}</p>{visible.length === 0 ? <p className="mt-1 text-xs text-forge-text-muted">None recorded</p> : <ul className="mt-1 space-y-1">{visible.map((value) => <li key={value} className="break-all text-xs font-mono text-forge-text-secondary">{value}</li>)}{values.length > visible.length && <li className="text-xs text-forge-text-muted">+{values.length - visible.length} more</li>}</ul>}</div>;
}

export function VerificationScopeCard({ scope }: { scope: VerificationScopeView | null }) {
  const noPersistedScope = scope?.available === true && scope.requestedMode === 'UNKNOWN' && scope.resolvedMode === 'UNKNOWN' && !scope.fingerprint;
  const unresolved = scope?.resolvedMode === 'UNRESOLVED';
  return <section className={cn('rounded-10 border bg-forge-primary-surface p-4', unresolved ? 'border-forge-warning/40' : 'border-forge-border-subtle')} aria-labelledby="verification-scope-heading">
    <div className="flex items-center gap-2"><FileCheck2 className="h-4 w-4 text-forge-accent" /><h2 id="verification-scope-heading" className="text-sm font-semibold text-forge-text-primary">Verification Scope</h2></div>
    <p className="mt-1 text-xs text-forge-text-muted">ForgeLoop's persisted pre-completion verification plan.</p>
    {!scope ? <p className="mt-4 text-sm text-forge-text-muted">Loading verification scope…</p> : scope.error ? <p className="mt-4 text-sm text-forge-warning">{scope.error.message}</p> : noPersistedScope ? <p className="mt-4 text-sm text-forge-text-muted">No persisted verification scope for this task.</p> : <div className="mt-4 space-y-4">
      {unresolved && <p className="flex items-center gap-1.5 text-xs text-forge-warning"><AlertTriangle className="h-3.5 w-3.5" />ForgeLoop could not resolve a verification scope for this task.</p>}
      <div className="grid grid-cols-2 gap-3 text-xs md:grid-cols-4"><div><span className="text-forge-text-muted">Requested mode</span><p className="mt-1 font-mono text-forge-text-primary">{scope.requestedMode}</p></div><div><span className="text-forge-text-muted">Resolved mode</span><p className="mt-1 font-mono text-forge-text-primary">{scope.resolvedMode}</p></div><div><span className="text-forge-text-muted">Verification cycle</span><p className="mt-1 font-mono text-forge-text-primary">{scope.verificationCycle ?? 'Unknown'}</p></div><div><span className="text-forge-text-muted">Created at</span><p className="mt-1 text-forge-text-primary">{scope.createdAt || 'Unknown'}</p></div></div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2"><BoundedEvidenceList label="Changed paths" values={scope.changedPaths} /><BoundedEvidenceList label="Claimed paths" values={scope.claimedPaths} /><BoundedEvidenceList label="Selected paths" values={scope.selectedPaths} /><BoundedEvidenceList label="Reasons" values={scope.reasons} /></div>
      <div className="grid grid-cols-1 gap-2 text-xs text-forge-text-secondary"><p>Scope fingerprint: <span className="font-mono">{scope.fingerprint || 'Not recorded'}</span></p><p>Checker capability fingerprint: <span className="font-mono">{scope.checkerCapabilityFingerprint || 'Not recorded'}</span></p><p>Fallback: <span className="font-mono">{scope.fallback ? JSON.stringify(scope.fallback) : 'None'}</span></p></div>
    </div>}
    <p className="mt-4 border-t border-forge-border-subtle/60 pt-3 text-[11px] text-forge-text-muted">Verification scope is a pre-completion verification plan. It is not revision-range attestation coverage.</p>
  </section>;
}

function attestationTone(level: TaskAttestationView['level']): string {
  if (level === 'ATTESTED' || level === 'VERIFIED') return 'text-forge-success';
  if (level === 'PROCESSED') return 'text-forge-accent';
  return 'text-forge-text-muted';
}

export function AttestationCard({ attestation }: { attestation: TaskAttestationView | null }) {
  return <section className={cn('rounded-10 border bg-forge-primary-surface p-4', attestation?.status === 'INVALID' ? 'border-forge-danger/40' : 'border-forge-border-subtle')} aria-labelledby="code-attestation-heading">
    <div className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-forge-accent" /><h2 id="code-attestation-heading" className="text-sm font-semibold text-forge-text-primary">Code Attestation</h2></div>
    <p className="mt-1 text-xs text-forge-text-muted">Canonical content and evidence provenance for the selected task.</p>
    {!attestation ? <p className="mt-4 text-sm text-forge-text-muted">Loading code attestation…</p> : <div className="mt-4 space-y-4">
      <div className="flex flex-wrap items-center gap-2"><span className={cn('text-sm font-semibold', attestationTone(attestation.level))}>{attestation.level}</span><span className="text-xs text-forge-text-muted">Status: {attestation.status}</span></div>
      {attestation.readPolicy && !attestation.readPolicy.automaticCanonicalReadAllowed && <p className="flex items-center gap-1.5 text-xs text-forge-warning"><AlertTriangle className="h-3.5 w-3.5" />{attestation.readPolicy.reason === 'DISABLED' ? 'Automatic attestation reads are disabled by project policy.' : attestation.readPolicy.reason === 'CONFIG_UNAVAILABLE' ? 'Attestation policy could not be validated; automatic reads are disabled.' : 'External verification required.'}</p>}
      {attestation.status === 'INVALID' && <p className="flex items-center gap-1.5 text-xs text-forge-danger"><AlertTriangle className="h-3.5 w-3.5" />Canonical attestation reported an invalid result.</p>}
      {attestation.status === 'MISSING' && <p className="text-xs text-forge-text-muted">Attestation artifacts are missing for this task.</p>}
      {attestation.status === 'DISABLED' && <p className="text-xs text-forge-text-muted">Attestation is disabled by the project policy.</p>}
      <div className="grid grid-cols-2 gap-3 text-xs md:grid-cols-3"><div><span className="text-forge-text-muted">Content</span><p className="mt-1 text-forge-text-primary">{attestation.content || 'Not recorded'}</p></div><div><span className="text-forge-text-muted">Receipt</span><p className="mt-1 text-forge-text-primary">{attestation.receipt || 'Not recorded'}</p></div><div><span className="text-forge-text-muted">Ledger</span><p className="mt-1 text-forge-text-primary">{attestation.ledger || 'Not recorded'}</p></div><div><span className="text-forge-text-muted">Signature</span><p className="mt-1 text-forge-text-primary">{attestation.signature || 'Not recorded'}</p></div><div><span className="text-forge-text-muted">File count</span><p className="mt-1 text-forge-text-primary">{attestation.files ?? 'Unknown'}</p></div><div><span className="text-forge-text-muted">Subject</span><p className="mt-1 break-all text-forge-text-primary">{attestation.subject || 'Not recorded'}</p></div></div>
      {attestation.signer && <p className="text-xs text-forge-text-secondary">Signer policy details: <span className="font-mono">{JSON.stringify(attestation.signer)}</span></p>}
      {attestation.errors.length > 0 && <div className="space-y-1 text-xs text-forge-danger">{attestation.errors.slice(0, 5).map((error, index) => <p key={`${error.code}-${index}`}>{error.code}: {error.message}</p>)}</div>}
    </div>}
    <p className="mt-4 border-t border-forge-border-subtle/60 pt-3 text-[11px] text-forge-text-muted">PROCESSED means artifacts were processed; VERIFIED means ForgeLoop validated content and evidence bindings; ATTESTED additionally satisfies configured signing policy. This does not claim security, authorship, or bug-free code.</p>
  </section>;
}
