import { continuityOptionDefaults, validateContinuityOptions } from "./continuity-cli-options.js";
import { E_CLI_INVOCATION_INVALID } from "./error-codes.js";
import { EXECUTION_PROFILE_REQUESTS } from "./execution-profile.js";

function inputError(message) {
  const error = new Error(message);
  error.code = E_CLI_INVOCATION_INVALID;
  return error;
}

function validateSearchCommandInput(command, options, help) {
  if (command === "search" && !help && (typeof options.pattern !== "string" || options.pattern.length === 0)) {
    throw inputError("search requires a pattern");
  }
}

function validatePolicyInput(command, options) {
  if (command === "policy" && !options.policy) throw inputError("policy requires a name");
  if (command !== "policy" && options.policy) throw inputError(`Policy name is not valid for ${command}`);
}

function validateTaskCreationInput(command, options) {
  if (command === "bundle" && !options.taskId) throw inputError("bundle requires --task");
  if (command === "task-create" && !options.taskId) throw inputError("task-create requires --task");
  if (command !== "task-create" && (options.preset || options.preview)) {
    throw inputError(`preset/preview options are not valid for ${command}`);
  }
  if (command === "task-create" && options.preview && !options.preset && !options.contractFile) {
    throw inputError("task-create --preview requires --preset or --contract-file");
  }
  if (command === "task-create" && options.preset && options.contractFile) {
    throw inputError("task-create accepts either --preset or --contract-file, not both");
  }
  const hasTaskListFilter = Boolean(
    options.phase
      || options.active
      || (options.limit !== undefined && options.limit !== null)
      || (options.offset !== undefined && options.offset !== null && options.offset !== 0),
  );
  if (command !== "task-list" && hasTaskListFilter) {
    throw inputError(`task-list filters are not valid for ${command}`);
  }
}

function validateProfileAndUsageInput(command, options, help) {
  if (options.executionProfile !== null && options.executionProfile !== undefined) {
    if (command !== "route") throw inputError(`executionProfile is not valid for ${command}`);
    if (!EXECUTION_PROFILE_REQUESTS.includes(options.executionProfile)) {
      throw inputError(`route --execution-profile must be one of ${EXECUTION_PROFILE_REQUESTS.join(", ")}`);
    }
  }
  if (command === "usage-record" && !help) {
    if (!options.taskId) throw inputError("usage-record requires --task");
    if ((options.usageSource ?? "ACTOR_REPORTED") !== "ACTOR_REPORTED") {
      throw inputError("usage-record accepts only --source ACTOR_REPORTED");
    }
  }
  if (command === "efficiency" && !help && !options.taskId) throw inputError("efficiency requires --task");
  if (["quality-baseline", "quality-verify", "quality-status"].includes(command) && !help && !options.taskId) {
    throw inputError(`${command} requires --task`);
  }
  if (["quality-baseline", "quality-verify"].includes(command) && !help
    && options.timeoutMs !== null && options.timeoutMs !== undefined
    && (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 0 || options.timeoutMs > 300000)) {
    throw inputError(`${command} --timeout-ms must be between 0 and 300000`);
  }
  if (command !== "quality-baseline" && options.replace === true) throw inputError("--replace is only valid for quality-baseline");
  if (command !== "usage-record" && options.usageSource !== undefined && options.usageSource !== "ACTOR_REPORTED") {
    throw inputError(`usageSource is not valid for ${command}`);
  }
}

function validateOutputInput(command, options) {
  if (options.compact === true && !["next", "task-show"].includes(command)) {
    throw inputError(`compact output is not valid for ${command}`);
  }
  if (command !== "next" && options.explain === true) throw inputError(`explain output is not valid for ${command}`);
}

function validateTaskSelectorsInput(command, options, help) {
  const taskCommands = ["workspace-bind", "workspace-status", "handoff-create", "handoff-list", "handoff-show", "handoff-accept", "responsibility-set", "responsibility-status", "verify-scope", "attestation-create", "attestation-status", "attestation-verify"];
  if (taskCommands.includes(command) && !options.taskId) throw inputError(`${command} requires --task`);
  if (command === "handoff-show" && !help && !options.handoffId) throw inputError("handoff-show requires --id");
  if (command === "handoff-accept" && !help) {
    if (!options.handoffId) throw inputError("handoff-accept requires --handoff");
    if (!options.consumerId) throw inputError("handoff-accept requires --consumer-id");
  }
  if (command === "responsibility-set" && !help && !options.responsibilityLabel) {
    throw inputError("responsibility-set requires --label");
  }
  if (command === "verify-scope" && !help) {
    const mode = String(options.verificationScopeMode ?? "AUTO").toUpperCase();
    if (!["AUTO", "CHANGED", "CLAIMED", "FULL"].includes(mode)) throw inputError("verify-scope --mode must be AUTO, CHANGED, CLAIMED, or FULL");
  }
  if (command === "attestation-verify-range" && !help) {
    if (!options.baseRevision) throw inputError("attestation-verify-range requires --base");
    if (!options.headRevision) throw inputError("attestation-verify-range requires --head");
  }
}

