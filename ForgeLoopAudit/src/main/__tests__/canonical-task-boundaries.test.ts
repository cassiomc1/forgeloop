import { describe, expect, it, vi } from 'vitest';
import type { ForgeLoopFeatureSupport } from '@shared/domain';
import type { ForgeLoopIntegrationAdapter } from '@main/core/integration/forgeloop-integration';
import {
  createCanonicalTaskBoundariesService,
  normalizeAttestation,
  normalizeHandoffs,
  normalizeResponsibility,
  normalizeVerificationScope,
  normalizeWorkspaceBinding,
} from '@main/core/integration/canonical-task-boundaries';

const allFeatures: ForgeLoopFeatureSupport = {
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
};

function fakeAdapter(overrides: Partial<ForgeLoopIntegrationAdapter> = {}): ForgeLoopIntegrationAdapter {
  return {
    getPackageVersion: () => '1.6.4',
    getCapabilities: () => ({
      packageVersion: '1.6.4',
      protocolVersion: 1,
      integrationApiVersion: 1,
      executorParity: true,
      features: { taskClaimRecovery: { version: 1, durableRecoveryState: true, explicitResume: true, validatedClaimProjection: true } },
      resources: [],
    }),
    readProtocolInfo: vi.fn(),
    listTasks: vi.fn(),
    readTaskStatus: vi.fn(),
    readTaskOwnership: vi.fn(),
    readTaskContract: vi.fn(),
    readTaskContinuity: vi.fn(),
    executeReadOnly: vi.fn(),
    ...overrides,
  };
}

