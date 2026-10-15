import type { TaskOwnershipSummary } from '@shared/domain';

interface OwnershipPanelProps {
  ownership: TaskOwnershipSummary;
}

function ClaimList({ title, claims }: { title: string; claims: string[] }) {
  return (
    <div>
      <h4 className="text-xs font-medium text-forge-text-muted mb-1">{title}</h4>
      {claims.length === 0 ? (
        <span className="text-xs text-forge-text-muted">None</span>
      ) : (
        <ul className="space-y-0.5">
          {claims.map((claim) => (
            <li key={claim} className="text-xs font-mono text-forge-text-secondary break-all">
              {claim}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function OwnershipPanel({ ownership }: OwnershipPanelProps) {
  const sourceLabel =
    ownership.source === 'FORGELOOP_INTEGRATION'
      ? 'ForgeLoop Integration API (canonical)'
      : 'Unavailable — canonical ownership not readable';

  return (
    <div className="rounded-10 border border-forge-border-subtle p-3 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-forge-text-muted uppercase tracking-wider">Ownership</h3>
        <span className="text-[11px] text-forge-text-muted">{sourceLabel}</span>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <span className="text-forge-text-muted">Claim state:</span>{' '}
          <span className="font-mono font-semibold">{ownership.claimState}</span>
        </div>
        <div>
          <span className="text-forge-text-muted">Mutation allowed:</span>{' '}
          <span className="font-mono font-semibold">{ownership.mutationAllowed === null ? 'UNKNOWN' : String(ownership.mutationAllowed)}</span>
        </div>
        <div>
          <span className="text-forge-text-muted">Ownership valid:</span>{' '}
          <span className="font-mono font-semibold">{ownership.ownershipValid === null ? 'UNKNOWN' : String(ownership.ownershipValid)}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3">
        <ClaimList title="Effective write claims" claims={ownership.effectiveWriteClaims} />
        <ClaimList title="Historical write claims" claims={ownership.historicalWriteClaims} />
      </div>

      {ownership.reasonCodes.length > 0 && (
        <div>
          <h4 className="text-xs font-medium text-forge-text-muted mb-1">Reason codes</h4>
          <ul className="space-y-0.5">
            {ownership.reasonCodes.map((code) => (
              <li key={code} className="text-xs font-mono text-forge-warning break-all">
                {code}
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-[11px] text-forge-text-muted">
        Ownership facts come exclusively from the canonical ForgeLoop projection. Historical claims are never active claims.
      </p>
    </div>
  );
}
