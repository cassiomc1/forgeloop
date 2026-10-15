import type {
  CanonicalDiagnosticCaseViewModel,
  CanonicalHistoryQualityViewModel,
  CanonicalHistoryViewModel,
  CanonicalInspectionViewModel,
  CanonicalReflectionViewModel,
  CanonicalTaskProjectionViewModel,
  CanonicalTraceViewModel,
  TraceInterventionKind,
  TraceInterventionViewModel,
} from '@shared/domain';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function asNumberArray(value: unknown): number[] {
  return Array.isArray(value) ? value.filter((entry): entry is number => typeof entry === 'number') : [];
}

function normalizeTask(value: unknown): CanonicalTaskProjectionViewModel {
  const record = asRecord(value);
  return {
    id: asString(record.id),
    phase: asString(record.phase),
    status: asString(record.status),
    revision: asNumber(record.revision),
    verificationCycle: asNumber(record.verificationCycle),
    present: record.present === true,
  };
}

function normalizeHistoryQuality(value: unknown): CanonicalHistoryQualityViewModel {
  const record = asRecord(value);
  const level = asString(record.level);
  return {
    level: level === 'COMPLETE' || level === 'PARTIAL' || level === 'MINIMAL' ? level : 'UNKNOWN',
    reasons: asStringArray(record.reasons),
  };
}

function normalizeDiagnosticCase(value: unknown): CanonicalDiagnosticCaseViewModel | null {
  const record = asRecord(value);
  const nextSafeAction = asRecord(record.nextSafeAction);
  return {
    sequence: asNumber(record.sequence),
    at: asString(record.at),
    verificationCycle: asNumber(record.verificationCycle),
    diagnosticRevision: asNumber(record.diagnosticRevision),
    failureClass: asString(record.failureClass),
    hypothesisIds: Array.isArray(record.hypotheses)
      ? record.hypotheses
        .map((entry) => asString(asRecord(entry).id))
        .filter((entry): entry is string => entry !== null)
      : [],
    nextSafeAction: asString(nextSafeAction.statement),
    diagnosticFingerprint: asString(record.diagnosticFingerprint),
  };
}

function normalizeInterventionKind(value: unknown): TraceInterventionKind {
  switch (value) {
    case 'CODE_CHANGE':
    case 'CONFIG_CHANGE':
    case 'TEST_CHANGE':
    case 'FIXTURE_CHANGE':
    case 'ENVIRONMENT_CHANGE':
    case 'DEPENDENCY_CHANGE':
    case 'ROLLBACK':
    case 'ISOLATION':
    case 'INSTRUMENTATION':
    case 'NO_MUTATION_EXPERIMENT':
    case 'OTHER':
      return value;
    default:
      return 'UNKNOWN';
  }
}

function normalizeIntervention(value: unknown): TraceInterventionViewModel {
  const record = asRecord(value);
  return {
    id: asString(record.id),
    kind: normalizeInterventionKind(record.kind),
    statement: asString(record.statement),
    hypothesisRefs: asStringArray(record.hypothesisRefs),
    reversible: asBoolean(record.reversible),
  };
}

export function normalizeCanonicalHistory(value: unknown): CanonicalHistoryViewModel {
  const record = asRecord(value);
  const summary = asRecord(record.summary);
  return {
    task: normalizeTask(record.task),
    summary: {
      eventCount: asNumber(summary.eventCount),
      totalEventCount: asNumber(summary.totalEventCount),
      checkAttemptCount: asNumber(summary.checkAttemptCount),
      failedAttemptCount: asNumber(summary.failedAttemptCount),
      diagnosticCaseCount: asNumber(summary.diagnosticCaseCount),
      interventionCount: asNumber(summary.interventionCount),
    },
    historyQuality: normalizeHistoryQuality(record.historyQuality),
  };
}