describe('canonical task boundary projections', () => {
  it('normalizes the new resource payloads without exposing unknown enum values as supported', () => {
    expect(normalizeWorkspaceBinding({
      status: 'MATCH',
      taskId: 'TASK-003',
      path: '/workspace/forgeshop',
      bindingFingerprint: 'a'.repeat(64),
      binding: { mode: 'GIT_WORKTREE', branchAtBind: 'main', headAtBind: 'b'.repeat(40) },
    })).toMatchObject({ status: 'MATCH', mode: 'GIT_WORKTREE', branchAtBind: 'main', headAtBind: 'b'.repeat(40) });

    const handoffs = normalizeHandoffs({
      count: 2,
      handoffs: [
        { handoffId: 'handoff-old', createdAt: '2026-08-01T00:00:00.000Z', state: { phase: 'EXECUTING', revision: 1 }, acceptance: { status: 'OPEN' } },
        { handoffId: 'handoff-new', createdAt: '2026-08-02T00:00:00.000Z', state: { phase: 'VERIFYING', revision: 2 }, acceptance: { status: 'ACCEPTED', consumerId: 'agent-42', harness: 'codex', acceptedAt: '2026-08-02T01:00:00.000Z', reasonCodes: [] } },
      ],
    });
    expect(handoffs.handoffs.map((handoff) => handoff.handoffId)).toEqual(['handoff-new', 'handoff-old']);
    expect(handoffs.handoffs[0]?.acceptance).toEqual({
      status: 'ACCEPTED',
      consumerId: 'agent-42',
      harness: 'codex',
      acceptedAt: '2026-08-02T01:00:00.000Z',
      reasonCodes: [],
    });
    expect(handoffs.handoffs[1]?.acceptance?.status).toBe('OPEN');

    expect(normalizeResponsibility({
      status: 'VALID',
      responsibility: { label: 'checkout implementation', allowedPaths: ['src/**'], readOnlyPaths: ['tests/**'], requiredCheckIds: ['typecheck'], frozenInputs: { contract: true, route: false, claims: true } },
      changedPaths: ['src/checkout.ts'],
      fingerprint: 'c'.repeat(64),
    })).toMatchObject({ status: 'VALID', label: 'checkout implementation', allowedPaths: ['src/**'], frozenInputs: { contract: true, route: false, claims: true } });

    expect(normalizeVerificationScope({
      scope: { requestedMode: 'AUTO', resolvedMode: 'CHANGED', verificationCycle: 2, changedPaths: ['src/checkout.ts'], claimedPaths: ['src/checkout.ts'], selectedPaths: ['src/checkout.ts'], reasons: ['changed input'], fallback: null, checkerCapabilityFingerprint: 'd'.repeat(64), createdAt: '2026-08-02T00:00:00.000Z' },
      fingerprint: 'e'.repeat(64),
    })).toMatchObject({ requestedMode: 'AUTO', resolvedMode: 'CHANGED', verificationCycle: 2 });
    expect(normalizeVerificationScope({ scope: { requestedMode: 'AUTO', resolvedMode: 'UNRESOLVED' } }).resolvedMode).toBe('UNRESOLVED');
    expect(normalizeVerificationScope({ scope: { requestedMode: 'UNRESOLVED', resolvedMode: 'UNRESOLVED' } })).toMatchObject({
      requestedMode: 'UNKNOWN',
      resolvedMode: 'UNRESOLVED',
    });
    expect(normalizeVerificationScope({ scope: { requestedMode: 'AUTO', resolvedMode: 'IMPACTED' } }).resolvedMode).toBe('UNKNOWN');

    expect(normalizeAttestation({
      status: 'VALID',
      level: 'VERIFIED',
      content: 'VALID',
      receipt: 'VALID',
      ledger: 'VALID',
      signature: 'UNSIGNED',
      signer: { provider: 'none' },
      files: 3,
      subject: 'TASK-001',
    })).toMatchObject({ status: 'VALID', level: 'VERIFIED', files: 3, subject: 'TASK-001' });
  });

  it('keeps boundary resource failures independent and preserves canonical error guidance', async () => {
    const responsibility = { status: 'VALID', responsibility: { label: 'safe scope', allowedPaths: [], readOnlyPaths: [], requiredCheckIds: [], frozenInputs: {} }, changedPaths: [], fingerprint: 'a'.repeat(64), errors: [] };
    const adapter = fakeAdapter({
      readTaskWorkspaceBinding: vi.fn().mockRejectedValue({ code: 'E_WORKSPACE_BINDING_MISMATCH', message: 'worktree mismatch', next: 'bind a matching worktree' }),
      readTaskResponsibility: vi.fn().mockResolvedValue(responsibility),
      readTaskHandoffs: vi.fn().mockResolvedValue({ count: 0, handoffs: [] }),
      readTaskVerificationScope: vi.fn().mockRejectedValue({ code: 'E_VERIFICATION_SCOPE_INVALID', message: 'verification scope artifact missing' }),
      readTaskAttestation: vi.fn().mockRejectedValue(new Error('attestation provider unavailable')),
    });
    const service = createCanonicalTaskBoundariesService({
      integration: adapter,
      featureSupport: allFeatures,
      readAttestationConfig: () => ({ attestation: { mode: 'optional', signing: { provider: 'none', required: false } } }),
    });

    const [workspace, responsibilityView, handoffs, scope, attestation] = await Promise.all([
      service.getWorkspaceBinding('/project', 'TASK-003'),
      service.getResponsibility('/project', 'TASK-003'),
      service.getHandoffs('/project', 'TASK-003'),
      service.getVerificationScope('/project', 'TASK-003'),
      service.getAttestation('/project', 'TASK-003'),
    ]);
    expect(workspace.available).toBe(false);
    expect(workspace.error).toMatchObject({ code: 'E_WORKSPACE_BINDING_MISMATCH', next: 'bind a matching worktree' });
    expect(responsibilityView.available).toBe(true);
    expect(handoffs.available).toBe(true);
    expect(scope.available).toBe(true);
    expect(scope.error).toBeNull();
    expect(scope.requestedMode).toBe('UNKNOWN');
    expect(attestation.available).toBe(false);
    expect(attestation.errors[0]).toMatchObject({ code: 'E_CANONICAL_ATTESTATION_INVOCATION' });
  });

  it('closes feature-specific reads when the negotiated feature is unavailable', async () => {
    const readTaskHandoffs = vi.fn();
    const service = createCanonicalTaskBoundariesService({
      integration: fakeAdapter({ readTaskHandoffs }),
      featureSupport: { ...allFeatures, canonicalHandoffs: false },
    });
    const result = await service.getHandoffs('/project', 'TASK-001');
    expect(result.available).toBe(false);
    expect(result.error).toMatchObject({ code: 'E_FEATURE_UNAVAILABLE' });
    expect(readTaskHandoffs).not.toHaveBeenCalled();
  });

  it('normalizes malformed payloads into bounded unknown or unavailable values', () => {
    expect(normalizeWorkspaceBinding(null)).toMatchObject({ available: false, status: 'UNAVAILABLE' });
    expect(normalizeWorkspaceBinding({ status: 'UNSUPPORTED', error: { message: 42 } })).toMatchObject({
      available: true,
      status: 'UNKNOWN',
      error: { code: 'E_WORKSPACE_BINDING_INVALID', message: 'Workspace binding status is invalid.' },
    });

    expect(normalizeHandoffs(null)).toMatchObject({ available: false, count: null });
    expect(normalizeHandoffs({ handoffs: [null, { handoffId: 'handoff-empty', createdAt: null }], count: 'not-a-number', error: { code: 'E_HANDOFF_INVALID' } })).toMatchObject({
      available: true,
      count: 2,
      error: { code: 'E_HANDOFF_INVALID', message: 'Canonical handoff projection is invalid.' },
    });
    expect(normalizeHandoffs({ handoffs: [{ handoffId: 'handoff-unknown', acceptance: { status: 'FUTURE', reasonCodes: ['E_UNKNOWN'] } }] }).handoffs[0]?.acceptance).toEqual({
      status: 'UNKNOWN',
      consumerId: null,
      harness: null,
      acceptedAt: null,
      reasonCodes: ['E_UNKNOWN'],
    });

    expect(normalizeResponsibility(null)).toMatchObject({ available: false, status: 'UNKNOWN' });
    expect(normalizeResponsibility({ status: 'UNSUPPORTED', responsibility: { frozenInputs: 'not-an-object' }, errors: [null, { next: '' }] })).toMatchObject({
      available: true,
      status: 'UNKNOWN',
      frozenInputs: null,
      errors: [
        { code: 'E_CANONICAL_PROJECTION_ERROR', message: 'Canonical projection reported an error.' },
        { code: 'E_CANONICAL_PROJECTION_ERROR', message: 'Canonical projection reported an error.' },
      ],
    });

    expect(normalizeVerificationScope(null)).toMatchObject({ available: false, resolvedMode: 'UNKNOWN' });
    expect(normalizeVerificationScope({ scope: { requestedMode: 'UNSUPPORTED', resolvedMode: 'IMPACTED' }, error: { code: 'E_SCOPE', message: 42 } })).toMatchObject({
      available: true,
      requestedMode: 'UNKNOWN',
      resolvedMode: 'UNKNOWN',
      error: { code: 'E_SCOPE', message: 'Verification scope projection is invalid.' },
    });

    expect(normalizeAttestation(null)).toMatchObject({ available: false, level: 'UNKNOWN' });
    expect(normalizeAttestation({ status: 'UNSUPPORTED', level: 'UNSUPPORTED', errors: [null] })).toMatchObject({
      available: true,
      status: 'UNKNOWN',
      level: 'UNKNOWN',
      errors: [{ code: 'E_CANONICAL_PROJECTION_ERROR' }],
    });
  });

  it('degrades independently when optional adapters are absent or disabled', async () => {
    const disabled = createCanonicalTaskBoundariesService({
      integration: fakeAdapter(),
      featureSupport: {
        ...allFeatures,
        workspaceBinding: false,
        canonicalHandoffs: false,
        responsibilityConstraints: false,
        differentialVerificationScope: false,
        codeAttestation: false,
      },
    });
    const unavailable = createCanonicalTaskBoundariesService({ integration: fakeAdapter(), featureSupport: allFeatures });
    const [disabledWorkspace, disabledHandoffs, disabledResponsibility, disabledScope, disabledAttestation] = await Promise.all([
      disabled.getWorkspaceBinding('/project', 'TASK-001'),
      disabled.getHandoffs('/project', 'TASK-001'),
      disabled.getResponsibility('/project', 'TASK-001'),
      disabled.getVerificationScope('/project', 'TASK-001'),
      disabled.getAttestation('/project', 'TASK-001'),
    ]);
    expect(disabledWorkspace.error).toMatchObject({ code: 'E_FEATURE_UNAVAILABLE' });
    expect(disabledHandoffs.error).toMatchObject({ code: 'E_FEATURE_UNAVAILABLE' });
    expect(disabledResponsibility.errors[0]).toMatchObject({ code: 'E_FEATURE_UNAVAILABLE' });
    expect(disabledScope.error).toMatchObject({ code: 'E_FEATURE_UNAVAILABLE' });
    expect(disabledAttestation.errors[0]).toMatchObject({ code: 'E_FEATURE_UNAVAILABLE' });

    const [missingWorkspace, missingHandoffs, missingResponsibility, missingScope, missingAttestation] = await Promise.all([
      unavailable.getWorkspaceBinding('/project', 'TASK-001'),
      unavailable.getHandoffs('/project', 'TASK-001'),
      unavailable.getResponsibility('/project', 'TASK-001'),
      unavailable.getVerificationScope('/project', 'TASK-001'),
      unavailable.getAttestation('/project', 'TASK-001'),
    ]);
    expect(missingWorkspace.error).toMatchObject({ code: 'E_CANONICAL_WORKSPACE_BINDING_UNAVAILABLE' });
    expect(missingHandoffs.error).toMatchObject({ code: 'E_CANONICAL_HANDOFFS_UNAVAILABLE' });
    expect(missingResponsibility.errors[0]).toMatchObject({ code: 'E_CANONICAL_RESPONSIBILITY_UNAVAILABLE' });
    expect(missingScope.error).toMatchObject({ code: 'E_CANONICAL_VERIFICATION_SCOPE_UNAVAILABLE' });
    expect(missingAttestation.errors[0]).toMatchObject({ code: 'E_CANONICAL_ATTESTATION_UNAVAILABLE' });
  });

  it('keeps non-missing invocation failures separate by resource', async () => {
    const adapter = fakeAdapter({
      readTaskHandoffs: vi.fn().mockRejectedValue('handoff provider failed'),
      readTaskResponsibility: vi.fn().mockRejectedValue({ message: 'responsibility provider failed' }),
      readTaskVerificationScope: vi.fn().mockRejectedValue({ code: 'E_SCOPE_PROVIDER', message: 'provider failed', next: 'retry later' }),
    });
    const service = createCanonicalTaskBoundariesService({ integration: adapter, featureSupport: allFeatures });
    const [handoffs, responsibility, scope] = await Promise.all([
      service.getHandoffs('/project', 'TASK-001'),
      service.getResponsibility('/project', 'TASK-001'),
      service.getVerificationScope('/project', 'TASK-001'),
    ]);
    expect(handoffs.error).toMatchObject({ code: 'E_CANONICAL_HANDOFFS_INVOCATION', message: 'handoff provider failed' });
    expect(responsibility.errors[0]).toMatchObject({ code: 'E_CANONICAL_RESPONSIBILITY_INVOCATION', message: 'responsibility provider failed' });
    expect(scope.error).toMatchObject({ code: 'E_SCOPE_PROVIDER', message: 'provider failed', next: 'retry later' });
  });
});
