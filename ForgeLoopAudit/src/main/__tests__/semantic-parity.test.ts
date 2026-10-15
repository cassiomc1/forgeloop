import { describe, expect, it } from 'vitest';
import { compareAuthoritativeFacts } from '@main/core/protocol/semantic-parity';

describe('CLI and artifact semantic parity', () => {
  it('reports agreement across authoritative facts', () => {
    const facts = { phase: 'EXECUTING', health: 'VALID', nextAction: 'run-check', policy: 'strict', continuity: 'resume-1' };
    expect(compareAuthoritativeFacts(facts, { ...facts })).toEqual({ consistent: true, differences: [] });
  });

  it('reports contradictions instead of selecting a winner silently', () => {
    const result = compareAuthoritativeFacts(
      { phase: 'VERIFYING', health: 'VALID' },
      { phase: 'COMPLETE', health: 'VALID' },
    );
    expect(result.consistent).toBe(false);
    expect(result.differences).toContainEqual({ field: 'phase', artifactValue: 'VERIFYING', cliValue: 'COMPLETE' });
  });
});
