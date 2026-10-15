export interface ForgeLoopRecoveryFeatureSummary {
  version: number;
  durableRecoveryState: boolean;
  explicitResume: boolean;
  validatedClaimProjection: boolean;
}

export interface ForgeLoopAdaptiveExecutionProfilesFeatureSummary {
  version: number;
  supported: boolean;
  deterministic: boolean;
  lifecycleFastPath: boolean;
}

export interface ForgeLoopExecutionProfileContextFeatureSummary {
  version: number;
  supported: boolean;
  resource: string;
  resolvedProfileAuthoritative: boolean;
  compatibilityFallback: string;
  lifecycleFastPath: boolean;
}

export interface ForgeLoopContextUsageObservabilityFeatureSummary {
  version: number;
  supported: boolean;
  sources: string[];
  estimation: boolean;
  inflationStatus: string;
}

export interface ForgeLoopDurableActionsFeatureSummary {
  version: number;
  readOnlyResources: boolean;
  externalExecutionOverMcp: boolean;
}

export interface ForgeLoopTrajectoryEvaluationFeatureSummary {
  version: number;
  readOnlyMetrics: boolean;
  projectLocalReference: boolean;
}

export type ForgeLoopVerificationIsolationMode =
  | 'NATIVE_PROJECT'
  | 'PROJECT_ISOLATED'
  | 'SYSTEM_ISOLATED';

export interface ForgeLoopVerificationExecutionIsolationFeatureSummary {
  version: number;
  supported: boolean;
  adapter: boolean;
  modes: ForgeLoopVerificationIsolationMode[];
  protocolProjectRootSeparateFromExecutionCwd: boolean;
}

export interface ForgeLoopWorkspaceBindingFeatureSummary {
  version: number;
  supported: boolean;
  optional: boolean;
  explicitRebinding: boolean;
}

export interface ForgeLoopCanonicalHandoffsFeatureSummary {
  version: number;
  supported: boolean;
  immutable: boolean;
  lifecycleAuthority: boolean;
  evidenceAuthority: boolean;
  exactlyOnceAcceptance: boolean;
  acceptanceLedgerBacked: boolean;
  acceptanceCommand: string;
  acceptanceStatuses: string[];
}

export interface ForgeLoopAdvisoryContextProvidersFeatureSummary {
  version: number;
  supported: boolean;
  providerNeutral: boolean;
  integrationApiOnly: boolean;
  lazy: boolean;
  optIn: boolean;
  persistedByForgeLoop: boolean;
  lifecycleAuthority: boolean;
  evidenceAuthority: boolean;
  executable: boolean;
}

export interface ForgeLoopResponsibilityConstraintsFeatureSummary {
  version: number;
  supported: boolean;
  immutableDuringPass: boolean;
  completionEnforced: boolean;
}

export type ForgeLoopVerificationScopeMode = 'AUTO' | 'CHANGED' | 'CLAIMED' | 'FULL';

export interface ForgeLoopDifferentialVerificationScopeFeatureSummary {
  version: number;
  supported: boolean;
  modes: ForgeLoopVerificationScopeMode[];
  impactedMode: boolean;
}

export interface ForgeLoopCodeAttestationFeatureSummary {
  version: number;
  supported: boolean;
  modes: Array<'off' | 'optional' | 'required'>;
  revisionProviders: string[];
  signingProviders: string[];
  completionLedgerBound: boolean;
}

export interface ForgeLoopStructuralQualityFeatureSummary {
  version: number;
  supported: boolean;
  schemaVersion: number;
  providerNeutral: boolean;
  modes: string[];
  builtInProviders: string[];
  commands: string[];
  baselineImmutableAfterExecution: boolean;
  maxOutputBytes: number;
}

export interface ForgeLoopRepositoryIndexFeatureSummary {
  version: number;
  required: boolean;
  providerNeutral: boolean;
  implementation: string;
  engineVersion: string;
  managedBinary: boolean;
  resource: string;
}

