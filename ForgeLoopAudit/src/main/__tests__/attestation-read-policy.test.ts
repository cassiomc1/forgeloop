import { describe, expect, it, vi } from 'vitest';
import type { ForgeLoopFeatureSupport } from '@shared/domain';
import type { ForgeLoopIntegrationAdapter } from '@main/core/integration/forgeloop-integration';
import {
  createCanonicalTaskBoundariesService,
} from '@main/core/integration/canonical-task-boundaries';
import {
  readAttestationReadPolicy,
  resolveAttestationReadPolicy,
} from '@main/core/integration/attestation-read-policy';

const features: ForgeLoopFeatureSupport = {
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
  advisoryContextProviders: false,
};

function config(mode: 'off' | 'optional' | 'required' = 'optional', provider = 'none', required = false): Record<string, unknown> {
  return {
    schemaVersion: 1,
    protocolVersion: 1,
    complianceMode: 'standard',
    attestation: { mode, signing: { provider, required } },
  };
}

function adapter(readTaskAttestation: ForgeLoopIntegrationAdapter['readTaskAttestation']): ForgeLoopIntegrationAdapter {
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
    readTaskAttestation,
    executeReadOnly: vi.fn(),
  };
}

describe('attestation automatic-read policy', () => {
  it('disables automatic reads when attestation mode is off', () => {
    expect(resolveAttestationReadPolicy(config('off'))).toMatchObject({
      automaticCanonicalReadAllowed: false,
      reason: 'DISABLED',
      signingProvider: 'none',
      signingRequired: false,
    });
  });

  it('allows only the provider-none, non-required automatic case', () => {
    expect(resolveAttestationReadPolicy(config())).toMatchObject({
      automaticCanonicalReadAllowed: true,
      reason: 'NO_EXTERNAL_SIGNING_PROVIDER',
    });
    expect(resolveAttestationReadPolicy(config('optional', 'sigstore'))).toMatchObject({
      automaticCanonicalReadAllowed: false,
      reason: 'EXTERNAL_SIGNING_PROVIDER',
    });
    expect(resolveAttestationReadPolicy(config('optional', 'none', true))).toMatchObject({
      automaticCanonicalReadAllowed: false,
      reason: 'EXTERNAL_SIGNING_PROVIDER',
    });
  });

  it('fails closed for unknown providers and unavailable or malformed config', () => {
    expect(resolveAttestationReadPolicy(config('optional', 'future-provider'))).toMatchObject({
      automaticCanonicalReadAllowed: false,
      reason: 'UNKNOWN_PROVIDER',
      signingProvider: 'future-provider',
    });
    expect(resolveAttestationReadPolicy({ ...config(), attestation: { mode: 'optional', signing: { provider: 'none' } } })).toMatchObject({
      automaticCanonicalReadAllowed: false,
      reason: 'CONFIG_UNAVAILABLE',
    });
    expect(readAttestationReadPolicy(() => { throw new Error('config unavailable'); })).toMatchObject({
      automaticCanonicalReadAllowed: false,
      reason: 'CONFIG_UNAVAILABLE',
    });
  });

  it('never invokes provider-backed canonical verification automatically', async () => {
    const readTaskAttestation = vi.fn().mockResolvedValue({ status: 'VALID', level: 'VERIFIED' });
    const service = createCanonicalTaskBoundariesService({
      integration: adapter(readTaskAttestation),
      featureSupport: features,
      readAttestationConfig: () => config('optional', 'sigstore'),
    });

    const result = await service.getAttestation('/project', 'TASK-001');
    expect(readTaskAttestation).not.toHaveBeenCalled();
    expect(result.available).toBe(false);
    expect(result.readPolicy).toMatchObject({ reason: 'EXTERNAL_SIGNING_PROVIDER' });
    expect(result.errors[0]).toMatchObject({ code: 'AUDIT_ATTESTATION_EXTERNAL_VERIFICATION_REQUIRED' });
  });

  it('does not invoke the canonical read when config is missing or attestation is disabled', async () => {
    const readTaskAttestation = vi.fn().mockResolvedValue({ status: 'VALID', level: 'VERIFIED' });
    const missingConfig = createCanonicalTaskBoundariesService({
      integration: adapter(readTaskAttestation),
      featureSupport: features,
    });
    const disabled = createCanonicalTaskBoundariesService({
      integration: adapter(readTaskAttestation),
      featureSupport: features,
      readAttestationConfig: () => config('off'),
    });

    const missing = await missingConfig.getAttestation('/project', 'TASK-001');
    const off = await disabled.getAttestation('/project', 'TASK-001');
    expect(readTaskAttestation).not.toHaveBeenCalled();
    expect(missing.readPolicy?.reason).toBe('CONFIG_UNAVAILABLE');
    expect(off.readPolicy?.reason).toBe('DISABLED');
  });
});
