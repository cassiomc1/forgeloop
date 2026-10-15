import { describe, it, expect } from 'vitest';
import {
  normalizeCanonicalProtocolInfo,
  negotiateCompatibilityMode,
  deriveFeatureSupport,
} from '@main/core/protocol/protocol-capabilities';
import type { ForgeLoopCapabilitiesSummary } from '@main/core/integration/types';

function validCapabilities(overrides: Record<string, unknown> = {}) {
  return {
    packageVersion: '1.5.0',
    protocolVersion: 1,
    integrationApiVersion: 1,
    executorParity: true,
    features: {
      taskClaimRecovery: {
        version: 1,
        durableRecoveryState: true,
        explicitResume: true,
        validatedClaimProjection: true,
      },
    },
    resources: [
      'protocol/info',
      'project/tasks',
      'task/status',
      'task/ownership',
      'task/contract',
      'task/continuity',
    ],
    ...overrides,
  };
}

function validProtocolInfo(overrides: Record<string, unknown> = {}) {
  return {
    packageVersion: '1.5.0',
    protocolVersion: 1,
    readsProtocol: [1],
    features: {
      providerExtensions: {
        version: 1,
        supported: true,
        providerNeutral: true,
        maturity: 'experimental',
        publicRegistryApi: false,
        packageSubpathExported: false,
        autoInstall: false,
        lifecycleAuthority: false,
        completionAuthority: false,
        evidenceAuthority: false,
        providerKinds: ['ADVISORY_CONTEXT', 'VERIFICATION_EXECUTION', 'BROWSER_VERIFICATION', 'SECURITY_REVIEW', 'PRESENTATION'],
        resultBoundary: 'STRICT_JSON_SNAPSHOT',
        cancellation: 'COOPERATIVE_ABORT_SIGNAL',
      },
    },
    compatibility: {
      protocolVersion: 1,
      schemaVersion: 1,
      ...overrides,
    },
  };
}

function currentCapabilities(overrides: Record<string, unknown> = {}): ForgeLoopCapabilitiesSummary {
  return {
    ...validCapabilities({
    packageVersion: '1.10.0',
    features: {
      taskClaimRecovery: {
        version: 1,
        durableRecoveryState: true,
        explicitResume: true,
        validatedClaimProjection: true,
      },
      auditUx: {
        version: 1,
        supported: true,
        readOnly: true,
        resource: 'task/audit-view',
        timeline: true,
        lifecycleAuthority: false,
        evidenceAuthority: false,
        completionAuthority: false,
        mutationAuthority: false,
        externalExecution: false,
      },
      durableActions: {
        version: 1,
        readOnlyResources: true,
        externalExecutionOverMcp: false,
      },
      trajectoryEvaluation: {
        version: 1,
        readOnlyMetrics: true,
        projectLocalReference: true,
      },
      adaptiveExecutionProfiles: {
        version: 1,
        supported: true,
        deterministic: true,
        lifecycleFastPath: false,
      },
      executionProfileContext: {
        version: 1,
        supported: true,
        resource: 'task/context',
        resolvedProfileAuthoritative: true,
        compatibilityFallback: 'balanced',
        lifecycleFastPath: false,
      },
      contextUsageObservability: {
        version: 1,
        supported: true,
        sources: ['HOST_REPORTED', 'UNKNOWN'],
        estimation: false,
        inflationStatus: 'OBSERVATIONAL',
      },
      verificationExecutionIsolation: {
        version: 1,
        supported: true,
        adapter: true,
        modes: ['NATIVE_PROJECT', 'PROJECT_ISOLATED', 'SYSTEM_ISOLATED'],
        protocolProjectRootSeparateFromExecutionCwd: true,
      },
      workspaceBinding: {
        version: 1,
        supported: true,
        optional: true,
        explicitRebinding: false,
      },
      canonicalHandoffs: {
        version: 2,
        supported: true,
        immutable: true,
        lifecycleAuthority: false,
        evidenceAuthority: false,
        exactlyOnceAcceptance: true,
        acceptanceLedgerBacked: true,
        acceptanceCommand: 'handoff-accept',
        acceptanceStatuses: ['OPEN', 'ACCEPTED', 'UNBOUND', 'INCONSISTENT'],
      },
      advisoryContextProviders: {
        version: 1,
        supported: true,
        providerNeutral: true,
        integrationApiOnly: true,
        lazy: true,
        optIn: true,
        persistedByForgeLoop: false,
        lifecycleAuthority: false,
        evidenceAuthority: false,
        executable: false,
      },
      responsibilityConstraints: {
        version: 1,
        supported: true,
        immutableDuringPass: true,
        completionEnforced: true,
      },
      differentialVerificationScope: {
        version: 1,
        supported: true,
        modes: ['AUTO', 'CHANGED', 'CLAIMED', 'FULL'],
        impactedMode: false,
      },
      codeAttestation: {
        version: 1,
        supported: true,
        modes: ['off', 'optional', 'required'],
        revisionProviders: ['git'],
        signingProviders: ['none', 'sigstore'],
        completionLedgerBound: true,
      },
      structuralQuality: {
        version: 1,
        supported: true,
        schemaVersion: 1,
        providerNeutral: true,
        modes: ['off', 'observe', 'gate'],
        builtInProviders: ['sentrux'],
        commands: ['quality-baseline', 'quality-verify', 'quality-status'],
        baselineImmutableAfterExecution: true,
        maxOutputBytes: 2097152,
      },
    },
    resources: [
      'protocol/info',
      'project/tasks',
      'task/status',
      'task/ownership',
      'task/contract',
      'task/continuity',
      'task/actions',
      'task/action',
      'task/approvals',
      'task/metrics',
      'task/context',
      'task/evaluations',
      'project/capability-policy',
      'task/workspace-binding',
      'task/handoffs',
      'task/responsibility',
      'task/verification-scope',
      'task/attestation',
      'task/structural-quality',
      'task/audit-view',
    ],
    commands: [
      'history', 'trace', 'reflect', 'inspect', 'metrics', 'action-show',
    ].map((name) => ({
      name,
      baseRiskClass: 'READ_ONLY',
      mayExecuteExternalProcess: false,
      mutatesProtocol: false,
    })),
    ...overrides,
    }),
  } as ForgeLoopCapabilitiesSummary;
}