function validateCheckInput(command, options, help) {
  if (command === "record-check" && !help) {
    if (!options.checkId) throw inputError("record-check requires --id");
    if (!options.checkRequirement) throw inputError("record-check requires --requirement");
    if (!options.checkStatus) throw inputError("record-check requires --status");
    if (!options.checkEvidenceKind) throw inputError("record-check requires --evidence-kind");
    if (!options.checkCommand && !options.checkResult) throw inputError("record-check requires --command or --result");
  }
  if (command === "run-check" && !help) {
    if (!options.checkId) throw inputError("run-check requires --id");
    if (!options.checkRequirement) throw inputError("run-check requires --requirement");
    if (options.checkKind || options.checkStatus || options.checkEvidenceKind || options.checkCommand
      || options.checkResult || options.checkExitCode !== null || options.checkExecutionRef || options.checkProvenance) {
      throw inputError("run-check accepts only --id, --requirement, --details, --timeout-ms, --scope-ref, and -- <argv>");
    }
    if (!Array.isArray(options.commandArgv) || options.commandArgv.length === 0) throw inputError("run-check requires -- followed by an exact command argv");
  }
  if (command === "reconcile-closure" && !help) {
    if (!options.taskId) throw inputError("reconcile-closure requires --task");
    if (!options.checkId) throw inputError("reconcile-closure requires --id");
    if (!options.checkRequirement) throw inputError("reconcile-closure requires --requirement");
    if (options.checkKind || options.checkStatus || options.checkEvidenceKind || options.checkCommand
      || options.checkResult || options.checkExitCode !== null || options.checkExecutionRef || options.checkProvenance) {
      throw inputError("reconcile-closure accepts only --id, --requirement, --details, and -- <argv>");
    }
    if (!Array.isArray(options.commandArgv) || options.commandArgv.length === 0) throw inputError("reconcile-closure requires -- followed by an exact command argv");
  }
}

/**
 * Transport-neutral option defaults shared by the CLI parser and the
 * programmatic command runtime so every executor observes the same
 * normalized input shape regardless of transport.
 */
export function defaultCommandInputValues() {
  return {
    path: ".",
    dryRun: false,
    json: false,
    compact: false,
    explain: false,
    strict: false,
    fix: false,
    adopt: [],
    pattern: null,
    globs: [],
    types: [],
    fixedStrings: false,
    ignoreCase: false,
    smartCase: false,
    wordRegexp: false,
    context: null,
    beforeContext: null,
    afterContext: null,
    maxCount: null,
    filesWithMatches: false,
    stats: false,
    assetPath: null,
    binaryPath: null,
    force: false,
    workType: null,
    surfaces: [],
    risks: [],
    platforms: [],
    behaviorChange: false,
    executableChange: false,
    executionProfile: null,
    usageProvider: null,
    usageModel: null,
    usageInputTokens: null,
    usageOutputTokens: null,
    usageCacheReadTokens: null,
    usageCacheWriteTokens: null,
    usageTotalTokens: null,
    usageCostUsd: null,
    usageSource: "ACTOR_REPORTED",
    baselinePath: null,
    to: null,
    file: null,
    contractFile: null,
    preset: null,
    preview: false,
    phase: null,
    active: false,
    limit: null,
    offset: 0,
    routeFile: null,
    stateFile: null,
    receiptFile: null,
    continuityFile: null,
    taskBriefFiles: [],
    delegatedResultFiles: [],
    checkId: null,
    checkKind: null,
    checkRequirement: null,
    checkStatus: null,
    checkEvidenceKind: null,
    checkCommand: null,
    checkResult: null,
    checkExitCode: null,
    checkDetails: null,
    checkExecutionRef: null,
    checkProvenance: null,
    timeoutMs: null,
    replace: false,
    scopeRef: null,
    commandArgv: [],
    checkType: null,
    checkSource: null,
    policy: null,
    taskId: null,
    recipientHint: null,
    handoffNote: null,
    handoffId: null,
    consumerId: null,
    harness: null,
    responsibilityLabel: null,
    responsibilityAllowedPaths: [],
    responsibilityReadOnlyPaths: [],
    responsibilityRequiredChecks: [],
    responsibilityFreezeContract: false,
    responsibilityFreezeRoute: false,
    responsibilityFreezeClaims: false,
    verificationScopeMode: null,
    revisionProvider: null,
    signingProvider: null,
    trustedRoot: null,
    baseRevision: null,
    headRevision: null,
    requireCompleteCoverage: false,
    requireSignature: false,
    attestationRef: null,
    attestationBundle: null,
    attestationIdentity: null,
    attestationIssuer: null,
    help: false,
    version: false,
    ...continuityOptionDefaults(),
  };
}

/**
 * Canonical semantic validation shared by the CLI argv parser and
 * programmatic integrations. JSON-Schema style checks cannot express these
 * cross-field rules, so every transport must run this after its own parsing.
 */
export function validateForgeLoopCommandInput({ command, input, help = false } = {}) {
  const options = input ?? {};
  if (!command) return;

  validatePolicyInput(command, options);
  validateTaskCreationInput(command, options);
  validateSearchCommandInput(command, options, help);
  validateProfileAndUsageInput(command, options, help);
  validateOutputInput(command, options);
  validateTaskSelectorsInput(command, options, help);

  validateContinuityOptions(command, options);

  validateCheckInput(command, options, help);
}
