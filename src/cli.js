#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { formatStatusResult } from "./commands/status.js";
import { formatValidateStateResult } from "./commands/validate-state.js";
import { formatClearStateResult } from "./commands/clear-state.js";
import { formatInspectResult } from "./commands/inspect.js";
import { formatRouteResult } from "./commands/route.js";
import { formatValidateProtocolResult } from "./commands/validate-protocol.js";
import { formatActivateResult } from "./commands/activate.js";
import { formatAdvanceResult } from "./commands/advance.js";
import { formatPreflightResult } from "./commands/preflight.js";
import { formatQualityBaselineResult } from "./commands/quality-baseline.js";
import { formatQualityVerifyResult } from "./commands/quality-verify.js";
import { formatQualityStatusResult } from "./commands/quality-status.js";
import { formatCompleteResult } from "./commands/complete.js";
import { formatAuditResult } from "./commands/audit.js";
import { formatReportResult } from "./commands/report.js";
import { formatPolicyResult } from "./commands/policy.js";
import { formatPolicyDiscoverResult } from "./commands/policy-discover.js";
import { formatPolicyStatusResult } from "./commands/policy-status.js";
import { formatPolicyDiffResult } from "./commands/policy-diff.js";
import { formatRuleVerifyResult } from "./commands/rule-verify.js";
import { formatBaselineResult } from "./commands/baseline.js";
import { formatProfileInterviewResult } from "./commands/profile-interview.js";
import { formatBundleResult } from "./commands/bundle.js";
import { formatPrepareCompletionResult } from "./commands/prepare-completion.js";
import { formatRecordCheckResult } from "./commands/record-check.js";
import { formatRunCheckResult } from "./commands/run-check.js";
import { formatRunActionResult } from "./commands/run-action.js";
import { formatActionProposeResult } from "./commands/action-propose.js";
import { formatActionRecordResult } from "./commands/action-record.js";
import { formatActionAuthorizeResult } from "./commands/action-authorize.js";
import { formatActionVerifyResult } from "./commands/action-verify.js";
import { formatActionShowResult } from "./commands/action-show.js";
import { formatActionReconcileResult } from "./commands/action-reconcile.js";
import { formatMetricsResult } from "./commands/metrics.js";
import { formatUsageRecordResult } from "./commands/usage-record.js";
import { formatEfficiencyResult } from "./commands/efficiency.js";
import { formatEvalResult } from "./commands/eval.js";
import { formatApprovalRequestResult } from "./commands/approval-request.js";
import { formatApprovalResolveResult } from "./commands/approval-resolve.js";
import { formatReconcileClosureResult } from "./commands/reconcile-closure.js";
import { formatRecordTerminalResult } from "./commands/record-terminal-result.js";
import { formatRecordDiagnosisResult } from "./commands/record-diagnosis.js";
import { formatRecordInterventionResult } from "./commands/record-intervention.js";
import { formatRecordHypothesisDispositionResult } from "./commands/record-hypothesis-disposition.js";
import { formatHistoryResult } from "./commands/history.js";
import { formatTraceResult } from "./commands/trace.js";
import { formatReflectResult } from "./commands/reflect.js";
import { formatProgressResult } from "./commands/progress.js";
import { formatRecordDecisionCriterionResult } from "./commands/record-decision-criterion.js";
import { formatNextActionResult, formatCompactNextActionResult } from "./commands/next.js";
import { formatContinuityResult } from "./commands/continuity.js";
import { formatRecordContinuityResult } from "./commands/record-continuity.js";
import { formatReconcileContinuityResult } from "./commands/reconcile-continuity.js";
import { formatClearContinuityResult } from "./commands/clear-continuity.js";
import { formatTaskCreateResult } from "./commands/task-create.js";
import { formatTaskListResult } from "./commands/task-list.js";
import { formatTaskShowResult, formatCompactTaskShowResult } from "./commands/task-show.js";
import { formatTaskScopeResult } from "./commands/task-scope.js";
import { formatTaskMigrateResult } from "./commands/task-migrate.js";
import { formatMigrateProtocolResult } from "./commands/migrate-protocol.js";
import { formatTaskUnlockResult } from "./commands/task-unlock.js";
import { formatTaskRecoverResult } from "./commands/task-recover.js";
import { formatTaskResumeResult } from "./commands/task-resume.js";
import {
  formatTaskRepairLegacyRecoveryResult,
} from "./commands/task-repair-legacy-recovery.js";
import { formatTaskLockStatusResult } from "./commands/task-lock-status.js";
import { formatProtocolInfoResult } from "./commands/protocol-info.js";
import { formatWorkspaceBindResult } from "./commands/workspace-bind.js";
import { formatWorkspaceStatusResult } from "./commands/workspace-status.js";
import { formatHandoffCreateResult } from "./commands/handoff-create.js";
import { formatHandoffListResult } from "./commands/handoff-list.js";
import { formatHandoffShowResult } from "./commands/handoff-show.js";
import { formatHandoffAcceptResult } from "./commands/handoff-accept.js";
import { formatResponsibilitySetResult } from "./commands/responsibility-set.js";
import { formatResponsibilityStatusResult } from "./commands/responsibility-status.js";
import { formatVerifyScopeResult } from "./commands/verify-scope.js";
import { formatAttestationCreateResult } from "./commands/attestation-create.js";
import { formatAttestationVerifyResult } from "./commands/attestation-verify.js";
import { formatAttestationStatusResult } from "./commands/attestation-status.js";
import { formatAttestationVerifyRangeResult } from "./commands/attestation-verify-range.js";
import {
  formatRepositoryIndexResult,
  formatRepositoryIndexStatus,
  formatSearchResult,
} from "./commands/repository-index.js";
import { defaultCommandInputValues, validateForgeLoopCommandInput } from "./core/command-input.js";
import { COMMAND_EXECUTORS } from "./core/command-executors.js";
import { resolveTarget } from "./core/filesystem.js";
import { getPackageRoot } from "./core/templates.js";
import { CLI_COMMAND_DEFINITIONS, buildOptionLookup, getPositionalDefinitions } from "./core/cli-command-definitions.js";
import { exitCodeForError } from "./core/exit-codes.js";
import { E_CLI_INVOCATION_INVALID } from "./core/error-codes.js";

