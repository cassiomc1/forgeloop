import { CLI_COMMAND_DEFINITIONS } from "./cli-command-definitions.js";
import { COMMAND_EXECUTORS } from "./command-executors.js";
import { PROTOCOL_VERSION } from "./protocol.js";
import { FORGELOOP_INTEGRATION_RUNTIME_VERSION } from "./command-runtime.js";
import { VERIFICATION_ISOLATION_MODES } from "./verification-execution.js";

/**
 * Integration risk classes. They classify the *invocation*, not only the
 * command name: input-dependent commands (doctor --fix, task-unlock --force,
 * policy-discover --write, baseline mutations) are refined by the sparse
 * override table below.
 */
export const INTEGRATION_RISK_CLASSES = Object.freeze({
  READ_ONLY: "READ_ONLY",
  LOOP_MUTATION: "LOOP_MUTATION",
  CLAIM_REACQUISITION: "CLAIM_REACQUISITION",
  EXTERNAL_EXECUTION: "EXTERNAL_EXECUTION",
  AUTHORITY_MUTATION: "AUTHORITY_MUTATION",
  EXTERNAL_STATE_ATTESTATION: "EXTERNAL_STATE_ATTESTATION",
  MAINTENANCE: "MAINTENANCE",
  CLAIM_RELEASE_RECOVERY: "CLAIM_RELEASE_RECOVERY",
  LEGACY_MIGRATION: "LEGACY_MIGRATION",
  FORCE_DESTRUCTIVE: "FORCE_DESTRUCTIVE",
});

const READ_ONLY_COMMANDS = Object.freeze(new Set([
  "protocol-info", "status", "next", "continuity", "reconcile-continuity",
  "task-list", "task-show", "task-lock-status", "progress", "audit", "report",
  "inspect", "validate-state", "validate-protocol", "validate-receipt",
  "policy-status", "policy-diff", "rule-verify", "policy",
  "history", "trace", "reflect",
  "efficiency",
  "workspace-status", "handoff-list", "handoff-show", "responsibility-status",
  "attestation-verify", "attestation-status", "attestation-verify-range",
  "quality-status",
  "index-status", "search",
]));

const LOOP_MUTATION_COMMANDS = Object.freeze(new Set([
  "route", "preflight", "advance", "task-create", "task-scope",
  "record-continuity", "clear-continuity", "prepare-completion",
  "record-check", "record-diagnosis", "record-decision-criterion",
  "record-terminal-result", "complete",
  "record-intervention", "record-hypothesis-disposition",
  "usage-record",
  "workspace-bind", "handoff-create", "handoff-accept", "responsibility-set", "verify-scope", "attestation-create",
]));

const STATIC_RISK_CLASSES = Object.freeze({
  ...Object.fromEntries([...READ_ONLY_COMMANDS].map((name) => [name, INTEGRATION_RISK_CLASSES.READ_ONLY])),
  ...Object.fromEntries([...LOOP_MUTATION_COMMANDS].map((name) => [name, INTEGRATION_RISK_CLASSES.LOOP_MUTATION])),
  "task-resume": INTEGRATION_RISK_CLASSES.CLAIM_REACQUISITION,
  "run-check": INTEGRATION_RISK_CLASSES.EXTERNAL_EXECUTION,
  "quality-baseline": INTEGRATION_RISK_CLASSES.EXTERNAL_EXECUTION,
  "quality-verify": INTEGRATION_RISK_CLASSES.EXTERNAL_EXECUTION,
  "run-action": INTEGRATION_RISK_CLASSES.EXTERNAL_EXECUTION,
  "reconcile-closure": INTEGRATION_RISK_CLASSES.EXTERNAL_EXECUTION,
  "action-propose": INTEGRATION_RISK_CLASSES.LOOP_MUTATION,
  "action-authorize": INTEGRATION_RISK_CLASSES.LOOP_MUTATION,
  "action-record": INTEGRATION_RISK_CLASSES.LOOP_MUTATION,
  "action-verify": INTEGRATION_RISK_CLASSES.LOOP_MUTATION,
  "action-reconcile": INTEGRATION_RISK_CLASSES.LOOP_MUTATION,
  "approval-request": INTEGRATION_RISK_CLASSES.LOOP_MUTATION,
  "approval-resolve": INTEGRATION_RISK_CLASSES.AUTHORITY_MUTATION,
  eval: INTEGRATION_RISK_CLASSES.LOOP_MUTATION,
  "action-show": INTEGRATION_RISK_CLASSES.READ_ONLY,
  metrics: INTEGRATION_RISK_CLASSES.READ_ONLY,
  efficiency: INTEGRATION_RISK_CLASSES.READ_ONLY,
  "usage-record": INTEGRATION_RISK_CLASSES.LOOP_MUTATION,
  init: INTEGRATION_RISK_CLASSES.MAINTENANCE,
  update: INTEGRATION_RISK_CLASSES.MAINTENANCE,
  activate: INTEGRATION_RISK_CLASSES.MAINTENANCE,
  "task-migrate": INTEGRATION_RISK_CLASSES.MAINTENANCE,
  "migrate-protocol": INTEGRATION_RISK_CLASSES.MAINTENANCE,
  "clear-state": INTEGRATION_RISK_CLASSES.MAINTENANCE,
  doctor: INTEGRATION_RISK_CLASSES.MAINTENANCE,
  "index-setup": INTEGRATION_RISK_CLASSES.MAINTENANCE,
  "index-start": INTEGRATION_RISK_CLASSES.MAINTENANCE,
  "index-stop": INTEGRATION_RISK_CLASSES.MAINTENANCE,
  "index-rebuild": INTEGRATION_RISK_CLASSES.MAINTENANCE,
  "policy-discover": INTEGRATION_RISK_CLASSES.MAINTENANCE,
  baseline: INTEGRATION_RISK_CLASSES.MAINTENANCE,
  "task-unlock": INTEGRATION_RISK_CLASSES.MAINTENANCE,
  // bundle writes a bundle artifact set under the task namespace; it is not
  // read-only despite producing no protocol-state mutations.
  bundle: INTEGRATION_RISK_CLASSES.MAINTENANCE,
  "profile-interview": INTEGRATION_RISK_CLASSES.MAINTENANCE,
  "task-recover": INTEGRATION_RISK_CLASSES.CLAIM_RELEASE_RECOVERY,
  "task-repair-legacy-recovery": INTEGRATION_RISK_CLASSES.LEGACY_MIGRATION,
});

