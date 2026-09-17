import { ARTIFACT_PATHS, readJsonArtifact } from "./artifacts.js";
import { taskArtifactPath } from "./task-paths.js";
import { readContract } from "./contract.js";
import { validateReadyProtocolConsistency } from "./preflight.js";
import { readWorkState } from "./work-state.js";
import { readEvents } from "./events.js";
import {
  NEXT_ACTIONS,
  directCommandSpec,
  decision,
  result,
} from "./next-action-model.js";
import { artifactError, loadArtifact } from "./next-action-artifacts.js";
import { resolveNextActionPhase } from "./next-action-phases.js";
import { criterionForDecision } from "./settlement-model.js";
import { validateApprovalForAction } from "./approvals.js";
import { evaluateActionCapability } from "./capability-policy.js";

export { NEXT_ACTIONS } from "./next-action-model.js";

function capabilityDecisionMetadata(action, capability, approvalId = null) {
  return {
    capability: action.capability,
    decision: capability.decision,
    reasonCode: capability.reasonCode ?? null,
    policyFingerprint: capability.policyFingerprint ?? null,
    ...(capability.authority?.authorityRef ? { authorityRef: capability.authority.authorityRef } : {}),
    ...(capability.approval?.approvalId
      ? { approvalId: capability.approval.approvalId }
      : approvalId ? { approvalId } : {}),
  };
}

function authorizeActionGuidance({ context, state, action, capability, eventsRel }) {
  const approvalId = capability.approval?.approvalId ?? null;
  const approvalSuffix = approvalId ? ` --approval ${approvalId}` : "";
  return result({
    ...context,
    nextAction: NEXT_ACTIONS.AUTHORIZE_ACTION,
    commands: [`forgeloop action-authorize --task ${state.taskId} --action ${action.actionId}${approvalSuffix}`],
    reasons: [artifactError(
      "E_ACTION_AUTHORIZATION_REQUIRED",
      `Required action ${action.actionId} is PROPOSED and is authorizable under the canonical capability policy.`,
    )],
    capabilityDecision: capabilityDecisionMetadata(action, capability),
    requiredArtifacts: [taskArtifactPath(state.taskId, "actions"), eventsRel],
  });
}

function actionApprovalGuidance({ context, state, action, capability, eventsRel }) {
  return result({
    ...context,
    nextAction: NEXT_ACTIONS.REQUEST_ACTION_APPROVAL,
    commands: [
      `forgeloop approval-request --task ${state.taskId} --action ${action.actionId} --approval <approval-id> --reason <reason>`,
    ],
    commandSpecs: [{
      ...directCommandSpec("approval-request", state.taskId, [
        { name: "approvalId", option: "--approval=<approval-id>" },
        { name: "actionId", option: "--action=<action-id>" },
        { name: "reason", option: "--reason=<text>" },
      ]),
    }],
    reasons: [artifactError(
      "E_ACTION_APPROVAL_REQUIRED",
      `Capability policy requires a current approval before required action ${action.actionId} can be authorized.`,
    )],
    approvalRequired: {
      actionId: action.actionId,
      capability: action.capability,
      reason: "Capability policy requires approval before authorization.",
    },
    capabilityDecision: capabilityDecisionMetadata(action, capability),
    requiredArtifacts: [taskArtifactPath(state.taskId, "actions"), eventsRel],
  });
}

function actionAuthorityGuidance({ context, state, action, capability, eventsRel }) {
  return result({
    ...context,
    nextAction: NEXT_ACTIONS.AUTHORIZE_ACTION,
    commands: [],
    reasons: [artifactError(
      capability.reasonCode ?? "E_ACTION_AUTHORITY_REQUIRED",
      `Required action ${action.actionId} needs trusted host authority before it can be authorized.`,
    )],
    authorityRequired: {
      kind: "HOST_ATTESTED",
      actionId: action.actionId,
      capability: action.capability,
      reason: capability.allowed
        ? "Authorization must be performed by a trusted host boundary that preserves authority context."
        : "Capability policy requires trusted host authority; no standalone CLI command can create it.",
    },
    hostActionRequired: {
      action: "action-authorize",
      actionId: action.actionId,
      executionBoundary: "HOST",
      requiresAuthorityContext: true,
    },
    capabilityDecision: capabilityDecisionMetadata(action, capability),
    requiredArtifacts: [taskArtifactPath(state.taskId, "actions"), eventsRel],
  });
}