export const COMMANDS = Object.freeze(Object.keys(CLI_COMMAND_DEFINITIONS));

function formatOptionUsage(optKey, optDef) {
  let label = optKey;
  if (optDef.valueName) {
    label = optKey === "--" ? `-- <${optDef.valueName}>` : `${optKey} <${optDef.valueName}>`;
  }
  return `  ${label.padEnd(20)} ${optDef.description}`;
}

export function usage(command = null) {
  if (command && CLI_COMMAND_DEFINITIONS[command]) {
    const def = CLI_COMMAND_DEFINITIONS[command];
    const lines = Object.entries(def.options).map(([optKey, optDef]) => formatOptionUsage(optKey, optDef));
    return `Usage: forgeloop <${command}> [options]\n\nOptions:\n${lines.join("\n")}\n`;
  }

  const allOptions = new Map();
  for (const def of Object.values(CLI_COMMAND_DEFINITIONS)) {
    for (const [optKey, optDef] of Object.entries(def.options)) {
      if (!allOptions.has(optKey)) {
        allOptions.set(optKey, optDef);
      }
    }
  }

  const lines = [...allOptions.entries()].map(([optKey, optDef]) => formatOptionUsage(optKey, optDef));
  const commands = COMMANDS.join("|");
  return `Usage: forgeloop <${commands}> [options]\n\nOptions:\n${lines.join("\n")}\n`;
}

export function splitLongOption(argument) {
  if (!argument.startsWith("--")) {
    return { name: argument, inlineValue: undefined };
  }
  const index = argument.indexOf("=");
  if (index === -1) {
    return { name: argument, inlineValue: undefined };
  }
  return {
    name: argument.slice(0, index),
    inlineValue: argument.slice(index + 1),
  };
}

function applyOption({ canonicalName, optionDef, inlineValue, argv, index, options, suppliedFlags }) {
  const key = optionDef.targetKey;
  suppliedFlags.add(canonicalName);

  if (inlineValue !== undefined && !optionDef.takesValue) {
    throw new Error(`${canonicalName} does not accept a value`);
  }

  switch (optionDef.parseType) {
    case "boolean": {
      options[key] = true;
      return { index };
    }
    case "string": {
      const value = inlineValue ?? argv[index + 1];
      if (
        value === undefined ||
        (value.length === 0 && !optionDef.allowEmpty) ||
        (value.startsWith("-") && inlineValue === undefined && !optionDef.allowLeadingHyphen)
      ) {
        throw new Error(optionDef.missingValueMessage ?? `${canonicalName} requires a value`);
      }
      if (optionDef.repeatable) {
        if (!Array.isArray(options[key])) options[key] = [];
        options[key].push(value);
      } else {
        options[key] = value;
      }
      return { index: inlineValue === undefined ? index + 1 : index };
    }
    case "non-negative-integer": {
      const value = inlineValue ?? argv[index + 1];
      if (value === undefined || !/^\d+$/.test(value)) {
        throw new Error(optionDef.missingValueMessage ?? `${canonicalName} requires a non-negative integer`);
      }
      options[key] = Number(value);
      return { index: inlineValue === undefined ? index + 1 : index };
    }
    case "json-object": {
      const raw = inlineValue ?? argv[index + 1];
      if (!raw || (raw.startsWith("-") && inlineValue === undefined)) {
        throw new Error(optionDef.missingValueMessage ?? `${canonicalName} requires a JSON object`);
      }
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new Error(`${canonicalName} must be valid JSON`);
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error(`${canonicalName} must be a JSON object`);
      }
      options[key] = parsed;
      return { index: inlineValue === undefined ? index + 1 : index };
    }
    case "argv": {
      const remaining = argv.slice(index + 1);
      options[key] = remaining;
      return { index: argv.length, stop: true };
    }
    default:
      throw new Error(`Unsupported option type: ${optionDef.parseType}`);
  }
}