export interface ForgeLoopAuditUxFeatureSummary {
  version: number;
  supported: boolean;
  readOnly: boolean;
  resource: string;
  timeline: boolean;
  lifecycleAuthority: boolean;
  evidenceAuthority: boolean;
  completionAuthority: boolean;
  mutationAuthority: boolean;
  externalExecution: boolean;
}

/**
 * Provider-neutral, experimental `providerExtensions` v1 advertisement from the
 * canonical `protocol/info` feature block. ForgeLoopAudit only ever displays
 * this as observation metadata; provider kinds never become lifecycle,
 * evidence, ownership, or completion authority and are never invoked here.
 */
export interface ForgeLoopProviderExtensionsFeatureSummary {
  version: number;
  supported: boolean;
  providerNeutral: boolean;
  maturity: string;
  publicRegistryApi: boolean;
  packageSubpathExported: boolean;
  autoInstall: boolean;
  lifecycleAuthority: boolean;
  completionAuthority: boolean;
  evidenceAuthority: boolean;
  providerKinds: string[];
  resultBoundary: string;
  cancellation: string;
}

export interface ForgeLoopCommandCapabilitySummary {
  name: string;
  baseRiskClass?: string;
  mayExecuteExternalProcess?: boolean;
  mutatesProtocol?: boolean;
}

export interface ForgeLoopCapabilitiesSummary {
  packageVersion: string | null;
  protocolVersion: number;
  integrationApiVersion: number;
  executorParity: boolean;
  features: {
    taskClaimRecovery: ForgeLoopRecoveryFeatureSummary;
    adaptiveExecutionProfiles?: ForgeLoopAdaptiveExecutionProfilesFeatureSummary;
    executionProfileContext?: ForgeLoopExecutionProfileContextFeatureSummary;
    contextUsageObservability?: ForgeLoopContextUsageObservabilityFeatureSummary;
    durableActions?: ForgeLoopDurableActionsFeatureSummary;
    trajectoryEvaluation?: ForgeLoopTrajectoryEvaluationFeatureSummary;
    verificationExecutionIsolation?: ForgeLoopVerificationExecutionIsolationFeatureSummary;
    workspaceBinding?: ForgeLoopWorkspaceBindingFeatureSummary;
    canonicalHandoffs?: ForgeLoopCanonicalHandoffsFeatureSummary;
    advisoryContextProviders?: ForgeLoopAdvisoryContextProvidersFeatureSummary;
    responsibilityConstraints?: ForgeLoopResponsibilityConstraintsFeatureSummary;
    differentialVerificationScope?: ForgeLoopDifferentialVerificationScopeFeatureSummary;
    codeAttestation?: ForgeLoopCodeAttestationFeatureSummary;
    structuralQuality?: ForgeLoopStructuralQualityFeatureSummary;
    repositoryIndex?: ForgeLoopRepositoryIndexFeatureSummary;
    auditUx?: ForgeLoopAuditUxFeatureSummary;
  };
  resources: string[];
  commands?: ForgeLoopCommandCapabilitySummary[];
}

export interface CanonicalTaskListEntry {
  taskId: string;
  healthy: boolean;
  phase: string | null;
  mutationAllowed: boolean;
}

export interface CanonicalTaskList {
  count: number;
  tasks: CanonicalTaskListEntry[];
}

export type CanonicalOwnershipResource = {
  taskId: string;
  phase: string | null;
  claimState: string;
  mutationAllowed: boolean;
  ownershipValid: boolean;
  recoveryStatus: string | null;
  historicalWriteClaims: string[];
  effectiveWriteClaims: string[];
  reasonCodes: string[];
};

export interface ForgeLoopCanonicalError {
  code: string;
  message: string;
  next?: string;
}

export interface ForgeLoopReadOnlyResult<T> {
  ok: boolean;
  command: string;
  exitCode: number;
  result: T | null;
  error: ForgeLoopCanonicalError | null;
  metadata: Record<string, unknown> | null;
}

export interface ForgeLoopResourceReadOptions {
  projectPath?: string;
  packageRoot?: string;
  packageVersion?: string | null;
  taskId?: string | null;
  actionId?: string | null;
}
