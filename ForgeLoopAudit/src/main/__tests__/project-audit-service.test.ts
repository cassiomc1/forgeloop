import { describe, expect, it, vi } from 'vitest';
import type { ProjectSnapshot, TaskSummary, TaskReflectionView, ForgeLoopFeatureSupport } from '@shared/domain';
import type { ForgeLoopIntegrationAdapter } from '@main/core/integration/forgeloop-integration';
import type { CanonicalObservabilityService } from '@main/core/integration/canonical-observability';
import { createProjectAuditService } from '@main/core/audit/project-audit-service';

const featureSupport: ForgeLoopFeatureSupport = {
  canonicalOwnership: true,
  observability: true,
  structuredDiagnostics: true,
  durableActions: true,
  approvals: true,
  capabilityPolicy: true,
  trajectoryMetrics: true,
  trajectoryEvaluations: true,
  verificationExecutionIsolation: true,
  workspaceBinding: true,
  canonicalHandoffs: true,
  responsibilityConstraints: true,
  differentialVerificationScope: true,
  codeAttestation: true,
  advisoryContextProviders: true,
  structuralQuality: true,
};

function taskSummary(taskId: string, coveragePercent = 100): TaskSummary {
  return {
    taskId,
    taskKey: taskId.toLowerCase(),
    objective: `Objective for ${taskId}`,
    phase: 'VERIFYING',
    selectedGuides: [],
    completedSteps: [],
    pendingSteps: [],
    blockers: [],
    failures: [],
    checks: [],
    gates: [],
    evidenceCoverage: {
      total: coveragePercent === 100 ? 2 : 4,
      covered: coveragePercent === 100 ? 2 : 2,
      partial: coveragePercent === 100 ? 0 : 1,
      notVerified: coveragePercent === 100 ? 0 : 1,
      blocked: 0,
      coveragePercent,
    },
    ownership: {
      claimState: 'RELEASED_BY_COMPLETION',
      mutationAllowed: false,
      ownershipValid: true,
      historicalWriteClaims: [],
      effectiveWriteClaims: [],
      reasonCodes: [],
      source: 'FORGELOOP_INTEGRATION',
    },
    operationalState: 'READ_ONLY_UNKNOWN',
  };
}

function projectSnapshot(tasks: TaskSummary[]): ProjectSnapshot {
  return {
    project: { name: 'Audit fixture', rootPath: '/project', branch: 'main', head: 'abc123' },
    protocol: {
      protocolVersion: 1,
      schemaVersion: 1,
      packageVersion: '1.10.0',
      compatible: true,
      compatibilityMode: 'INTEGRATION_V1',
    },
    health: { status: 'VALID', source: 'FORGELOOP_STATUS_AGGREGATE' },
    observations: {
      taskCount: tasks.length,
      evidence: { covered: 0, partial: 0, notVerified: 0, blocked: 0 },
      continuity: { present: 0, missing: tasks.length },
      artifactValidationErrors: 0,
      ownership: { activeCount: 0, recoveredResumeRequiredCount: 0, inconsistentCount: 0, unavailableCount: 0 },
    },
    tasks,
    sessions: [],
    updatedAt: '2026-09-04T00:00:00.000Z',
  };
}

function integrationAdapter(): ForgeLoopIntegrationAdapter {
  return {
    getPackageVersion: () => '1.10.0',
    getCapabilities: () => ({
      packageVersion: '1.10.0',
      protocolVersion: 1,
      integrationApiVersion: 1,
      executorParity: true,
      features: { taskClaimRecovery: { version: 1, durableRecoveryState: true, explicitResume: true, validatedClaimProjection: true } },
      resources: [],
      commands: [],
    }),
    readProtocolInfo: vi.fn(),
    listTasks: vi.fn(),
    readTaskStatus: vi.fn(),
    readTaskOwnership: vi.fn(),
    readTaskContract: vi.fn(),
    readTaskContinuity: vi.fn(),
    readTaskStructuralQuality: vi.fn().mockResolvedValue({
      taskId: 'TASK-001',
      mode: 'gate',
      provider: 'canonical',
      baseline: { status: 'PASS', qualitySignal: 0.9, artifactRef: 'quality-baseline.json' },
      current: { status: 'FAIL', verificationCycle: 2, attempt: 1, qualitySignal: 0.6, delta: -0.3, bottleneck: 'duplication', artifactRef: 'quality-current.json' },
      comparable: true,
      completionRequired: true,
      reasonCodes: ['QUALITY_BELOW_GATE'],
      next: 'Improve the structural quality score.',
      evidenceKind: 'OBSERVED',
    }),
    executeReadOnly: vi.fn().mockImplementation(async (_root: string, command: string, input: Record<string, unknown>) => ({
      ok: true,
      command,
      exitCode: 1,
      result: { taskId: input.taskId, status: 'VALID', errors: [], warnings: [] },
      error: null,
      metadata: null,
    })),
  };
}

