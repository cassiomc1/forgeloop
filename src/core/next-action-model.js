import { PROTOCOL_VERSION } from "./protocol.js";
import { sha256 } from "./manifest.js";

export const NEXT_ACTIONS = Object.freeze({
  DISCOVER: "DISCOVER",
  CREATE_CONTRACT: "CREATE_CONTRACT",
  ROUTE: "ROUTE",
  SATISFY_GATES: "SATISFY_GATES",
  RUN_PREFLIGHT: "RUN_PREFLIGHT",
  PLAN: "PLAN",
  START_EXECUTION: "START_EXECUTION",
  ENTER_VERIFYING: "ENTER_VERIFYING",
  CONTINUE_IMPLEMENTATION: "CONTINUE_IMPLEMENTATION",
  RECORD_VERIFICATION: "RECORD_VERIFICATION",
  CAPTURE_STRUCTURAL_QUALITY_BASELINE: "CAPTURE_STRUCTURAL_QUALITY_BASELINE",
  VERIFY_STRUCTURAL_QUALITY: "VERIFY_STRUCTURAL_QUALITY",
  DIAGNOSE_STRUCTURAL_QUALITY_REGRESSION: "DIAGNOSE_STRUCTURAL_QUALITY_REGRESSION",
  RESOLVE_STRUCTURAL_QUALITY_BLOCKER: "RESOLVE_STRUCTURAL_QUALITY_BLOCKER",
  DIAGNOSE: "DIAGNOSE",
  RECORD_DIAGNOSIS: "RECORD_DIAGNOSIS",
  CORRECT: "CORRECT",
  CHANGE_STRATEGY: "CHANGE_STRATEGY",
  REQUIRE_NEW_DIAGNOSTIC_INFORMATION: "REQUIRE_NEW_DIAGNOSTIC_INFORMATION",
  INTRODUCE_NEW_OBSERVATION: "INTRODUCE_NEW_OBSERVATION",
  RECORD_INTERVENTION: "RECORD_INTERVENTION",
  ENTER_REVIEWING: "ENTER_REVIEWING",
  RECORD_TERMINAL_RESULT: "RECORD_TERMINAL_RESULT",
  PREPARE_COMPLETION: "PREPARE_COMPLETION",
  RUN_COMPLETE: "RUN_COMPLETE",
  RESOLVE_STALE_ROUTE: "RESOLVE_STALE_ROUTE",
  RESOLVE_BLOCKER: "RESOLVE_BLOCKER",
  RESTORE_POLICY: "RESTORE_POLICY",
  REVERIFY_AFTER_POLICY_CHANGE: "REVERIFY_AFTER_POLICY_CHANGE",
  VERIFY_RULE: "VERIFY_RULE",
  RESOLVE_INERT_CHECK: "RESOLVE_INERT_CHECK",
  RUN_REQUIRED_CHECK: "RUN_REQUIRED_CHECK",
  REPAIR_CHECKER: "REPAIR_CHECKER",
  REPAIR_POLICY: "REPAIR_POLICY",
  RESTORE_BASELINE: "RESTORE_BASELINE",
  CONTINUE_WITH_EXISTING_BASELINE: "CONTINUE_WITH_EXISTING_BASELINE",
  RECONCILE_CLOSURE: "RECONCILE_CLOSURE",
  RECONCILE_ACTION: "RECONCILE_ACTION",
  AUTHORIZE_ACTION: "AUTHORIZE_ACTION",
  REQUEST_ACTION_APPROVAL: "REQUEST_ACTION_APPROVAL",
  RESOLVE_ACTION_APPROVAL: "RESOLVE_ACTION_APPROVAL",
  VERIFY_EXTERNAL_ACTION: "VERIFY_EXTERNAL_ACTION",
  RECOVER_TASK: "RECOVER_TASK",
  RESUME_RECOVERED_TASK: "RESUME_RECOVERED_TASK",
  RESOLVE_RECOVERY_INCONSISTENCY: "RESOLVE_RECOVERY_INCONSISTENCY",
  REPAIR_CONTRACT_BOOTSTRAP: "REPAIR_CONTRACT_BOOTSTRAP",
  NONE: "NONE",
});

export function directCommandSpec(commandId, taskId, requiredInputs = []) {
  return {
    commandId,
    executable: "forgeloop",
    subcommand: commandId,
    argv: [commandId, `--task=${taskId}`, "--json"],
    requiredInputs,
  };
}

