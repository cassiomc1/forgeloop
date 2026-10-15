import type { DurableActionView } from '@shared/domain';
import { ActionStateBadge } from './ActionStateBadge';

function Value({ label, value }: { label: string; value: string | number | boolean | null | undefined }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wider text-forge-text-muted">{label}</dt>
      <dd className="mt-1 text-sm text-forge-text-secondary break-words">{value === null || value === undefined || value === '' ? 'Unknown / not verified' : String(value)}</dd>
    </div>
  );
}

export function ActionDetail({ action }: { action: DurableActionView | null }) {
  if (!action) {
    return <div className="p-5 text-sm text-forge-text-muted">Select an action to inspect its canonical read model.</div>;
  }

  return (
    <div className="p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-forge-text-primary">{action.actionId}</h3>
          <p className="mt-1 text-xs text-forge-text-muted">Canonical durable-action projection</p>
        </div>
        <ActionStateBadge state={action.state} />
      </div>
      {action.state === 'COMMIT_UNKNOWN' && (
        <div className="rounded-8 border border-forge-danger/30 bg-forge-danger/10 p-3 text-xs text-forge-danger">
          Commit outcome is unknown. ForgeLoopAudit does not retry, reconcile, authorize, or infer whether the external effect happened.
        </div>
      )}
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Value label="Effect class" value={action.effectClass} />
        <Value label="Capability" value={action.capability} />
        <Value label="Operation" value={action.operation} />
        <Value label="Target" value={action.target} />
        <Value label="Required for completion" value={action.requiredForCompletion ? 'Yes' : 'No'} />
        <Value label="Requirement" value={action.requirement} />
        <Value label="Provenance" value={action.provenance} />
        <Value label="Revision" value={action.revision} />
        <Value label="Idempotency key" value={action.idempotencyKey} />
        <Value label="Commit result" value={action.commitResultCode} />
        <Value label="Last evidence" value={action.lastEvidenceRef} />
        <Value label="Last reconciliation" value={action.lastReconciliationAt} />
      </dl>
      <div>
        <p className="text-[11px] uppercase tracking-wider text-forge-text-muted">Action fingerprint</p>
        <p className="mt-1 text-xs font-mono text-forge-text-secondary break-all">{action.actionFingerprint || 'Unknown / not verified'}</p>
      </div>
    </div>
  );
}
