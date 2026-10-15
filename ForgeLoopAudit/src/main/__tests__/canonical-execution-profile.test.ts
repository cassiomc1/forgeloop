import { describe, expect, it, vi } from 'vitest';
import {
  balancedCompatibilityContext,
  createCanonicalExecutionProfileContextService,
  normalizeExecutionProfileContext,
} from '@main/core/integration/canonical-execution-profile';
import type { ForgeLoopIntegrationAdapter } from '@main/core/integration/forgeloop-integration';

function canonicalContext(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    protocolVersion: 1,
    taskId: 'task-1',
    executionProfile: {
      requested: 'light',
      floor: 'balanced',
      resolved: 'balanced',
      reasons: ['SAFETY_FLOOR'],
      escalated: true,
    },
    phase: 'EXECUTING',
    nextAction: 'START_VERIFICATION',
    objective: 'Build the page.',
    deliverables: ['index.html'],
    constraints: ['No external services.'],
    selectedGuideIds: ['clean', 'test'],
    verificationRequirements: [{ id: 'html', text: 'HTML checks', type: 'VERIFICATION' }],
    contextPolicy: {
      contextDepth: 'relevant',
      output: 'standard',
      planDepth: 'standard',
      guideStrategy: 'relevant',
      verificationStrategy: 'normal',
      optionalArtifacts: 'lazy',
      requiredSections: ['objective', 'verification'],
      excludedContext: ['full-history'],
      allowedOptionalContext: ['task-history'],
    },
    optionalContext: { available: ['task-history'], loaded: [] },
    invariants: {
      lifecyclePhasesPreserved: true,
      requiredGatesPreserved: true,
      evidenceRequirementsPreserved: true,
      verificationTruthPreserved: true,
      authorityChecksPreserved: true,
      provenancePreserved: true,
      completionValidationPreserved: true,
      safetyFloorPreserved: true,
      lifecyclePhaseSkippingAllowed: false,
    },
    ...overrides,
  };
}

const adapter = (readTaskContext?: ForgeLoopIntegrationAdapter['readTaskContext']) => ({
  readTaskContext,
} as unknown as ForgeLoopIntegrationAdapter);

function expectInvalidContext(overrides: Record<string, unknown>, message: string) {
  expect(() => normalizeExecutionProfileContext(canonicalContext(overrides), 'task-1')).toThrow(message);
}