// Sparse input-dependent refinements over the static table.
function refineRiskClass(command, input) {
  if (command === "task-unlock" && input?.force === true) {
    return INTEGRATION_RISK_CLASSES.FORCE_DESTRUCTIVE;
  }
  // Settling external commit state is independently gated: recording an
  // UNKNOWN observation stays LOOP_MUTATION, while COMMITTED / NOT_COMMITTED
  // settlements attest external state and require their own capability.
  if (
    command === "action-reconcile"
    && ["COMMITTED", "NOT_COMMITTED"].includes(input?.reconciliationOutcome)
  ) {
    return INTEGRATION_RISK_CLASSES.EXTERNAL_STATE_ATTESTATION;
  }
  // Fail closed: every canonical command must be explicitly classified.
  return baseRiskClass(command);
}

export function baseRiskClass(command) {
  const riskClass = STATIC_RISK_CLASSES[command];
  if (!riskClass) {
    throw new Error(`Command ${command} has no integration risk classification`);
  }
  return riskClass;
}

export function getForgeLoopCapabilities({ packageVersion = null } = {}) {
  const commands = Object.keys(CLI_COMMAND_DEFINITIONS).sort().map((name) => {
    const def = CLI_COMMAND_DEFINITIONS[name];
    return {
      name,
      category: def.category,
      mutation: def.mutation,
      baseRiskClass: baseRiskClass(name),
      mayExecuteExternalProcess: def.mayExecuteExternalProcess === true,
      description: def.description,
    };
  });
  return {
    packageVersion,
    protocolVersion: PROTOCOL_VERSION,
    integrationApiVersion: FORGELOOP_INTEGRATION_RUNTIME_VERSION,
    executorParity: Object.keys(COMMAND_EXECUTORS).length === Object.keys(CLI_COMMAND_DEFINITIONS).length,
    features: {
      taskClaimRecovery: {
        version: 1,
        durableRecoveryState: true,
        explicitResume: true,
        validatedClaimProjection: true,
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
        estimation: false,
        evidence: false,
      },
      efficiencyMetrics: {
        version: 1,
        supported: true,
        comparativeOnly: true,
      },
      contextUsageObservability: {
        version: 1,
        supported: true,
        sources: ["HOST_REPORTED", "UNKNOWN"],
        estimation: false,
        inflationStatus: "OBSERVATIONAL",
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
        completionEnforced: true,
      },
      differentialVerificationScope: {
        version: 1,
        supported: true,
        modes: ["AUTO", "CHANGED", "CLAIMED", "FULL"],
        impactedMode: false,
      },
      structuralQuality: {
        version: 1,
        supported: true,
        schemaVersion: 1,
        providerNeutral: true,
        modes: ["off", "observe", "gate"],
        builtInProviders: ["sentrux"],
        commands: ["quality-baseline", "quality-verify", "quality-status"],
        baselineImmutableAfterExecution: true,
        maxOutputBytes: 2 * 1024 * 1024,
      },
      codeAttestation: {
        version: 1,
        supported: true,
        modes: ["off", "optional", "required"],
        revisionProviders: ["git"],
        signingProviders: ["none", "sigstore"],
        completionLedgerBound: true,
      },
      verificationExecutionIsolation: {
        version: 1,
        supported: true,
        adapter: true,
        modes: [...VERIFICATION_ISOLATION_MODES],
        protocolProjectRootSeparateFromExecutionCwd: true,
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
    },
    commands,
    resources: [
      { name: "protocol/info", scope: "PROJECT" },
      { name: "project/tasks", scope: "PROJECT" },
      { name: "task/status", scope: "TASK" },
      { name: "task/ownership", scope: "TASK" },
      { name: "task/contract", scope: "TASK" },
      { name: "task/continuity", scope: "TASK" },
      { name: "task/workspace-binding", scope: "TASK" },
      { name: "task/handoffs", scope: "TASK" },
      { name: "task/responsibility", scope: "TASK" },
      { name: "task/verification-scope", scope: "TASK" },
      { name: "task/attestation", scope: "TASK" },
      { name: "task/structural-quality", scope: "TASK" },
      { name: "task/actions", scope: "TASK" },
      { name: "task/action", scope: "TASK" },
      { name: "task/approvals", scope: "TASK" },
      { name: "task/metrics", scope: "TASK" },
      { name: "task/context", scope: "TASK" },
      { name: "task/evaluations", scope: "TASK" },
      { name: "project/capability-policy", scope: "PROJECT" },
      { name: "repository/index-status", scope: "PROJECT" },
    ],
  };
}

/**
 * Classify a concrete command invocation (command + structured input).
 * Tool-provided input can never elevate a launch-level capability; this
 * classifier only describes what the invocation would do.
 */
export function classifyForgeLoopInvocation(command, input = {}) {
  const definition = CLI_COMMAND_DEFINITIONS[command];
  if (!definition) {
    throw new Error(`Unknown ForgeLoop command: ${command}`);
  }
  const riskClass = refineRiskClass(command, input);
  const readOnly = riskClass === INTEGRATION_RISK_CLASSES.READ_ONLY;
  const requiredCapability = (() => {
    switch (riskClass) {
      case INTEGRATION_RISK_CLASSES.EXTERNAL_EXECUTION:
        return "allowExternalExecution";
      case INTEGRATION_RISK_CLASSES.AUTHORITY_MUTATION:
        return "allowApprovalResolution";
      case INTEGRATION_RISK_CLASSES.EXTERNAL_STATE_ATTESTATION:
        return "allowActionReconciliationSettlement";
      case INTEGRATION_RISK_CLASSES.MAINTENANCE:
        return "allowMaintenance";
      case INTEGRATION_RISK_CLASSES.CLAIM_RELEASE_RECOVERY:
        return "allowRecovery";
      case INTEGRATION_RISK_CLASSES.LEGACY_MIGRATION:
        return "allowLegacyRepair";
      case INTEGRATION_RISK_CLASSES.FORCE_DESTRUCTIVE:
        return "allowForceRecovery";
      default:
        return null;
    }
  })();
  return Object.freeze({
    command,
    riskClass,
    readOnly,
    mutatesProtocol: !readOnly && [
      INTEGRATION_RISK_CLASSES.LOOP_MUTATION,
      INTEGRATION_RISK_CLASSES.CLAIM_REACQUISITION,
      INTEGRATION_RISK_CLASSES.EXTERNAL_EXECUTION,
      INTEGRATION_RISK_CLASSES.AUTHORITY_MUTATION,
      INTEGRATION_RISK_CLASSES.EXTERNAL_STATE_ATTESTATION,
      INTEGRATION_RISK_CLASSES.MAINTENANCE,
      INTEGRATION_RISK_CLASSES.CLAIM_RELEASE_RECOVERY,
      INTEGRATION_RISK_CLASSES.LEGACY_MIGRATION,
      INTEGRATION_RISK_CLASSES.FORCE_DESTRUCTIVE,
    ].includes(riskClass),
    removesArtifacts: definition.removes.length > 0,
    executesExternalProcess: definition.mayExecuteExternalProcess === true,
    affectsClaimAuthority: [
      "task-resume", "task-recover", "task-repair-legacy-recovery",
      "task-create", "task-scope", "complete",
    ].includes(command),
    destructive: [
      INTEGRATION_RISK_CLASSES.AUTHORITY_MUTATION,
      INTEGRATION_RISK_CLASSES.FORCE_DESTRUCTIVE,
      INTEGRATION_RISK_CLASSES.CLAIM_RELEASE_RECOVERY,
      INTEGRATION_RISK_CLASSES.LEGACY_MIGRATION,
      INTEGRATION_RISK_CLASSES.MAINTENANCE,
    ].includes(riskClass),
    requiredCapability,
  });
}