export function recoveryGuidanceForClassification(classification, taskId) {
  if (classification === "RECOVERABLE") {
    return {
      nextAction: NEXT_ACTIONS.RECONCILE_CLOSURE,
      commands: ["forgeloop reconcile-closure --task <id>"],
      commandSpecs: [directCommandSpec("reconcile-closure", taskId, [
        { name: "checkId", option: "--id=<contract-verification-id>" },
        { name: "requirement", option: "--requirement=<exact-contract-verification-text>" },
        { name: "command", option: "-- <verification-command...>" },
      ])],
    };
  }
  if (classification === "STALE" || classification === "ABANDONED") {
    return {
      nextAction: NEXT_ACTIONS.RECOVER_TASK,
      commands: ["forgeloop task-recover --task <id> --acknowledge-recovery --json"],
      commandSpecs: [directCommandSpec("task-recover", taskId, [
        {
          name: "acknowledgeRecovery",
          option: "--acknowledge-recovery",
          description: "Caller acknowledgement only; not host-attested authority.",
        },
      ])],
    };
  }
  if (classification === "RECOVERED") {
    return {
      nextAction: NEXT_ACTIONS.RESUME_RECOVERED_TASK,
      commands: ["forgeloop task-resume --task <id> --json"],
      commandSpecs: [directCommandSpec("task-resume", taskId)],
    };
  }
  if (classification === "INCONSISTENT") {
    return {
      nextAction: NEXT_ACTIONS.RESOLVE_RECOVERY_INCONSISTENCY,
      commands: ["forgeloop validate-protocol --task <id> --json"],
      commandSpecs: [directCommandSpec("validate-protocol", taskId)],
    };
  }
  return {
    nextAction: NEXT_ACTIONS.RESOLVE_BLOCKER,
    commands: ["forgeloop task-show --task <id> --json"],
    commandSpecs: [directCommandSpec("task-show", taskId)],
  };
}

export function result({
  taskId = "unknown",
  currentPhase = "RECEIVED",
  nextAction,
  reasons = [],
  commands = [],
  commandSpecs = [],
  requiredArtifacts = [],
  missingArtifacts = [],
  progress = undefined,
  diagnosticGuidance = undefined,
  authorityRequired = undefined,
  hostActionRequired = undefined,
  approvalRequired = undefined,
  capabilityDecision = undefined,
  reconciliationAuthorityRequired = undefined,
  optionalActions = undefined,
}) {
  const normalizedReasons = reasons
    .map((reason) => {
      const base = {
        code: reason.code ?? "E_NEXT_ACTION_BLOCKED",
        message: reason.message ?? String(reason),
        artifacts: uniqueSorted(reason.artifacts ?? []),
      };
      if (reason.resolution) {
        base.resolution = structuredClone(reason.resolution);
      }
      return base;
    })
    .sort((left, right) => left.code.localeCompare(right.code)
      || left.artifacts.join("\0").localeCompare(right.artifacts.join("\0"))
      || left.message.localeCompare(right.message));

  return {
    schemaVersion: 1,
    protocolVersion: PROTOCOL_VERSION,
    taskId,
    currentPhase,
    nextAction,
    terminal: nextAction === NEXT_ACTIONS.NONE,
    reasonCodes: uniqueSorted(normalizedReasons.map((reason) => reason.code)),
    reasons: normalizedReasons,
    commands: uniqueSorted(commands),
    commandSpecs: [...new Map(commandSpecs.map((spec) => [JSON.stringify(spec), spec])).values()]
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
    requiredArtifacts: uniqueSorted(requiredArtifacts),
    missingArtifacts: uniqueSorted(missingArtifacts),
    ...(progress ? { progress: structuredClone(progress) } : {}),
    ...(diagnosticGuidance ? { diagnosticGuidance: structuredClone(diagnosticGuidance) } : {}),
    ...(authorityRequired ? { authorityRequired: structuredClone(authorityRequired) } : {}),
    ...(hostActionRequired ? { hostActionRequired: structuredClone(hostActionRequired) } : {}),
    ...(approvalRequired ? { approvalRequired: structuredClone(approvalRequired) } : {}),
    ...(capabilityDecision ? { capabilityDecision: structuredClone(capabilityDecision) } : {}),
    ...(reconciliationAuthorityRequired
      ? { reconciliationAuthorityRequired: structuredClone(reconciliationAuthorityRequired) }
      : {}),
    ...(optionalActions?.length ? { optionalActions: structuredClone(optionalActions) } : {}),
  };
}

export function contractBootstrapRepairGuidance(taskId, reason = null) {
  const command = `forgeloop task-repair-contract-bootstrap --task ${taskId} --acknowledge-repair --json`;
  return {
    nextAction: NEXT_ACTIONS.REPAIR_CONTRACT_BOOTSTRAP,
    commands: [command],
    commandSpecs: [directCommandSpec("task-repair-contract-bootstrap", taskId, [
      { name: "acknowledgeRepair", option: "--acknowledge-repair", description: "Explicit caller acknowledgement of the exact repair signature." },
    ])],
    reason: reason ?? { code: "E_CONTRACT_BOOTSTRAP_REPAIR_AVAILABLE", message: "The exact duplicate contract bootstrap defect is repairable through the official append-only command." },
  };
}

