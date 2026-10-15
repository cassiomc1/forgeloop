import { PHASE_ORDER } from '@shared/domain';
import type { TaskSummary, ForgeLoopPhase, EvidenceCoverageSummary, BlockerSummary, FailureSummary, CheckSummary, GateSummary, NextActionSummary, ContinuitySummary, ContinuityWorkItem, TaskOwnershipSummary, TaskRecoverySummary, DiagnosticContextSummary } from '@shared/domain';
import type { AllowedArtifact } from '@shared/domain';

export interface RawTaskArtifacts {
  'task.json'?: Record<string, unknown>;
  'contract.json'?: Record<string, unknown>;
  'routing-result.json'?: Record<string, unknown>;
  'preflight.json'?: Record<string, unknown>;
  'work-state.json'?: Record<string, unknown>;
  'continuity.json'?: Record<string, unknown>;
  'recovery.json'?: Record<string, unknown>;
  'execution-receipt.json'?: Record<string, unknown>;
  'policy-snapshot.json'?: Record<string, unknown>;
  'events.ndjson'?: string;
  artifactErrors?: string[];
}

function safeString(obj: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = obj?.[key];
  return typeof value === 'string' ? value : undefined;
}

function safeStringArray(obj: Record<string, unknown> | undefined, key: string): string[] {
  const value = obj?.[key];
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function safeNumber(obj: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = obj?.[key];
  return typeof value === 'number' ? value : undefined;
}

function safeGateArtifacts(value: unknown): Array<{ path: string; sha256: string }> | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is { path: string; sha256: string } => {
    if (!item || typeof item !== 'object') return false;
    const record = item as Record<string, unknown>;
    return typeof record.path === 'string' && typeof record.sha256 === 'string';
  });
}

function safeEvidenceObjects(value: unknown): Array<Record<string, unknown>> | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item));
}

function parsePhase(value: unknown): ForgeLoopPhase | undefined {
  if (typeof value !== 'string') return undefined;
  return PHASE_ORDER[value as ForgeLoopPhase] !== undefined ? (value as ForgeLoopPhase) : undefined;
}

function buildEvidenceCoverage(workState: Record<string, unknown> | undefined): EvidenceCoverageSummary {
  const evidenceCoverage = workState?.evidenceCoverage as unknown[] | undefined;
  if (!Array.isArray(evidenceCoverage)) {
    return { total: 0, covered: 0, partial: 0, notVerified: 0, blocked: 0, coveragePercent: 0 };
  }

  let covered = 0;
  let partial = 0;
  let notVerified = 0;
  let blocked = 0;

  for (const item of evidenceCoverage) {
    if (item && typeof item === 'object' && 'status' in item) {
      const status = String(item.status);
      switch (status) {
        case 'COVERED':
          covered++;
          break;
        case 'PARTIAL':
          partial++;
          break;
        case 'NOT_VERIFIED':
          notVerified++;
          break;
        case 'BLOCKED':
          blocked++;
          break;
        default:
          notVerified++;
      }
    }
  }

  const total = evidenceCoverage.length;
  const coveragePercent = total > 0 ? Math.round(((covered + partial * 0.5) / total) * 100) : 0;

  return { total, covered, partial, notVerified, blocked, coveragePercent };
}

function buildBlockers(workState: Record<string, unknown> | undefined): BlockerSummary[] {
  const blockers = workState?.blockers as unknown[] | undefined;
  if (!Array.isArray(blockers)) return [];

  return blockers
    .filter((b): b is Record<string, unknown> => b !== null && typeof b === 'object')
    .map((b) => ({
      id: safeString(b, 'id') || 'unknown',
      message: safeString(b, 'message') || safeString(b, 'reason') || 'Unknown blocker',
      phase: parsePhase(b.phase),
    }));
}

