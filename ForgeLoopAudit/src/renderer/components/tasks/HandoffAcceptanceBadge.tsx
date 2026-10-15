import type { HandoffAcceptanceView } from '@shared/domain';
import { cn } from '../../lib/utils';

function acceptanceLabel(acceptance: HandoffAcceptanceView | null): string {
  if (!acceptance) return 'Acceptance not reported';
  switch (acceptance.status) {
    case 'ACCEPTED': return 'Accepted — operational receipt only';
    case 'UNBOUND': return 'Legacy unbound handoff';
    case 'INCONSISTENT': return 'Acceptance history inconsistent';
    case 'OPEN': return 'Open';
    default: return 'Acceptance unknown';
  }
}

function acceptanceTone(acceptance: HandoffAcceptanceView | null): string {
  if (acceptance?.status === 'ACCEPTED') return 'bg-forge-success/10 text-forge-success';
  if (acceptance?.status === 'INCONSISTENT') return 'bg-forge-danger/10 text-forge-danger';
  if (acceptance?.status === 'UNBOUND') return 'bg-forge-warning/10 text-forge-warning';
  return 'bg-forge-border-subtle text-forge-text-muted';
}

export function HandoffAcceptanceBadge({ acceptance }: { acceptance: HandoffAcceptanceView | null }) {
  return (
    <span
      className={cn('inline-flex rounded-6 px-2 py-1 text-[11px] font-semibold', acceptanceTone(acceptance))}
      title={acceptance?.status === 'ACCEPTED' ? 'No claims transferred. No evidence or authority is created by acceptance.' : undefined}
    >
      {acceptanceLabel(acceptance)}
    </span>
  );
}

export function HandoffAcceptanceDetail({ acceptance }: { acceptance: HandoffAcceptanceView | null }) {
  if (!acceptance) return <p className="text-xs text-forge-text-muted">Acceptance projection not reported by ForgeLoop.</p>;
  return (
    <div className="space-y-1 text-xs text-forge-text-secondary">
      <p><HandoffAcceptanceBadge acceptance={acceptance} /></p>
      {acceptance.status === 'ACCEPTED' && (
        <p title="No claims transferred. No evidence or authority is created by acceptance.">
          No claims transferred. No evidence or authority is created by acceptance.
        </p>
      )}
      {acceptance.consumerId && <p>Consumer: <strong>{acceptance.consumerId}</strong></p>}
      {acceptance.harness && <p>Harness: <strong>{acceptance.harness}</strong></p>}
      {acceptance.acceptedAt && <p>Accepted at: <strong>{acceptance.acceptedAt}</strong></p>}
      {acceptance.reasonCodes.length > 0 && <p>Reason codes: <span className="font-mono">{acceptance.reasonCodes.join(', ')}</span></p>}
    </div>
  );
}
