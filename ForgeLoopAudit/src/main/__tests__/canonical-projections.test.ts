import { describe, expect, it, vi } from 'vitest';
import { createCanonicalActionsService } from '@main/core/integration/canonical-actions';
import { createCanonicalObservabilityService } from '@main/core/integration/canonical-observability';
import { createCanonicalTrajectoryService } from '@main/core/integration/canonical-trajectory';
import type { ForgeLoopIntegrationAdapter } from '@main/core/integration/forgeloop-integration';

function adapterWith(overrides: Partial<ForgeLoopIntegrationAdapter> = {}): ForgeLoopIntegrationAdapter {
  return {
    getPackageVersion: () => '1.6.1',
    getCapabilities: () => ({}) as never,
    readProtocolInfo: async () => ({}),
    listTasks: async () => ({ count: 0, tasks: [] }),
    readTaskStatus: async () => ({}),
    readTaskOwnership: async () => ({}) as never,
    readTaskContract: async () => ({}),
    readTaskContinuity: async () => ({}),
    executeReadOnly: vi.fn(async (_root: string, command: string, _input?: Record<string, unknown>) => ({
      ok: true,
      command,
      exitCode: 0,
      result: { command },
      error: null,
      metadata: null,
    })) as unknown as ForgeLoopIntegrationAdapter['executeReadOnly'],
    ...overrides,
  };
}

const allFeatures = {
  observability: true,
  durableActions: true,
  approvals: true,
  capabilityPolicy: true,
  trajectoryMetrics: true,
  trajectoryEvaluations: true,
  verificationExecutionIsolation: true,
} as const;

