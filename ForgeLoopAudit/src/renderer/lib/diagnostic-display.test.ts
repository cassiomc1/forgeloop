import { describe, expect, it } from 'vitest';
import { countInspectionSignals, formatIntervention, isStalledReflection, openHypothesisPresentation } from './diagnostic-display';

describe('diagnostic display helpers', () => {
  it('formats nested intervention identity and statement', () => {
    expect(formatIntervention({
      id: 'intervention-cart-guard',
      kind: 'CODE_CHANGE',
      statement: 'Add a guarded parse-and-discard path for malformed persisted carts.',
      hypothesisRefs: ['h-cart-parser'],
      reversible: true,
    })).toBe('intervention-cart-guard — Add a guarded parse-and-discard path for malformed persisted carts.');
  });

  it('treats only the canonical stalled status as stalled', () => {
    expect(isStalledReflection({ status: 'STALLED' })).toBe(true);
    expect(isStalledReflection({ status: 'WATCH' })).toBe(false);
  });

  it('surfaces identity-unavailable copy when the count is known but the ids are absent', () => {
    expect(openHypothesisPresentation(2, [])).toEqual({
      summary: '2 open hypotheses',
      items: ['Exact hypothesis IDs unavailable in continuity projection.'],
    });
  });

  it('counts only populated inspection leaves, not empty nested objects', () => {
    expect(countInspectionSignals({
      ok: null,
      task: { id: null, phase: null },
      progress: { status: null },
      next: { command: null },
    })).toBe(0);

    expect(countInspectionSignals({
      ok: false,
      task: { id: 'TASK-002', phase: null },
      progress: { status: 'ADVANCING' },
      next: { command: null },
    })).toBe(3);
  });
});