const ALL_VALUE_TAKING_FLAGS = new Set();
for (const def of Object.values(CLI_COMMAND_DEFINITIONS)) {
  for (const [optName, optDef] of Object.entries(def.options)) {
    if (optDef.takesValue && optName.startsWith("-")) {
      ALL_VALUE_TAKING_FLAGS.add(optName);
    }
  }
}

export function discoverCommand(argv) {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--") break;

    if (arg.startsWith("-")) {
      const eqIdx = arg.indexOf("=");
      const optName = eqIdx === -1 ? arg : arg.slice(0, eqIdx);
      if (eqIdx === -1 && ALL_VALUE_TAKING_FLAGS.has(optName)) {
        i += 1; // Skip the option's value so it is never scanned as a candidate command
      }
      continue;
    }

    if (COMMANDS.includes(arg)) {
      return arg;
    }
  }
  return null;
}

export function parseCliSyntax(argv) {
  const options = defaultCommandInputValues();

  const command = discoverCommand(argv);
  const bootstrapLookup = buildOptionLookup(null);
  const commandLookup = buildOptionLookup(command);
  const positionalDefs = getPositionalDefinitions(command);
  let positionalCursor = 0;
  const suppliedFlags = new Set();
  let commandSeen = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === command && !commandSeen) {
      commandSeen = true;
      continue;
    }

    if (argument === "--") {
      if (!commandSeen) {
        throw new Error("-- is not valid before a command");
      }
      const passthrough = commandLookup.get("--");
      if (!passthrough) {
        throw new Error(`Unknown option: --`);
      }
      options[passthrough.optionDef.targetKey] = argv.slice(index + 1);
      suppliedFlags.add("--");
      break;
    }

    const { name: optName, inlineValue } = splitLongOption(argument);
    const activeLookup = commandSeen ? commandLookup : bootstrapLookup;
    const matched = activeLookup.get(optName);

    if (matched) {
      const res = applyOption({
        canonicalName: matched.canonicalName,
        optionDef: matched.optionDef,
        inlineValue,
        argv,
        index,
        options,
        suppliedFlags,
      });
      index = res.index;
      if (res.stop) break;
      continue;
    }

    if (commandSeen && command && !argument.startsWith("-")) {
      const positional = positionalDefs[positionalCursor];
      if (positional) {
        options[positional.targetKey] = argument;
        positionalCursor += 1;
        continue;
      }
    }

    if (!commandSeen) {
      if (!command) {
        throw new Error(`Unknown option: ${argument}`);
      }
      throw new Error(`Option ${argument} is not valid before a command`);
    }

    if (command) {
      throw new Error(`Option ${argument} is not valid for ${command}`);
    } else {
      throw new Error(`Unknown option: ${argument}`);
    }
  }

  return { command, options };
}

export function validateCliSemantics({ command, options } = {}) {
  validateForgeLoopCommandInput({ command, input: options, help: options?.help ?? false });
}

export function parseArgs(argv) {
  try {
    const parsed = parseCliSyntax(argv);
    validateCliSemantics(parsed);
    return parsed;
  } catch (error) {
    if (!error.code) error.code = E_CLI_INVOCATION_INVALID;
    throw error;
  }
}

async function packageVersion(packageRoot) {
  const packageJson = JSON.parse(
    await readFile(path.join(packageRoot, "package.json"), "utf8"),
  );
  return packageJson.version;
}

function printActions(actions) {
  for (const item of actions) {
    const reason = item.reason ? ` (${item.reason})` : "";
    console.log(`${item.action.replaceAll("-", " ")}: ${item.path}${reason}`);
  }
}

function renderJsonOr(options, result, formatter) {
  console.log(options.json ? JSON.stringify(result, null, 2) : formatter(result));
}

