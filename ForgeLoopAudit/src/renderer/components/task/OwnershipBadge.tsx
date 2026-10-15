import type { TaskOperationalState } from '@shared/domain';
import { cn } from '../../lib/utils';

const BADGE_CONFIG: Record<TaskOperationalState, { label: string; className: string }> = {
  ACTIVE: { label: 'ACTIVE', className: 'bg-forge-success/10 text-forge-success' },
  COMPLETED_RELEASED: { label: 'RELEASED BY COMPLETION', className: 'bg-forge-text-muted/10 text-forge-text-muted' },
  RECOVERY_RESUME_REQUIRED: { label: 'RECOVERED — RESUME REQUIRED', className: 'bg-forge-warning/10 text-forge-warning' },
  OWNERSHIP_INCONSISTENT: { label: 'OWNERSHIP INCONSISTENT', className: 'bg-forge-danger/10 text-forge-danger' },
  BLOCKED: { label: 'BLOCKED', className: 'bg-forge-danger/10 text-forge-danger' },
  READ_ONLY_UNKNOWN: { label: 'OWNERSHIP UNAVAILABLE', className: 'bg-forge-text-muted/10 text-forge-text-muted' },
};

interface OwnershipBadgeProps {
  state: TaskOperationalState;
}

export function OwnershipBadge({ state }: OwnershipBadgeProps) {
  const config = BADGE_CONFIG[state] ?? BADGE_CONFIG.READ_ONLY_UNKNOWN;
  return (
    <span
      title="Canonical ownership state"
      aria-label={`Ownership: ${config.label}`}
      className={cn('px-2 py-0.5 rounded-6 text-[11px] font-semibold whitespace-nowrap', config.className)}
    >
      {config.label}
    </span>
  );
}