export function normalizeCanonicalTrace(value: unknown): CanonicalTraceViewModel {
  const record = asRecord(value);
  const diagnostics = asRecord(record.diagnostics);
  const actions = asRecord(record.actions);
  return {
    task: normalizeTask(record.task),
    failureSurfaces: Array.isArray(record.failureSurfaces)
      ? record.failureSurfaces
        .filter((entry) => entry && typeof entry === 'object')
        .map((entry) => {
          const surface = asRecord(entry);
          return {
            verificationCycle: asNumber(surface.verificationCycle),
            surface: asStringArray(surface.surface),
            size: asNumber(surface.size),
          };
        })
      : [],
    failureSignatures: Array.isArray(record.failureSignatures)
      ? record.failureSignatures
        .filter((entry) => entry && typeof entry === 'object')
        .map((entry) => {
          const signature = asRecord(entry);
          return {
            signature: asString(signature.signature),
            cycles: asNumberArray(signature.cycles),
            requirements: asStringArray(signature.requirements),
          };
        })
      : [],
    diagnostics: {
      cases: Array.isArray(diagnostics.cases)
        ? diagnostics.cases
          .filter((entry) => entry && typeof entry === 'object')
          .map(normalizeDiagnosticCase)
          .filter((entry): entry is CanonicalDiagnosticCaseViewModel => entry !== null)
        : [],
      interventions: Array.isArray(diagnostics.interventions)
        ? diagnostics.interventions
          .filter((entry) => entry && typeof entry === 'object')
          .map((entry) => {
            const interventionRecord = asRecord(entry);
            return {
              sequence: asNumber(interventionRecord.sequence),
              at: asString(interventionRecord.at),
              verificationCycle: asNumber(interventionRecord.verificationCycle),
              intervention: normalizeIntervention(interventionRecord.intervention),
            };
          })
        : [],
      dispositions: Array.isArray(diagnostics.dispositions)
        ? diagnostics.dispositions
          .filter((entry) => entry && typeof entry === 'object')
          .map((entry) => {
            const disposition = asRecord(entry);
            return {
              sequence: asNumber(disposition.sequence),
              at: asString(disposition.at),
              verificationCycle: asNumber(disposition.verificationCycle),
              hypothesisRef: asString(disposition.hypothesisRef),
              status: asString(disposition.status),
            };
          })
        : [],
    },
    actions: {
      total: asNumber(actions.total),
      ambiguous: asNumber(actions.ambiguous),
    },
  };
}

export function normalizeCanonicalReflection(value: unknown): CanonicalReflectionViewModel {
  const record = asRecord(value);
  const hypotheses = asRecord(record.hypotheses);
  const stallAnalysis = asRecord(record.stallAnalysis);
  const informationGain = asRecord(record.informationGain);
  const status = asString(record.status);

  return {
    status: status === 'ADVANCING' || status === 'WATCH' || status === 'STALLED' ? status : 'UNKNOWN',
    verificationCycles: asNumber(record.verificationCycles),
    hypotheses: {
      created: asNumber(hypotheses.created),
      supported: asNumber(hypotheses.supported),
      weakened: asNumber(hypotheses.weakened),
      falsified: asNumber(hypotheses.falsified),
      superseded: asNumber(hypotheses.superseded),
      unresolved: asNumber(hypotheses.unresolved),
      open: asNumber(hypotheses.open),
    },
    stallAnalysis: {
      latestNoGain: asBoolean(stallAnalysis.latestNoGain),
      consecutiveNoGainCycles: asNumber(stallAnalysis.consecutiveNoGainCycles),
      sameStrategyAsPrevious: asBoolean(stallAnalysis.sameStrategyAsPrevious),
      sameFailureSurfaceAsPrevious: asBoolean(stallAnalysis.sameFailureSurfaceAsPrevious),
      sameFailureSignaturesAsPrevious: asBoolean(stallAnalysis.sameFailureSignaturesAsPrevious),
    },
    informationGain: {
      cyclesWithoutEffectiveGain: asNumberArray(informationGain.cyclesWithoutEffectiveGain),
    },
    recommendedProtocolAction: asString(record.recommendedProtocolAction),
  };
}

export function normalizeCanonicalInspection(value: unknown): CanonicalInspectionViewModel {
  const record = asRecord(value);
  const task = asRecord(record.task);
  const progress = asRecord(record.progress);
  const next = asRecord(record.next);

  return {
    ok: asBoolean(record.ok),
    task: {
      id: asString(task.id),
      phase: asString(task.phase),
    },
    progress: {
      status: asString(progress.status),
    },
    next: {
      command: asString(next.command),
    },
  };
}