function actionApprovalResolutionGuidance({ context, state, action, approval, eventsRel }) {
  return result({
    ...context,
    nextAction: NEXT_ACTIONS.RESOLVE_ACTION_APPROVAL,
    commands: [],
    reasons: [artifactError(
      "E_ACTION_APPROVAL_REQUIRED",
      `Required action ${action.actionId} is waiting for approval.`,
    )],
    requiredArtifacts: [taskArtifactPath(state.taskId, "approvals"), eventsRel],
    authorityRequired: {
      kind: "HOST_ATTESTED",
      approvalId: approval.approvalId,
      actionId: action.actionId,
      reason: "This approval must be resolved by a trusted host/operator boundary.",
    },
  });
}

function actionDeniedGuidance({ context, state, action, capability, eventsRel }) {
  return result({
    ...context,
    nextAction: NEXT_ACTIONS.RESOLVE_BLOCKER,
    commands: [],
    reasons: [artifactError(
      capability.reasonCode ?? "E_ACTION_CAPABILITY_DENIED",
      `Capability policy does not authorize required action ${action.actionId}: ${capability.decision}.`,
    )],
    capabilityDecision: capabilityDecisionMetadata(action, capability),
    requiredArtifacts: [taskArtifactPath(state.taskId, "actions"), eventsRel],
  });
}

function actionPolicyEpochGuidance({ context, state, action, policyIdentity, eventsRel }) {
  const code = policyIdentity.code ?? "E_ACTION_POLICY_LOCK_REQUIRED";
  const recoveryAction = policyRecoveryAction([{ code }]);
  return result({
    ...context,
    nextAction: recoveryAction ?? NEXT_ACTIONS.RESOLVE_BLOCKER,
    commands: [],
    reasons: [artifactError(
      code,
      policyIdentity.message
        ?? `Required action ${action.actionId} cannot be evaluated because the capability policy is not bound to the active task policy epoch.`,
      [taskArtifactPath(state.taskId, "actions"), eventsRel],
    )],
    requiredArtifacts: [taskArtifactPath(state.taskId, "actions"), eventsRel],
  });
}

async function evaluateProposedActionCapability({ target, packageRoot, action, approvals, authorityContext }) {
  const current = await evaluateActionCapability({ target, packageRoot, action, authorityContext });
  if (current.decision !== "REQUIRE_APPROVAL" || !approvals) return current;
  const approved = approvals.filter((approval) => approval.actionId === action.actionId && approval.status === "APPROVED");
  for (const approval of approved) {
    const evaluated = await evaluateActionCapability({
      target,
      packageRoot,
      action,
      authorityContext,
      approval: { approvalId: approval.approvalId },
    });
    if (evaluated.allowed) return evaluated;
  }
  return current;
}

async function findApplicablePendingApproval({ target, packageRoot, taskId, action, approvals }) {
  for (const approval of approvals) {
    if (approval.status !== "PENDING" || approval.actionId !== action.actionId) continue;
    try {
      return await validateApprovalForAction(target, {
        packageRoot,
        taskId,
        action,
        approvalId: approval.approvalId,
        requireApproved: false,
      });
    } catch (error) {
      if (["E_APPROVAL_STALE", "E_APPROVAL_INVALID"].includes(error.code)) continue;
      throw error;
    }
  }
  return null;
}

