import { describe, it, expect } from 'vitest';
import { PHASE_ORDER } from '@shared/domain';

describe('shared/domain', () => {
  describe('PHASE_ORDER', () => {
    it('should define all ForgeLoop phases', () => {
      const expectedPhases = [
        'RECEIVED',
        'DISCOVERING',
        'CONTRACT_READY',
        'ROUTED',
        'DESIGNING',
        'PLANNED',
        'EXECUTING',
        'VERIFYING',
        'DIAGNOSING',
        'CORRECTING',
        'REVIEWING',
        'COMPLETE',
        'BLOCKED',
      ];

      for (const phase of expectedPhases) {
        expect(PHASE_ORDER).toHaveProperty(phase);
      }
    });

    it('should have RECEIVED as the first phase', () => {
      const values = Object.values(PHASE_ORDER);
      expect(Math.min(...values)).toBe(PHASE_ORDER.RECEIVED);
    });

    it('should have COMPLETE as the last normal phase', () => {
      const normalPhases = [
        'RECEIVED',
        'DISCOVERING',
        'CONTRACT_READY',
        'ROUTED',
        'DESIGNING',
        'PLANNED',
        'EXECUTING',
        'VERIFYING',
        'REVIEWING',
        'COMPLETE',
      ];

      const maxOrder = Math.max(...normalPhases.map((p) => PHASE_ORDER[p as keyof typeof PHASE_ORDER]));
      expect(PHASE_ORDER.COMPLETE).toBe(maxOrder);
    });

    it('should have each phase with a unique order', () => {
      const values = Object.values(PHASE_ORDER);
      const uniqueValues = new Set(values);
      expect(uniqueValues.size).toBe(values.length);
    });
  });
});