export function commandFor(action) {
  return {
    [NEXT_ACTIONS.PLAN]: "forgeloop advance --to PLANNED",
    [NEXT_ACTIONS.RUN_PREFLIGHT]: "forgeloop preflight --json",
    [NEXT_ACTIONS.START_EXECUTION]: "forgeloop advance --to EXECUTING",
    [NEXT_ACTIONS.ENTER_VERIFYING]: "forgeloop advance --to VERIFYING",
    [NEXT_ACTIONS.CAPTURE_STRUCTURAL_QUALITY_BASELINE]: "forgeloop quality-baseline --task <id> --json",
    [NEXT_ACTIONS.VERIFY_STRUCTURAL_QUALITY]: "forgeloop quality-verify --task <id> --json",
    [NEXT_ACTIONS.DIAGNOSE_STRUCTURAL_QUALITY_REGRESSION]: "forgeloop advance --to DIAGNOSING",
    [NEXT_ACTIONS.DIAGNOSE]: "forgeloop advance --to DIAGNOSING",
    [NEXT_ACTIONS.CORRECT]: "forgeloop advance --to CORRECTING",
    [NEXT_ACTIONS.ENTER_REVIEWING]: "forgeloop advance --to REVIEWING",
    [NEXT_ACTIONS.RECORD_TERMINAL_RESULT]: "forgeloop record-terminal-result",
    [NEXT_ACTIONS.PREPARE_COMPLETION]: "forgeloop prepare-completion --json",
    [NEXT_ACTIONS.RUN_COMPLETE]: "forgeloop complete --json",
  }[action];
}

export function recordCheckCommandSpec(requirement) {
  const checkId = `requirement-${sha256(Buffer.from(requirement)).slice(0, 16)}`;
  return {
    commandId: "record-check",
    executable: "forgeloop",
    subcommand: "record-check",
    argv: ["record-check", `--id=${checkId}`, `--requirement=${requirement}`],
    requiredInputs: [
      { name: "status", option: "--status=<passed|failed|blocked|not-run>" },
      { name: "evidenceKind", option: "--evidence-kind=<OBSERVED|INFERRED|NOT_VERIFIED|BLOCKED>" },
      { name: "result", option: "--result=<text>" },
      { name: "exitCode", option: "--exit-code=<number>", optional: true },
    ],
  };
}

export function recordDiagnosisCommandSpec() {
  return {
    commandId: "record-diagnosis",
    executable: "forgeloop",
    subcommand: "record-diagnosis",
    argv: ["record-diagnosis"],
    requiredInputs: [
      { name: "hypothesis", option: "--hypothesis=<text>" },
      { name: "failureClass", option: "--failure-class=<class>" },
      { name: "evidenceRef", option: "--evidence-ref=<check-id>", repeatable: true },
      { name: "settledBy", option: "--settled-by=<text>" },
      { name: "nextSafeAction", option: "--next-safe-action=<text>" },
    ],
  };
}

export function recordInterventionCommandSpec(taskId = null) {
  return {
    commandId: "record-intervention",
    executable: "forgeloop",
    subcommand: "record-intervention",
    argv: ["record-intervention", ...(taskId ? [`--task=${taskId}`] : [])],
    requiredInputs: [
      { name: "file", option: "--file=<intervention-json-path>" },
    ],
  };
}

export function recordTerminalResultCommandSpec(requirement) {
  const reqId = requirement.id ?? requirement;
  const type = requirement.type ?? "PUBLICATION";
  const status = requirement.requiredPublicationStatus ?? (type === "PUBLICATION" ? "published" : "ready");
  return {
    commandId: "record-terminal-result",
    executable: "forgeloop",
    subcommand: "record-terminal-result",
    argv: ["record-terminal-result", `--requirement=${reqId}`, `--type=${type}`, `--status=${status}`],
    requiredInputs: [
      { name: "source", option: "--source=<text>" },
      { name: "result", option: "--result=<text>" },
      { name: "details", option: "--details=<json>", optional: true },
    ],
  };
}

export function decision(input, action, reason, requiredArtifacts = [], missingArtifacts = [], optionalActions = undefined) {
  const command = commandFor(action);
  return result({
    ...input,
    nextAction: action,
    reasons: [reason],
    ...(command ? { commands: [command] } : {}),
    requiredArtifacts,
    missingArtifacts,
    optionalActions,
  });
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

export { uniqueSorted };
