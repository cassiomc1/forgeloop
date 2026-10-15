import { ForgeLoopAuditError } from '@shared/errors';
import provenance from '../../../../schemas/provenance.json';
import type {
  CanonicalOwnershipResource,
  CanonicalTaskList,
  ForgeLoopCapabilitiesSummary,
  ForgeLoopReadOnlyResult,
  ForgeLoopResourceReadOptions,
  ForgeLoopStructuralQualityFeatureSummary,
  ForgeLoopVerificationIsolationMode,
  ForgeLoopVerificationScopeMode,
} from './types';
import type {
  RepositoryIndexProjection,
  RepositorySearchMatch,
  RepositorySearchRequest,
  RepositorySearchResult,
} from '@shared/domain';

export * from './types';

/**
 * Generated schema provenance is the fallback identity for diagnostics and
 * tests. Runtime calls still ask the loaded ESM integration module for its
 * package version so a package drift cannot be hidden by a stale literal.
 */
export const FORGELOOP_PACKAGE_VERSION = provenance.forgeLoopPackageVersion;
export const FORGELOOP_UPSTREAM_COMMIT = provenance.forgeLoopGitCommit;

/**
 * Commands the ForgeLoopAudit may invoke through the canonical read runtime beyond
 * dedicated integration resources. Every entry must classify as READ_ONLY
 * inside ForgeLoop; the guard re-verifies at invocation time.
 */
export const AUDIT_READ_ONLY_COMMANDS = Object.freeze(
  new Set([
    'next',
    'progress',
    'reconcile-continuity',
    'audit',
    'report',
    'policy-status',
    'validate-state',
    'validate-receipt',
    'history',
    'trace',
    'reflect',
    'inspect',
    'metrics',
    'action-show',
    'handoff-list',
    'handoff-show',
  ]),
);

const REQUIRED_RESOURCES = [
  'protocol/info',
  'project/tasks',
  'task/status',
  'task/ownership',
  'task/contract',
  'task/continuity',
] as const;

const KNOWN_VERIFICATION_ISOLATION_MODES: ForgeLoopVerificationIsolationMode[] = [
  'NATIVE_PROJECT',
  'PROJECT_ISOLATED',
  'SYSTEM_ISOLATED',
];

function isKnownIsolationMode(value: unknown): value is ForgeLoopVerificationIsolationMode {
  return typeof value === 'string'
    && KNOWN_VERIFICATION_ISOLATION_MODES.includes(value as ForgeLoopVerificationIsolationMode);
}

export interface ForgeLoopIntegrationAdapter {
  getPackageVersion(): string;
  getCapabilities(): ForgeLoopCapabilitiesSummary;
  readProtocolInfo(projectRoot: string): Promise<Record<string, unknown>>;
  listTasks(projectRoot: string): Promise<CanonicalTaskList>;
  readTaskStatus(projectRoot: string, taskId: string): Promise<Record<string, unknown>>;
  readTaskOwnership(projectRoot: string, taskId: string): Promise<CanonicalOwnershipResource>;
  readTaskContract(projectRoot: string, taskId: string): Promise<Record<string, unknown>>;
  readTaskContinuity(projectRoot: string, taskId: string): Promise<Record<string, unknown>>;
  /** Present when the negotiated structural-quality capability is advertised. */
  readTaskStructuralQuality?: (projectRoot: string, taskId: string) => Promise<Record<string, unknown>>;
  /** Present when the canonical execution-profile context capability is advertised. */
  readTaskContext?: (projectRoot: string, taskId: string) => Promise<Record<string, unknown>>;
  readTaskWorkspaceBinding?: (projectRoot: string, taskId: string) => Promise<Record<string, unknown>>;
  readTaskHandoffs?: (projectRoot: string, taskId: string) => Promise<Record<string, unknown>>;
  readTaskResponsibility?: (projectRoot: string, taskId: string) => Promise<Record<string, unknown>>;
  readTaskVerificationScope?: (projectRoot: string, taskId: string) => Promise<Record<string, unknown>>;
  readTaskAttestation?: (projectRoot: string, taskId: string) => Promise<Record<string, unknown>>;
  /** Optional in test/legacy adapters; present when the negotiated feature is advertised. */
  readTaskActions?: (projectRoot: string, taskId: string) => Promise<Record<string, unknown>>;
  readTaskAction?: (projectRoot: string, taskId: string, actionId: string) => Promise<Record<string, unknown>>;
  readTaskApprovals?: (projectRoot: string, taskId: string) => Promise<Record<string, unknown>>;
  /**
   * Present when the bounded, read-only Audit UX read model (`task/audit-view`)
   * is advertised. The projection is canonical presentation context only; it
   * never carries lifecycle, evidence, ownership, or completion authority.
   */
  readTaskAuditView?: (
    projectRoot: string,
    taskId: string,
    options?: { limit?: number; categories?: readonly string[] },
  ) => Promise<Record<string, unknown>>;
  readTaskMetrics?: (projectRoot: string, taskId: string) => Promise<Record<string, unknown>>;
  readTaskEvaluations?: (projectRoot: string, taskId: string) => Promise<Record<string, unknown>>;
  readCapabilityPolicy?: (projectRoot: string) => Promise<Record<string, unknown> | null>;
  getRepositoryIndexStatus?: (projectRoot: string) => Promise<RepositoryIndexProjection>;
  searchRepository?: (projectRoot: string, request: RepositorySearchRequest) => Promise<RepositorySearchResult>;
  executeReadOnly<T = Record<string, unknown>>(
    projectRoot: string,
    command: string,
    input?: Record<string, unknown>,
  ): Promise<ForgeLoopReadOnlyResult<T>>;
}