function reflection(): TaskReflectionView {
  return {
    available: true,
    source: 'FORGELOOP_INTEGRATION',
    feature: 'reflect',
    data: {
      status: 'STALLED',
      verificationCycles: 3,
      hypotheses: { created: 1, supported: 0, weakened: 0, falsified: 0, superseded: 0, unresolved: 1, open: 1 },
      stallAnalysis: {
        latestNoGain: true,
        consecutiveNoGainCycles: 3,
        sameStrategyAsPrevious: true,
        sameFailureSurfaceAsPrevious: true,
        sameFailureSignaturesAsPrevious: false,
      },
      informationGain: { cyclesWithoutEffectiveGain: [1, 2, 3] },
      recommendedProtocolAction: 'Change the verification strategy.',
    },
    result: null,
    exitCode: 0,
    error: null,
  };
}

describe('ProjectAuditService', () => {
  it('audits every canonical task through the integration boundary and aggregates quality plus derived findings', async () => {
    const integration = integrationAdapter();
    const observability = {
      getReflection: vi.fn().mockResolvedValue(reflection()),
    } as unknown as CanonicalObservabilityService;
    const service = createProjectAuditService({
      projectRoot: '/project',
      getSnapshot: vi.fn().mockResolvedValue(projectSnapshot([taskSummary('TASK-001', 50)])),
      integration,
      observability,
      compatibilityMode: 'INTEGRATION_V1',
      featureSupport,
    });

    const result = await service.auditProject();

    expect(integration.executeReadOnly).toHaveBeenCalledWith('/project', 'audit', { taskId: 'TASK-001' });
    expect(integration.readTaskStructuralQuality).toHaveBeenCalledWith('/project', 'TASK-001');
    expect(observability.getReflection).toHaveBeenCalledWith('/project', 'TASK-001');
    expect(result.verdict).toMatchObject({ integrity: 'VALID', completionReadiness: 'VALID', quality: 'FAIL', trust: 'VALID' });
    expect(result.coverage).toMatchObject({ canonicalAudit: true, structuralQuality: true, percent: 100 });
    expect(result.findings.map((finding) => finding.code)).toEqual(expect.arrayContaining(['FLA-QUALITY-001', 'FLA-EFF-001', 'FLA-EVID-001']));
    expect(result.taskAudits[0]).toMatchObject({ taskId: 'TASK-001', status: 'VALID', structuralQualityStatus: 'FAIL' });
  });

  it('keeps artifact-only and incompatible projects explicitly unavailable', async () => {
    const snapshot = projectSnapshot([taskSummary('TASK-001')]);
    for (const compatibilityMode of ['ARTIFACT_ONLY', 'INCOMPATIBLE'] as const) {
      const service = createProjectAuditService({
        projectRoot: '/project',
        getSnapshot: vi.fn().mockResolvedValue(snapshot),
        integration: null,
        compatibilityMode,
      });

      const result = await service.auditProject();

      expect(result.verdict.completionReadiness).toBe('UNKNOWN');
      expect(result.coverage.canonicalAudit).toBe(false);
      expect(result.findings[0]).toMatchObject({ code: 'E_CANONICAL_AUDIT_UNAVAILABLE', source: 'FORGELOOP_CANONICAL_AUDIT' });
    }
  });

  it('audits a requested unknown task without inventing a canonical result', async () => {
    const integration = integrationAdapter();
    const service = createProjectAuditService({
      projectRoot: '/project',
      getSnapshot: vi.fn().mockResolvedValue(projectSnapshot([])),
      integration,
      compatibilityMode: 'INTEGRATION_V1',
      featureSupport: { ...featureSupport, structuralQuality: false },
    });

    const result = await service.auditTask('TASK-MISSING');

    expect(result.taskId).toBe('TASK-MISSING');
    expect(result.canonical.taskId).toBe('TASK-MISSING');
    expect(result.structuralQuality).toBeNull();
    expect(integration.executeReadOnly).toHaveBeenCalledWith('/project', 'audit', { taskId: 'TASK-MISSING' });
  });

  it('reduces coverage and integrity when the canonical audit invocation is unavailable', async () => {
    const integration = integrationAdapter();
    vi.mocked(integration.executeReadOnly).mockResolvedValue({
      ok: false,
      command: 'audit',
      exitCode: -1,
      result: null,
      error: { code: 'E_CLI_UNAVAILABLE', message: 'ForgeLoop audit runtime unavailable.' },
      metadata: null,
    });
    const service = createProjectAuditService({
      projectRoot: '/project',
      getSnapshot: vi.fn().mockResolvedValue(projectSnapshot([taskSummary('TASK-001')])),
      integration,
      compatibilityMode: 'INTEGRATION_V1',
      featureSupport,
    });

    const result = await service.auditProject();

    expect(result.coverage.canonicalAudit).toBe(false);
    expect(result.verdict.integrity).toBe('UNKNOWN');
    expect(result.verdict.trust).toBe('UNKNOWN');
    expect(result.score).toBeNull();
  });
});