describe('canonical execution-profile context', () => {
  it('normalizes the canonical resolved profile and bounded policy', () => {
    const view = normalizeExecutionProfileContext(canonicalContext(), 'task-1');
    expect(view.status).toBe('CANONICAL');
    expect(view.executionProfile.resolved).toBe('balanced');
    expect(view.executionProfile.floor).toBe('balanced');
    expect(view.contextPolicy?.excludedContext).toEqual(['full-history']);
    expect(view.invariants?.lifecyclePhaseSkippingAllowed).toBe(false);
  });

  it('uses an explicit balanced compatibility projection when the feature is absent', async () => {
    const readTaskContext = vi.fn();
    const service = createCanonicalExecutionProfileContextService({
      integration: adapter(readTaskContext),
      featureSupport: { executionProfileContext: false },
    });
    const view = await service.getContext('/project', 'task-1');
    expect(view).toEqual(balancedCompatibilityContext());
    expect(readTaskContext).not.toHaveBeenCalled();
  });

  it('fails closed when an advertised canonical resource is unavailable', async () => {
    const service = createCanonicalExecutionProfileContextService({
      integration: adapter(undefined),
      featureSupport: { executionProfileContext: true },
    });
    const view = await service.getContext('/project', 'task-1');
    expect(view).toMatchObject({
      available: false,
      status: 'UNAVAILABLE',
      error: { code: 'E_CANONICAL_CONTEXT_UNAVAILABLE' },
    });
  });

  it('does not accept a malformed projection or task identity mismatch', async () => {
    const readTaskContext = vi.fn(async () => canonicalContext({
      taskId: 'other-task',
      invariants: { ...(canonicalContext().invariants as Record<string, boolean>), lifecyclePhaseSkippingAllowed: true },
    }));
    const service = createCanonicalExecutionProfileContextService({
      integration: adapter(readTaskContext),
      featureSupport: { executionProfileContext: true },
    });
    const view = await service.getContext('/project', 'task-1');
    expect(view.available).toBe(false);
    expect(view.status).toBe('UNAVAILABLE');
  });

  it('rejects unsupported profile requests and unsafe lifecycle invariants', () => {
    const executionProfile = canonicalContext().executionProfile as Record<string, unknown>;
    expectInvalidContext(
      { executionProfile: { ...executionProfile, requested: 'turbo' } },
      'executionProfile.requested is not a supported profile request',
    );
    expectInvalidContext(
      { executionProfile: { ...executionProfile, floor: 'turbo' } },
      'executionProfile.floor is not a supported execution profile',
    );
    expectInvalidContext(
      { executionProfile: { ...executionProfile, escalated: 'yes' } },
      'executionProfile.escalated is invalid',
    );
    expectInvalidContext(
      {
        invariants: {
          ...(canonicalContext().invariants as Record<string, unknown>),
          lifecyclePhaseSkippingAllowed: true,
        },
      },
      'lifecycle phase skipping is not allowed',
    );
  });

  it('normalizes wrapped context, nullable fields, and reported usage without estimation', () => {
    const view = normalizeExecutionProfileContext({
      data: canonicalContext({
        objective: null,
        deliverables: null,
        constraints: null,
        selectedGuideIds: null,
        verificationRequirements: [{ id: null, text: null, type: null }],
        optionalContext: null,
        usage: {
          source: 'PROVIDER_REPORTED',
          inputTokens: 10,
          outputTokens: 20,
          cacheReadTokens: null,
          cacheWriteTokens: undefined,
          totalTokens: 30,
          costUsd: 0.12,
          model: 'model-1',
          provider: 'provider-1',
        },
      }),
    }, 'task-1');

    expect(view.objective).toBeNull();
    expect(view.deliverables).toEqual([]);
    expect(view.optionalContext).toEqual({ available: [], loaded: [] });
    expect(view.verificationRequirements).toEqual([{ id: null, text: null, type: null }]);
    expect(view.usage).toMatchObject({
      source: 'PROVIDER_REPORTED',
      inputTokens: 10,
      outputTokens: 20,
      cacheReadTokens: null,
      cacheWriteTokens: null,
      totalTokens: 30,
      costUsd: 0.12,
    });
  });

  it('keeps unknown usage non-quantified and ignores invalid usage sources', () => {
    const unknown = normalizeExecutionProfileContext(canonicalContext({
      contextUsage: {
        source: 'UNKNOWN',
        inputTokens: 10,
        outputTokens: 20,
        totalTokens: 30,
        costUsd: 0.5,
      },
    }), 'task-1');
    expect(unknown.usage).toMatchObject({
      source: 'UNKNOWN',
      inputTokens: null,
      outputTokens: null,
      cacheReadTokens: null,
      cacheWriteTokens: null,
      totalTokens: null,
      costUsd: null,
    });

    const invalid = normalizeExecutionProfileContext(canonicalContext({
      usage: { source: 'ESTIMATED', inputTokens: 10, costUsd: 0.5 },
    }), 'task-1');
    expect(invalid.usage).toBeNull();
  });

  it('converts invalid usage measurements to null while retaining trusted source identity', () => {
    const view = normalizeExecutionProfileContext(canonicalContext({
      usage: {
        source: 'HOST_REPORTED',
        inputTokens: -1,
        outputTokens: 2,
        cacheReadTokens: 'not-a-number',
        cacheWriteTokens: null,
        totalTokens: undefined,
        costUsd: -1,
        model: '',
        provider: 'host',
      },
    }), 'task-1');
    expect(view.usage).toEqual({
      source: 'HOST_REPORTED',
      inputTokens: null,
      outputTokens: 2,
      cacheReadTokens: null,
      cacheWriteTokens: null,
      totalTokens: null,
      costUsd: null,
      model: null,
      provider: 'host',
    });

    const finiteCost = normalizeExecutionProfileContext(canonicalContext({
      usage: { source: 'ACTOR_REPORTED', costUsd: 0 },
    }), 'task-1');
    expect(finiteCost.usage?.costUsd).toBe(0);
  });

  it('fails closed for malformed bounded fields and requirements', () => {
    expectInvalidContext({ contextPolicy: null }, 'contextPolicy is unavailable');
    expectInvalidContext({ deliverables: [''] }, 'deliverables is not a bounded string');
    expectInvalidContext({ verificationRequirements: [{}] }, 'verificationRequirements.id is not a bounded string');
    expectInvalidContext({ verificationRequirements: [null] }, 'verificationRequirements contains an invalid entry');
    expectInvalidContext({ invariants: null }, 'invariants are unavailable');
  });

  it('uses compatibility only when canonical support is absent and surfaces non-Error failures', async () => {
    const compatibility = createCanonicalExecutionProfileContextService({
      integration: adapter(undefined),
    });
    expect((await compatibility.getContext('/project', 'task-1')).status).toBe('COMPATIBILITY_FALLBACK');

    const service = createCanonicalExecutionProfileContextService({
      integration: adapter(async () => {
        throw 'transport failed';
      }),
      featureSupport: { executionProfileContext: true },
    });
    await expect(service.getContext('/project', 'task-1')).resolves.toMatchObject({
      status: 'UNAVAILABLE',
      error: { message: 'transport failed' },
    });
  });
});