export function policyRecoveryAction(errors = []) {
  if (errors.some((e) => [
    "E_POLICY_WEAKENING",
    "E_POLICY_LOCK_MISMATCH",
    "E_ACTION_POLICY_DRIFT",
  ].includes(e.code))) {
    return NEXT_ACTIONS.RESTORE_POLICY;
  }
  if (errors.some((e) => e.code === "E_CHECK_MUTATION_EXECUTION_ERROR" || e.code === "E_CHECK_MUTATION_NOT_DETECTED")) {
    return NEXT_ACTIONS.REPAIR_CHECKER;
  }
  if (errors.some((e) => e.code === "E_POLICY_INVALID" || e.code === "E_POLICY_EVALUATION_FAILED")) {
    return NEXT_ACTIONS.REPAIR_POLICY;
  }
  if (errors.some((e) => e.code === "E_POLICY_DRIFT_UNKNOWN")) {
    return NEXT_ACTIONS.REVERIFY_AFTER_POLICY_CHANGE;
  }
  if (errors.some((e) => e.code === "E_BASELINE_EXPANSION")) {
    return NEXT_ACTIONS.RESTORE_BASELINE;
  }
  if (errors.some((e) => e.code === "E_BASELINE_RECORD_DURING_ACTIVE_TASK")) {
    return NEXT_ACTIONS.CONTINUE_WITH_EXISTING_BASELINE;
  }
  if (errors.some((e) => e.code === "E_CHECK_INERT")) {
    return NEXT_ACTIONS.RESOLVE_INERT_CHECK;
  }
  return null;
}

async function computeNextAction(targetOrOptions = {}, packageRootOption) {
  const normalized = typeof targetOrOptions === "string"
    ? { target: targetOrOptions, packageRoot: packageRootOption }
    : targetOrOptions;
  const { target, packageRoot, taskId: explicitTaskId, authorityContext, runtimeContext } = normalized ?? {};

  const stateRel = explicitTaskId ? taskArtifactPath(explicitTaskId, "state") : ARTIFACT_PATHS.state;
  const preflightRel = explicitTaskId ? taskArtifactPath(explicitTaskId, "preflight") : ARTIFACT_PATHS.preflight;
  const contractRel = explicitTaskId ? taskArtifactPath(explicitTaskId, "contract") : ARTIFACT_PATHS.contract;
  const routeRel = explicitTaskId ? taskArtifactPath(explicitTaskId, "route") : ARTIFACT_PATHS.route;
  const receiptRel = explicitTaskId ? taskArtifactPath(explicitTaskId, "receipt") : ARTIFACT_PATHS.receipt;
  const eventsRel = explicitTaskId ? taskArtifactPath(explicitTaskId, "events") : ARTIFACT_PATHS.events;

  const workState = await loadArtifact(
    () => readWorkState(target, { packageRoot, taskId: explicitTaskId }),
    stateRel,
  );
  if (workState.error) {
    return decision(
      {},
      NEXT_ACTIONS.RESOLVE_BLOCKER,
      artifactError("WORK_STATE_INVALID", workState.error.message, [stateRel]),
      [stateRel],
      workState.missingArtifacts,
    );
  }
  if (!workState.value) {
    const persistedPreflight = await loadArtifact(
      () => readJsonArtifact(target, preflightRel, "preflight", packageRoot),
      preflightRel,
    );
    if (!persistedPreflight.error && persistedPreflight.value?.value?.status === "READY") {
      try {
        const consistencyErrors = await validateReadyProtocolConsistency({
          target,
          packageRoot,
          taskId: explicitTaskId,
          persisted: persistedPreflight.value.value,
        });
        if (consistencyErrors.length > 0) {
          return result({
            taskId: persistedPreflight.value.value.taskId ?? explicitTaskId ?? "unknown",
            currentPhase: "ROUTED",
            nextAction: NEXT_ACTIONS.RESOLVE_BLOCKER,
            reasons: consistencyErrors,
            requiredArtifacts: [
              stateRel,
              contractRel,
              routeRel,
              preflightRel,
              eventsRel,
            ],
            missingArtifacts: [stateRel],
          });
        }
      } catch (error) {
        return result({
          taskId: persistedPreflight.value.value.taskId ?? explicitTaskId ?? "unknown",
          currentPhase: "ROUTED",
          nextAction: NEXT_ACTIONS.RESOLVE_BLOCKER,
          reasons: [artifactError(
            error.code ?? "E_PREFLIGHT_READY_INCONSISTENT",
            error.message,
            error.artifacts ?? [preflightRel, eventsRel],
          )],
          requiredArtifacts: [preflightRel, eventsRel],
        });
      }
    }
    const events = await readEvents(target, packageRoot, { taskId: explicitTaskId });
    if (events.some((event) => event.event === "DISCOVERY_STARTED")) {
      return result({
        taskId: explicitTaskId ?? "unknown",
        currentPhase: "DISCOVERING",
        nextAction: NEXT_ACTIONS.CREATE_CONTRACT,
        reasons: [artifactError("PHASE_DISCOVERING", "Create and validate the task contract", [contractRel])],
        commands: [`forgeloop contract-create --task ${explicitTaskId} --preset <documentation|bug|feature|release> --json`],
        commandSpecs: [{
          commandId: "contract-create",
          executable: "forgeloop",
          subcommand: "contract-create",
          argv: ["contract-create", `--task=${explicitTaskId}`, "--json"],
          requiredInputs: [{ name: "preset", option: "--preset=<documentation|bug|feature|release>" }],
        }],
        requiredArtifacts: [contractRel],
        missingArtifacts: [contractRel, stateRel],
      });
    }
    return result({
      taskId: explicitTaskId ?? "unknown",
      currentPhase: "RECEIVED",
      nextAction: NEXT_ACTIONS.DISCOVER,
      reasons: [artifactError("WORK_STATE_ABSENT", "No work-state checkpoint is present", [stateRel])],
      commands: [`forgeloop discover --task ${explicitTaskId} --json`],
      commandSpecs: [{
        commandId: "discover",
        executable: "forgeloop",
        subcommand: "discover",
        argv: ["discover", `--task=${explicitTaskId}`, "--json"],
        requiredInputs: [],
      }],
      requiredArtifacts: [stateRel],
      missingArtifacts: [stateRel],
    });
  }

  return resolveNextActionPhase({
    target,
    packageRoot,
    explicitTaskId,
    normalized,
    state: workState.value,
    context: { taskId: workState.value.taskId, currentPhase: workState.value.phase },
    stateRel,
    preflightRel,
    contractRel,
    routeRel,
    receiptRel,
    eventsRel,
    authorityContext,
    runtimeContext,
    helpers: {
      capabilityDecisionMetadata,
      actionApprovalGuidance,
      actionAuthorityGuidance,
      actionApprovalResolutionGuidance,
      actionDeniedGuidance,
      actionPolicyEpochGuidance,
      authorizeActionGuidance,
      evaluateProposedActionCapability,
      findApplicablePendingApproval,
      policyRecoveryAction,
    },
  });
}