export const COMMAND_HANDLERS = Object.freeze({
  "protocol-info": async ({ packageVersion, options }) => {
    const { result } = await COMMAND_EXECUTORS["protocol-info"]({ packageVersion, options });
    renderJsonOr(options, result, formatProtocolInfoResult);
    return 0;
  },
  init: async ({ target, packageRoot, packageVersion, options }) => {
    const { result } = await COMMAND_EXECUTORS.init({ target, packageRoot, packageVersion, options });
    printActions(result.actions);
    return 0;
  },
  doctor: async ({ target, packageRoot, options }) => {
    const { result } = await COMMAND_EXECUTORS.doctor({ target, packageRoot, options });
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      for (const item of result.findings) {
        console.log(`${item.severity}: ${item.code}: ${item.path} - ${item.message}`);
      }
      console.log(result.ok
        ? "healthy: ForgeLoop target is ready; project profile is available"
        : "unhealthy: ForgeLoop target needs attention");
    }
    return result.ok ? 0 : 1;
  },
  "index-setup": async ({ target, packageRoot, options }) => {
    const { result } = await COMMAND_EXECUTORS["index-setup"]({ target, packageRoot, options });
    renderJsonOr(options, result, formatRepositoryIndexResult);
    return 0;
  },
  "index-start": async ({ target, packageRoot, options }) => {
    const { result } = await COMMAND_EXECUTORS["index-start"]({ target, packageRoot, options });
    renderJsonOr(options, result, formatRepositoryIndexResult);
    return 0;
  },
  "index-stop": async ({ target, packageRoot, options }) => {
    const { result } = await COMMAND_EXECUTORS["index-stop"]({ target, packageRoot, options });
    renderJsonOr(options, result, formatRepositoryIndexResult);
    return 0;
  },
  "index-status": async ({ target, packageRoot, options }) => {
    const { result } = await COMMAND_EXECUTORS["index-status"]({ target, packageRoot, options });
    renderJsonOr(options, result, formatRepositoryIndexStatus);
    return 0;
  },
  "index-rebuild": async ({ target, packageRoot, options }) => {
    const { result } = await COMMAND_EXECUTORS["index-rebuild"]({ target, packageRoot, options });
    renderJsonOr(options, result, formatRepositoryIndexResult);
    return 0;
  },
  search: async ({ target, packageRoot, options }) => {
    const { result, exitCode } = await COMMAND_EXECUTORS.search({ target, packageRoot, options, transport: "cli" });
    renderJsonOr(options, result, formatSearchResult);
    return exitCode;
  },
  route: async ({ target, packageRoot, options }) => {
    const { result } = await COMMAND_EXECUTORS.route({ target, packageRoot, options });
    renderJsonOr(options, result, formatRouteResult);
    return 0;
  },
  activate: async ({ target, packageRoot, options }) => {
    const { result } = await COMMAND_EXECUTORS.activate({ target, packageRoot, options });
    renderJsonOr(options, result, formatActivateResult);
    return 0;
  },
  preflight: async ({ target, packageRoot, options }) => {
    const { result, exitCode } = await COMMAND_EXECUTORS.preflight({ target, packageRoot, options });
    renderJsonOr(options, result, formatPreflightResult);
    return exitCode;
  },
  "quality-baseline": async ({ target, packageRoot, options }) => {
    const { result, exitCode } = await COMMAND_EXECUTORS["quality-baseline"]({ target, packageRoot, options });
    renderJsonOr(options, result, formatQualityBaselineResult);
    return exitCode;
  },
  "quality-verify": async ({ target, packageRoot, options }) => {
    const { result, exitCode } = await COMMAND_EXECUTORS["quality-verify"]({ target, packageRoot, options });
    renderJsonOr(options, result, formatQualityVerifyResult);
    return exitCode;
  },
  "quality-status": async ({ target, packageRoot, options }) => {
    const { result, exitCode } = await COMMAND_EXECUTORS["quality-status"]({ target, packageRoot, options });
    renderJsonOr(options, result, formatQualityStatusResult);
    return exitCode;
  },
  advance: async ({ target, packageRoot, options }) => {
    const { result } = await COMMAND_EXECUTORS.advance({ target, packageRoot, options });
    renderJsonOr(options, result, formatAdvanceResult);
    return 0;
  },
  next: async ({ target, packageRoot, options }) => {
    const { result } = await COMMAND_EXECUTORS.next({ target, packageRoot, options });
    if (options.compact) console.log(formatCompactNextActionResult(result));
    else renderJsonOr(options, result, formatNextActionResult);
    return 0;
  },
  continuity: async ({ target, packageRoot, options }) => {
    const { result } = await COMMAND_EXECUTORS.continuity({ target, packageRoot, options });
    renderJsonOr(options, result, formatContinuityResult);
    return 0;
  },
  "record-continuity": async ({ target, packageRoot, options }) => {
    const { result } = await COMMAND_EXECUTORS["record-continuity"]({ target, packageRoot, options });
    renderJsonOr(options, result, formatRecordContinuityResult);
    return 0;
  },
  "reconcile-continuity": async ({ target, packageRoot, options }) => {
    const { result } = await COMMAND_EXECUTORS["reconcile-continuity"]({ target, packageRoot, options });
    renderJsonOr(options, result, formatReconcileContinuityResult);
    return 0;
  },
  "clear-continuity": async ({ target, options }) => {
    const { result } = await COMMAND_EXECUTORS["clear-continuity"]({ target, options });
    renderJsonOr(options, result, formatClearContinuityResult);
    return 0;
  },
  "prepare-completion": async ({ target, packageRoot, options }) => {
    const { result } = await COMMAND_EXECUTORS["prepare-completion"]({ target, packageRoot, options });
    renderJsonOr(options, result, formatPrepareCompletionResult);
    return 0;
  },
  "run-check": async ({ target, packageRoot, options }) => {
    const { result, exitCode } = await COMMAND_EXECUTORS["run-check"]({ target, packageRoot, options });
    renderJsonOr(options, result, formatRunCheckResult);
    return exitCode;
  },
  "workspace-bind": async ({ target, packageRoot, options }) => {
    const { result, exitCode } = await COMMAND_EXECUTORS["workspace-bind"]({ target, packageRoot, options });
    renderJsonOr(options, result, formatWorkspaceBindResult);
    return exitCode;
  },
  "workspace-status": async ({ target, packageRoot, options }) => {
    const { result, exitCode } = await COMMAND_EXECUTORS["workspace-status"]({ target, packageRoot, options });
    renderJsonOr(options, result, formatWorkspaceStatusResult);
    return exitCode;
  },
  "handoff-create": async ({ target, packageRoot, options }) => {
    const { result, exitCode } = await COMMAND_EXECUTORS["handoff-create"]({ target, packageRoot, options });
    renderJsonOr(options, result, formatHandoffCreateResult);
    return exitCode;
  },
  "handoff-list": async ({ target, packageRoot, options }) => {
    const { result, exitCode } = await COMMAND_EXECUTORS["handoff-list"]({ target, packageRoot, options });
    renderJsonOr(options, result, formatHandoffListResult);
    return exitCode;
  },
  "handoff-show": async ({ target, packageRoot, options }) => {
    const { result, exitCode } = await COMMAND_EXECUTORS["handoff-show"]({ target, packageRoot, options });
    renderJsonOr(options, result, formatHandoffShowResult);
    return exitCode;
  },
  "handoff-accept": async ({ target, packageRoot, options }) => {
    const { result, exitCode } = await COMMAND_EXECUTORS["handoff-accept"]({ target, packageRoot, options });
    renderJsonOr(options, result, formatHandoffAcceptResult);
    return exitCode;
  },
  "responsibility-set": async ({ target, packageRoot, options }) => {
    const { result, exitCode } = await COMMAND_EXECUTORS["responsibility-set"]({ target, packageRoot, options });
    renderJsonOr(options, result, formatResponsibilitySetResult);
    return exitCode;
  },
  "responsibility-status": async ({ target, packageRoot, options }) => {
    const { result, exitCode } = await COMMAND_EXECUTORS["responsibility-status"]({ target, packageRoot, options });
    renderJsonOr(options, result, formatResponsibilityStatusResult);
    return exitCode;
  },
  "verify-scope": async ({ target, packageRoot, options }) => {
    const { result, exitCode } = await COMMAND_EXECUTORS["verify-scope"]({ target, packageRoot, options });
    renderJsonOr(options, result, formatVerifyScopeResult);
    return exitCode;
  },
  "attestation-create": async ({ target, packageRoot, options }) => {
    const { result, exitCode } = await COMMAND_EXECUTORS["attestation-create"]({ target, packageRoot, options });
    renderJsonOr(options, result, formatAttestationCreateResult);
    return exitCode;
  },
  "attestation-verify": async ({ target, packageRoot, options }) => {
    const { result, exitCode } = await COMMAND_EXECUTORS["attestation-verify"]({ target, packageRoot, options });
    renderJsonOr(options, result, formatAttestationVerifyResult);
    return exitCode;
  },
  "attestation-status": async ({ target, packageRoot, options }) => {
    const { result, exitCode } = await COMMAND_EXECUTORS["attestation-status"]({ target, packageRoot, options });
    renderJsonOr(options, result, formatAttestationStatusResult);
    return exitCode;
  },
  "attestation-verify-range": async ({ target, packageRoot, options }) => {
    const { result, exitCode } = await COMMAND_EXECUTORS["attestation-verify-range"]({ target, packageRoot, options });
    renderJsonOr(options, result, formatAttestationVerifyRangeResult);
    return exitCode;
  },
  "run-action": async ({ target, packageRoot, options }) => {
    const { result, exitCode } = await COMMAND_EXECUTORS["run-action"]({ target, packageRoot, options });
    renderJsonOr(options, result, formatRunActionResult);
    return exitCode;
  },
  "action-propose": async ({ target, packageRoot, options }) => {
    const { result } = await COMMAND_EXECUTORS["action-propose"]({ target, packageRoot, options });
    renderJsonOr(options, result, formatActionProposeResult); return 0;
  },
  "action-authorize": async ({ target, packageRoot, options }) => {
    const { result } = await COMMAND_EXECUTORS["action-authorize"]({ target, packageRoot, options });
    renderJsonOr(options, result, formatActionAuthorizeResult); return 0;
  },
  "action-record": async ({ target, packageRoot, options }) => {
    const { result } = await COMMAND_EXECUTORS["action-record"]({ target, packageRoot, options });
    renderJsonOr(options, result, formatActionRecordResult); return 0;
  },
  "action-verify": async ({ target, packageRoot, options }) => {
    const { result } = await COMMAND_EXECUTORS["action-verify"]({ target, packageRoot, options });
    renderJsonOr(options, result, formatActionVerifyResult); return 0;
  },
  "action-show": async ({ target, packageRoot, options }) => {
    const { result } = await COMMAND_EXECUTORS["action-show"]({ target, packageRoot, options });
    renderJsonOr(options, result, formatActionShowResult); return 0;
  },
  "action-reconcile": async ({ target, packageRoot, options }) => {
    const { result } = await COMMAND_EXECUTORS["action-reconcile"]({ target, packageRoot, options });
    renderJsonOr(options, result, formatActionReconcileResult); return 0;
  },
  metrics: async ({ target, packageRoot, options }) => {
    const { result } = await COMMAND_EXECUTORS.metrics({ target, packageRoot, options });
    renderJsonOr(options, result, formatMetricsResult); return 0;
  },
  "usage-record": async ({ target, packageRoot, options }) => {
    const { result } = await COMMAND_EXECUTORS["usage-record"]({ target, packageRoot, options });
    renderJsonOr(options, result, formatUsageRecordResult); return 0;
  },
  efficiency: async ({ target, packageRoot, options }) => {
    const { result } = await COMMAND_EXECUTORS.efficiency({ target, packageRoot, options });
    renderJsonOr(options, result, formatEfficiencyResult); return 0;
  },
  eval: async ({ target, packageRoot, options }) => {
    const { result, exitCode } = await COMMAND_EXECUTORS.eval({ target, packageRoot, options });
    renderJsonOr(options, result, formatEvalResult); return exitCode;
  },
  "approval-request": async ({ target, packageRoot, options }) => { const { result } = await COMMAND_EXECUTORS["approval-request"]({ target, packageRoot, options }); renderJsonOr(options, result, formatApprovalRequestResult); return 0; },
  "approval-resolve": async ({ target, packageRoot, options }) => { const { result } = await COMMAND_EXECUTORS["approval-resolve"]({ target, packageRoot, options }); renderJsonOr(options, result, formatApprovalResolveResult); return 0; },
  "record-check": async ({ target, packageRoot, options }) => {
    const { result } = await COMMAND_EXECUTORS["record-check"]({ target, packageRoot, options });
    renderJsonOr(options, result, formatRecordCheckResult);
    return 0;
  },
  "record-terminal-result": async ({ target, packageRoot, options }) => {
    const { result } = await COMMAND_EXECUTORS["record-terminal-result"]({ target, packageRoot, options });
    renderJsonOr(options, result, formatRecordTerminalResult);
    return 0;
  },
  "record-diagnosis": async ({ target, packageRoot, options }) => {
    const { result } = await COMMAND_EXECUTORS["record-diagnosis"]({ target, packageRoot, options });
    renderJsonOr(options, result, formatRecordDiagnosisResult);
    return 0;
  },
  "record-intervention": async ({ target, packageRoot, options }) => {
    const { result } = await COMMAND_EXECUTORS["record-intervention"]({ target, packageRoot, options });
    renderJsonOr(options, result, formatRecordInterventionResult);
    return 0;
  },
  "record-hypothesis-disposition": async ({ target, packageRoot, options }) => {
    const { result } = await COMMAND_EXECUTORS["record-hypothesis-disposition"]({ target, packageRoot, options });
    renderJsonOr(options, result, formatRecordHypothesisDispositionResult);
    return 0;
  },
  history: async ({ target, packageRoot, options }) => {
    const { result, exitCode } = await COMMAND_EXECUTORS.history({ target, packageRoot, options });
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else if (options.compact) {
      for (const event of result.events) {
        console.log(`${event.timestamp ?? "--:--:--"} ${event.type}`);
      }
    } else if (options.verbose) {
      console.log(formatHistoryResult(result));
      for (const event of result.events) {
        console.log(`--- ${event.sequence} ${event.type} ---`);
        console.log(JSON.stringify(event.data, null, 2));
      }
    } else {
      console.log(formatHistoryResult(result));
    }
    return exitCode;
  },
  trace: async ({ target, packageRoot, options }) => {
    const { result, exitCode } = await COMMAND_EXECUTORS.trace({ target, packageRoot, options });
    renderJsonOr(options, result, formatTraceResult);
    return exitCode;
  },
  reflect: async ({ target, packageRoot, options }) => {
    const { result, exitCode } = await COMMAND_EXECUTORS.reflect({ target, packageRoot, options });
    renderJsonOr(options, result, formatReflectResult);
    return exitCode;
  },
  progress: async ({ target, packageRoot, options }) => {
    const { result, exitCode } = await COMMAND_EXECUTORS.progress({ target, packageRoot, options });
    renderJsonOr(options, result, formatProgressResult);
    return exitCode;
  },
  "record-decision-criterion": async ({ target, packageRoot, options }) => {
    const { result } = await COMMAND_EXECUTORS["record-decision-criterion"]({ target, packageRoot, options });
    renderJsonOr(options, result, formatRecordDecisionCriterionResult);
    return 0;
  },
  complete: async ({ target, packageRoot, options }) => {
    const { result, exitCode } = await COMMAND_EXECUTORS.complete({ target, packageRoot, options });
    renderJsonOr(options, result, formatCompleteResult);
    return exitCode;
  },
  audit: async ({ target, packageRoot, options }) => {
    const { result, exitCode } = await COMMAND_EXECUTORS.audit({ target, packageRoot, options });
    renderJsonOr(options, result, formatAuditResult);
    return exitCode;
  },
  report: async ({ target, packageRoot, options }) => {
    const { result, exitCode } = await COMMAND_EXECUTORS.report({ target, packageRoot, options });
    renderJsonOr(options, result, formatReportResult);
    return exitCode;
  },
  policy: async ({ target, packageRoot, options }) => {
    const { result } = await COMMAND_EXECUTORS.policy({ target, packageRoot, options });
    renderJsonOr(options, result, formatPolicyResult);
    return 0;
  },
  "policy-discover": async ({ target, packageRoot, options }) => {
    const { result } = await COMMAND_EXECUTORS["policy-discover"]({ target, packageRoot, options });
    renderJsonOr(options, result, formatPolicyDiscoverResult);
    return 0;
  },
  "policy-status": async ({ target, packageRoot, options }) => {
    const { result, exitCode } = await COMMAND_EXECUTORS["policy-status"]({ target, packageRoot, options });
    renderJsonOr(options, result, formatPolicyStatusResult);
    return exitCode;
  },
  "policy-diff": async ({ target, packageRoot, options }) => {
    const { result } = await COMMAND_EXECUTORS["policy-diff"]({ target, packageRoot, options });
    renderJsonOr(options, result, formatPolicyDiffResult);
    return 0;
  },
  "rule-verify": async ({ target, packageRoot, options }) => {
    const { result, exitCode } = await COMMAND_EXECUTORS["rule-verify"]({ target, packageRoot, options });
    renderJsonOr(options, result, formatRuleVerifyResult);
    return exitCode;
  },
  baseline: async ({ target, packageRoot, options }) => {
    const { result } = await COMMAND_EXECUTORS.baseline({ target, packageRoot, options });
    renderJsonOr(options, result, formatBaselineResult);
    return 0;
  },
  "profile-interview": async ({ target, packageRoot, options }) => {
    const { result } = await COMMAND_EXECUTORS["profile-interview"]({ target, packageRoot, options });
    renderJsonOr(options, result, formatProfileInterviewResult);
    return 0;
  },
  bundle: async ({ target, packageRoot, options }) => {
    const { result } = await COMMAND_EXECUTORS.bundle({ target, packageRoot, options });
    renderJsonOr(options, result, formatBundleResult);
    return 0;
  },
  inspect: async ({ target, packageRoot, options }) => {
    const { result, exitCode } = await COMMAND_EXECUTORS.inspect({ target, packageRoot, options });
    renderJsonOr(options, result, formatInspectResult);
    return exitCode;
  },
  "validate-receipt": async ({ target, packageRoot, options }) => {
    const { result } = await COMMAND_EXECUTORS["validate-receipt"]({ target, packageRoot, options });
    console.log(options.json ? JSON.stringify(result, null, 2) : "valid: execution receipt");
    return 0;
  },
  "validate-protocol": async ({ target, packageRoot, options }) => {
    const { result, exitCode } = await COMMAND_EXECUTORS["validate-protocol"]({ target, packageRoot, options });
    renderJsonOr(options, result, formatValidateProtocolResult);
    return exitCode;
  },
  status: async ({ target, packageRoot, options }) => {
    const { result } = await COMMAND_EXECUTORS.status({ target, packageRoot, options });
    renderJsonOr(options, result, formatStatusResult);
    return 0;
  },
  "validate-state": async ({ target, packageRoot, options }) => {
    const { result, exitCode } = await COMMAND_EXECUTORS["validate-state"]({ target, packageRoot, options });
    renderJsonOr(options, result, formatValidateStateResult);
    return exitCode;
  },
  "clear-state": async ({ target, options }) => {
    const { result } = await COMMAND_EXECUTORS["clear-state"]({ target, options });
    renderJsonOr(options, result, formatClearStateResult);
    return 0;
  },
  "task-create": async ({ target, packageRoot, options }) => {
    const { result } = await COMMAND_EXECUTORS["task-create"]({ target, packageRoot, options });
    renderJsonOr(options, result, formatTaskCreateResult);
    return 0;
  },
  "task-list": async ({ target, packageRoot, options }) => {
    const { result } = await COMMAND_EXECUTORS["task-list"]({ target, packageRoot, options });
    renderJsonOr(options, result, formatTaskListResult);
    return 0;
  },
  "task-show": async ({ target, packageRoot, options }) => {
    const { result } = await COMMAND_EXECUTORS["task-show"]({ target, packageRoot, options });
    if (options.compact) console.log(formatCompactTaskShowResult(result));
    else renderJsonOr(options, result, formatTaskShowResult);
    return 0;
  },
  "task-lock-status": async ({ target, packageRoot, options }) => {
    const { result } = await COMMAND_EXECUTORS["task-lock-status"]({ target, packageRoot, options });
    renderJsonOr(options, result, formatTaskLockStatusResult);
    return 0;
  },
  "task-scope": async ({ target, packageRoot, options }) => {
    const { result } = await COMMAND_EXECUTORS["task-scope"]({ target, packageRoot, options });
    renderJsonOr(options, result, formatTaskScopeResult);
    return 0;
  },
  "task-migrate": async ({ target, packageRoot, options }) => {
    const { result } = await COMMAND_EXECUTORS["task-migrate"]({ target, packageRoot, options });
    renderJsonOr(options, result, formatTaskMigrateResult);
    return 0;
  },
  "migrate-protocol": async ({ target, packageRoot, options }) => {
    const { result } = await COMMAND_EXECUTORS["migrate-protocol"]({ target, packageRoot, options });
    renderJsonOr(options, result, formatMigrateProtocolResult);
    return 0;
  },
  "task-unlock": async ({ target, packageRoot, options }) => {
    const { result } = await COMMAND_EXECUTORS["task-unlock"]({ target, packageRoot, options });
    renderJsonOr(options, result, formatTaskUnlockResult);
    return 0;
  },
  "task-recover": async ({ target, packageRoot, options }) => {
    if (options.operatorAuthorized && !options.acknowledgeRecovery) {
      console.error("DEPRECATION: --operator-authorized is caller acknowledgement, not host attestation; use --acknowledge-recovery.");
    }
    const { result } = await COMMAND_EXECUTORS["task-recover"]({ target, packageRoot, options });
    renderJsonOr(options, result, formatTaskRecoverResult);
    return 0;
  },
  "task-resume": async ({ target, packageRoot, options }) => {
    const { result } = await COMMAND_EXECUTORS["task-resume"]({ target, packageRoot, options });
    renderJsonOr(options, result, formatTaskResumeResult);
    return 0;
  },
  "task-repair-legacy-recovery": async ({ target, packageRoot, options }) => {
    const { result } = await COMMAND_EXECUTORS["task-repair-legacy-recovery"]({ target, packageRoot, options });
    renderJsonOr(options, result, formatTaskRepairLegacyRecoveryResult);
    return 0;
  },
  "reconcile-closure": async ({ target, packageRoot, options }) => {
    const { result } = await COMMAND_EXECUTORS["reconcile-closure"]({ target, packageRoot, options });
    renderJsonOr(options, result, formatReconcileClosureResult);
    return 0;
  },
  update: async ({ target, packageRoot, packageVersion, options }) => {
    const { result, exitCode } = await COMMAND_EXECUTORS.update({ target, packageRoot, packageVersion, options });
    printActions(result.actions);
    for (const conflict of result.conflicts) {
      const code = conflict.code ? `${conflict.code}: ` : "";
      console.log(`conflict: ${code}${conflict.path} - ${conflict.message}`);
    }
    return exitCode;
  },
});

