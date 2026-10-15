import { createNativeDemoFixture } from '../../../scripts/demo/native-fixture.mjs';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { join } from 'node:path';
import { createForgeLoopIntegration } from '@main/core/integration/forgeloop-integration';
import type { ForgeLoopIntegrationAdapter } from '@main/core/integration/forgeloop-integration';
import { createCanonicalObservabilityService } from '@main/core/integration/canonical-observability';
import { createCanonicalActionsService } from '@main/core/integration/canonical-actions';
import { createCanonicalTrajectoryService } from '@main/core/integration/canonical-trajectory';

let DEMO_ROOT: string;
let native: ReturnType<typeof createNativeDemoFixture>;

describe('real vendored ForgeLoop projection contract', () => {
  let adapter: ForgeLoopIntegrationAdapter;

  beforeAll(async () => {
    native = createNativeDemoFixture(join(process.cwd(), 'demo'));
    DEMO_ROOT = native.root;
    adapter = await createForgeLoopIntegration();
  // Cold Linux fixture migration took 62s; the child has its own 90s bound.
  }, 120_000);

  afterAll(() => native?.cleanup());

  describe('trace projection contract', () => {
    it('matches canonical trace structure from real vendored ForgeLoop output', async () => {
      const trace = await adapter.executeReadOnly<Record<string, unknown>>(DEMO_ROOT, 'trace', { taskId: 'TASK-002' });
      expect(trace.ok).toBe(true);
      expect(trace.result).toBeDefined();

      const result = trace.result as Record<string, unknown>;
      expect(result).toHaveProperty('task.id', 'TASK-002');
      expect(result).toHaveProperty('task.phase', 'VERIFYING');
      expect(result).toHaveProperty('task.verificationCycle', 1);

      // Lock nested intervention structure
      expect(result).toHaveProperty('diagnostics.interventions.0.intervention.id', 'intervention-cart-guard');
      expect(result).toHaveProperty('diagnostics.interventions.0.intervention.kind', 'CODE_CHANGE');
      expect(result).toHaveProperty('diagnostics.interventions.0.intervention.hypothesisRefs', ['h-cart-parser']);
      expect(result).toHaveProperty('diagnostics.interventions.0.intervention.reversible', true);

      // Lock failure surfaces and signatures
      expect(result).toHaveProperty('failureSurfaces.0.surface', ['Corrupted persisted carts are discarded safely']);
      expect(result).toHaveProperty('failureSignatures.0.signature');

      // Lock actions summary
      expect(result).toHaveProperty('actions.total', 2);
      expect(result).toHaveProperty('actions.ambiguous', 1);

      // Verify normalizer handles real trace projection
      const obsService = createCanonicalObservabilityService({ integration: adapter, featureSupport: { observability: true } as never });
      const traceView = await obsService.getTrace(DEMO_ROOT, 'TASK-002');
      expect(traceView.available).toBe(true);
      expect(traceView.data?.diagnostics.interventions[0]?.intervention.id).toBe('intervention-cart-guard');
      expect(traceView.data?.diagnostics.interventions[0]?.intervention.kind).toBe('CODE_CHANGE');
    });
  });

  describe('reflection projection contract', () => {
    it('matches canonical reflection structure without local stall fields', async () => {
      const reflection = await adapter.executeReadOnly<Record<string, unknown>>(DEMO_ROOT, 'reflect', { taskId: 'TASK-002' });
      expect(reflection.ok).toBe(true);
      expect(reflection.result).toBeDefined();

      const result = reflection.result as Record<string, unknown>;
      expect(result).toHaveProperty('status', 'WATCH');
      expect(result).toHaveProperty('verificationCycles', 1);

      // Lock hypotheses count fields
      expect(result).toHaveProperty('hypotheses.created', 1);
      expect(result).toHaveProperty('hypotheses.supported', 0);
      expect(result).toHaveProperty('hypotheses.weakened', 1);
      expect(result).toHaveProperty('hypotheses.open', 0);

      // Lock stallAnalysis fields
      expect(result).toHaveProperty('stallAnalysis.latestNoGain', false);
      expect(result).toHaveProperty('stallAnalysis.consecutiveNoGainCycles', 0);
      expect(result).toHaveProperty('stallAnalysis.sameStrategyAsPrevious', false);
      expect(result).toHaveProperty('stallAnalysis.sameFailureSurfaceAsPrevious', false);
      expect(result).toHaveProperty('stallAnalysis.sameFailureSignaturesAsPrevious', false);
      expect(result).not.toHaveProperty('stallAnalysis.stalled');
      expect(result).not.toHaveProperty('stallAnalysis.reason');

      // Lock recommendations
      expect(result).toHaveProperty('recommendedProtocolAction', 'RECONCILE_EXTERNAL_ACTION');

      // Verify normalizer handles real reflection projection
      const obsService = createCanonicalObservabilityService({ integration: adapter, featureSupport: { observability: true } as never });
      const reflectionView = await obsService.getReflection(DEMO_ROOT, 'TASK-002');
      expect(reflectionView.available).toBe(true);
      expect(reflectionView.data?.status).toBe('WATCH');
      expect(reflectionView.data?.hypotheses.open).toBe(0);
      expect(reflectionView.data?.stallAnalysis.latestNoGain).toBe(false);
    });
  });

  describe('continuity projection contract', () => {
    it('matches canonical continuity diagnostic context fields', async () => {
      const continuity = await adapter.readTaskContinuity(DEMO_ROOT, 'TASK-002');
      expect(continuity).toHaveProperty('diagnosticContext.present', true);
      expect(continuity).toHaveProperty('diagnosticContext.openHypotheses');
      expect(continuity).toHaveProperty('diagnosticContext.activeFailureSignatures');
      expect(continuity).toHaveProperty('diagnosticContext.activeFailedRequirements');
      expect(continuity).toHaveProperty('diagnosticContext.latestIntervention', 'intervention-cart-guard');
      expect(continuity).toHaveProperty('continuity.currentFocus.id', 'harden-hydration');
      expect(continuity).toHaveProperty('continuity.resumeNote');
    });
  });

  describe('ForgeLoop 1.6.4 boundary resource contract', () => {
    it('reads all five canonical resources from the vendored Integration API', async () => {
      const workspace = await adapter.readTaskWorkspaceBinding!(DEMO_ROOT, 'TASK-003');
      expect(workspace).toMatchObject({ taskId: 'TASK-003', status: 'UNAVAILABLE' });
      expect(workspace).toHaveProperty('binding.mode', 'GIT_WORKTREE');

      const handoffs = await adapter.readTaskHandoffs!(DEMO_ROOT, 'TASK-004');
      expect(handoffs).toMatchObject({ taskId: 'TASK-004', count: 1 });
      expect((handoffs.handoffs as Array<Record<string, unknown>>)[0]).toMatchObject({
        handoffId: 'handoff-harness-a-to-b',
        taskId: 'TASK-004',
      });

      const responsibility = await adapter.readTaskResponsibility!(DEMO_ROOT, 'TASK-003');
      expect(responsibility).toMatchObject({ taskId: 'TASK-003', status: 'INVALID' });
      expect(responsibility).toHaveProperty('errors.0.code', 'E_ROUTE_REASON_MISSING');

      const scope = await adapter.readTaskVerificationScope!(DEMO_ROOT, 'TASK-002');
      expect(scope).toHaveProperty('scope.requestedMode', 'AUTO');
      expect(scope).toHaveProperty('scope.resolvedMode', 'CHANGED');

      const attestation = await adapter.readTaskAttestation!(DEMO_ROOT, 'TASK-001');
      expect(attestation).toMatchObject({ status: 'DISABLED', level: 'PROCESSED', signature: 'NOT_CHECKED' });
    });
  });

  describe('actions, approvals, metrics, and evaluations contract', () => {
    it('locks fields consumed from task/actions', async () => {
      const actionsData = await adapter.readTaskActions!(DEMO_ROOT, 'TASK-002');
      expect(actionsData).toHaveProperty('actions');

      const actions = (actionsData as { actions: Array<Record<string, unknown>> }).actions;
      expect(actions).toHaveLength(2);

      const inspectAction = actions.find((a) => a.actionId === 'action-cart-inspect');
      expect(inspectAction).toMatchObject({
        actionId: 'action-cart-inspect',
        actionFingerprint: expect.any(String),
        effectClass: 'READ_ONLY',
        capability: 'filesystem.read',
        operation: 'Inspect persisted cart payload',
        target: 'src/cart.ts',
        state: 'VERIFIED',
        requiredForCompletion: false,
        provenance: 'EXTERNAL_OBSERVED',
      });

      const repairAction = actions.find((a) => a.actionId === 'action-cart-repair');
      expect(repairAction).toMatchObject({
        actionId: 'action-cart-repair',
        actionFingerprint: expect.any(String),
        effectClass: 'REVERSIBLE_WRITE',
        capability: 'filesystem.write',
        state: 'COMMIT_UNKNOWN',
        commitResultCode: 'AMBIGUOUS',
        requiredForCompletion: true,
      });

      // Verify canonical actions service
      const actionsService = createCanonicalActionsService({
        integration: adapter,
        featureSupport: { durableActions: true, approvals: true, capabilityPolicy: true, trajectoryMetrics: true },
      });
      const actionsView = await actionsService.getActions(DEMO_ROOT, 'TASK-002');
      expect(actionsView.available).toBe(true);
      expect(actionsView.actions).toHaveLength(2);
      expect(actionsView.approvals).toHaveLength(1);
      expect(actionsView.readiness).toMatchObject({
        total: 2,
        satisfied: 0,
        unresolved: 1,
        ambiguous: 1,
        source: 'FORGELOOP_INTEGRATION',
      });
    });

    it('locks fields consumed from task/approvals', async () => {
      const approvalsData = await adapter.readTaskApprovals!(DEMO_ROOT, 'TASK-002');
      expect(approvalsData).toHaveProperty('approvals');

      const approvals = (approvalsData as { approvals: Array<Record<string, unknown>> }).approvals;
      expect(approvals).toHaveLength(1);
      expect(approvals[0]).toMatchObject({
        approvalId: 'approval-cart-repair',
        actionId: 'action-cart-repair',
        actionFingerprint: expect.any(String),
        contractFingerprint: expect.any(String),
        taskRevision: 2,
        capability: 'filesystem.write',
        status: 'PENDING',
        requestedAt: expect.any(String),
        reason: expect.any(String),
      });
    });

    it('locks fields consumed from task/metrics', async () => {
      const metricsData = await adapter.readTaskMetrics!(DEMO_ROOT, 'TASK-002');
      expect(metricsData).toMatchObject({
        taskId: 'TASK-002',
        completion: {
          validated: false,
          phase: 'VERIFYING',
        },
        trajectory: {
          events: 16,
          verificationCycles: 1,
          diagnosticCycles: 1,
        },
        actions: {
          total: 2,
          verified: 1,
          trustedSatisfied: 0,
          unresolvedRequired: 1,
          ambiguous: 1,
        },
        comparableSteps: 4,
      });

      const trajectoryService = createCanonicalTrajectoryService({
        integration: adapter,
        featureSupport: { trajectoryMetrics: true, trajectoryEvaluations: true },
      });
      const metricsView = await trajectoryService.getMetrics(DEMO_ROOT, 'TASK-002');
      expect(metricsView.available).toBe(true);
      expect(metricsView.metrics).toMatchObject({ taskId: 'TASK-002' });
    });

    it('locks fields consumed from task/evaluations', async () => {
      const evaluationsData = await adapter.readTaskEvaluations!(DEMO_ROOT, 'TASK-002');
      expect(evaluationsData).toHaveProperty('evaluations');

      const evaluations = (evaluationsData as { evaluations: Array<Record<string, unknown>> }).evaluations;
      expect(evaluations).toHaveLength(1);
      expect(evaluations[0]).toMatchObject({
        evaluationId: 'eval-cart-hydration',
        scenarioId: 'cart-hydration-recovery',
        taskId: 'TASK-002',
        result: 'FAIL',
        completionValid: false,
        safetyValid: true,
        missingMilestones: ['COMPLETION_VALIDATED'],
        limits: {
          verificationCycles: {
            actual: 1,
            max: 3,
            pass: true,
          },
        },
        efficiency: {
          referenceComparableSteps: 4,
          actualComparableSteps: 6,
        },
        source: 'PROJECT_LOCAL_REFERENCE',
      });

      const trajectoryService = createCanonicalTrajectoryService({
        integration: adapter,
        featureSupport: { trajectoryMetrics: true, trajectoryEvaluations: true },
      });
      const evaluationsView = await trajectoryService.getEvaluations(DEMO_ROOT, 'TASK-002');
      expect(evaluationsView.available).toBe(true);
      expect(evaluationsView.evaluations).toHaveLength(1);
      expect(evaluationsView.evaluations[0]?.evaluationId).toBe('eval-cart-hydration');
    });

    it('locks fields consumed from project/capability-policy', async () => {
      const policyData = await adapter.readCapabilityPolicy!(DEMO_ROOT);
      expect(policyData).toHaveProperty('policy');
      expect(policyData).toHaveProperty('fingerprint');

      const policy = (policyData as { policy: Record<string, unknown> }).policy;
      expect(policy).toHaveProperty('defaultDecision', 'DENY');
      expect(policy).toHaveProperty('rules');
      expect(Array.isArray(policy.rules)).toBe(true);

      const actionsService = createCanonicalActionsService({
        integration: adapter,
        featureSupport: { durableActions: true, approvals: true, capabilityPolicy: true },
      });
      const policyView = await actionsService.getCapabilityPolicy(DEMO_ROOT);
      expect(policyView.available).toBe(true);
      expect(policyView.defaultDecision).toBe('DENY');
      expect(policyView.rules.length).toBeGreaterThan(0);
    });
  });
});