describe('core/protocol/protocol-capabilities', () => {
  describe('normalizeCanonicalProtocolInfo', () => {
    it('reads schemaVersion from the compatibility block only', () => {
      const normalized = normalizeCanonicalProtocolInfo(validProtocolInfo());
      expect(normalized).not.toBeNull();
      expect(normalized?.schemaVersion).toBe(1);
      expect(normalized?.protocolVersion).toBe(1);
      expect(normalized?.packageVersion).toBe('1.5.0');
    });

    it('regression: works without any top-level schemaVersion field', () => {
      const raw = validProtocolInfo() as Record<string, unknown>;
      expect(raw.schemaVersion).toBeUndefined();
      const normalized = normalizeCanonicalProtocolInfo(raw);
      expect(normalized?.schemaVersion).toBe(1);
    });

    it('returns null when the compatibility block is missing', () => {
      expect(normalizeCanonicalProtocolInfo({ protocolVersion: 1 })).toBeNull();
    });

    it('returns null for non-object input', () => {
      expect(normalizeCanonicalProtocolInfo(null)).toBeNull();
      expect(normalizeCanonicalProtocolInfo(undefined)).toBeNull();
      expect(normalizeCanonicalProtocolInfo('bogus')).toBeNull();
    });
  });

  describe('negotiateCompatibilityMode', () => {
    it('selects INTEGRATION_V1 when protocol, schema and capabilities are valid', () => {
      const result = negotiateCompatibilityMode({
        protocolInfo: normalizeCanonicalProtocolInfo(validProtocolInfo()),
        capabilities: validCapabilities(),
      });
      expect(result.mode).toBe('INTEGRATION_V1');
      expect(result.reason).toBeUndefined();
    });

    it('derives every optional current feature without changing the core mode', () => {
      const result = negotiateCompatibilityMode({
        protocolInfo: normalizeCanonicalProtocolInfo(validProtocolInfo({ packageVersion: '1.6.0' })),
        capabilities: currentCapabilities(),
      });
      expect(result.mode).toBe('INTEGRATION_V1');
      expect(result.featureSupport).toEqual({
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
        advisoryContextProviders: true,
        responsibilityConstraints: true,
        differentialVerificationScope: true,
        codeAttestation: true,
        adaptiveExecutionProfiles: true,
        executionProfileContext: true,
        contextUsageObservability: true,
        structuralQuality: true,
        repositoryIndex: false,
        auditUx: true,
        providerExtensions: true,
      });
    });

    it('enables the additive verification execution isolation feature for a complete v1 contract', () => {
      const result = negotiateCompatibilityMode({
        protocolInfo: normalizeCanonicalProtocolInfo(validProtocolInfo({ packageVersion: '1.6.1' })),
        capabilities: currentCapabilities(),
      });

      expect(result.mode).toBe('INTEGRATION_V1');
      expect(result.featureSupport.verificationExecutionIsolation).toBe(true);
    });

    it('keeps protocol-v1 compatible when the optional isolation capability is absent', () => {
      const capabilities = currentCapabilities();
      const features = { ...capabilities.features };
      Reflect.deleteProperty(features, 'verificationExecutionIsolation');
      const result = negotiateCompatibilityMode({
        protocolInfo: normalizeCanonicalProtocolInfo(validProtocolInfo()),
        capabilities: { ...capabilities, features },
      });

      expect(result.mode).toBe('INTEGRATION_V1');
      expect(result.featureSupport.verificationExecutionIsolation).toBe(false);
    });

    it.each([
      ['unsupported version', { version: 2 }],
      ['missing NATIVE_PROJECT mode', { modes: ['PROJECT_ISOLATED', 'SYSTEM_ISOLATED'] }],
      ['missing PROJECT_ISOLATED mode', { modes: ['NATIVE_PROJECT', 'SYSTEM_ISOLATED'] }],
      ['missing SYSTEM_ISOLATED mode', { modes: ['NATIVE_PROJECT', 'PROJECT_ISOLATED'] }],
      ['supported false', { supported: false }],
      ['adapter false', { adapter: false }],
      ['root/cwd separation absent', { protocolProjectRootSeparateFromExecutionCwd: false }],
    ])('degrades optional isolation support without changing INTEGRATION_V1 for %s', (_name, overrides) => {
      const current = currentCapabilities();
      const feature = {
        ...current.features.verificationExecutionIsolation,
        ...overrides,
      } as NonNullable<ForgeLoopCapabilitiesSummary['features']['verificationExecutionIsolation']>;
      const result = negotiateCompatibilityMode({
        protocolInfo: normalizeCanonicalProtocolInfo(validProtocolInfo()),
        capabilities: {
          ...current,
          features: { ...current.features, verificationExecutionIsolation: feature },
        },
      });

      expect(result.mode).toBe('INTEGRATION_V1');
      expect(result.featureSupport.verificationExecutionIsolation).toBe(false);
    });

    it('degrades optional features independently when their advertisements are absent', () => {
      const capabilities = currentCapabilities({
        features: {
          taskClaimRecovery: currentCapabilities().features.taskClaimRecovery,
        },
        resources: validCapabilities().resources,
        commands: [{ name: 'history', baseRiskClass: 'READ_ONLY', mayExecuteExternalProcess: false, mutatesProtocol: false }],
      });
      const result = negotiateCompatibilityMode({
        protocolInfo: normalizeCanonicalProtocolInfo(validProtocolInfo()),
        capabilities,
      });
      expect(result.mode).toBe('INTEGRATION_V1');
      expect(result.featureSupport.canonicalOwnership).toBe(true);
      expect(result.featureSupport.observability).toBe(false);
      expect(result.featureSupport.durableActions).toBe(false);
      expect(result.featureSupport.trajectoryMetrics).toBe(false);
      expect(result.featureSupport.trajectoryEvaluations).toBe(false);
      expect(result.featureSupport.workspaceBinding).toBe(false);
      expect(result.featureSupport.canonicalHandoffs).toBe(false);
      expect(result.featureSupport.advisoryContextProviders).toBe(false);
      expect(result.featureSupport.responsibilityConstraints).toBe(false);
      expect(result.featureSupport.differentialVerificationScope).toBe(false);
      expect(result.featureSupport.codeAttestation).toBe(false);
    });

    it.each([
      ['wrong version', { version: 2 }],
      ['provider is not neutral', { providerNeutral: false }],
      ['not integration-only', { integrationApiOnly: false }],
      ['not lazy', { lazy: false }],
      ['not opt-in', { optIn: false }],
      ['persisted', { persistedByForgeLoop: true }],
      ['lifecycle authority', { lifecycleAuthority: true }],
      ['evidence authority', { evidenceAuthority: true }],
      ['executable', { executable: true }],
    ])('degrades advisory context support without changing protocol-v1 compatibility for %s', (_name, overrides) => {
      const current = currentCapabilities();
      const feature = {
        ...current.features.advisoryContextProviders,
        ...overrides,
      } as NonNullable<ForgeLoopCapabilitiesSummary['features']['advisoryContextProviders']>;
      const result = negotiateCompatibilityMode({
        protocolInfo: normalizeCanonicalProtocolInfo(validProtocolInfo()),
        capabilities: {
          ...current,
          features: { ...current.features, advisoryContextProviders: feature },
        },
      });

      expect(result.mode).toBe('INTEGRATION_V1');
      expect(result.featureSupport.advisoryContextProviders).toBe(false);
    });

    it('keeps the protocol compatible while closing each incomplete 1.6.4 boundary feature', () => {
      const cases: Array<[string, (capabilities: ForgeLoopCapabilitiesSummary) => ForgeLoopCapabilitiesSummary]> = [
        ['workspace feature absent', (capabilities) => {
          const features = { ...capabilities.features };
          Reflect.deleteProperty(features, 'workspaceBinding');
          return { ...capabilities, features };
        }],
        ['handoff resource absent', (capabilities) => ({
          ...capabilities,
          resources: capabilities.resources.filter((resource) => resource !== 'task/handoffs'),
        })],
        ['responsibility contract incomplete', (capabilities) => ({
          ...capabilities,
          features: {
            ...capabilities.features,
            responsibilityConstraints: {
              ...capabilities.features.responsibilityConstraints,
              completionEnforced: false,
            } as NonNullable<ForgeLoopCapabilitiesSummary['features']['responsibilityConstraints']>,
          },
        })],
        ['verification modes incomplete', (capabilities) => ({
          ...capabilities,
          features: {
            ...capabilities.features,
            differentialVerificationScope: {
              ...capabilities.features.differentialVerificationScope,
              modes: ['AUTO', 'CHANGED', 'CLAIMED'],
            } as NonNullable<ForgeLoopCapabilitiesSummary['features']['differentialVerificationScope']>,
          },
        })],
        ['IMPACTED unexpectedly advertised', (capabilities) => ({
          ...capabilities,
          features: {
            ...capabilities.features,
            differentialVerificationScope: {
              ...capabilities.features.differentialVerificationScope,
              impactedMode: true,
            } as NonNullable<ForgeLoopCapabilitiesSummary['features']['differentialVerificationScope']>,
          },
        })],
        ['attestation feature absent', (capabilities) => {
          const features = { ...capabilities.features };
          Reflect.deleteProperty(features, 'codeAttestation');
          return { ...capabilities, features };
        }],
      ];

      for (const [label, mutate] of cases) {
        const result = negotiateCompatibilityMode({
          protocolInfo: normalizeCanonicalProtocolInfo(validProtocolInfo()),
          capabilities: mutate(currentCapabilities()),
        });
        expect(result.mode, label).toBe('INTEGRATION_V1');
        if (label.includes('workspace')) expect(result.featureSupport.workspaceBinding, label).toBe(false);
        if (label.includes('handoff')) expect(result.featureSupport.canonicalHandoffs, label).toBe(false);
        if (label.includes('responsibility')) expect(result.featureSupport.responsibilityConstraints, label).toBe(false);
        if (label.includes('verification') || label.includes('IMPACTED')) expect(result.featureSupport.differentialVerificationScope, label).toBe(false);
        if (label.includes('attestation')) expect(result.featureSupport.codeAttestation, label).toBe(false);
      }
    });

    it('rejects unknown protocol versions', () => {
      const result = negotiateCompatibilityMode({
        protocolInfo: normalizeCanonicalProtocolInfo(validProtocolInfo({ protocolVersion: 2 })),
        capabilities: validCapabilities(),
      });
      expect(result.mode).toBe('INCOMPATIBLE');
      expect(result.reason).toBe('UNSUPPORTED_PROTOCOL_VERSION');
    });

    it('rejects unknown schema versions from the compatibility block', () => {
      const result = negotiateCompatibilityMode({
        protocolInfo: normalizeCanonicalProtocolInfo(validProtocolInfo({ schemaVersion: 2 })),
        capabilities: validCapabilities(),
      });
      expect(result.mode).toBe('INCOMPATIBLE');
      expect(result.reason).toBe('UNSUPPORTED_SCHEMA_VERSION');
    });

    it('degrades to ARTIFACT_ONLY when the Integration API is unavailable', () => {
      const result = negotiateCompatibilityMode({
        protocolInfo: normalizeCanonicalProtocolInfo(validProtocolInfo()),
        capabilities: null,
      });
      expect(result.mode).toBe('ARTIFACT_ONLY');
      expect(result.reason).toBe('INTEGRATION_UNAVAILABLE');
    });

    it('fails closed on capability drift when the Integration API version differs', () => {
      const result = negotiateCompatibilityMode({
        protocolInfo: normalizeCanonicalProtocolInfo(validProtocolInfo()),
        capabilities: validCapabilities({ integrationApiVersion: 2 }),
      });
      expect(result.mode).toBe('INCOMPATIBLE');
      expect(result.reason).toBe('CAPABILITY_DRIFT');
    });

    it('fails closed when executor parity is broken', () => {
      const result = negotiateCompatibilityMode({
        protocolInfo: normalizeCanonicalProtocolInfo(validProtocolInfo()),
        capabilities: validCapabilities({ executorParity: false }),
      });
      expect(result.mode).toBe('INCOMPATIBLE');
      expect(result.reason).toBe('CAPABILITY_DRIFT');
    });

    it('fails closed when taskClaimRecovery capability is missing', () => {
      const result = negotiateCompatibilityMode({
        protocolInfo: normalizeCanonicalProtocolInfo(validProtocolInfo()),
        capabilities: validCapabilities({
          features: {},
        }),
      });
      expect(result.mode).toBe('INCOMPATIBLE');
      expect(result.reason).toBe('CAPABILITY_DRIFT');
    });

    it('fails closed when durable recovery features are not declared', () => {
      const result = negotiateCompatibilityMode({
        protocolInfo: normalizeCanonicalProtocolInfo(validProtocolInfo()),
        capabilities: validCapabilities({
          features: {
            taskClaimRecovery: {
              version: 1,
              durableRecoveryState: false,
              explicitResume: true,
              validatedClaimProjection: true,
            },
          },
        }),
      });
      expect(result.mode).toBe('INCOMPATIBLE');
      expect(result.reason).toBe('CAPABILITY_DRIFT');
    });

    it('fails closed when required resources are absent', () => {
      const result = negotiateCompatibilityMode({
        protocolInfo: normalizeCanonicalProtocolInfo(validProtocolInfo()),
        capabilities: validCapabilities({
          resources: ['protocol/info', 'project/tasks'],
        }),
      });
      expect(result.mode).toBe('INCOMPATIBLE');
      expect(result.reason).toBe('CAPABILITY_DRIFT');
    });

    it('degrades to ARTIFACT_ONLY when protocol info cannot be verified', () => {
      const result = negotiateCompatibilityMode({
        protocolInfo: null,
        capabilities: validCapabilities(),
      });
      expect(result.mode).toBe('ARTIFACT_ONLY');
      expect(result.reason).toBe('INTEGRATION_UNAVAILABLE');
    });
  });
});

