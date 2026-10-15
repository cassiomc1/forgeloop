import type { TaskRecoverySummary } from '@shared/domain';

interface RecoveryPanelProps {
  recovery: TaskRecoverySummary;
}

const STATUS_STYLES: Record<TaskRecoverySummary['status'], string> = {
  RECOVERED: 'text-forge-warning',
  UNKNOWN: 'text-forge-danger',
  NONE: 'text-forge-text-muted',
};

export function RecoveryPanel({ recovery }: RecoveryPanelProps) {
  return (
    <div className="rounded-10 border border-forge-border-subtle p-3 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-forge-text-muted uppercase tracking-wider">Recovery</h3>
        <span className={`text-xs font-semibold font-mono ${STATUS_STYLES[recovery.status]}`}>{recovery.status}</span>
      </div>

      {recovery.status === 'NONE' && recovery.source === 'UNAVAILABLE' && (
        <p className="text-xs text-forge-text-muted">No durable recovery recorded for this task.</p>
      )}

      {recovery.status === 'UNKNOWN' && (
        <p className="text-xs text-forge-danger">
          A recovery artifact exists but canonical ownership is unavailable. The ForgeLoopAudit cannot confirm its semantics.
        </p>
      )}

      {recovery.status !== 'NONE' && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
          {recovery.recoveryId && (
            <>
              <dt className="text-forge-text-muted">Recovery ID</dt>
              <dd className="font-mono break-all">{recovery.recoveryId}</dd>
            </>
          )}
          {recovery.recoveredAt && (
            <>
              <dt className="text-forge-text-muted">Recovered at</dt>
              <dd className="font-mono">{recovery.recoveredAt}</dd>
            </>
          )}
          {recovery.classificationAtRecovery && (
            <>
              <dt className="text-forge-text-muted">Classification</dt>
              <dd className="font-mono">{recovery.classificationAtRecovery}</dd>
            </>
          )}
          {recovery.previousPhase && (
            <>
              <dt className="text-forge-text-muted">Previous phase</dt>
              <dd className="font-mono">{recovery.previousPhase}</dd>
            </>
          )}
          {typeof recovery.previousRevision === 'number' && (
            <>
              <dt className="text-forge-text-muted">Previous revision</dt>
              <dd className="font-mono">{recovery.previousRevision}</dd>
            </>
          )}
          {recovery.authorityKind && (
            <>
              <dt className="text-forge-text-muted">Authority</dt>
              <dd className="font-mono">
                {recovery.authorityKind}
                {recovery.grantRef ? ` (${recovery.grantRef})` : ''}
              </dd>
            </>
          )}
        </dl>
      )}

      {recovery.releasedClaims.length > 0 && (
        <div>
          <h4 className="text-xs font-medium text-forge-text-muted mb-1">Released claims</h4>
          <ul className="space-y-0.5">
            {recovery.releasedClaims.map((claim) => (
              <li key={claim} className="text-xs font-mono text-forge-text-secondary break-all">
                {claim}
              </li>
            ))}
          </ul>
        </div>
      )}

      {recovery.reasonCodes.length > 0 && (
        <div>
          <h4 className="text-xs font-medium text-forge-text-muted mb-1">Reason codes</h4>
          <ul className="space-y-0.5">
            {recovery.reasonCodes.map((code) => (
              <li key={code} className="text-xs font-mono text-forge-warning break-all">
                {code}
              </li>
            ))}
          </ul>
        </div>
      )}

      {recovery.resumeRequired ? (
        <p className="text-xs text-forge-warning font-medium">
          Resume required — mutations stay blocked until the canonical ForgeLoop resume is performed by an authorized harness.
        </p>
      ) : (
        <p className="text-[11px] text-forge-text-muted">
          Recovery facts are read-only in the ForgeLoopAudit. Resuming or recovering a task must be done through ForgeLoop.
        </p>
      )}
    </div>
  );
}
