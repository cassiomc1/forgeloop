import { CLI_COMMAND_DEFINITIONS } from "./cli-command-definitions.js";
import { ARTIFACT_REGISTRY } from "./artifact-registry.js";
import { PUBLIC_ERROR_REGISTRY } from "./error-codes.js";
import { GUIDE_REGISTRY } from "./guide-registry.js";
import { PROTOCOL_VERSION, WORK_PHASES, WORK_TRANSITIONS } from "./protocol.js";
import { VERIFICATION_ISOLATION_MODES } from "./verification-execution.js";

export const SCHEMA_COMPATIBILITY_POLICY = Object.freeze({
  protocolVersion: PROTOCOL_VERSION,
  schemaVersion: 1,
  read: "Readers reject unknown protocol or schema versions; compatibility changes require a new published version.",
  write: "Writers emit only the current schema and protocol versions.",
  migration: "Use migrate-protocol --to <version> --dry-run to plan an explicit supported migration. Legacy singleton artifacts are migrated with a receipt-backed task-migrate action.",
});

function publicSchemaVersions() {
  return Object.fromEntries(
    [...new Set(Object.values(ARTIFACT_REGISTRY)
      .filter((artifact) => artifact.isPublic && artifact.isPersisted)
      .map((artifact) => artifact.schema)
      .filter(Boolean))]
      .sort()
      .map((schema) => [schema, [SCHEMA_COMPATIBILITY_POLICY.schemaVersion]]),
  );
}

