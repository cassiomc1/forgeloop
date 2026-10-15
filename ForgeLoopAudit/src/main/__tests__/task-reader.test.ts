import { describe, it, expect } from 'vitest';
import { buildTaskSummary, getRawArtifact } from '@main/core/tasks/task-reader';
import type { RawTaskArtifacts } from '@main/core/tasks/task-reader';

describe('task-reader', () => {
  describe('buildTaskSummary', () => {
    it('should return defaults for empty artifacts', () => {
      const result = buildTaskSummary('test-task', {});

      expect(result.taskId).toBe('test-task');
      expect(result.taskKey).toBe('test-task');
      expect(result.phase).toBe('RECEIVED');
      expect(result.blockers).toEqual([]);
      expect(result.failures).toEqual([]);
      expect(result.checks).toEqual([]);
      expect(result.gates).toEqual([]);
    });

    it('should extract taskId from task.json', () => {
      const artifacts: RawTaskArtifacts = {
        'task.json': { taskId: 'my-task-id' },
      };
      const result = buildTaskSummary('test-key', artifacts);
      expect(result.taskId).toBe('my-task-id');
    });

    it('should extract objective from contract.json', () => {
      const artifacts: RawTaskArtifacts = {
        'contract.json': { objective: 'Build the feature' },
      };
      const result = buildTaskSummary('test-key', artifacts);
      expect(result.objective).toBe('Build the feature');
    });

    it('should extract phase from work-state.json', () => {
      const artifacts: RawTaskArtifacts = {
        'work-state.json': { phase: 'EXECUTING' },
      };
      const result = buildTaskSummary('test-key', artifacts);
      expect(result.phase).toBe('EXECUTING');
    });

    it('should extract selectedGuides from work-state.json', () => {
      const artifacts: RawTaskArtifacts = {
        'work-state.json': { selectedGuides: ['guide-a', 'guide-b'] },
      };
      const result = buildTaskSummary('test-key', artifacts);
      expect(result.selectedGuides).toEqual(['guide-a', 'guide-b']);
    });

    it('should extract completedSteps and pendingSteps', () => {
      const artifacts: RawTaskArtifacts = {
        'work-state.json': {
          completedSteps: ['step-1', 'step-2'],
          pendingSteps: ['step-3'],
        },
      };
      const result = buildTaskSummary('test-key', artifacts);
      expect(result.completedSteps).toEqual(['step-1', 'step-2']);
      expect(result.pendingSteps).toEqual(['step-3']);
    });

    it('should parse evidence coverage from work-state.json', () => {
      const artifacts: RawTaskArtifacts = {
        'work-state.json': {
          evidenceCoverage: [
            { status: 'COVERED' },
            { status: 'COVERED' },
            { status: 'PARTIAL' },
            { status: 'NOT_COVERED' },
          ],
        },
      };
      const result = buildTaskSummary('test-key', artifacts);
      expect(result.evidenceCoverage.total).toBe(4);
      expect(result.evidenceCoverage.covered).toBe(2);
      expect(result.evidenceCoverage.partial).toBe(1);
      expect(result.evidenceCoverage.notVerified).toBe(1);
      expect(result.evidenceCoverage.coveragePercent).toBe(63);
    });

    it('should parse blockers from work-state.json', () => {
      const artifacts: RawTaskArtifacts = {
        'work-state.json': {
          blockers: [{ id: 'b1', message: 'Blocked by dependency' }],
        },
      };
      const result = buildTaskSummary('test-key', artifacts);
      expect(result.blockers).toHaveLength(1);
      expect(result.blockers[0].id).toBe('b1');
      expect(result.blockers[0].message).toBe('Blocked by dependency');
    });

    it('should parse checks from work-state.json', () => {
      const artifacts: RawTaskArtifacts = {
        'work-state.json': {
          checks: [
            { id: 'c1', requirement: 'Must compile', status: 'passed', evidenceKind: 'OBSERVED' },
            { id: 'c2', requirement: 'Must pass tests', status: 'failed', evidenceKind: 'NOT_VERIFIED' },
          ],
        },
      };
      const result = buildTaskSummary('test-key', artifacts);
      expect(result.checks).toHaveLength(2);
      expect(result.checks[0].status).toBe('passed');
      expect(result.checks[1].status).toBe('failed');
    });

    it('should build gates from preflight.json and work-state.json', () => {
      const artifacts: RawTaskArtifacts = {
        'preflight.json': {
          requiredGates: ['compile', 'tests'],
          satisfiedGates: ['compile'],
        },
        'work-state.json': {
          gates: [{ id: 'compile', name: 'Compilation Gate', status: 'satisfied' }],
        },
      };
      const result = buildTaskSummary('test-key', artifacts);
      expect(result.gates).toHaveLength(2);
      const compileGate = result.gates.find((g) => g.id === 'compile');
      expect(compileGate?.status).toBe('satisfied');
      const testsGate = result.gates.find((g) => g.id === 'tests');
      expect(testsGate?.status).toBe('unverified');
    });

    it('should parse continuity from continuity.json', () => {
      const artifacts: RawTaskArtifacts = {
        'continuity.json': {
          taskId: 'task-1', phase: 'EXECUTING', updatedAt: '2026-08-20T00:00:00Z',
          remainingWork: [{ id: 'work-1', summary: 'Write tests' }], knownIssues: [{ id: 'issue-1', summary: 'Missing dependency' }],
        },
      };
      const result = buildTaskSummary('test-key', artifacts);
      expect(result.continuity).toBeDefined();
      expect(result.continuity?.taskId).toBe('task-1');
      expect(result.continuity?.remainingWork).toEqual([{ id: 'work-1', summary: 'Write tests' }]);
      expect(result.continuity?.knownIssues).toEqual([{ id: 'issue-1', summary: 'Missing dependency' }]);
    });

    it('preserves canonical diagnostic-context fields needed by diagnostics', () => {
      const artifacts: RawTaskArtifacts = {
        'continuity.json': {
          continuity: {
            taskId: 'TASK-002',
            phase: 'VERIFYING',
          },
          diagnosticContext: {
            present: true,
            activeFailureSignatures: ['sig-1'],
            activeFailedRequirements: ['Corrupted persisted carts are discarded safely'],
            openHypotheses: ['h-cart-parser'],
            latestIntervention: 'intervention-cart-guard',
            nextExperiment: 'Run verification cycle 2',
            doNotRepeat: ['repeat-semantic-fingerprint'],
          },
        },
      };

      const result = buildTaskSummary('task-key', artifacts);

      expect(result.continuity?.diagnosticContext).toEqual({
        present: true,
        activeFailureSignatures: ['sig-1'],
        activeFailedRequirements: ['Corrupted persisted carts are discarded safely'],
        openHypotheses: ['h-cart-parser'],
        latestIntervention: 'intervention-cart-guard',
        nextExperiment: 'Run verification cycle 2',
        doNotRepeat: [{ summary: 'repeat-semantic-fingerprint' }],
      });
      expect(result.continuity?.diagnosticContext).not.toHaveProperty('verificationCycle');
      expect(result.continuity?.diagnosticContext).not.toHaveProperty('guidance');
      expect(result.continuity?.diagnosticContext).not.toHaveProperty('stall');
    });

    it('should build nextAction from nextResult', () => {
      const artifacts: RawTaskArtifacts = {};
      const nextResult = {
        nextAction: 'VERIFY_RULE',
        currentPhase: 'VERIFYING',
        terminal: false,
      };
      const result = buildTaskSummary('test-key', artifacts, nextResult);
      expect(result.nextAction).toBeDefined();
      expect(result.nextAction?.action).toBe('VERIFY_RULE');
      expect(result.nextAction?.type).toBe('progress');
      expect(result.nextAction?.currentPhase).toBe('VERIFYING');
    });

    it('should return undefined nextAction for COMPLETE phase', () => {
      const artifacts: RawTaskArtifacts = {
        'work-state.json': { phase: 'COMPLETE' },
      };
      const result = buildTaskSummary('test-key', artifacts);
      expect(result.nextAction).toBeUndefined();
    });

    it('should use taskKey as fallback when taskId is missing', () => {
      const result = buildTaskSummary('fallback-key', {});
      expect(result.taskId).toBe('fallback-key');
    });
  });

  describe('getRawArtifact', () => {
    it('should return stringified JSON for object artifacts', () => {
      const artifacts: RawTaskArtifacts = {
        'task.json': { key: 'value' },
      };
      const result = getRawArtifact(artifacts, 'task.json');
      expect(result).toBe(JSON.stringify({ key: 'value' }, null, 2));
    });

    it('should return string artifacts directly', () => {
      const artifacts: RawTaskArtifacts = {
        'events.ndjson': '{"event":"test"}\n',
      };
      const result = getRawArtifact(artifacts, 'events.ndjson');
      expect(result).toBe('{"event":"test"}\n');
    });

    it('should return undefined for missing artifacts', () => {
      const artifacts: RawTaskArtifacts = {};
      const result = getRawArtifact(artifacts, 'task.json');
      expect(result).toBeUndefined();
    });
  });
});