export async function getNextAction(targetOrOptions = {}, packageRootOption) {
  const res = await computeNextAction(targetOrOptions, packageRootOption);
  if (res && res.reasons && res.reasons.some((r) => r.code === "E_CONTRACT_UNRESOLVED_DECISION" || r.code === "E_UNRESOLVED_DECISION")) {
    const normalized = typeof targetOrOptions === "string" ? { target: targetOrOptions, packageRoot: packageRootOption } : targetOrOptions;
    const { target, packageRoot, taskId } = normalized ?? {};
    try {
      const explicitTaskId = taskId ?? null;
      const contract = await readContract(target, packageRoot, { taskId: explicitTaskId });
      const events = await readEvents(target, packageRoot, { taskId: explicitTaskId });
      if (contract?.value?.unresolvedDecisions?.length > 0) {
        const foundCriteria = [];
        for (const dec of contract.value.unresolvedDecisions) {
          const criterion = criterionForDecision(events, res.taskId, dec, contract.fingerprint);
          if (criterion) {
            foundCriteria.push({
              decisionId: criterion.decisionId,
              decision: dec,
              settledBy: criterion.settledBy,
            });
          }
        }

        if (foundCriteria.length > 0) {
          let resolution;
          if (foundCriteria.length === 1) {
            resolution = {
              kind: "SETTLEMENT_CRITERION",
              itemId: foundCriteria[0].decisionId,
              decision: foundCriteria[0].decision,
              settledBy: foundCriteria[0].settledBy,
            };
          } else {
            resolution = {
              kind: "SETTLEMENT_CRITERIA",
              items: foundCriteria,
            };
          }

          const enrichedReasons = res.reasons.map((r) => {
            if (r.code === "E_CONTRACT_UNRESOLVED_DECISION" || r.code === "E_UNRESOLVED_DECISION") {
              return {
                ...r,
                resolution,
              };
            }
            return r;
          });

          return result({
            ...res,
            reasons: enrichedReasons,
          });
        }
      }
    } catch {
      // Ignore read errors
    }
  }
  return res;
}
