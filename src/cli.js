#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
  discover: async ({ target, packageRoot, options }) => {
    const { result } = await COMMAND_EXECUTORS.discover({ target, packageRoot, options });
    renderJsonOr(options, result, (await import("./commands/discover.js")).formatDiscoverResult);
    return 0;
  },
  "contract-create": async ({ target, packageRoot, options }) => {
    const { result } = await COMMAND_EXECUTORS["contract-create"]({ target, packageRoot, options });
    renderJsonOr(options, result, (await import("./commands/contract-create.js")).formatContractCreateResult);
    return 0;
  },
  "contract-revise": async ({ target, packageRoot, options }) => {
    const { result } = await COMMAND_EXECUTORS["contract-revise"]({ target, packageRoot, options });
    renderJsonOr(options, result, (await import("./commands/contract-revise.js")).formatContractReviseResult);
    return 0;
  },
  "gate-record": async ({ target, packageRoot, options }) => {
    const { result } = await COMMAND_EXECUTORS["gate-record"]({ target, packageRoot, options });
    renderJsonOr(options, result, (await import("./commands/gate-record.js")).formatGateRecordResult);
    return 0;
  },
  "gate-revalidate": async ({ target, packageRoot, options }) => {
    const { result } = await COMMAND_EXECUTORS["gate-revalidate"]({ target, packageRoot, options });
    renderJsonOr(options, result, (await import("./commands/gate-revalidate.js")).formatGateRevalidateResult);
    return 0;
  },
  "protocol-info": async ({ packageVersion, options }) => {
    const { result } = await COMMAND_EXECUTORS["protocol-info"]({ packageVersion, options });
    renderJsonOr(options, result, (await import("./commands/protocol-info.js")).formatProtocolInfoResult);
    return 0;
  },
  "decision-status": async ({ target, packageRoot, options }) => {
    const { result } = await COMMAND_EXECUTORS["decision-status"]({ target, packageRoot, options });
    renderJsonOr(options, result, (await import("./commands/decision-status.js")).formatDecisionStatusResult);
    return 0;
  },
  "decision-show": async ({ target, packageRoot, options }) => {
    const { result } = await COMMAND_EXECUTORS["decision-show"]({ target, packageRoot, options });
    renderJsonOr(options, result, (await import("./commands/decision-show.js")).formatDecisionShowResult);
    return 0;
  },
  "context-plan": async ({ options }) => {
    const { result } = await COMMAND_EXECUTORS["context-plan"]({ options });
    renderJsonOr(options, result, (await import("./commands/context-plan.js")).formatContextPlanResult);
    return 0;
  },
  "model-route": async ({ options }) => {
    const { result } = await COMMAND_EXECUTORS["model-route"]({ options });
    renderJsonOr(options, result, (await import("./commands/model-route.js")).formatModelRouteResult);
    return 0;
  },
  "semantic-plan": async ({ options }) => {
    const { result } = await COMMAND_EXECUTORS["semantic-plan"]({ options });
    renderJsonOr(options, result, (await import("./commands/semantic-plan.js")).formatSemanticPlanResult);
    return 0;
  },
  "test-inventory": async ({ target, options }) => {
    const { result } = await COMMAND_EXECUTORS["test-inventory"]({ target, options });
    renderJsonOr(options, result, (await import("./commands/test-inventory.js")).formatTestInventoryResult);
    return 0;
  },
  "test-utility": async ({ target, packageRoot, options }) => {
    const { result } = await COMMAND_EXECUTORS["test-utility"]({ target, packageRoot, options });
    renderJsonOr(options, result, (await import("./commands/test-utility.js")).formatTestUtilityResult);
    return 0;
  },
  "test-prune-plan": async ({ target, packageRoot, options }) => {
    const { result } = await COMMAND_EXECUTORS["test-prune-plan"]({ target, packageRoot, options });
    renderJsonOr(options, result, (await import("./commands/test-prune-plan.js")).formatTestPrunePlanResult);
    return 0;
  },
  "test-prune-probe": async ({ target, packageRoot, options }) => {
    const { result } = await COMMAND_EXECUTORS["test-prune-probe"]({ target, packageRoot, options });
    renderJsonOr(options, result, (await import("./commands/test-prune-probe.js")).formatTestPruneProbeResult);
    return 0;
  },
  init: async ({ target, packageRoot, packageVersion, options }) => {
    const { result } = await COMMAND_EXECUTORS.init({ target, packageRoot, packageVersion, options });
    printActions(result.actions);
    return 0;
  },
  "storage-migration-resume": async ({ target, packageRoot, options }) => {
    const { result, exitCode } = await COMMAND_EXECUTORS["storage-migration-resume"]({ target, packageRoot, options });
    renderJsonOr(options, result, value => `storage recovery: ${value.phase}\ncurrent state verified: ${value.currentStateVerified}`);
    return exitCode;
  },
  "storage-rollback-resume": async ({ target, packageRoot, options }) => {
    const { result, exitCode } = await COMMAND_EXECUTORS["storage-rollback-resume"]({ target, packageRoot, options });
    renderJsonOr(options, result, value => `source restored: ${value.restored}\ntarget version validated: ${value.targetVersionValidated}`);
    return exitCode;
  },
  "storage-rollback": async ({ target, packageRoot, options }) => {
    const { result, exitCode } = await COMMAND_EXECUTORS["storage-rollback"]({ target, packageRoot, options });
    renderJsonOr(options, result, value => `source restored: ${value.restored}\ntarget version validated: ${value.targetVersionValidated}`);
    return exitCode;
  },
  "storage-migrate": async ({ target, packageRoot, options }) => {
    const { result, exitCode } = await COMMAND_EXECUTORS["storage-migrate"]({ target, packageRoot, options });
    renderJsonOr(options, result, value => `storage migration: ${value.phase}\ncurrent state verified: ${value.currentStateVerified}`);
    return exitCode;
  },
  "storage-backup": async ({ target, options }) => {
    const { result, exitCode } = await COMMAND_EXECUTORS["storage-backup"]({ target, options });
    renderJsonOr(options, result, value => `storage backup: ${value.path}\nattachments included: ${value.attachmentsIncluded}`);
    return exitCode;
  },
  "storage-restore": async ({ target, packageRoot, options }) => {
    const { result, exitCode } = await COMMAND_EXECUTORS["storage-restore"]({ target, packageRoot, options });
    renderJsonOr(options, result, value => `storage restore: ${value.path}\nactive: ${value.active}\nretained snapshot: ${value.retainedSnapshot}`);
    return exitCode;
  },
  "storage-restore-resume": async ({ target, packageRoot, options }) => {
    const { result, exitCode } = await COMMAND_EXECUTORS["storage-restore-resume"]({ target, packageRoot, options });
    renderJsonOr(options, result, value => `restore recovery: ${value.active ? "ACTIVE" : "incomplete"}\nrestored snapshot: ${value.restored}\ncurrent state verified: ${value.currentStateVerified ?? false}`);
    return exitCode;
  },
  "storage-migration-status": async ({ target, options }) => {
    const { result, exitCode } = await COMMAND_EXECUTORS["storage-migration-status"]({ target, options });
    renderJsonOr(options, result, value => `storage layout: ${value.layout}\nmaintenance: ${value.maintenance.status}`);
    return exitCode;
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
    renderJsonOr(options, result, (await import("./commands/repository-index.js")).formatRepositoryIndexResult);
    return 0;
  },
  "index-start": async ({ target, packageRoot, options }) => {
    const { result } = await COMMAND_EXECUTORS["index-start"]({ target, packageRoot, options });
    renderJsonOr(options, result, (await import("./commands/repository-index.js")).formatRepositoryIndexResult);
    return 0;
  },
  "index-stop": async ({ target, packageRoot, options }) => {
    const { result } = await COMMAND_EXECUTORS["index-stop"]({ target, packageRoot, options });
    renderJsonOr(options, result, (await import("./commands/repository-index.js")).formatRepositoryIndexResult);
    return 0;
  },
  "index-status": async ({ target, packageRoot, options }) => {
    const { result } = await COMMAND_EXECUTORS["index-status"]({ target, packageRoot, options });
    renderJsonOr(options, result, (await import("./commands/repository-index.js")).formatRepositoryIndexStatus);
    return 0;
  },
  "index-rebuild": async ({ target, packageRoot, options }) => {
    const { result } = await COMMAND_EXECUTORS["index-rebuild"]({ target, packageRoot, options });
    renderJsonOr(options, result, (await import("./commands/repository-index.js")).formatRepositoryIndexResult);
    return 0;
  },
  search: async ({ target, packageRoot, options }) => {
    const { result, exitCode } = await COMMAND_EXECUTORS.search({ target, packageRoot, options, transport: "cli" });
    renderJsonOr(options, result, (await import("./commands/repository-index.js")).formatSearchResult);
    return exitCode;
  },
  route: async ({ target, packageRoot, options }) => {
    const { result } = await COMMAND_EXECUTORS.route({ target, packageRoot, options });
    renderJsonOr(options, result, (await import("./commands/route.js")).formatRouteResult);
    return 0;
  },
  activate: async ({ target, packageRoot, options }) => {
    const { result } = await COMMAND_EXECUTORS.activate({ target, packageRoot, options });
    renderJsonOr(options, result, (await import("./commands/activate.js")).formatActivateResult);
    return 0;
  },
  preflight: async ({ target, packageRoot, options }) => {
    const { result, exitCode } = await COMMAND_EXECUTORS.preflight({ target, packageRoot, options });
    renderJsonOr(options, result, (await import("./commands/preflight.js")).formatPreflightResult);
    return exitCode;
  },
  "quality-baseline": async ({ target, packageRoot, options }) => {
    const { result, exitCode } = await COMMAND_EXECUTORS["quality-baseline"]({ target, packageRoot, options });
    renderJsonOr(options, result, (await import("./commands/quality-baseline.js")).formatQualityBaselineResult);
    return exitCode;
  },
  "quality-verify": async ({ target, packageRoot, options }) => {
    const { result, exitCode } = await COMMAND_EXECUTORS["quality-verify"]({ target, packageRoot, options });
    renderJsonOr(options, result, (await import("./commands/quality-verify.js")).formatQualityVerifyResult);
    return exitCode;
  },
  "quality-status": async ({ target, packageRoot, options }) => {
    const { result, exitCode } = await COMMAND_EXECUTORS["quality-status"]({ target, packageRoot, options });
    renderJsonOr(options, result, (await import("./commands/quality-status.js")).formatQualityStatusResult);
    return exitCode;
  },
  advance: async ({ target, packageRoot, options }) => {
    const { result } = await COMMAND_EXECUTORS.advance({ target, packageRoot, options });
    renderJsonOr(options, result, (await import("./commands/advance.js")).formatAdvanceResult);
    return 0;
  },
  next: async ({ target, packageRoot, options }) => {
    const { result } = await COMMAND_EXECUTORS.next({ target, packageRoot, options });
    if (options.compact) console.log((await import("./commands/next.js")).formatCompactNextActionResult(result));
    else renderJsonOr(options, result, (await import("./commands/next.js")).formatNextActionResult);
    return 0;
  },
  continuity: async ({ target, packageRoot, options }) => {
    const { result } = await COMMAND_EXECUTORS.continuity({ target, packageRoot, options });
    renderJsonOr(options, result, (await import("./commands/continuity.js")).formatContinuityResult);
    return 0;
  },
  "record-continuity": async ({ target, packageRoot, options }) => {
    const { result } = await COMMAND_EXECUTORS["record-continuity"]({ target, packageRoot, options });
    renderJsonOr(options, result, (await import("./commands/record-continuity.js")).formatRecordContinuityResult);
    return 0;
  },
  "reconcile-continuity": async ({ target, packageRoot, options }) => {
    const { result } = await COMMAND_EXECUTORS["reconcile-continuity"]({ target, packageRoot, options });
    renderJsonOr(options, result, (await import("./commands/reconcile-continuity.js")).formatReconcileContinuityResult);
    return 0;
  },
  "clear-continuity": async ({ target, options }) => {
    const { result } = await COMMAND_EXECUTORS["clear-continuity"]({ target, options });
    renderJsonOr(options, result, (await import("./commands/clear-continuity.js")).formatClearContinuityResult);
    return 0;
  },
  "prepare-completion": async ({ target, packageRoot, options }) => {
    const { result } = await COMMAND_EXECUTORS["prepare-completion"]({ target, packageRoot, options });
    renderJsonOr(options, result, (await import("./commands/prepare-completion.js")).formatPrepareCompletionResult);
    return 0;
  },
  "run-check": async ({ target, packageRoot, options }) => {
    const { result, exitCode } = await COMMAND_EXECUTORS["run-check"]({ target, packageRoot, options });
    renderJsonOr(options, result, (await import("./commands/run-check.js")).formatRunCheckResult);
    return exitCode;
  },
  "workspace-bind": async ({ target, packageRoot, options }) => {
    const { result, exitCode } = await COMMAND_EXECUTORS["workspace-bind"]({ target, packageRoot, options });
    renderJsonOr(options, result, (await import("./commands/workspace-bind.js")).formatWorkspaceBindResult);
    return exitCode;
  },
  "workspace-status": async ({ target, packageRoot, options }) => {
    const { result, exitCode } = await COMMAND_EXECUTORS["workspace-status"]({ target, packageRoot, options });
    renderJsonOr(options, result, (await import("./commands/workspace-status.js")).formatWorkspaceStatusResult);
    return exitCode;
  },
  "handoff-create": async ({ target, packageRoot, options }) => {
    const { result, exitCode } = await COMMAND_EXECUTORS["handoff-create"]({ target, packageRoot, options });
    renderJsonOr(options, result, (await import("./commands/handoff-create.js")).formatHandoffCreateResult);
    return exitCode;
  },
  "handoff-list": async ({ target, packageRoot, options }) => {
    const { result, exitCode } = await COMMAND_EXECUTORS["handoff-list"]({ target, packageRoot, options });
    renderJsonOr(options, result, (await import("./commands/handoff-list.js")).formatHandoffListResult);
    return exitCode;
  },
  "handoff-show": async ({ target, packageRoot, options }) => {
    const { result, exitCode } = await COMMAND_EXECUTORS["handoff-show"]({ target, packageRoot, options });
    renderJsonOr(options, result, (await import("./commands/handoff-show.js")).formatHandoffShowResult);
    return exitCode;
  },
  "handoff-accept": async ({ target, packageRoot, options }) => {
    const { result, exitCode } = await COMMAND_EXECUTORS["handoff-accept"]({ target, packageRoot, options });
    renderJsonOr(options, result, (await import("./commands/handoff-accept.js")).formatHandoffAcceptResult);
    return exitCode;
  },
  "responsibility-set": async ({ target, packageRoot, options }) => {
    const { result, exitCode } = await COMMAND_EXECUTORS["responsibility-set"]({ target, packageRoot, options });
    renderJsonOr(options, result, (await import("./commands/responsibility-set.js")).formatResponsibilitySetResult);
    return exitCode;
  },
  "responsibility-status": async ({ target, packageRoot, options }) => {
    const { result, exitCode } = await COMMAND_EXECUTORS["responsibility-status"]({ target, packageRoot, options });
    renderJsonOr(options, result, (await import("./commands/responsibility-status.js")).formatResponsibilityStatusResult);
    return exitCode;
  },
  "verify-scope": async ({ target, packageRoot, options }) => {
    const { result, exitCode } = await COMMAND_EXECUTORS["verify-scope"]({ target, packageRoot, options });
    renderJsonOr(options, result, (await import("./commands/verify-scope.js")).formatVerifyScopeResult);
    return exitCode;
  },
  "attestation-create": async ({ target, packageRoot, options }) => {
    const { result, exitCode } = await COMMAND_EXECUTORS["attestation-create"]({ target, packageRoot, options });
    renderJsonOr(options, result, (await import("./commands/attestation-create.js")).formatAttestationCreateResult);
    return exitCode;
  },
  "attestation-verify": async ({ target, packageRoot, options }) => {
    const { result, exitCode } = await COMMAND_EXECUTORS["attestation-verify"]({ target, packageRoot, options });
    renderJsonOr(options, result, (await import("./commands/attestation-verify.js")).formatAttestationVerifyResult);
    return exitCode;
  },
  "attestation-status": async ({ target, packageRoot, options }) => {
    const { result, exitCode } = await COMMAND_EXECUTORS["attestation-status"]({ target, packageRoot, options });
    renderJsonOr(options, result, (await import("./commands/attestation-status.js")).formatAttestationStatusResult);
    return exitCode;
  },
  "attestation-verify-range": async ({ target, packageRoot, options }) => {
    const { result, exitCode } = await COMMAND_EXECUTORS["attestation-verify-range"]({ target, packageRoot, options });
    renderJsonOr(options, result, (await import("./commands/attestation-verify-range.js")).formatAttestationVerifyRangeResult);
    return exitCode;
  },
  "run-action": async ({ target, packageRoot, options }) => {
    const { result, exitCode } = await COMMAND_EXECUTORS["run-action"]({ target, packageRoot, options });
    renderJsonOr(options, result, (await import("./commands/run-action.js")).formatRunActionResult);
    return exitCode;
  },
  "action-propose": async ({ target, packageRoot, options }) => {
    const { result } = await COMMAND_EXECUTORS["action-propose"]({ target, packageRoot, options });
    renderJsonOr(options, result, (await import("./commands/action-propose.js")).formatActionProposeResult); return 0;
  },
  "action-authorize": async ({ target, packageRoot, options }) => {
    const { result } = await COMMAND_EXECUTORS["action-authorize"]({ target, packageRoot, options });
    renderJsonOr(options, result, (await import("./commands/action-authorize.js")).formatActionAuthorizeResult); return 0;
  },
  "action-record": async ({ target, packageRoot, options }) => {
    const { result } = await COMMAND_EXECUTORS["action-record"]({ target, packageRoot, options });
    renderJsonOr(options, result, (await import("./commands/action-record.js")).formatActionRecordResult); return 0;
  },
  "action-verify": async ({ target, packageRoot, options }) => {
    const { result } = await COMMAND_EXECUTORS["action-verify"]({ target, packageRoot, options });
    renderJsonOr(options, result, (await import("./commands/action-verify.js")).formatActionVerifyResult); return 0;
  },
  "action-show": async ({ target, packageRoot, options }) => {
    const { result } = await COMMAND_EXECUTORS["action-show"]({ target, packageRoot, options });
    renderJsonOr(options, result, (await import("./commands/action-show.js")).formatActionShowResult); return 0;
  },
  "action-reconcile": async ({ target, packageRoot, options }) => {
    const { result } = await COMMAND_EXECUTORS["action-reconcile"]({ target, packageRoot, options });
    renderJsonOr(options, result, (await import("./commands/action-reconcile.js")).formatActionReconcileResult); return 0;
  },
  metrics: async ({ target, packageRoot, options }) => {
    const { result } = await COMMAND_EXECUTORS.metrics({ target, packageRoot, options });
    renderJsonOr(options, result, (await import("./commands/metrics.js")).formatMetricsResult); return 0;
  },
  "usage-record": async ({ target, packageRoot, options }) => {
    const { result } = await COMMAND_EXECUTORS["usage-record"]({ target, packageRoot, options });
    renderJsonOr(options, result, (await import("./commands/usage-record.js")).formatUsageRecordResult); return 0;
  },
  efficiency: async ({ target, packageRoot, options }) => {
    const { result } = await COMMAND_EXECUTORS.efficiency({ target, packageRoot, options });
    renderJsonOr(options, result, (await import("./commands/efficiency.js")).formatEfficiencyResult); return 0;
  },
  eval: async ({ target, packageRoot, options }) => {
    const { result, exitCode } = await COMMAND_EXECUTORS.eval({ target, packageRoot, options });
    renderJsonOr(options, result, (await import("./commands/eval.js")).formatEvalResult); return exitCode;
  },
  "approval-request": async ({ target, packageRoot, options }) => { const { result } = await COMMAND_EXECUTORS["approval-request"]({ target, packageRoot, options }); renderJsonOr(options, result, (await import("./commands/approval-request.js")).formatApprovalRequestResult); return 0; },
  "approval-resolve": async ({ target, packageRoot, options }) => { const { result } = await COMMAND_EXECUTORS["approval-resolve"]({ target, packageRoot, options }); renderJsonOr(options, result, (await import("./commands/approval-resolve.js")).formatApprovalResolveResult); return 0; },
  "record-check": async ({ target, packageRoot, options }) => {
    const { result } = await COMMAND_EXECUTORS["record-check"]({ target, packageRoot, options });
    renderJsonOr(options, result, (await import("./commands/record-check.js")).formatRecordCheckResult);
    return 0;
  },
  "record-terminal-result": async ({ target, packageRoot, options }) => {
    const { result } = await COMMAND_EXECUTORS["record-terminal-result"]({ target, packageRoot, options });
    renderJsonOr(options, result, (await import("./commands/record-terminal-result.js")).formatRecordTerminalResult);
    return 0;
  },
  "record-diagnosis": async ({ target, packageRoot, options }) => {
    const { result } = await COMMAND_EXECUTORS["record-diagnosis"]({ target, packageRoot, options });
    renderJsonOr(options, result, (await import("./commands/record-diagnosis.js")).formatRecordDiagnosisResult);
    return 0;
  },
  "record-intervention": async ({ target, packageRoot, options }) => {
    const { result } = await COMMAND_EXECUTORS["record-intervention"]({ target, packageRoot, options });
    renderJsonOr(options, result, (await import("./commands/record-intervention.js")).formatRecordInterventionResult);
    return 0;
  },
  "record-hypothesis-disposition": async ({ target, packageRoot, options }) => {
    const { result } = await COMMAND_EXECUTORS["record-hypothesis-disposition"]({ target, packageRoot, options });
    renderJsonOr(options, result, (await import("./commands/record-hypothesis-disposition.js")).formatRecordHypothesisDispositionResult);
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
      console.log((await import("./commands/history.js")).formatHistoryResult(result));
      for (const event of result.events) {
        console.log(`--- ${event.sequence} ${event.type} ---`);
        console.log(JSON.stringify(event.data, null, 2));
      }
    } else {
      console.log((await import("./commands/history.js")).formatHistoryResult(result));
    }
    return exitCode;
  },
  trace: async ({ target, packageRoot, options }) => {
    const { result, exitCode } = await COMMAND_EXECUTORS.trace({ target, packageRoot, options });
    renderJsonOr(options, result, (await import("./commands/trace.js")).formatTraceResult);
    return exitCode;
  },
  reflect: async ({ target, packageRoot, options }) => {
    const { result, exitCode } = await COMMAND_EXECUTORS.reflect({ target, packageRoot, options });
    renderJsonOr(options, result, (await import("./commands/reflect.js")).formatReflectResult);
    return exitCode;
  },
  progress: async ({ target, packageRoot, options }) => {
    const { result, exitCode } = await COMMAND_EXECUTORS.progress({ target, packageRoot, options });
    renderJsonOr(options, result, (await import("./commands/progress.js")).formatProgressResult);
    return exitCode;
  },
  "record-decision-criterion": async ({ target, packageRoot, options }) => {
    const { result } = await COMMAND_EXECUTORS["record-decision-criterion"]({ target, packageRoot, options });
    renderJsonOr(options, result, (await import("./commands/record-decision-criterion.js")).formatRecordDecisionCriterionResult);
    return 0;
  },
  complete: async ({ target, packageRoot, options }) => {
    const { result, exitCode } = await COMMAND_EXECUTORS.complete({ target, packageRoot, options });
    renderJsonOr(options, result, (await import("./commands/complete.js")).formatCompleteResult);
    return exitCode;
  },
  audit: async ({ target, packageRoot, options }) => {
    const { result, exitCode } = await COMMAND_EXECUTORS.audit({ target, packageRoot, options });
    renderJsonOr(options, result, (await import("./commands/audit.js")).formatAuditResult);
    return exitCode;
  },
  report: async ({ target, packageRoot, options }) => {
    const { result, exitCode } = await COMMAND_EXECUTORS.report({ target, packageRoot, options });
    renderJsonOr(options, result, (await import("./commands/report.js")).formatReportResult);
    return exitCode;
  },
  policy: async ({ target, packageRoot, options }) => {
    const { result } = await COMMAND_EXECUTORS.policy({ target, packageRoot, options });
    renderJsonOr(options, result, (await import("./commands/policy.js")).formatPolicyResult);
    return 0;
  },
  "policy-discover": async ({ target, packageRoot, options }) => {
    const { result } = await COMMAND_EXECUTORS["policy-discover"]({ target, packageRoot, options });
    renderJsonOr(options, result, (await import("./commands/policy-discover.js")).formatPolicyDiscoverResult);
    return 0;
  },
  "policy-status": async ({ target, packageRoot, options }) => {
    const { result, exitCode } = await COMMAND_EXECUTORS["policy-status"]({ target, packageRoot, options });
    renderJsonOr(options, result, (await import("./commands/policy-status.js")).formatPolicyStatusResult);
    return exitCode;
  },
  "policy-diff": async ({ target, packageRoot, options }) => {
    const { result } = await COMMAND_EXECUTORS["policy-diff"]({ target, packageRoot, options });
    renderJsonOr(options, result, (await import("./commands/policy-diff.js")).formatPolicyDiffResult);
    return 0;
  },
  "rule-verify": async ({ target, packageRoot, options }) => {
    const { result, exitCode } = await COMMAND_EXECUTORS["rule-verify"]({ target, packageRoot, options });
    renderJsonOr(options, result, (await import("./commands/rule-verify.js")).formatRuleVerifyResult);
    return exitCode;
  },
  baseline: async ({ target, packageRoot, options }) => {
    const { result } = await COMMAND_EXECUTORS.baseline({ target, packageRoot, options });
    renderJsonOr(options, result, (await import("./commands/baseline.js")).formatBaselineResult);
    return 0;
  },
  "profile-interview": async ({ target, packageRoot, options }) => {
    const { result } = await COMMAND_EXECUTORS["profile-interview"]({ target, packageRoot, options });
    renderJsonOr(options, result, (await import("./commands/profile-interview.js")).formatProfileInterviewResult);
    return 0;
  },
  bundle: async ({ target, packageRoot, options }) => {
    const { result } = await COMMAND_EXECUTORS.bundle({ target, packageRoot, options });
    renderJsonOr(options, result, (await import("./commands/bundle.js")).formatBundleResult);
    return 0;
  },
  inspect: async ({ target, packageRoot, options }) => {
    const { result, exitCode } = await COMMAND_EXECUTORS.inspect({ target, packageRoot, options });
    renderJsonOr(options, result, (await import("./commands/inspect.js")).formatInspectResult);
    return exitCode;
  },
  "validate-receipt": async ({ target, packageRoot, options }) => {
    const { result } = await COMMAND_EXECUTORS["validate-receipt"]({ target, packageRoot, options });
    console.log(options.json ? JSON.stringify(result, null, 2) : "valid: execution receipt");
    return 0;
  },
  "validate-protocol": async ({ target, packageRoot, options }) => {
    const { result, exitCode } = await COMMAND_EXECUTORS["validate-protocol"]({ target, packageRoot, options });
    renderJsonOr(options, result, (await import("./commands/validate-protocol.js")).formatValidateProtocolResult);
    return exitCode;
  },
  status: async ({ target, packageRoot, options }) => {
    const { result } = await COMMAND_EXECUTORS.status({ target, packageRoot, options });
    renderJsonOr(options, result, (await import("./commands/status.js")).formatStatusResult);
    return 0;
  },
  "validate-state": async ({ target, packageRoot, options }) => {
    const { result, exitCode } = await COMMAND_EXECUTORS["validate-state"]({ target, packageRoot, options });
    renderJsonOr(options, result, (await import("./commands/validate-state.js")).formatValidateStateResult);
    return exitCode;
  },
  "clear-state": async ({ target, options }) => {
    const { result } = await COMMAND_EXECUTORS["clear-state"]({ target, options });
    renderJsonOr(options, result, (await import("./commands/clear-state.js")).formatClearStateResult);
    return 0;
  },
  "task-create": async ({ target, packageRoot, options }) => {
    const { result } = await COMMAND_EXECUTORS["task-create"]({ target, packageRoot, options });
    renderJsonOr(options, result, (await import("./commands/task-create.js")).formatTaskCreateResult);
    return 0;
  },
  "task-list": async ({ target, packageRoot, options }) => {
    const { result } = await COMMAND_EXECUTORS["task-list"]({ target, packageRoot, options });
    renderJsonOr(options, result, (await import("./commands/task-list.js")).formatTaskListResult);
    return 0;
  },
  "task-show": async ({ target, packageRoot, options }) => {
    const { result } = await COMMAND_EXECUTORS["task-show"]({ target, packageRoot, options });
    if (options.compact) console.log((await import("./commands/task-show.js")).formatCompactTaskShowResult(result));
    else renderJsonOr(options, result, (await import("./commands/task-show.js")).formatTaskShowResult);
    return 0;
  },
  "task-lock-status": async ({ target, packageRoot, options }) => {
    const { result } = await COMMAND_EXECUTORS["task-lock-status"]({ target, packageRoot, options });
    renderJsonOr(options, result, (await import("./commands/task-lock-status.js")).formatTaskLockStatusResult);
    return 0;
  },
  "task-scope": async ({ target, packageRoot, options }) => {
    const { result } = await COMMAND_EXECUTORS["task-scope"]({ target, packageRoot, options });
    renderJsonOr(options, result, (await import("./commands/task-scope.js")).formatTaskScopeResult);
    return 0;
  },
  "task-migrate": async ({ target, packageRoot, options }) => {
    const { result } = await COMMAND_EXECUTORS["task-migrate"]({ target, packageRoot, options });
    renderJsonOr(options, result, (await import("./commands/task-migrate.js")).formatTaskMigrateResult);
    return 0;
  },
  "migrate-protocol": async ({ target, packageRoot, options }) => {
    const { result } = await COMMAND_EXECUTORS["migrate-protocol"]({ target, packageRoot, options });
    renderJsonOr(options, result, (await import("./commands/migrate-protocol.js")).formatMigrateProtocolResult);
    return 0;
  },
  "task-unlock": async ({ target, packageRoot, options }) => {
    const { result } = await COMMAND_EXECUTORS["task-unlock"]({ target, packageRoot, options });
    renderJsonOr(options, result, (await import("./commands/task-unlock.js")).formatTaskUnlockResult);
    return 0;
  },
  "task-recover": async ({ target, packageRoot, options }) => {
    if (options.operatorAuthorized && !options.acknowledgeRecovery) {
      console.error("DEPRECATION: --operator-authorized is caller acknowledgement, not host attestation; use --acknowledge-recovery.");
    }
    const { result } = await COMMAND_EXECUTORS["task-recover"]({ target, packageRoot, options });
    renderJsonOr(options, result, (await import("./commands/task-recover.js")).formatTaskRecoverResult);
    return 0;
  },
  "task-abandon": async ({ target, packageRoot, options }) => {
    const { result } = await COMMAND_EXECUTORS["task-abandon"]({ target, packageRoot, options });
    renderJsonOr(options, result, (await import("./commands/task-abandon.js")).formatTaskAbandonResult);
    return 0;
  },
  "task-resume": async ({ target, packageRoot, options }) => {
    const { result } = await COMMAND_EXECUTORS["task-resume"]({ target, packageRoot, options });
    renderJsonOr(options, result, (await import("./commands/task-resume.js")).formatTaskResumeResult);
    return 0;
  },
  "task-repair-contract-bootstrap": async ({ target, packageRoot, options }) => {
    const { result } = await COMMAND_EXECUTORS["task-repair-contract-bootstrap"]({ target, packageRoot, options });
    renderJsonOr(options, result, (await import("./commands/task-repair-contract-bootstrap.js")).formatTaskRepairContractBootstrapResult);
    return 0;
  },
  "task-migrate-contract-bootstrap-repair": async ({ target, packageRoot, options }) => {
    const { result } = await COMMAND_EXECUTORS["task-migrate-contract-bootstrap-repair"]({ target, packageRoot, options });
    renderJsonOr(options, result, (await import("./commands/task-migrate-contract-bootstrap-repair.js")).formatTaskMigrateContractBootstrapRepairResult);
    return 0;
  },
  "checkpoint-revalidate": async ({ target, packageRoot, options }) => {
    const { result } = await COMMAND_EXECUTORS["checkpoint-revalidate"]({ target, packageRoot, options });
    renderJsonOr(options, result, (await import("./commands/checkpoint-revalidate.js")).formatCheckpointRevalidateResult);
    return 0;
  },
  "task-repair-legacy-recovery": async ({ target, packageRoot, options }) => {
    const { result } = await COMMAND_EXECUTORS["task-repair-legacy-recovery"]({ target, packageRoot, options });
    renderJsonOr(options, result, (await import("./commands/task-repair-legacy-recovery.js")).formatTaskRepairLegacyRecoveryResult);
    return 0;
  },
  "reconcile-closure": async ({ target, packageRoot, options }) => {
    const { result } = await COMMAND_EXECUTORS["reconcile-closure"]({ target, packageRoot, options });
    renderJsonOr(options, result, (await import("./commands/reconcile-closure.js")).formatReconcileClosureResult);
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