export function protocolInfo({ packageVersion = null } = {}) {
  const errors = Object.values(PUBLIC_ERROR_REGISTRY);
  const schemaVersions = publicSchemaVersions();
  return {
    packageVersion,
    protocolVersion: PROTOCOL_VERSION,
    readsProtocol: [PROTOCOL_VERSION],
    writesProtocol: [PROTOCOL_VERSION],
    readsSchemaVersions: schemaVersions,
    writesSchemaVersions: schemaVersions,
    compatibility: SCHEMA_COMPATIBILITY_POLICY,
    features: {
      taskClaimRecovery: {
        version: 1,
        durableRecoveryState: true,
        explicitResume: true,
        validatedClaimProjection: true,
      },
      integrationApi: {
        version: 1,
        structuredCommandRuntime: true,
        canonicalResources: true,
      },
      repositoryIndex: {
        version: 1,
        required: true,
        providerNeutral: true,
        implementation: "microsoft/tgrep",
        engineVersion: "1.0.3",
        engineManagedByForgeLoop: true,
        commands: ["search", "index-setup", "index-start", "index-stop", "index-status", "index-rebuild"],
        resource: "repository/index-status",
        managedBinary: true,
        path: ".forgeloop/repository-index/tgrep",
        lifecycleStatePath: ".forgeloop/repository-index/engine-state.json",
        noPathFallback: true,
        supports: {
          regex: true,
          fixedStrings: true,
          glob: true,
          fileType: true,
          context: true,
          structuredOutput: true,
          liveIndex: true,
        },
      },
      executionHistory: {
        version: 1,
        supported: true,
        schemaVersion: 1,
      },
      verificationExecutionIsolation: {
        version: 1,
        supported: true,
        adapter: true,
        modes: [...VERIFICATION_ISOLATION_MODES],
        protocolProjectRootSeparateFromExecutionCwd: true,
      },
      structuredTrace: {
        version: 1,
        supported: true,
        schemaVersion: 1,
      },
      taskInspection: {
        version: 1,
        supported: true,
        schemaVersion: 1,
      },
      reflection: {
        version: 1,
        supported: true,
        schemaVersion: 1,
      },
      diagnostics: {
        legacyDiagnosis: true,
        structuredDiagnosticCase: true,
        multifactorContributors: true,
        hypothesisDisposition: true,
        interventionLedger: true,
        informationGainV2: true,
        strategyOscillationDetection: true,
      },
      structuralQuality: {
        version: 1,
        supported: true,
        schemaVersion: 1,
        modes: ["off", "observe", "gate"],
        builtInProviders: ["sentrux"],
        commands: ["quality-baseline", "quality-verify", "quality-status"],
        resource: "task/structural-quality",
        providerNeutral: true,
        defaultProvider: "sentrux",
        transport: "mcp-stdio",
        rootCauses: ["modularity", "acyclicity", "depth", "equality", "redundancy"],
        baselineImmutableAfterExecution: true,
        optimizationMaxExtraEvaluations: 2,
      },
      durableActions: {
        version: 1,
        supported: true,
        states: ["PROPOSED", "AUTHORIZED", "STARTED", "COMMITTED", "VERIFIED", "FAILED", "COMMIT_UNKNOWN", "CANCELLED"],
        reconciliation: true,
        exactlyOnce: false,
      },
      capabilityPolicy: { version: 1, supported: true, decisions: ["ALLOW", "DENY", "REQUIRE_AUTHORITY", "REQUIRE_APPROVAL"] },
      durableApprovals: { version: 1, supported: true, fingerprintBound: true, hostAttestationMinting: false },
      trajectoryMetrics: { version: 1, supported: true, usageUnknownWhenUnreported: true, overallScore: false },
      adaptiveExecutionProfiles: {
        version: 1,
        supported: true,
        requests: ["auto", "light", "balanced", "full"],
        resolvedProfiles: ["light", "balanced", "full"],
        deterministic: true,
        lifecycleFastPath: false,
      },
      executionProfileContext: {
        version: 1,
        supported: true,
        resource: "task/context",
        resolvedProfileAuthoritative: true,
        compatibilityFallback: "balanced",
        lifecycleFastPath: false,
      },
      compactLifecycleOutput: {
        version: 1,
        supported: true,
        commands: ["next", "task-show"],
        preservesDefaultOutput: true,
      },
      usageTelemetry: {
        version: 1,
        supported: true,
        sources: ["PROVIDER_REPORTED", "HOST_REPORTED", "ACTOR_REPORTED", "UNKNOWN"],
        estimation: false,
        evidence: false,
      },
      efficiencyMetrics: {
        version: 1,
        supported: true,
        comparativeOnly: true,
        baseline: "OPTIONAL_PROJECT_LOCAL_JSON",
      },
      contextUsageObservability: {
        version: 1,
        supported: true,
        sources: ["HOST_REPORTED", "UNKNOWN"],
        estimation: false,
        inflationStatus: "OBSERVATIONAL",
      },
      trajectoryEvaluation: { version: 1, supported: true, requiresReferenceScenario: true, source: "PROJECT_LOCAL_REFERENCE" },
      workspaceBinding: {
        version: 1,
        supported: true,
        optional: true,
        modes: ["GIT_WORKTREE"],
        statuses: ["UNBOUND", "MATCH", "MISMATCH", "INVALID", "UNAVAILABLE"],
        rebinding: "EXPLICIT_ONLY",
      },
      canonicalHandoffs: {
        version: 2,
        supported: true,
        immutable: true,
        lifecycleAuthority: false,
        evidenceAuthority: false,
        exactlyOnceAcceptance: true,
        acceptanceLedgerBacked: true,
        acceptanceCommand: "handoff-accept",
        acceptanceStatuses: ["OPEN", "ACCEPTED", "UNBOUND", "INCONSISTENT"],
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
        frozenInputs: ["contract", "route", "claims"],
        completionEnforced: true,
      },
      differentialVerificationScope: {
        version: 1,
        supported: true,
        modes: ["AUTO", "CHANGED", "CLAIMED", "FULL"],
        heuristicImpactedMode: false,
        staleBinding: true,
      },
      codeAttestation: {
        version: 1,
        supported: true,
        modes: ["off", "optional", "required"],
        revisionProviders: ["git"],
        signingProviders: ["none", "sigstore"],
        statementType: "https://in-toto.io/Statement/v1",
        completionLedgerBound: true,
        excludesProtocolMetadata: true,
      },
      observabilityStability: {
        executionHistory: "stable",
        structuredTrace: "stable",
        taskInspection: "stable",
        reflection: "stable",
        informationGainV2: "stable",
        strategyOscillationDetection: "stable",
      },
    },
    lifecycle: { phases: WORK_PHASES, transitions: WORK_TRANSITIONS },
    guides: Object.values(GUIDE_REGISTRY),
    commands: Object.values(CLI_COMMAND_DEFINITIONS).map(({ name, category, mutation, description }) => ({ name, category, mutation, description })),
    errors,
  };
}