function buildFailures(workState: Record<string, unknown> | undefined): FailureSummary[] {
  const failures = workState?.failures as unknown[] | undefined;
  if (!Array.isArray(failures)) return [];

  return failures
    .filter((f): f is Record<string, unknown> => f !== null && typeof f === 'object')
    .map((f) => ({
      id: safeString(f, 'id') || 'unknown',
      message: safeString(f, 'message') || safeString(f, 'reason') || 'Unknown failure',
      phase: parsePhase(f.phase),
      verificationCycle: safeNumber(f, 'verificationCycle'),
    }));
}

function buildChecks(workState: Record<string, unknown> | undefined): CheckSummary[] {
  const checks = workState?.checks as unknown[] | undefined;
  if (!Array.isArray(checks)) return [];

  return checks
    .filter((c): c is Record<string, unknown> => c !== null && typeof c === 'object')
    .map((c) => ({
      id: safeString(c, 'id') || 'unknown',
      requirement: safeString(c, 'requirement') || safeString(c, 'text') || 'Unknown requirement',
      status: (safeString(c, 'status') as CheckSummary['status']) || 'not-run',
      evidenceKind: (safeString(c, 'evidenceKind') as CheckSummary['evidenceKind']) || 'NOT_VERIFIED',
      verificationCycle: safeNumber(c, 'verificationCycle'),
      timestamp: safeString(c, 'timestamp'),
    }));
}

function buildGates(workState: Record<string, unknown> | undefined, preflight: Record<string, unknown> | undefined): GateSummary[] {
  const requiredGates = safeStringArray(preflight, 'requiredGates');
  const satisfiedGates = safeStringArray(preflight, 'satisfiedGates');
  const gates = workState?.gates as unknown[] | undefined;

  const gateMap = new Map<string, GateSummary>();

  for (const gateId of requiredGates) {
    const satisfied = satisfiedGates.includes(gateId);
    gateMap.set(gateId, {
      id: gateId,
      name: gateId,
      status: satisfied ? 'satisfied' : 'unverified',
    });
  }

  if (Array.isArray(gates)) {
    for (const gate of gates) {
      if (gate && typeof gate === 'object') {
        const gateObj = gate as Record<string, unknown>;
        const id = safeString(gateObj, 'id') || safeString(gateObj, 'name');
        if (id) {
          const existing = gateMap.get(id);
          gateMap.set(id, {
            id,
            name: safeString(gateObj, 'name') || id,
            status: (safeString(gateObj, 'status') as GateSummary['status']) || existing?.status || 'unverified',
            requiredBy: safeStringArray(gateObj, 'requiredBy'),
            decisions: safeStringArray(gateObj, 'decisions'),
            unknowns: safeStringArray(gateObj, 'unknowns'),
            approvedAssumptions: safeStringArray(gateObj, 'approvedAssumptions'),
            artifacts: safeGateArtifacts(gateObj.artifacts),
            evidence: safeEvidenceObjects(gateObj.evidence),
          });
        }
      }
    }
  }

  return Array.from(gateMap.values());
}

function buildNextAction(_workState: Record<string, unknown> | undefined, nextResult: Record<string, unknown> | undefined): NextActionSummary | undefined {
  if (nextResult) {
    const action = safeString(nextResult, 'nextAction');
    if (!action) return undefined;
    const terminal = nextResult.terminal === true || action === 'NONE';
    return { type: terminal ? 'terminal' : 'progress', action, terminal, currentPhase: parsePhase(nextResult.currentPhase), reasonCodes: safeStringArray(nextResult, 'reasonCodes'), missingArtifacts: safeStringArray(nextResult, 'missingArtifacts'), commandSynopses: safeStringArray(nextResult, 'commands'), reasons: Array.isArray(nextResult.reasons) ? nextResult.reasons as NextActionSummary['reasons'] : [] };
  }
  return undefined;
}

function parseWorkItems(value: unknown): ContinuityWorkItem[] {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object').map((item) => ({ id: safeString(item, 'id') || 'unknown', summary: safeString(item, 'summary') || 'Unknown work item' })) : [];
}