describe('canonical read-only projection services', () => {
  it('routes observability through the allowlisted ForgeLoop command boundary', async () => {
    const integration = adapterWith();
    const service = createCanonicalObservabilityService({ integration, featureSupport: allFeatures as never });
    const [history, trace, view, inspection] = await Promise.all([
      service.getHistory('/project', 'TASK-001'),
      service.getTrace('/project', 'TASK-001'),
      service.getReflection('/project', 'TASK-001'),
      service.getInspection('/project', 'TASK-001'),
    ]);

    expect(view).toMatchObject({ available: true, source: 'FORGELOOP_INTEGRATION', feature: 'reflect' });
    expect(view.data).toMatchObject({ status: 'UNKNOWN', verificationCycles: null });
    expect(view.result).toEqual(view.data);
    expect(history.feature).toBe('history');
    expect(trace.feature).toBe('trace');
    expect(inspection.feature).toBe('inspect');
    // verify normalization preserves allowlisted command boundary but normalizes payload shapes
    expect(history.data).toMatchObject({ historyQuality: { level: 'UNKNOWN' } });
    expect(trace.data).toMatchObject({ diagnostics: expect.any(Object) });
    expect(inspection.data).toMatchObject({ ok: null });
    expect(integration.executeReadOnly).toHaveBeenCalledWith('/project', 'reflect', { taskId: 'TASK-001' });
  });

  it('does not invoke ForgeLoop when an optional observability feature is unavailable', async () => {
    const integration = adapterWith();
    const service = createCanonicalObservabilityService({ integration, featureSupport: { ...allFeatures, observability: false } as never });
    const view = await service.getTrace('/project', 'TASK-001');

    expect(view.available).toBe(false);
    expect(view.error?.code).toBe('E_FEATURE_UNAVAILABLE');
    expect(integration.executeReadOnly).not.toHaveBeenCalled();
  });

  it('preserves canonical invocation failures and reports thrown reads separately', async () => {
    const failed = adapterWith({
      executeReadOnly: vi.fn(async <T>() => ({
        ok: false,
        command: 'history',
        exitCode: 7,
        result: null as T | null,
        error: { code: 'E_HISTORY_UNAVAILABLE', message: 'history unavailable' },
        metadata: null,
      })) as unknown as ForgeLoopIntegrationAdapter['executeReadOnly'],
    });
    const failureView = await createCanonicalObservabilityService({ integration: failed, featureSupport: allFeatures as never }).getHistory('/project', 'TASK-001');
    expect(failureView).toMatchObject({ available: false, exitCode: 7, error: { code: 'E_HISTORY_UNAVAILABLE' } });

    const thrown = adapterWith({
      executeReadOnly: vi.fn().mockRejectedValue(new Error('transport failed')) as unknown as ForgeLoopIntegrationAdapter['executeReadOnly'],
    });
    const thrownView = await createCanonicalObservabilityService({ integration: thrown }).getTrace('/project', 'TASK-001');
    expect(thrownView).toMatchObject({ available: false, exitCode: -1, error: { code: 'E_CANONICAL_OBSERVABILITY_INVOCATION', message: 'transport failed' } });
  });

  it('keeps action lifecycle state distinct from canonical readiness metrics', async () => {
    const integration = adapterWith({
      readTaskActions: async () => ({ actions: [
        { actionId: 'action-verified', state: 'VERIFIED', effectClass: 'READ_ONLY', requiredForCompletion: false },
        { actionId: 'action-unknown', state: 'NEW_STATE', effectClass: 'NEW_EFFECT', requiredForCompletion: true },
        null,
      ] }),
      readTaskApprovals: async () => ({ approvals: [
        { approvalId: 'approval-1', status: 'PENDING' },
        { approvalId: 'approval-2', status: 'APPROVED', decision: 'APPROVED', authorityKind: 'HOST_ATTESTED' },
        { approvalId: 'approval-3', status: 'REJECTED', decision: 'REJECTED', authorityKind: 'CALLER_ACKNOWLEDGED' },
        { approvalId: 'approval-4', status: 'NEW_STATUS', decision: 'NEW_DECISION', authorityKind: 'NEW_AUTHORITY' },
      ] }),
      readTaskMetrics: async () => ({ actions: { total: 2, trustedSatisfied: 0, unresolvedRequired: 1, failed: 0, ambiguous: 1 } }),
    });
    const service = createCanonicalActionsService({ integration, featureSupport: allFeatures });
    const view = await service.getActions('/project', 'TASK-001');

    expect(view.available).toBe(true);
    expect(view.actions[0].state).toBe('VERIFIED');
    expect(view.actions[1].state).toBe('UNKNOWN');
    expect(view.actions[1].effectClass).toBe('UNKNOWN');
    expect(view.actions[2].actionId).toBe('unknown-action');
    expect(view.readiness).toMatchObject({ satisfied: 0, unresolved: 1, ambiguous: 1, source: 'FORGELOOP_INTEGRATION' });
    expect(view.approvals[0].status).toBe('PENDING');
    expect(view.approvals[1]).toMatchObject({ status: 'APPROVED', decision: 'APPROVED', authorityKind: 'HOST_ATTESTED' });
    expect(view.approvals[2]).toMatchObject({ status: 'REJECTED', decision: 'REJECTED', authorityKind: 'CALLER_ACKNOWLEDGED' });
    expect(view.approvals[3]).toMatchObject({ status: 'UNKNOWN', decision: null, authorityKind: null });
  });

  it('still reads actions when optional metrics or approval readers are absent', async () => {
    const integration = adapterWith({
      readTaskActions: async () => ({ actions: [{ actionId: 'action-1', state: 'PROPOSED' }] }),
      readTaskApprovals: undefined,
      readTaskMetrics: undefined,
    });
    const service = createCanonicalActionsService({ integration, featureSupport: { durableActions: true, approvals: false, trajectoryMetrics: false } });
    const view = await service.getActions('/project', 'TASK-001');

    expect(view.available).toBe(true);
    expect(view.actions).toHaveLength(1);
    expect(view.approvals).toEqual([]);
    expect(view.approvalsAvailable).toBe(false);
    expect(view.readiness).toBeNull();
    expect(view.readinessAvailable).toBe(false);
    expect(view.warnings).toEqual([]);
  });

  it('marks approvalsAvailable true when approvals reader succeeds with empty list', async () => {
    const integration = adapterWith({
      readTaskActions: async () => ({ actions: [{ actionId: 'action-1', state: 'PROPOSED' }] }),
      readTaskApprovals: async () => ({ approvals: [] }),
    });
    const service = createCanonicalActionsService({
      integration,
      featureSupport: { durableActions: true, approvals: true, trajectoryMetrics: false },
    });
    const view = await service.getActions('/project', 'TASK-001');

    expect(view.available).toBe(true);
    expect(view.approvalsAvailable).toBe(true);
    expect(view.approvals).toEqual([]);
    expect(view.warnings).toEqual([]);
  });

  it('does not invoke readTaskMetrics when trajectoryMetrics is not negotiated', async () => {
    const readTaskMetrics = vi.fn().mockResolvedValue({ actions: { total: 1 } });
    const integration = adapterWith({
      readTaskActions: async () => ({ actions: [{ actionId: 'action-1', state: 'PROPOSED' }] }),
      readTaskMetrics,
    });
    const service = createCanonicalActionsService({
      integration,
      featureSupport: { durableActions: true, approvals: true, trajectoryMetrics: false },
    });
    const view = await service.getActions('/project', 'TASK-001');

    expect(readTaskMetrics).not.toHaveBeenCalled();
    expect(view.readinessAvailable).toBe(false);
    expect(view.readiness).toBeNull();
    expect(view.warnings).toEqual([]);
  });

  it('sets readinessAvailable false when metrics projection is missing actions data', async () => {
    const integration = adapterWith({
      readTaskActions: async () => ({ actions: [{ actionId: 'action-1', state: 'PROPOSED' }] }),
      readTaskMetrics: async () => ({ timing: { wallClockMs: 100 } }),
    });
    const service = createCanonicalActionsService({
      integration,
      featureSupport: { durableActions: true, approvals: true, trajectoryMetrics: true },
    });
    const view = await service.getActions('/project', 'TASK-001');

    expect(view.readiness).toBeNull();
    expect(view.readinessAvailable).toBe(false);
    expect(view.warnings).toEqual([]);
  });

  it('isolates approval reader failures and keeps primary actions visible with warning', async () => {
    const integration = adapterWith({
      readTaskActions: async () => ({ actions: [{ actionId: 'action-1', state: 'PROPOSED' }] }),
      readTaskApprovals: vi.fn().mockRejectedValue(new Error('approval read network failure')),
      readTaskMetrics: async () => ({ actions: { total: 1, trustedSatisfied: 1 } }),
    });
    const service = createCanonicalActionsService({ integration, featureSupport: allFeatures });
    const view = await service.getActions('/project', 'TASK-001');

    expect(view.available).toBe(true);
    expect(view.actions).toHaveLength(1);
    expect(view.approvals).toEqual([]);
    expect(view.approvalsAvailable).toBe(false);
    expect(view.readiness).toMatchObject({ satisfied: 1 });
    expect(view.readinessAvailable).toBe(true);
    expect(view.error).toBeNull();
    expect(view.warnings).toEqual([
      {
        code: 'E_CANONICAL_APPROVALS_UNAVAILABLE',
        message: 'approval read network failure',
      },
    ]);
  });

  it('isolates metrics reader failures and keeps primary actions visible with warning', async () => {
    const integration = adapterWith({
      readTaskActions: async () => ({ actions: [{ actionId: 'action-1', state: 'PROPOSED' }] }),
      readTaskApprovals: async () => ({ approvals: [{ approvalId: 'app-1', status: 'PENDING' }] }),
      readTaskMetrics: vi.fn().mockRejectedValue(new Error('metrics timeout')),
    });
    const service = createCanonicalActionsService({ integration, featureSupport: allFeatures });
    const view = await service.getActions('/project', 'TASK-001');

    expect(view.available).toBe(true);
    expect(view.actions).toHaveLength(1);
    expect(view.approvals).toHaveLength(1);
    expect(view.approvalsAvailable).toBe(true);
    expect(view.readiness).toBeNull();
    expect(view.readinessAvailable).toBe(false);
    expect(view.error).toBeNull();
    expect(view.warnings).toEqual([
      {
        code: 'E_CANONICAL_METRICS_UNAVAILABLE',
        message: 'metrics timeout',
      },
    ]);
  });

  it('fails closed when primary actions read fails', async () => {
    const integration = adapterWith({
      readTaskActions: vi.fn().mockRejectedValue(new Error('actions disk error')),
      readTaskApprovals: async () => ({ approvals: [{ approvalId: 'app-1', status: 'PENDING' }] }),
      readTaskMetrics: async () => ({ actions: { total: 1 } }),
    });
    const service = createCanonicalActionsService({ integration, featureSupport: allFeatures });
    const view = await service.getActions('/project', 'TASK-001');

    expect(view.available).toBe(false);
    expect(view.source).toBe('UNAVAILABLE');
    expect(view.actions).toEqual([]);
    expect(view.approvals).toEqual([]);
    expect(view.error).toEqual({
      code: 'E_CANONICAL_ACTIONS_INVOCATION',
      message: 'actions disk error',
    });
  });

  it('gates action detail and approval reads without guessing missing data', async () => {
    const integration = adapterWith({
      readTaskAction: async () => ({ actionId: 'action-1', state: 'FAILED', effectClass: 'DESTRUCTIVE' }),
      readTaskApprovals: async () => [{ approvalId: 'approval-1', status: 'APPROVED' }] as never,
    });
    const service = createCanonicalActionsService({ integration, featureSupport: allFeatures });
    await expect(service.getAction('/project', 'TASK-001', 'action-1')).resolves.toMatchObject({ actionId: 'action-1', state: 'FAILED', effectClass: 'DESTRUCTIVE' });
    await expect(service.getApprovals('/project', 'TASK-001')).resolves.toMatchObject([{ approvalId: 'approval-1', status: 'APPROVED' }]);

    const unavailable = createCanonicalActionsService({ integration, featureSupport: { durableActions: false, approvals: false } });
    await expect(unavailable.getAction('/project', 'TASK-001', 'action-1')).resolves.toBeNull();
    await expect(unavailable.getApprovals('/project', 'TASK-001')).resolves.toEqual([]);

    const failing = adapterWith({
      readTaskAction: vi.fn().mockRejectedValue(new Error('action unavailable')),
      readTaskApprovals: vi.fn().mockRejectedValue(new Error('approval unavailable')),
    });
    const failingService = createCanonicalActionsService({ integration: failing, featureSupport: allFeatures });
    await expect(failingService.getAction('/project', 'TASK-001', 'action-1')).resolves.toBeNull();
    await expect(failingService.getApprovals('/project', 'TASK-001')).resolves.toEqual([]);
  });

  it('renders capability policy in canonical form and keeps unavailable states explicit', async () => {
    const integration = adapterWith({
      readCapabilityPolicy: async () => ({
        policy: {
          defaultDecision: 'DENY',
          rules: [
            { capability: 'filesystem.read', decision: 'ALLOW' },
            { capability: 'filesystem.write', decision: 'REQUIRE_APPROVAL' },
            { capability: 'process.execute', decision: 'REQUIRE_AUTHORITY' },
            { capability: 'unknown', decision: 'NEW_DECISION' },
            null,
          ],
        },
        fingerprint: 'a'.repeat(64),
        path: '.forgeloop/policy/capabilities.json',
      }),
    });
    const service = createCanonicalActionsService({ integration, featureSupport: allFeatures });
    await expect(service.getCapabilityPolicy('/project')).resolves.toMatchObject({
      available: true,
      defaultDecision: 'DENY',
      fingerprint: 'a'.repeat(64),
      path: '.forgeloop/policy/capabilities.json',
      rules: [
        { capability: 'filesystem.read', decision: 'ALLOW' },
        { capability: 'filesystem.write', decision: 'REQUIRE_APPROVAL' },
        { capability: 'process.execute', decision: 'REQUIRE_AUTHORITY' },
        { capability: 'unknown', decision: 'UNKNOWN' },
      ],
    });

    const empty = adapterWith({ readCapabilityPolicy: async () => null });
    await expect(createCanonicalActionsService({ integration: empty, featureSupport: allFeatures }).getCapabilityPolicy('/project')).resolves.toMatchObject({ available: true, rules: [] });
    const raw = adapterWith({ readCapabilityPolicy: async () => ({ defaultDecision: 'ALLOW', rules: [] }) });
    await expect(createCanonicalActionsService({ integration: raw, featureSupport: allFeatures }).getCapabilityPolicy('/project')).resolves.toMatchObject({ defaultDecision: 'ALLOW' });
    const unavailable = createCanonicalActionsService({ integration, featureSupport: { capabilityPolicy: false } });
    await expect(unavailable.getCapabilityPolicy('/project')).resolves.toMatchObject({ available: false, error: { code: 'E_FEATURE_UNAVAILABLE' } });
    const missing = createCanonicalActionsService({ integration: adapterWith({ readCapabilityPolicy: undefined }), featureSupport: allFeatures });
    await expect(missing.getCapabilityPolicy('/project')).resolves.toMatchObject({ available: false, error: { code: 'E_CANONICAL_CAPABILITY_POLICY_INVOCATION' } });
  });

  it('returns canonical trajectory metrics and evaluations without recomputation', async () => {
    const metrics = { trajectory: { verificationCycles: 2 }, usage: { tokens: null, source: 'UNKNOWN' } };
    const integration = adapterWith({
      readTaskMetrics: async () => metrics,
      readTaskEvaluations: async () => ({ evaluations: [{ evaluationId: 'eval-1', result: 'FAIL' }] }),
    });
    const service = createCanonicalTrajectoryService({ integration, featureSupport: allFeatures });

    await expect(service.getMetrics('/project', 'TASK-001')).resolves.toMatchObject({
      available: true,
      source: 'FORGELOOP_INTEGRATION',
      metrics,
    });
    await expect(service.getEvaluations('/project', 'TASK-001')).resolves.toMatchObject({
      available: true,
      evaluations: [{ evaluationId: 'eval-1', result: 'FAIL' }],
    });
  });

  it('degrades trajectory projections when readers are missing or fail', async () => {
    const missing = adapterWith({ readTaskMetrics: undefined, readTaskEvaluations: undefined });
    const service = createCanonicalTrajectoryService({ integration: missing, featureSupport: allFeatures });
    await expect(service.getMetrics('/project', 'TASK-001')).resolves.toMatchObject({ available: false, error: { code: 'E_CANONICAL_METRICS_INVOCATION' } });
    await expect(service.getEvaluations('/project', 'TASK-001')).resolves.toMatchObject({ available: false, error: { code: 'E_CANONICAL_EVALUATIONS_INVOCATION' } });

    const unavailable = createCanonicalTrajectoryService({ integration: adapterWith(), featureSupport: { trajectoryMetrics: false, trajectoryEvaluations: false } });
    await expect(unavailable.getMetrics('/project', 'TASK-001')).resolves.toMatchObject({ available: false, error: { code: 'E_FEATURE_UNAVAILABLE' } });
    await expect(unavailable.getEvaluations('/project', 'TASK-001')).resolves.toMatchObject({ available: false, error: { code: 'E_FEATURE_UNAVAILABLE' } });

    const arrays = adapterWith({ readTaskEvaluations: async () => [{ evaluationId: 'eval-array' }, 'invalid'] as never });
    await expect(createCanonicalTrajectoryService({ integration: arrays, featureSupport: allFeatures }).getEvaluations('/project', 'TASK-001')).resolves.toMatchObject({ evaluations: [{ evaluationId: 'eval-array' }] });
  });
});