export const COMMAND_TABLE = Object.freeze(
  COMMANDS.map((name) => Object.freeze({
    name,
    handler: COMMAND_HANDLERS[name],
    usage: usage(name),
  })),
);

export async function main(argv = process.argv.slice(2)) {
  const jsonRequested = argv.some((argument) => argument === "--json" || argument.startsWith("--json="));
  const jsonErrorsAllowed = jsonRequested;
  try {
    if (argv[0] === "help") {
      const helpCommand = argv[1] ?? null;
      if (helpCommand && !CLI_COMMAND_DEFINITIONS[helpCommand]) {
        throw new Error(`Unknown command for help: ${helpCommand}`);
      }
      console.log(usage(helpCommand));
      return helpCommand ? 0 : 1;
    }
    const { command, options } = parseArgs(argv);
    if (options.version) {
      console.log(await packageVersion(getPackageRoot()));
      return 0;
    }
    if (!command || options.help) {
      console.log(usage(command));
      return options.help ? 0 : 1;
    }

    const target = await resolveTarget(process.cwd(), options.path);
    const packageRoot = getPackageRoot();
    const version = await packageVersion(packageRoot);

    const handler = COMMAND_HANDLERS[command];
    if (typeof handler !== "function") {
      throw new Error(`Unsupported command: ${command}`);
    }
    return await handler({
      target,
      packageRoot,
      packageVersion: version,
      options,
    });
  } catch (error) {
    if (jsonErrorsAllowed) {
      const payload = JSON.stringify({
        status: "ERROR",
        ok: false,
        error: {
          code: error.code ?? "E_CLI_INVOCATION_INVALID",
          message: error.message,
          ...(error.next ? { next: error.next } : {}),
          ...(error.artifacts ? { artifacts: error.artifacts } : {}),
        },
      }, null, 2);
      // Keep stderr as the diagnostic channel while also emitting the same
      // structured envelope on stdout for machine consumers.
      console.log(payload);
      console.error(payload);
    } else {
      console.error(`error: ${error.code ? `${error.code}: ` : ""}${error.message}`);
    }
    return exitCodeForError(error);
  }
}

function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMainModule()) {
  const exitCode = await main();
  process.exitCode = exitCode;
}