function buildDiagnosticContext(value: unknown): DiagnosticContextSummary | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const context = value as Record<string, unknown>;
  const readStrings = (key: string): string[] => Array.isArray(context[key])
    ? (context[key] as unknown[]).filter((entry): entry is string => typeof entry === 'string')
    : [];
  const rawDoNotRepeat = Array.isArray(context.doNotRepeat) ? context.doNotRepeat : [];
  return {
    present: context.present === true,
    activeFailureSignatures: readStrings('activeFailureSignatures'),
    activeFailedRequirements: readStrings('activeFailedRequirements'),
    openHypotheses: readStrings('openHypotheses'),
    latestIntervention: safeString(context, 'latestIntervention') ?? null,
    nextExperiment: safeString(context, 'nextExperiment') ?? null,
    doNotRepeat: rawDoNotRepeat.map((entry) => {
      if (typeof entry === 'string') return { summary: entry };
      if (entry && typeof entry === 'object') {
        const record = entry as Record<string, unknown>;
        return {
          id: safeString(record, 'id'),
          summary: safeString(record, 'summary') || safeString(record, 'fingerprint') || 'Repeated intervention',
          reason: safeString(record, 'reason'),
        };
      }
      return { summary: String(entry) };
    }),
  };
}

export function buildContinuity(continuity: Record<string, unknown> | undefined): ContinuitySummary | undefined {
  if (!continuity) return undefined;

  const canonicalContinuity = continuity.continuity && typeof continuity.continuity === 'object' && !Array.isArray(continuity.continuity)
    ? continuity.continuity as Record<string, unknown>
    : continuity;
  const diagnosticContext = buildDiagnosticContext(continuity.diagnosticContext ?? canonicalContinuity.diagnosticContext);

  return {
    taskId: safeString(canonicalContinuity, 'taskId'),
    phase: safeString(canonicalContinuity, 'phase'),
    updatedAt: safeString(canonicalContinuity, 'updatedAt'),
    currentFocus: canonicalContinuity.currentFocus,
    remainingWork: parseWorkItems(canonicalContinuity.remainingWork),
    knownIssues: parseWorkItems(canonicalContinuity.knownIssues),
    changedAreas: safeStringArray(canonicalContinuity, 'changedAreas'),
    inspectFirst: safeStringArray(canonicalContinuity, 'inspectFirst'),
    resumeNote: safeString(canonicalContinuity, 'resumeNote'),
    repositoryFingerprint: canonicalContinuity.repositoryFingerprint,
    verificationCycle: safeNumber(canonicalContinuity, 'verificationCycle'),
    diagnosticContext,
  };
}

export function buildRecoverySummary(
  rawRecovery: Record<string, unknown> | undefined,
  ownershipSummary: TaskOwnershipSummary,
): TaskRecoverySummary {
  const canonicalRecovered =
    ownershipSummary.source === 'FORGELOOP_INTEGRATION' && ownershipSummary.claimState === 'RELEASED_BY_RECOVERY';
  const hasArtifact = Boolean(rawRecovery) && typeof rawRecovery === 'object';

  if (!canonicalRecovered && !hasArtifact) {
    return { status: 'NONE', releasedClaims: [], reasonCodes: [], resumeRequired: false, source: 'UNAVAILABLE' };
  }

  if (!canonicalRecovered && hasArtifact) {
    if (ownershipSummary.source === 'FORGELOOP_INTEGRATION') {
      // Canonical authority resolved the recovery (e.g. resumed): the raw
      // artifact is history, never a live recovery state.
      return { status: 'NONE', releasedClaims: [], reasonCodes: [], resumeRequired: false, source: 'FORGELOOP_INTEGRATION' };
    }
    return {
      status: 'UNKNOWN',
      recoveryId: safeString(rawRecovery, 'recoveryId'),
      recoveredAt: safeString(rawRecovery, 'recoveredAt'),
      classificationAtRecovery: safeString(rawRecovery, 'classificationAtRecovery'),
      releasedClaims: safeStringArray(rawRecovery, 'releasedClaims'),
      reasonCodes: safeStringArray(rawRecovery, 'reasonCodes'),
      previousPhase: safeString(rawRecovery, 'previousPhase'),
      previousRevision: safeNumber(rawRecovery, 'previousRevision'),
      resumeRequired: false,
      source: 'RAW_ARTIFACT',
    };
  }

  const authority = rawRecovery?.authority;
  const authorityRecord = authority && typeof authority === 'object' ? authority as Record<string, unknown> : undefined;
  return {
    status: 'RECOVERED',
    recoveryId: safeString(rawRecovery, 'recoveryId'),
    recoveredAt: safeString(rawRecovery, 'recoveredAt'),
    classificationAtRecovery: safeString(rawRecovery, 'classificationAtRecovery'),
    releasedClaims: safeStringArray(rawRecovery, 'releasedClaims'),
    reasonCodes: ownershipSummary.reasonCodes.length > 0 ? ownershipSummary.reasonCodes : safeStringArray(rawRecovery, 'reasonCodes'),
    previousPhase: safeString(rawRecovery, 'previousPhase'),
    previousRevision: safeNumber(rawRecovery, 'previousRevision'),
    authorityKind: safeString(authorityRecord, 'kind') === 'CALLER_ACKNOWLEDGED' ? 'CALLER_ACKNOWLEDGED' : safeString(authorityRecord, 'kind') === 'HOST_ATTESTED' ? 'HOST_ATTESTED' : undefined,
    grantRef: safeString(authorityRecord, 'grantRef'),
    resumeRequired: ownershipSummary.mutationAllowed === false,
    source: 'FORGELOOP_INTEGRATION',
  };
}

