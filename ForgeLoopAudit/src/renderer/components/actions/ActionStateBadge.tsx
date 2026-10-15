import type { DurableActionState } from '@shared/domain';
import { cn } from '../../lib/utils';

const styles: Record<DurableActionState, string> = {
  PROPOSED: 'bg-forge-info/10 text-forge-info',
  AUTHORIZED: 'bg-forge-warning/10 text-forge-warning',
  STARTED: 'bg-forge-accent/10 text-forge-accent',
  COMMITTED: 'bg-forge-warning/10 text-forge-warning',
  VERIFIED: 'bg-forge-success/10 text-forge-success',
  FAILED: 'bg-forge-danger/10 text-forge-danger',
  COMMIT_UNKNOWN: 'bg-forge-danger/15 text-forge-danger ring-1 ring-forge-danger/30',
  CANCELLED: 'bg-forge-border-subtle text-forge-text-muted',
  UNKNOWN: 'bg-forge-border-subtle text-forge-text-muted',
};

export function ActionStateBadge({ state }: { state: DurableActionState }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 px-2 py-0.5 rounded-6 text-[11px] font-semibold tracking-wide', styles[state])}>
      <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full bg-current" />
      {state}
    </span>
  );
}