describe('compatibility version axes', () => {
  it('evaluates the Integration API axis independently from the protocol axis', () => {
    // protocol 1 + schema 1 are valid; a future Integration API v2 must fail
    // as capability drift, not as an unsupported protocol version.
    const result = negotiateCompatibilityMode({
      protocolInfo: normalizeCanonicalProtocolInfo(validProtocolInfo()),
      capabilities: validCapabilities({ integrationApiVersion: 2 }),
    });
    expect(result.mode).toBe('INCOMPATIBLE');
    expect(result.reason).toBe('CAPABILITY_DRIFT');
  });

  it('evaluates the taskClaimRecovery feature axis independently', () => {
    const result = negotiateCompatibilityMode({
      protocolInfo: normalizeCanonicalProtocolInfo(validProtocolInfo()),
      capabilities: validCapabilities({
        features: {
          taskClaimRecovery: {
            version: 2,
            durableRecoveryState: true,
            explicitResume: true,
            validatedClaimProjection: true,
          },
        },
      }),
    });
    expect(result.mode).toBe('INCOMPATIBLE');
    expect(result.reason).toBe('CAPABILITY_DRIFT');
  });

  it('does not treat a mutating advertisement as a read-only capability', () => {
    const capabilities = currentCapabilities({
      commands: currentCapabilities().commands?.map((command) => (
        command.name === 'history' || command.name === 'metrics' ? { ...command, mutatesProtocol: true } : command
      )),
    });
    const support = deriveFeatureSupport(capabilities);
    expect(support.observability).toBe(false);
    expect(support.trajectoryMetrics).toBe(false);
  });

  describe('trajectory feature contract negotiation', () => {
    it('degrades trajectory metrics and evaluations when trajectoryEvaluation feature is missing', () => {
      const capabilities = currentCapabilities({
        features: {
          taskClaimRecovery: currentCapabilities().features.taskClaimRecovery,
          durableActions: currentCapabilities().features.durableActions,
        },
      });
      const support = deriveFeatureSupport(capabilities);
      expect(support.trajectoryMetrics).toBe(false);
      expect(support.trajectoryEvaluations).toBe(false);
    });

    it('degrades when readOnlyMetrics is false', () => {
      const capabilities = currentCapabilities({
        features: {
          ...currentCapabilities().features,
          trajectoryEvaluation: {
            version: 1,
            readOnlyMetrics: false,
            projectLocalReference: true,
          },
        },
      });
      const support = deriveFeatureSupport(capabilities);
      expect(support.trajectoryMetrics).toBe(false);
      expect(support.trajectoryEvaluations).toBe(false);
    });

    it('degrades when projectLocalReference is false', () => {
      const capabilities = currentCapabilities({
        features: {
          ...currentCapabilities().features,
          trajectoryEvaluation: {
            version: 1,
            readOnlyMetrics: true,
            projectLocalReference: false,
          },
        },
      });
      const support = deriveFeatureSupport(capabilities);
      expect(support.trajectoryMetrics).toBe(false);
      expect(support.trajectoryEvaluations).toBe(false);
    });

    it('degrades when trajectoryEvaluation version is not exactly 1 (e.g., version 2)', () => {
      const capabilities = currentCapabilities({
        features: {
          ...currentCapabilities().features,
          trajectoryEvaluation: {
            version: 2,
            readOnlyMetrics: true,
            projectLocalReference: true,
          },
        },
      });
      const support = deriveFeatureSupport(capabilities);
      expect(support.trajectoryMetrics).toBe(false);
      expect(support.trajectoryEvaluations).toBe(false);
    });

    it('degrades trajectoryMetrics independently when task/metrics resource is absent', () => {
      const capabilities = currentCapabilities({
        resources: currentCapabilities().resources.filter((r) => r !== 'task/metrics'),
      });
      const support = deriveFeatureSupport(capabilities);
      expect(support.trajectoryMetrics).toBe(false);
      expect(support.trajectoryEvaluations).toBe(true);
    });

    it('degrades trajectoryEvaluations independently when task/evaluations resource is absent', () => {
      const capabilities = currentCapabilities({
        resources: currentCapabilities().resources.filter((r) => r !== 'task/evaluations'),
      });
      const support = deriveFeatureSupport(capabilities);
      expect(support.trajectoryMetrics).toBe(true);
      expect(support.trajectoryEvaluations).toBe(false);
    });

    it('degrades trajectoryMetrics when metrics command is missing', () => {
      const capabilities = currentCapabilities({
        commands: currentCapabilities().commands?.filter((c) => c.name !== 'metrics'),
      });
      const support = deriveFeatureSupport(capabilities);
      expect(support.trajectoryMetrics).toBe(false);
      expect(support.trajectoryEvaluations).toBe(true);
    });
  });
});
