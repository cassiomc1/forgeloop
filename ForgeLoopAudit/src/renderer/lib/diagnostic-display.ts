import type { CanonicalInspectionViewModel, CanonicalReflectionViewModel, TraceInterventionViewModel } from '@shared/domain';

export function formatIntervention(intervention: TraceInterventionViewModel): string {
  const identifier = intervention.id ?? 'Unknown intervention';
  const statement = intervention.statement ?? intervention.kind;
  return `${identifier} — ${statement}`;
}

export function isStalledReflection(reflection: Pick<CanonicalReflectionViewModel, 'status'> | null | undefined): boolean {
  return reflection?.status === 'STALLED';
}

export function openHypothesisPresentation(count: number | null, ids: string[]): { summary: string; items: string[] } {
  if (count === null) return { summary: 'Unknown / not verified', items: ids };
  if (count === 0) return { summary: '0 open hypotheses', items: [] };
  if (ids.length > 0) return { summary: `${count} open hypotheses`, items: ids };
  return {
    summary: `${count} open hypotheses`,
    items: ['Exact hypothesis IDs unavailable in continuity projection.'],
  };
}

export function countInspectionSignals(inspection: CanonicalInspectionViewModel | null | undefined): number {
  if (!inspection) return 0;

  let count = 0;
  if (inspection.ok !== null) count += 1;
  if (inspection.task.id !== null) count += 1;
  if (inspection.task.phase !== null) count += 1;
  if (inspection.progress.status !== null) count += 1;
  if (inspection.next.command !== null) count += 1;
  return count;
}
