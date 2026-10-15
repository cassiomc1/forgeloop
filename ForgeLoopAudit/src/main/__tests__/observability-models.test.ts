import { describe, expect, it } from 'vitest';
import {
  normalizeCanonicalHistory,
  normalizeCanonicalInspection,
  normalizeCanonicalReflection,
  normalizeCanonicalTrace,
} from '@main/core/integration/observability-models';

const traceFixture = {
  task: {
    id: 'TASK-002',
    phase: 'VERIFYING',
    status: null,
    revision: null,
    verificationCycle: 1,
    present: true,
  },
  failureSurfaces: [
    {
      verificationCycle: 1,
      surface: ['Corrupted persisted carts are discarded safely'],
      size: 1,
    },
  ],
  failureSignatures: [
    {
      signature: '69bec3085d4949765c52907b177d816920fa110e940b3d00d5d1427145e7f1ec',
      cycles: [1],
      requirements: ['Corrupted persisted carts are discarded safely'],
    },
  ],
  diagnostics: {
    cases: [
      {
        sequence: 14,
        at: '2026-08-04T11:01:00.000Z',
        verificationCycle: 1,
        diagnosticRevision: 1,
        failureClass: 'VERIFICATION_FAILURE',
        hypotheses: [
          {
            id: 'h-cart-parser',
            statement: 'Hydration needs a guarded parse-and-discard path for malformed carts.',
          },
        ],
        nextSafeAction: {
          statement: 'Add a reversible guard around persisted cart parsing, then run the hydration regression check.',
        },
        diagnosticFingerprint: '882794a9ecb3c63485a07e15e7ea61895e0061846b53fb6949bcb9cbd7cbb440',
      },
    ],
    interventions: [
      {
        sequence: 16,
        at: '2026-08-04T11:15:00.000Z',
        verificationCycle: 1,
        intervention: {
          id: 'intervention-cart-guard',
          kind: 'CODE_CHANGE',
          statement: 'Add a guarded parse-and-discard path for malformed persisted carts.',
          hypothesisRefs: ['h-cart-parser'],
          reversible: true,
        },
      },
    ],
    dispositions: [
      {
        sequence: 15,
        at: '2026-08-04T11:08:00.000Z',
        verificationCycle: 1,
        hypothesisRef: 'h-cart-parser',
        status: 'WEAKENED',
      },
    ],
  },
  actions: {
    total: 0,
    ambiguous: 1,
  },
};

const reflectionFixture = {
  status: 'STALLED',
  verificationCycles: 3,
  hypotheses: {
    created: 2,
    supported: 0,
    weakened: 1,
    falsified: 0,
    superseded: 0,
    unresolved: 0,
    open: 1,
  },
  stallAnalysis: {
    latestNoGain: true,
    consecutiveNoGainCycles: 2,
    sameStrategyAsPrevious: true,
    sameFailureSurfaceAsPrevious: true,
    sameFailureSignaturesAsPrevious: true,
  },
  informationGain: {
    cyclesWithoutEffectiveGain: [2, 3],
  },
  recommendedProtocolAction: 'REQUIRE_NEW_DIAGNOSTIC_INFORMATION',
};

const historyFixture = {
  summary: {
    eventCount: 16,
    totalEventCount: 16,
    checkAttemptCount: 4,
    failedAttemptCount: 2,
    diagnosticCaseCount: 1,
    interventionCount: 1,
  },
  historyQuality: {
    level: 'COMPLETE',
    reasons: [],
  },
};

const inspectionFixture = {
  ok: false,
  task: {
    id: 'TASK-002',
    phase: 'VERIFYING',
  },
  progress: {
    status: 'ADVANCING',
  },
  next: {
    command: 'forgeloop next --task TASK-002 --json',
  },
};