export function buildTaskSummary(
  taskKey: string,
  artifacts: RawTaskArtifacts,
  nextResult?: Record<string, unknown>,
  canonicalContinuity?: Record<string, unknown>,
): TaskSummary {
  const taskJson = artifacts['task.json'];
  const workState = artifacts['work-state.json'];
  const preflight = artifacts['preflight.json'];
  const continuity = artifacts['continuity.json'];

  const taskId = safeString(taskJson, 'taskId') || taskKey;
  const phase = parsePhase(workState?.phase) || parsePhase(taskJson?.phase) || 'RECEIVED';
  const previousPhase = parsePhase(workState?.previousPhase);

  const evidenceCoverage = buildEvidenceCoverage(workState);
  const blockers = buildBlockers(workState);
  const failures = buildFailures(workState);
  const checks = buildChecks(workState);
  const gates = buildGates(workState, preflight);
  const nextAction = buildNextAction(workState, nextResult);
  const continuitySummary = buildContinuity(canonicalContinuity ?? continuity);

  return {
    taskId,
    taskKey,
    objective: safeString(artifacts['contract.json'], 'objective'),
    phase,
    previousPhase,
    selectedGuides: safeStringArray(workState, 'selectedGuides'),
    completedSteps: safeStringArray(workState, 'completedSteps'),
    pendingSteps: safeStringArray(workState, 'pendingSteps'),
    blockers,
    failures,
    checks,
    gates,
    evidenceCoverage,
    verificationCycle: safeNumber(workState, 'verificationCycle'),
    publicationStatus: safeString(workState, 'publicationStatus'),
    lastUpdated: safeString(workState, 'lastUpdated'),
    nextAction,
    continuity: continuitySummary,
    writeClaims: safeStringArray(taskJson, 'writeClaims'),
    historicalWriteClaims: safeStringArray(taskJson, 'writeClaims'),
    effectiveWriteClaims: [],
    ownership: {
      claimState: 'UNKNOWN',
      mutationAllowed: null,
      ownershipValid: null,
      historicalWriteClaims: safeStringArray(taskJson, 'writeClaims'),
      effectiveWriteClaims: [],
      reasonCodes: [],
      source: 'UNAVAILABLE',
    },
    operationalState: 'READ_ONLY_UNKNOWN',
    policySnapshot: artifacts['policy-snapshot.json'],
    artifactErrors: artifacts.artifactErrors,
  };
}

export function getRawArtifact(artifacts: RawTaskArtifacts, artifact: AllowedArtifact): string | undefined {
  const key = artifact as keyof RawTaskArtifacts;
  const value = artifacts[key];
  if (value === undefined) return undefined;
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
}
