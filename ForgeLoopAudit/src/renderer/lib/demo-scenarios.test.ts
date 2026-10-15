import { describe, expect, it } from 'vitest';
import { classifyDemoScenario, DEMO_SCENARIOS } from './demo-scenarios';

const EXPECTED_SCENARIOS: Array<[string, string]> = [
  ['TASK-001', 'COMPLETE'],
  ['TASK-002', 'VERIFYING'],
  ['TASK-003', 'EXECUTING'],
  ['TASK-004', 'BLOCKED'],
  ['TASK-005', 'PLANNED'],
  ['TASK-006', 'COMPLETE'],
  ['TASK-007', 'PLANNED'],
  ['TASK-008', 'ROUTED'],
];

describe('DEMO_SCENARIOS registry', () => {
  it('contains exactly the eight documented demo scenarios', () => {
    expect(DEMO_SCENARIOS.map((s) => [s.taskId, s.expectedPhase])).toEqual(EXPECTED_SCENARIOS);
  });
});

describe('classifyDemoScenario', () => {
  for (const [taskId, phase] of EXPECTED_SCENARIOS) {
    it(`reports an intentional scenario for ${taskId} in its expected ${phase} phase`, () => {
      const match = classifyDemoScenario({ taskId, phase: phase as never });
      expect(match.kind).toBe('intentional');
      if (match.kind === 'intentional') {
        expect(match.scenario.taskId).toBe(taskId);
        expect(match.scenario.label.length).toBeGreaterThan(0);
        expect(match.scenario.summary.length).toBeGreaterThan(0);
      }
    });
  }

  it('reports drift when a known task is in an unexpected phase', () => {
    expect(
      classifyDemoScenario({ taskId: 'TASK-004', phase: 'COMPLETE' }),
    ).toEqual({
      kind: 'drift',
      scenario: expect.objectContaining({
        taskId: 'TASK-004',
        expectedPhase: 'BLOCKED',
      }),
      actualPhase: 'COMPLETE',
    });
  });

  it('reports drift for other known-task phase changes', () => {
    expect(classifyDemoScenario({ taskId: 'TASK-002', phase: 'BLOCKED' }).kind).toBe('drift');
    expect(classifyDemoScenario({ taskId: 'TASK-005', phase: 'EXECUTING' }).kind).toBe('drift');
    expect(classifyDemoScenario({ taskId: 'TASK-001', phase: 'VERIFYING' }).kind).toBe('drift');
  });

  it('reports unknown tasks without a scenario', () => {
    expect(classifyDemoScenario({ taskId: 'TASK-999', phase: 'EXECUTING' })).toEqual({ kind: 'unknown' });
  });

  it('accepts only taskId and phase so validation errors stay outside the classifier', () => {
    // Safety boundary: the classifier cannot see artifactErrors/gateErrors,
    // so a blocked-by-design task with real errors is still only classified
    // by its lifecycle phase. Errors remain independent error channels.
    expect(classifyDemoScenario({ taskId: 'TASK-004', phase: 'BLOCKED' }).kind)
      .toBe('intentional');
  });
});
