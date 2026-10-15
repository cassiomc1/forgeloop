import { describe, it, expect } from 'vitest';
import {
  parseClaimState,
  safeStringArray,
  FORGELOOP_CLAIM_STATES,
} from '@shared/domain';

describe('shared/domain ownership types', () => {
  describe('FORGELOOP_CLAIM_STATES', () => {
    it('declares exactly the canonical ForgeLoop 1.5 claim states', () => {
      expect([...FORGELOOP_CLAIM_STATES].sort()).toEqual(
        ['ACTIVE', 'INCONSISTENT', 'RELEASED_BY_COMPLETION', 'RELEASED_BY_RECOVERY'].sort(),
      );
    });
  });

  describe('parseClaimState', () => {
    it('accepts every canonical claim state verbatim', () => {
      expect(parseClaimState('ACTIVE')).toBe('ACTIVE');
      expect(parseClaimState('RELEASED_BY_COMPLETION')).toBe('RELEASED_BY_COMPLETION');
      expect(parseClaimState('RELEASED_BY_RECOVERY')).toBe('RELEASED_BY_RECOVERY');
      expect(parseClaimState('INCONSISTENT')).toBe('INCONSISTENT');
    });

    it('never casts unknown values into a canonical state', () => {
      expect(parseClaimState('SOMETHING_NEW_IN_1_6')).toBe('UNKNOWN');
      expect(parseClaimState('active')).toBe('UNKNOWN');
      expect(parseClaimState('')).toBe('UNKNOWN');
    });

    it('treats missing values as UNKNOWN instead of guessing', () => {
      expect(parseClaimState(null)).toBe('UNKNOWN');
      expect(parseClaimState(undefined)).toBe('UNKNOWN');
      expect(parseClaimState(42)).toBe('UNKNOWN');
    });
  });

  describe('safeStringArray', () => {
    it('keeps only string entries', () => {
      expect(safeStringArray(['a', 1, null, 'b'])).toEqual(['a', 'b']);
    });

    it('returns empty array for non-array input', () => {
      expect(safeStringArray(undefined)).toEqual([]);
      expect(safeStringArray(null)).toEqual([]);
      expect(safeStringArray('claims')).toEqual([]);
    });
  });
});
