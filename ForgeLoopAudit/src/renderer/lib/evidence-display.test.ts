import { describe, expect, it } from 'vitest';
import { formatEvidenceSummary } from './evidence-display';

describe('evidence display', () => {
  it('keeps partial evidence distinct from covered evidence', () => {
    expect(formatEvidenceSummary({ covered: 4, partial: 2, notVerified: 1, blocked: 0 })).toBe('4 covered · 2 partial · 1 not verified');
  });
});
