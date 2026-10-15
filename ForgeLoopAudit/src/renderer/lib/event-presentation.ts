/**
 * Event ledger presentation rules.
 *
 * Presentation never reinterprets ForgeLoop lifecycle authority: it only maps
 * canonical event names to filters and tones. Abandonment is deliberately kept
 * distinct from completion, and provenance refreshes (contract revision,
 * checkpoint revalidation, reconciliation) are never rendered as execution.
 */

export const EVENT_FILTERS = [
  'all',
  'verification',
  'lifecycle',
  'diagnosis',
  'actions',
  'approvals',
  'trajectory',
  'continuity',
  'policy',
  'errors',
] as const;

export type EventFilter = (typeof EVENT_FILTERS)[number];

export type EventTone =
  | 'danger'
  | 'success'
  | 'warning'
  | 'accent'
  | 'neutral';

function includesAny(event: string, needles: readonly string[]): boolean {
  return needles.some((needle) => event.includes(needle));
}

export function matchesEventFilter(event: string, filter: string): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'verification':
      return includesAny(event, ['VERIFICATION']);
    case 'lifecycle':
      return includesAny(event, ['STARTED', 'COMPLETED', 'VALIDATED', 'ABANDONED', 'REVISED', 'REVALIDATED']);
    case 'policy':
      return includesAny(event, ['POLICY', 'GATE']);
    case 'diagnosis':
      return includesAny(event, ['DIAGNOSTIC', 'HYPOTHESIS', 'INTERVENTION', 'REFLECTION']);
    case 'actions':
      return includesAny(event, ['ACTION']);
    case 'approvals':
      return includesAny(event, ['APPROVAL']);
    case 'trajectory':
      return includesAny(event, ['TRAJECTORY', 'EVALUATION', 'CYCLE']);
    case 'continuity':
      return includesAny(event, ['CONTINUITY', 'RECOVERY', 'SESSION', 'RECONCILED', 'REVALIDATED']);
    case 'errors':
      return includesAny(event, ['REJECTED', 'BLOCKED', 'FAILED']);
    default:
      return true;
  }
}

/**
 * Map a canonical event name to a presentation tone.
 *
 * `TASK_ABANDONED` is intentionally `warning`, never `success`: abandonment
 * terminates work without completion, publication, or evidence. Unknown future
 * events fall back to `neutral` instead of being guessed at.
 */
export function eventTone(event: string): EventTone {
  if (event.includes('ABANDONED')) return 'warning';
  // Provenance refreshes are checked before completion tokens: `REVALIDATED`
  // contains `VALIDATED`, but a checkpoint refresh is never a validation
  // success and never implies new execution or completion.
  if (includesAny(event, ['REVISED', 'REVALIDATED', 'RECONCILED'])) return 'accent';
  if (includesAny(event, ['REJECTED', 'BLOCKED', 'FAILED', 'COMMIT_UNKNOWN'])) return 'danger';
  if (includesAny(event, ['COMPLETED', 'VALIDATED', 'SATISFIED'])) return 'success';
  if (includesAny(event, ['ACTION', 'APPROVAL'])) return 'warning';
  if (includesAny(event, ['STARTED', 'RECORDED'])) return 'accent';
  return 'neutral';
}

export const EVENT_TONE_CLASS: Record<EventTone, string> = {
  danger: 'text-forge-danger',
  success: 'text-forge-success',
  warning: 'text-forge-warning',
  accent: 'text-forge-accent',
  neutral: 'text-forge-text-secondary',
};
