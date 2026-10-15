import type { DurableApprovalView } from '@shared/domain';
import { cn } from '../../lib/utils';

const styles: Record<DurableApprovalView['status'], string> = {
  PENDING: 'bg-forge-warning/10 text-forge-warning',
  APPROVED: 'bg-forge-success/10 text-forge-success',
  REJECTED: 'bg-forge-danger/10 text-forge-danger',
  UNKNOWN: 'bg-forge-border-subtle text-forge-text-muted',
};

export function ApprovalBadge({ status }: { status: DurableApprovalView['status'] }) {
  return <span className={cn('inline-flex px-2 py-0.5 rounded-6 text-[11px] font-semibold', styles[status])}>{status}</span>;
}