function assertReadProjectRoot(projectRoot: string): void {
  if (typeof projectRoot !== 'string' || projectRoot.length === 0) {
    throw ForgeLoopAuditError.pathBoundaryViolation(String(projectRoot), 'integration adapter requires a resolved project root');
  }
}

interface ForgeLoopIntegrationModule {
  getForgeLoopPackageVersion(): string;
  executeForgeLoopCommand(options: { command: string; projectPath?: string; input?: Record<string, unknown> }): Promise<ForgeLoopReadOnlyResult<unknown>>;
  getForgeLoopCapabilities(options?: { packageVersion?: string | null }): {
    packageVersion: string | null;
    protocolVersion: number;
    integrationApiVersion: number;
    executorParity: boolean;
    features: {
      taskClaimRecovery: {
        version: number;
        durableRecoveryState: boolean;
        explicitResume: boolean;
        validatedClaimProjection: boolean;
      };
      auditUx?: {
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
      };
      adaptiveExecutionProfiles?: {
        version: number;
        supported: boolean;
        deterministic: boolean;
        lifecycleFastPath: boolean;
      };
      executionProfileContext?: {
        version: number;
        supported: boolean;
        resource: string;
        resolvedProfileAuthoritative: boolean;
        compatibilityFallback: string;
        lifecycleFastPath: boolean;
      };
      contextUsageObservability?: {
        version: number;
        supported: boolean;
        sources: unknown[];
        estimation: boolean;
        inflationStatus: string;
      };
      durableActions?: {
        version: number;
        readOnlyResources: boolean;
        externalExecutionOverMcp: boolean;
      };
      trajectoryEvaluation?: {
        version: number;
        readOnlyMetrics: boolean;
        projectLocalReference: boolean;
      };
      verificationExecutionIsolation?: {
        version: number;
        supported: boolean;
        adapter: boolean;
        modes: unknown[];
        protocolProjectRootSeparateFromExecutionCwd: boolean;
      };
      workspaceBinding?: {
        version: number;
        supported: boolean;
        optional: boolean;
        explicitRebinding: boolean;
      };
      canonicalHandoffs?: {
        version: number;
        supported: boolean;
        immutable: boolean;
        lifecycleAuthority: boolean;
        evidenceAuthority: boolean;
        exactlyOnceAcceptance: boolean;
        acceptanceLedgerBacked: boolean;
        acceptanceCommand: string;
        acceptanceStatuses: unknown[];
      };
      advisoryContextProviders?: {
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
      };
      responsibilityConstraints?: {
        version: number;
        supported: boolean;
        immutableDuringPass: boolean;
        completionEnforced: boolean;
      };
      differentialVerificationScope?: {
        version: number;
        supported: boolean;
        modes: unknown[];
        impactedMode: boolean;
      };
      codeAttestation?: {
        version: number;
        supported: boolean;
        modes: unknown[];
        revisionProviders: unknown[];
        signingProviders: unknown[];
        completionLedgerBound: boolean;
      };
      structuralQuality?: {
        version: number;
        supported: boolean;
        schemaVersion: number;
        providerNeutral: boolean;
        modes: unknown[];
        builtInProviders: unknown[];
        commands: unknown[];
        baselineImmutableAfterExecution: boolean;
        maxOutputBytes: number;
      };
      repositoryIndex?: {
        version: number;
        required: boolean;
        providerNeutral: boolean;
        implementation: string;
        engineVersion: string;
        engineManagedByForgeLoop: boolean;
        resource: string;
        managedBinary: boolean;
      };
    };
    commands: Array<Record<string, unknown>>;
    resources: Array<{ name: string }>;
  };
  classifyForgeLoopInvocation(command: string, input?: Record<string, unknown>): {
    riskClass: string;
    mutatesProtocol: boolean;
    executesExternalProcess: boolean;
  };
  readForgeLoopIntegrationResource<T = Record<string, unknown>>(
    uri: string,
    options?: ForgeLoopResourceReadOptions,
  ): Promise<{ uri: string; taskId?: string | null; data: T }>;
  repositorySearch?: (input: RepositorySearchRequest & { projectPath?: string }) => Promise<unknown>;
  repositoryIndexStatus?: (input?: { projectPath?: string }) => Promise<unknown>;
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function nullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function nullableBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function normalizeRepositoryIndexStatus(value: unknown): RepositoryIndexProjection {
  const raw = recordValue(value);
  const index = recordValue(raw.index);
  const policy = recordValue(raw.policy);
  const server = recordValue(raw.server);
  const diagnostics = Array.isArray(raw.diagnostics)
    ? raw.diagnostics.flatMap((entry) => {
      const diagnostic = recordValue(entry);
      return typeof diagnostic.code === 'string' && typeof diagnostic.message === 'string'
        ? [{ code: diagnostic.code, message: diagnostic.message }]
        : [];
    })
    : [];
  const health = typeof raw.health === 'string'
    && ['READY', 'INDEXING', 'NOT_INITIALIZED', 'ENGINE_MISSING', 'ENGINE_INVALID', 'SERVER_DOWN', 'SERVER_UNHEALTHY', 'ERROR'].includes(raw.health)
    ? raw.health as RepositoryIndexProjection['health']
    : 'ERROR';
  return {
    schemaVersion: raw.schemaVersion === 1 ? 1 : null,
    available: true,
    source: 'FORGELOOP_INTEGRATION',
    required: raw.required === true ? true : raw.required === false ? false : null,
    engine: nullableString(raw.engine),
    engineVersion: nullableString(raw.engineVersion),
    managedBinary: nullableBoolean(raw.managedBinary),
    overridden: nullableBoolean(raw.overridden),
    index: {
      present: nullableBoolean(index.present),
      complete: nullableBoolean(index.complete),
      files: nullableNumber(index.files),
      trigrams: nullableNumber(index.trigrams),
      createdAt: nullableNumber(index.createdAt),
      updatedAt: nullableNumber(index.updatedAt),
    },
    policy: {
      maxFileSize: typeof policy.maxFileSize === 'string' || typeof policy.maxFileSize === 'number' ? policy.maxFileSize : null,
      maxCpuPercent: nullableNumber(policy.maxCpuPercent),
      watcherQueueCap: nullableNumber(policy.watcherQueueCap),
      autoSaveMutations: nullableNumber(policy.autoSaveMutations),
    },
    server: {
      running: nullableBoolean(server.running),
      owned: nullableBoolean(server.owned),
      pid: nullableNumber(server.pid),
      port: nullableNumber(server.port),
      watcher: nullableString(server.watcher),
      indexing: nullableString(server.indexing),
      files: nullableNumber(server.files),
    },
    health,
    diagnostics,
  };
}

function normalizeRepositorySearchResult(value: unknown, request: RepositorySearchRequest): RepositorySearchResult {
  const raw = recordValue(value);
  const rawQuery = recordValue(raw.query);
  const normalizeMatch = (entry: unknown): RepositorySearchMatch => {
    const match = recordValue(entry);
    const submatches = Array.isArray(match.submatches)
      ? match.submatches.flatMap((submatch) => {
        const value = recordValue(submatch);
        return typeof value.start === 'number' && typeof value.end === 'number'
          ? [{ start: value.start, end: value.end, match: nullableString(value.match) }]
          : [];
      })
      : [];
    return {
      path: typeof match.path === 'string' ? match.path : '',
      line: typeof match.line === 'number' ? match.line : 0,
      column: nullableNumber(match.column),
      offset: nullableNumber(match.offset),
      text: typeof match.text === 'string' ? match.text : '',
      submatches,
    };
  };
  const rawMetrics = recordValue(raw.metrics);
  const rawIndex = recordValue(raw.repositoryIndex);
  return {
    available: true,
    source: 'FORGELOOP_INTEGRATION',
    query: {
      ...request,
      ...(typeof rawQuery.pattern === 'string' ? { pattern: rawQuery.pattern } : {}),
      globs: Array.isArray(rawQuery.globs) ? stringArray(rawQuery.globs) : request.globs ?? [],
      types: Array.isArray(rawQuery.types) ? stringArray(rawQuery.types) : request.types ?? [],
    },
    repositoryIndex: typeof rawIndex.engine === 'string' ? {
      engine: rawIndex.engine,
      engineVersion: nullableString(rawIndex.engineVersion),
      indexed: rawIndex.indexed === true,
      server: rawIndex.server === true,
    } : null,
    matches: Array.isArray(raw.matches) ? raw.matches.map(normalizeMatch) : [],
    contexts: Array.isArray(raw.contexts) ? raw.contexts.map(normalizeMatch) : [],
    files: Array.isArray(raw.files) ? stringArray(raw.files) : [],
    stats: recordValue(raw.stats) as Record<string, number>,
    metrics: Object.keys(rawMetrics).length === 0 ? null : {
      queryDurationMs: nullableNumber(rawMetrics.queryDurationMs),
      nativeDurationMs: nullableNumber(rawMetrics.nativeDurationMs),
      matchCount: typeof rawMetrics.matchCount === 'number' ? rawMetrics.matchCount : 0,
      matchedFileCount: typeof rawMetrics.matchedFileCount === 'number' ? rawMetrics.matchedFileCount : 0,
      engine: nullableString(rawMetrics.engine),
      engineVersion: nullableString(rawMetrics.engineVersion),
      serverUsed: nullableBoolean(rawMetrics.serverUsed),
      exitCode: nullableNumber(rawMetrics.exitCode),
      ignoredNativeEvents: nullableNumber(rawMetrics.ignoredNativeEvents),
      ...(typeof rawMetrics.bytesSearched === 'number' ? { bytesSearched: rawMetrics.bytesSearched } : {}),
      ...(typeof rawMetrics.matchedLines === 'number' ? { matchedLines: rawMetrics.matchedLines } : {}),
    },
    trust: 'DISCOVERY_ONLY',
  };
}

const KNOWN_VERIFICATION_SCOPE_MODES: ForgeLoopVerificationScopeMode[] = ['AUTO', 'CHANGED', 'CLAIMED', 'FULL'];

function verificationScopeModes(value: unknown): ForgeLoopVerificationScopeMode[] {
  return stringArray(value).filter((entry): entry is ForgeLoopVerificationScopeMode =>
    KNOWN_VERIFICATION_SCOPE_MODES.includes(entry as ForgeLoopVerificationScopeMode));
}

let cachedModule: Promise<ForgeLoopIntegrationModule> | null = null;

/**
 * Load the bundled Integration API at runtime. The package is external to
 * the main-process bundle and resolved from node_modules (packaged inside
 * the app), so its ESM modules keep working without any global ForgeLoop CLI.
 */
async function loadIntegrationModule(): Promise<ForgeLoopIntegrationModule> {
  if (!cachedModule) {
    // The upstream declaration intentionally types capability/resource payloads
    // as generic records. This private adapter narrows the exact public
    // contract after the module boundary; no ambient duplicate declaration is
    // needed now that ForgeLoopAudit resolves the vendored package's own declarations.
    cachedModule = import('@cassiomc1/forgeloop/integration') as unknown as Promise<ForgeLoopIntegrationModule>;
  }
  return cachedModule;
}

export function createForgeLoopIntegration(): Promise<ForgeLoopIntegrationAdapter> {
  return loadIntegrationModule().then((fl) => buildAdapter(fl));
}

function buildAdapter(fl: ForgeLoopIntegrationModule): ForgeLoopIntegrationAdapter {
  return {
    getPackageVersion(): string {
      return fl.getForgeLoopPackageVersion();
    },

    getCapabilities(): ForgeLoopCapabilitiesSummary {
      const packageVersion = fl.getForgeLoopPackageVersion();
      const raw = fl.getForgeLoopCapabilities({ packageVersion });
      const adaptiveExecutionProfiles = raw.features.adaptiveExecutionProfiles;
      const executionProfileContext = raw.features.executionProfileContext;
      const contextUsageObservability = raw.features.contextUsageObservability;
      const durableActions = raw.features.durableActions;
      const trajectoryEvaluation = raw.features.trajectoryEvaluation;
      const verificationExecutionIsolation = raw.features.verificationExecutionIsolation;
      const workspaceBinding = raw.features.workspaceBinding;
      const canonicalHandoffs = raw.features.canonicalHandoffs;
      const advisoryContextProviders = raw.features.advisoryContextProviders;
      const responsibilityConstraints = raw.features.responsibilityConstraints;
      const differentialVerificationScope = raw.features.differentialVerificationScope;
      const codeAttestation = raw.features.codeAttestation;
      const structuralQuality = raw.features.structuralQuality;
      const repositoryIndex = raw.features.repositoryIndex;
      const auditUx = raw.features.auditUx;
      return {
        packageVersion,
        protocolVersion: raw.protocolVersion,
        integrationApiVersion: raw.integrationApiVersion,
        executorParity: raw.executorParity === true,
        features: {
          taskClaimRecovery: {
            version: raw.features.taskClaimRecovery.version,
            durableRecoveryState: raw.features.taskClaimRecovery.durableRecoveryState === true,
            explicitResume: raw.features.taskClaimRecovery.explicitResume === true,
            validatedClaimProjection: raw.features.taskClaimRecovery.validatedClaimProjection === true,
          },
          ...(auditUx ? {
            auditUx: {
              version: finiteNumber(auditUx.version, 0),
              supported: auditUx.supported === true,
              readOnly: auditUx.readOnly === true,
              resource: typeof auditUx.resource === 'string' ? auditUx.resource : '',
              timeline: auditUx.timeline === true,
              lifecycleAuthority: auditUx.lifecycleAuthority === true,
              evidenceAuthority: auditUx.evidenceAuthority === true,
              completionAuthority: auditUx.completionAuthority === true,
              mutationAuthority: auditUx.mutationAuthority === true,
              externalExecution: auditUx.externalExecution === true,
            },
          } : {}),
          ...(adaptiveExecutionProfiles ? {
            adaptiveExecutionProfiles: {
              version: finiteNumber(adaptiveExecutionProfiles.version, 0),
              supported: adaptiveExecutionProfiles.supported === true,
              deterministic: adaptiveExecutionProfiles.deterministic === true,
              lifecycleFastPath: adaptiveExecutionProfiles.lifecycleFastPath === true,
            },
          } : {}),
          ...(executionProfileContext ? {
            executionProfileContext: {
              version: finiteNumber(executionProfileContext.version, 0),
              supported: executionProfileContext.supported === true,
              resource: typeof executionProfileContext.resource === 'string' ? executionProfileContext.resource : '',
              resolvedProfileAuthoritative: executionProfileContext.resolvedProfileAuthoritative === true,
              compatibilityFallback: typeof executionProfileContext.compatibilityFallback === 'string'
                ? executionProfileContext.compatibilityFallback
                : '',
              lifecycleFastPath: executionProfileContext.lifecycleFastPath === true,
            },
          } : {}),
          ...(contextUsageObservability ? {
            contextUsageObservability: {
              version: finiteNumber(contextUsageObservability.version, 0),
              supported: contextUsageObservability.supported === true,
              sources: stringArray(contextUsageObservability.sources),
              estimation: contextUsageObservability.estimation === true,
              inflationStatus: typeof contextUsageObservability.inflationStatus === 'string'
                ? contextUsageObservability.inflationStatus
                : '',
            },
          } : {}),
          ...(durableActions ? {
            durableActions: {
              version: durableActions.version,
              readOnlyResources: durableActions.readOnlyResources === true,
              externalExecutionOverMcp: durableActions.externalExecutionOverMcp === true,
            },
          } : {}),
          ...(trajectoryEvaluation ? {
            trajectoryEvaluation: {
              version: trajectoryEvaluation.version,
              readOnlyMetrics: trajectoryEvaluation.readOnlyMetrics === true,
              projectLocalReference: trajectoryEvaluation.projectLocalReference === true,
            },
          } : {}),
          ...(verificationExecutionIsolation ? {
            verificationExecutionIsolation: {
              version: verificationExecutionIsolation.version,
              supported: verificationExecutionIsolation.supported === true,
              adapter: verificationExecutionIsolation.adapter === true,
              modes: Array.isArray(verificationExecutionIsolation.modes)
                ? verificationExecutionIsolation.modes.filter(isKnownIsolationMode)
                : [],
              protocolProjectRootSeparateFromExecutionCwd:
                verificationExecutionIsolation.protocolProjectRootSeparateFromExecutionCwd === true,
            },
          } : {}),
          ...(workspaceBinding ? {
            workspaceBinding: {
              version: finiteNumber(workspaceBinding.version, 0),
              supported: workspaceBinding.supported === true,
              optional: workspaceBinding.optional === true,
              explicitRebinding: workspaceBinding.explicitRebinding === true,
            },
          } : {}),
          ...(canonicalHandoffs ? {
            canonicalHandoffs: {
              version: finiteNumber(canonicalHandoffs.version, 0),
              supported: canonicalHandoffs.supported === true,
              immutable: canonicalHandoffs.immutable === true,
              lifecycleAuthority: canonicalHandoffs.lifecycleAuthority === true,
              evidenceAuthority: canonicalHandoffs.evidenceAuthority === true,
              exactlyOnceAcceptance: canonicalHandoffs.exactlyOnceAcceptance === true,
              acceptanceLedgerBacked: canonicalHandoffs.acceptanceLedgerBacked === true,
              acceptanceCommand: typeof canonicalHandoffs.acceptanceCommand === 'string'
                ? canonicalHandoffs.acceptanceCommand
                : '',
              acceptanceStatuses: stringArray(canonicalHandoffs.acceptanceStatuses),
            },
          } : {}),
          ...(advisoryContextProviders ? {
            advisoryContextProviders: {
              version: finiteNumber(advisoryContextProviders.version, 0),
              supported: advisoryContextProviders.supported === true,
              providerNeutral: advisoryContextProviders.providerNeutral === true,
              integrationApiOnly: advisoryContextProviders.integrationApiOnly === true,
              lazy: advisoryContextProviders.lazy === true,
              optIn: advisoryContextProviders.optIn === true,
              persistedByForgeLoop: advisoryContextProviders.persistedByForgeLoop === true,
              lifecycleAuthority: advisoryContextProviders.lifecycleAuthority === true,
              evidenceAuthority: advisoryContextProviders.evidenceAuthority === true,
              executable: advisoryContextProviders.executable === true,
            },
          } : {}),
          ...(responsibilityConstraints ? {
            responsibilityConstraints: {
              version: finiteNumber(responsibilityConstraints.version, 0),
              supported: responsibilityConstraints.supported === true,
              immutableDuringPass: responsibilityConstraints.immutableDuringPass === true,
              completionEnforced: responsibilityConstraints.completionEnforced === true,
            },
          } : {}),
          ...(differentialVerificationScope ? {
            differentialVerificationScope: {
              version: finiteNumber(differentialVerificationScope.version, 0),
              supported: differentialVerificationScope.supported === true,
              modes: verificationScopeModes(differentialVerificationScope.modes),
              impactedMode: differentialVerificationScope.impactedMode === true,
            },
          } : {}),
          ...(codeAttestation ? {
            codeAttestation: {
              version: finiteNumber(codeAttestation.version, 0),
              supported: codeAttestation.supported === true,
              modes: stringArray(codeAttestation.modes).filter((entry): entry is 'off' | 'optional' | 'required' =>
                entry === 'off' || entry === 'optional' || entry === 'required'),
              revisionProviders: stringArray(codeAttestation.revisionProviders),
              signingProviders: stringArray(codeAttestation.signingProviders),
              completionLedgerBound: codeAttestation.completionLedgerBound === true,
            },
          } : {}),
          ...(structuralQuality ? {
            structuralQuality: {
              version: finiteNumber(structuralQuality.version, 0),
              supported: structuralQuality.supported === true,
              schemaVersion: finiteNumber(structuralQuality.schemaVersion, 0),
              providerNeutral: structuralQuality.providerNeutral === true,
              modes: stringArray(structuralQuality.modes),
              builtInProviders: stringArray(structuralQuality.builtInProviders),
              commands: stringArray(structuralQuality.commands),
              baselineImmutableAfterExecution: structuralQuality.baselineImmutableAfterExecution === true,
              maxOutputBytes: finiteNumber(structuralQuality.maxOutputBytes, 0),
            } satisfies ForgeLoopStructuralQualityFeatureSummary,
          } : {}),
          ...(repositoryIndex ? {
            repositoryIndex: {
              version: finiteNumber(repositoryIndex.version, 0),
              required: repositoryIndex.required === true,
              providerNeutral: repositoryIndex.providerNeutral === true,
              implementation: typeof repositoryIndex.implementation === 'string' ? repositoryIndex.implementation : '',
              engineVersion: typeof repositoryIndex.engineVersion === 'string' ? repositoryIndex.engineVersion : '',
              managedBinary: repositoryIndex.managedBinary === true,
              resource: typeof repositoryIndex.resource === 'string' ? repositoryIndex.resource : '',
            },
          } : {}),
        },
        resources: raw.resources.map((resource) => resource.name),
        commands: raw.commands.map((command) => ({
          name: typeof command.name === 'string' ? command.name : '',
          baseRiskClass: typeof command.baseRiskClass === 'string' ? command.baseRiskClass : undefined,
          mayExecuteExternalProcess: command.mayExecuteExternalProcess === true,
          mutatesProtocol: command.mutatesProtocol === true
            || (typeof command.mutation === 'string' && command.mutation !== 'READ_ONLY'),
        })).filter((command) => command.name.length > 0),
      };
    },

    async readProtocolInfo(projectRoot: string): Promise<Record<string, unknown>> {
      assertReadProjectRoot(projectRoot);
      return readResource<Record<string, unknown>>(fl, 'protocol/info', { packageVersion: fl.getForgeLoopPackageVersion() });
    },

    async listTasks(projectRoot: string): Promise<CanonicalTaskList> {
      assertReadProjectRoot(projectRoot);
      return readResource<CanonicalTaskList>(fl, 'project/tasks', { projectPath: projectRoot });
    },

    async readTaskStatus(projectRoot: string, taskId: string): Promise<Record<string, unknown>> {
      assertReadProjectRoot(projectRoot);
      return readResource<Record<string, unknown>>(fl, 'task/status', { projectPath: projectRoot, taskId });
    },

    async readTaskOwnership(projectRoot: string, taskId: string): Promise<CanonicalOwnershipResource> {
      assertReadProjectRoot(projectRoot);
      return readResource<CanonicalOwnershipResource>(fl, 'task/ownership', { projectPath: projectRoot, taskId });
    },

    async readTaskContract(projectRoot: string, taskId: string): Promise<Record<string, unknown>> {
      assertReadProjectRoot(projectRoot);
      return readResource<Record<string, unknown>>(fl, 'task/contract', { projectPath: projectRoot, taskId });
    },

    async readTaskContinuity(projectRoot: string, taskId: string): Promise<Record<string, unknown>> {
      assertReadProjectRoot(projectRoot);
      return readResource<Record<string, unknown>>(fl, 'task/continuity', { projectPath: projectRoot, taskId });
    },

    async readTaskStructuralQuality(projectRoot: string, taskId: string): Promise<Record<string, unknown>> {
      assertReadProjectRoot(projectRoot);
      return readResource<Record<string, unknown>>(fl, 'task/structural-quality', { projectPath: projectRoot, taskId });
    },

    async readTaskContext(projectRoot: string, taskId: string): Promise<Record<string, unknown>> {
      assertReadProjectRoot(projectRoot);
      return readResource<Record<string, unknown>>(fl, 'task/context', { projectPath: projectRoot, taskId });
    },

    async readTaskWorkspaceBinding(projectRoot: string, taskId: string): Promise<Record<string, unknown>> {
      assertReadProjectRoot(projectRoot);
      return readResource<Record<string, unknown>>(fl, 'task/workspace-binding', { projectPath: projectRoot, taskId });
    },

    async readTaskHandoffs(projectRoot: string, taskId: string): Promise<Record<string, unknown>> {
      assertReadProjectRoot(projectRoot);
      return readResource<Record<string, unknown>>(fl, 'task/handoffs', { projectPath: projectRoot, taskId });
    },

    async readTaskResponsibility(projectRoot: string, taskId: string): Promise<Record<string, unknown>> {
      assertReadProjectRoot(projectRoot);
      return readResource<Record<string, unknown>>(fl, 'task/responsibility', { projectPath: projectRoot, taskId });
    },

    async readTaskVerificationScope(projectRoot: string, taskId: string): Promise<Record<string, unknown>> {
      assertReadProjectRoot(projectRoot);
      return readResource<Record<string, unknown>>(fl, 'task/verification-scope', { projectPath: projectRoot, taskId });
    },

    async readTaskAttestation(projectRoot: string, taskId: string): Promise<Record<string, unknown>> {
      assertReadProjectRoot(projectRoot);
      return readResource<Record<string, unknown>>(fl, 'task/attestation', { projectPath: projectRoot, taskId });
    },

    async readTaskActions(projectRoot: string, taskId: string): Promise<Record<string, unknown>> {
      assertReadProjectRoot(projectRoot);
      return readResource<Record<string, unknown>>(fl, 'task/actions', { projectPath: projectRoot, taskId });
    },

    async readTaskAction(projectRoot: string, taskId: string, actionId: string): Promise<Record<string, unknown>> {
      assertReadProjectRoot(projectRoot);
      return readResource<Record<string, unknown>>(fl, 'task/action', { projectPath: projectRoot, taskId, actionId });
    },

    async readTaskApprovals(projectRoot: string, taskId: string): Promise<Record<string, unknown>> {
      assertReadProjectRoot(projectRoot);
      return readResource<Record<string, unknown>>(fl, 'task/approvals', { projectPath: projectRoot, taskId });
    },

    async readTaskAuditView(
      projectRoot: string,
      taskId: string,
      options: { limit?: number; categories?: readonly string[] } = {},
    ): Promise<Record<string, unknown>> {
      assertReadProjectRoot(projectRoot);
      return readResource<Record<string, unknown>>(fl, 'task/audit-view', {
        projectPath: projectRoot,
        taskId,
        ...(typeof options.limit === 'number' ? { limit: options.limit } : {}),
        ...(options.categories && options.categories.length > 0 ? { categories: [...options.categories] } : {}),
      });
    },

    async readTaskMetrics(projectRoot: string, taskId: string): Promise<Record<string, unknown>> {
      assertReadProjectRoot(projectRoot);
      return readResource<Record<string, unknown>>(fl, 'task/metrics', { projectPath: projectRoot, taskId });
    },

    async readTaskEvaluations(projectRoot: string, taskId: string): Promise<Record<string, unknown>> {
      assertReadProjectRoot(projectRoot);
      return readResource<Record<string, unknown>>(fl, 'task/evaluations', { projectPath: projectRoot, taskId });
    },

    async readCapabilityPolicy(projectRoot: string): Promise<Record<string, unknown> | null> {
      assertReadProjectRoot(projectRoot);
      return readResource<Record<string, unknown> | null>(fl, 'project/capability-policy', { projectPath: projectRoot });
    },

    async getRepositoryIndexStatus(projectRoot: string): Promise<RepositoryIndexProjection> {
      assertReadProjectRoot(projectRoot);
      if (!fl.repositoryIndexStatus) {
        return {
          schemaVersion: null,
          available: false,
          source: 'UNAVAILABLE',
          required: null,
          engine: null,
          engineVersion: null,
          managedBinary: null,
          overridden: null,
          index: { present: null, complete: null, files: null, trigrams: null, createdAt: null, updatedAt: null },
          policy: { maxFileSize: null, maxCpuPercent: null, watcherQueueCap: null, autoSaveMutations: null },
          server: { running: null, owned: null, pid: null, port: null, watcher: null, indexing: null, files: null },
          health: 'UNAVAILABLE',
          diagnostics: [{ code: 'CAPABILITY_UNAVAILABLE', message: 'ForgeLoop Repository Index status is not exported by this Integration API.' }],
          message: 'Repository Index status is unavailable for this ForgeLoop runtime.',
        };
      }
      return normalizeRepositoryIndexStatus(await fl.repositoryIndexStatus({ projectPath: projectRoot }));
    },

    async searchRepository(projectRoot: string, request: RepositorySearchRequest): Promise<RepositorySearchResult> {
      assertReadProjectRoot(projectRoot);
      if (!fl.repositorySearch) {
        return {
          available: false,
          source: 'UNAVAILABLE',
          query: { ...request, globs: request.globs ?? [], types: request.types ?? [] },
          repositoryIndex: null,
          matches: [],
          contexts: [],
          files: [],
          stats: {},
          metrics: null,
          trust: 'DISCOVERY_ONLY',
          message: 'ForgeLoop Repository Search is unavailable for this runtime.',
        };
      }
      return normalizeRepositorySearchResult(await fl.repositorySearch({ ...request, projectPath: projectRoot }), request);
    },

    async executeReadOnly<T>(
      projectRoot: string,
      command: string,
      input: Record<string, unknown> = {},
    ): Promise<ForgeLoopReadOnlyResult<T>> {
      let classification: ReturnType<ForgeLoopIntegrationModule['classifyForgeLoopInvocation']>;
      try {
        classification = fl.classifyForgeLoopInvocation(command, input);
      } catch (error) {
        throw ForgeLoopAuditError.cliFailed(
          command,
          -1,
          `Command has no canonical integration classification: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      if (
        classification.riskClass !== INTEGRATION_RISK_CLASSES_READ_ONLY ||
        classification.mutatesProtocol !== false ||
        classification.executesExternalProcess !== false
      ) {
        throw ForgeLoopAuditError.cliFailed(
          command,
          -1,
          `ForgeLoopAudit refuses non-read-only ForgeLoop invocation: ${classification.riskClass}`,
        );
      }

      return fl.executeForgeLoopCommand({ command, projectPath: projectRoot, input }) as Promise<ForgeLoopReadOnlyResult<T>>;
    },
  };
}

const INTEGRATION_RISK_CLASSES_READ_ONLY = 'READ_ONLY';

async function readResource<T>(
  fl: ForgeLoopIntegrationModule,
  uri: string,
  options: Parameters<ForgeLoopIntegrationModule['readForgeLoopIntegrationResource']>[1],
): Promise<T> {
  const resource = await fl.readForgeLoopIntegrationResource<T>(uri, options);
  return resource.data;
}

export function hasRequiredResources(capabilities: ForgeLoopCapabilitiesSummary): boolean {
  return REQUIRED_RESOURCES.every((resource) => capabilities.resources.includes(resource));
}