describe('observability model normalization', () => {
  it('normalizes canonical trace and reflection shapes without inventing local stall fields', () => {
    const trace = normalizeCanonicalTrace(traceFixture);
    const reflection = normalizeCanonicalReflection(reflectionFixture);
    const history = normalizeCanonicalHistory(historyFixture);
    const inspection = normalizeCanonicalInspection(inspectionFixture);

    expect(trace.task).toMatchObject({ id: 'TASK-002', phase: 'VERIFYING', verificationCycle: 1, present: true });
    expect(trace.failureSurfaces).toEqual([
      {
        verificationCycle: 1,
        surface: ['Corrupted persisted carts are discarded safely'],
        size: 1,
      },
    ]);
    expect(trace.diagnostics.interventions).toEqual([
      {
        sequence: 16,
        at: '2026-08-04T11:15:00.000Z',
        verificationCycle: 1,
        intervention: {
          id: 'intervention-cart-guard',
          kind: 'CODE_CHANGE',
          statement: 'Add a guarded parse-and-discard path for malformed persisted carts.',
          hypothesisRefs: ['h-cart-parser'],
          reversible: true,
        },
      },
    ]);

    expect(reflection.status).toBe('STALLED');
    expect(reflection.hypotheses.open).toBe(1);
    expect(reflection.stallAnalysis).toEqual({
      latestNoGain: true,
      consecutiveNoGainCycles: 2,
      sameStrategyAsPrevious: true,
      sameFailureSurfaceAsPrevious: true,
      sameFailureSignaturesAsPrevious: true,
    });
    expect(reflection).not.toHaveProperty('openHypotheses');
    expect(reflection.stallAnalysis).not.toHaveProperty('stalled');
    expect(reflection.stallAnalysis).not.toHaveProperty('reason');
    expect(history.summary).toMatchObject({ eventCount: 16, interventionCount: 1 });
    expect(inspection).toEqual({
      ok: false,
      task: { id: 'TASK-002', phase: 'VERIFYING' },
      progress: { status: 'ADVANCING' },
      next: { command: 'forgeloop next --task TASK-002 --json' },
    });
  });

  it('normalizes malformed observability payloads to null, UNKNOWN, and empty arrays', () => {
    const trace = normalizeCanonicalTrace({
      task: {
        id: 42,
        phase: 7,
        verificationCycle: 'x',
        present: 'yes',
      },
      failureSurfaces: ['invalid'],
      failureSignatures: [{}],
      diagnostics: {
        cases: [null],
        interventions: [{ intervention: { id: 9, kind: false, statement: null, hypothesisRefs: [1], reversible: 'yes' } }],
        dispositions: ['bad'],
      },
      actions: 'bad',
    });
    const reflection = normalizeCanonicalReflection({
      status: 'NOT_REAL',
      verificationCycles: 'three',
      hypotheses: { open: 'one' },
      stallAnalysis: {
        latestNoGain: 'true',
        consecutiveNoGainCycles: 'two',
        sameStrategyAsPrevious: 1,
        sameFailureSurfaceAsPrevious: null,
        sameFailureSignaturesAsPrevious: 'no',
      },
      informationGain: {
        cyclesWithoutEffectiveGain: [1, 'two'],
      },
      recommendedProtocolAction: 9,
    });
    const history = normalizeCanonicalHistory({ summary: { eventCount: '16' }, historyQuality: { level: 7, reasons: [1] } });
    const inspection = normalizeCanonicalInspection({ ok: 'false', task: { id: 3 }, progress: { status: {} }, next: { command: false } });

    expect(trace.task).toEqual({
      id: null,
      phase: null,
      status: null,
      revision: null,
      verificationCycle: null,
      present: false,
    });
    expect(trace.failureSurfaces).toEqual([]);
    expect(trace.failureSignatures).toEqual([{ signature: null, cycles: [], requirements: [] }]);
    expect(trace.diagnostics.cases).toEqual([]);
    expect(trace.diagnostics.interventions).toEqual([
      {
        sequence: null,
        at: null,
        verificationCycle: null,
        intervention: {
          id: null,
          kind: 'UNKNOWN',
          statement: null,
          hypothesisRefs: [],
          reversible: null,
        },
      },
    ]);
    expect(reflection.status).toBe('UNKNOWN');
    expect(reflection.verificationCycles).toBeNull();
    expect(reflection.hypotheses.open).toBeNull();
    expect(reflection.stallAnalysis).toEqual({
      latestNoGain: null,
      consecutiveNoGainCycles: null,
      sameStrategyAsPrevious: null,
      sameFailureSurfaceAsPrevious: null,
      sameFailureSignaturesAsPrevious: null,
    });
    expect(reflection.informationGain.cyclesWithoutEffectiveGain).toEqual([1]);
    expect(reflection.recommendedProtocolAction).toBeNull();
    expect(history.summary.eventCount).toBeNull();
    expect(history.historyQuality).toEqual({ level: 'UNKNOWN', reasons: [] });
    expect(inspection).toEqual({
      ok: null,
      task: { id: null, phase: null },
      progress: { status: null },
      next: { command: null },
    });
  });

  describe('canonical intervention kind vocabulary', () => {
    const canonicalKinds = [
      'CODE_CHANGE',
      'CONFIG_CHANGE',
      'TEST_CHANGE',
      'FIXTURE_CHANGE',
      'ENVIRONMENT_CHANGE',
      'DEPENDENCY_CHANGE',
      'ROLLBACK',
      'ISOLATION',
      'INSTRUMENTATION',
      'NO_MUTATION_EXPERIMENT',
      'OTHER',
    ] as const;

    it.each(canonicalKinds)('normalizes canonical kind %s accurately', (kind) => {
      const trace = normalizeCanonicalTrace({
        diagnostics: {
          interventions: [
            {
              intervention: {
                id: `int-${kind.toLowerCase()}`,
                kind,
              },
            },
          ],
        },
      });
      expect(trace.diagnostics.interventions[0]?.intervention.kind).toBe(kind);
    });

    const nonCanonicalValues = [
      'DOCUMENTATION',
      'UNKNOWN',
      'CUSTOM_CHANGE',
      'HOTFIX',
      '',
      123,
      true,
      null,
      undefined,
      {},
      [],
    ];

    it.each(nonCanonicalValues)('degrades non-canonical or unknown value %j to UNKNOWN', (value) => {
      const trace = normalizeCanonicalTrace({
        diagnostics: {
          interventions: [
            {
              intervention: {
                id: 'int-invalid',
                kind: value,
              },
            },
          ],
        },
      });
      expect(trace.diagnostics.interventions[0]?.intervention.kind).toBe('UNKNOWN');
    });
  });
});

