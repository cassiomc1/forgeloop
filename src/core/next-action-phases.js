import { resolveVerifyingPhase } from "./next-action-verification-phase.js";
import { resolveReviewingPhase } from "./next-action-review-phase.js";
import { resolveDiagnosingPhase, resolveCorrectingPhase } from "./next-action-recovery-phases.js";
import { resolvePlannedPhase } from "./next-action-planned-phase.js";
import { resolvePendingActionGuidance } from "./next-action-pending-actions.js";
import { preExecutionRefreshGuidance } from "./next-action-refresh.js";
import { ARTIFACT_PATHS, readJsonArtifact } from "./artifacts.js";
import { taskArtifactPath } from "./task-paths.js";
import { completionIdentityErrors, evaluateCompletion } from "./completion.js";
import { readContract } from "./contract.js";
import { evaluatePreflight, validatePersistedPreflight } from "./preflight.js";

import { readPersistedRoute } from "./route-artifact.js";

import { classifyLoadedWorkState } from "./work-state.js";

import { evaluateStartExecutionPrerequisites } from "./execution-prerequisites.js";

import { NEXT_ACTIONS, commandFor, decision, recoveryGuidanceForClassification, result, uniqueSorted } from "./next-action-model.js";
import { artifactError, freshnessReasons, loadArtifact, staleReasons } from "./next-action-artifacts.js";

import { inspectTaskConflictState } from "./task-conflict-inspection.js";

import { evaluateContinuityNextAction } from "./next-action-continuity.js";

export const PHASES_REQUIRING_EXECUTION_CHRONOLOGY = new Set([
  "EXECUTING",
  "VERIFYING",
  "DIAGNOSING",
  "CORRECTING",
  "REVIEWING",
  "COMPLETE",
]);

export function phaseRequiresExecutionChronology(phase) {
  return PHASES_REQUIRING_EXECUTION_CHRONOLOGY.has(phase);
}

export async function resolveNextActionPhase({
  target,
  packageRoot,
  explicitTaskId,
  normalized,
  state,
  context,
  stateRel,
  preflightRel,
  contractRel,
  routeRel,
  receiptRel,
  eventsRel,
  authorityContext,
  runtimeContext,
  helpers,
} = {}) {
  const { policyRecoveryAction } = helpers;
  if (explicitTaskId) {
    let inspection;
    try {
      inspection = await inspectTaskConflictState(target, {
        taskId: explicitTaskId,
        packageRoot,
      });
    } catch (error) {
      inspection = {
        classification: "INCONSISTENT",
        reasonCodes: [error.code ?? "E_TASK_RECOVERY_INCONSISTENT"],
      };
    }
    if (!["ACTIVE", "COMPLETE"].includes(inspection.classification)) {
      const guidance = recoveryGuidanceForClassification(inspection.classification, explicitTaskId);
      return result({
        ...context,
        nextAction: guidance.nextAction,
        commands: guidance.commands,
        commandSpecs: guidance.commandSpecs,
        reasons: inspection.reasonCodes.map((code) => artifactError(
          code,
          `Task conflict state is ${inspection.classification}; follow the structured recovery guidance.`,
          [stateRel, eventsRel, taskArtifactPath(explicitTaskId, "recovery")],
        )),
        requiredArtifacts: [stateRel, eventsRel],
      });
    }
  }
  const actionGuidance = await resolvePendingActionGuidance({ target, packageRoot, state, context, eventsRel, authorityContext, runtimeContext, helpers });
  if (actionGuidance) return actionGuidance;
  if (state.phase === "RECEIVED") {
    return decision(
      context,
      NEXT_ACTIONS.DISCOVER,
      artifactError("PHASE_RECEIVED", "Discovery has not started"),
      [stateRel],
    );
  }
  if (state.phase === "DISCOVERING") {
    return decision(
      context,
      NEXT_ACTIONS.CREATE_CONTRACT,
      artifactError("PHASE_DISCOVERING", "Create and validate the task contract"),
      [stateRel],
    );
  }
  const contractResult = await loadArtifact(
    () => readContract(target, packageRoot, { taskId: explicitTaskId }),
    contractRel,
  );
  const contractArtifacts = [stateRel, contractRel];

  if (contractResult.error) {
    return result({
      ...context,
      nextAction: NEXT_ACTIONS.RESOLVE_BLOCKER,
      reasons: [artifactError(
        contractResult.error.code === "ARTIFACT_MISSING" ? "E_CONTRACT_MISSING" : "E_CONTRACT_INVALID",
        contractResult.error.message,
        contractResult.error.artifacts ?? [],
      )],
      requiredArtifacts: contractArtifacts,
      missingArtifacts: contractResult.missingArtifacts,
    });
  }

  const contract = contractResult.value;
  const identityErrors = completionIdentityErrors({ contract: contract.value, state });
  if (identityErrors.length > 0) {
    return result({
      ...context,
      nextAction: NEXT_ACTIONS.RESOLVE_BLOCKER,
      reasons: identityErrors,
      requiredArtifacts: contractArtifacts,
    });
  }
  const freshness = await classifyLoadedWorkState({
    target,
    state,
    contractFile: contractRel,
  });
  if (freshness.status === "REVALIDATION_REQUIRED") {
    const refreshGuidance = await preExecutionRefreshGuidance({ target, packageRoot, state, contract });
    return result({
      ...context,
      ...refreshGuidance,
      nextAction: NEXT_ACTIONS.RESOLVE_BLOCKER,
      reasons: freshnessReasons(state, freshness),
      requiredArtifacts: uniqueSorted([
        stateRel,
        contractRel,
        ...(state.requiredArtifacts?.map((artifact) => artifact.path) ?? []),
      ]),
    });
  }
  if (state.phase === "CONTRACT_READY") {
    return result({
      ...context,
      nextAction: NEXT_ACTIONS.ROUTE,
      reasons: [artifactError("PHASE_CONTRACT_READY", "Persist deterministic routing for the validated contract")],
      commands: [`forgeloop route --task ${explicitTaskId} --work <type> --json`],
      commandSpecs: [{
        commandId: "route",
        executable: "forgeloop",
        subcommand: "route",
        argv: ["route", `--task=${explicitTaskId}`, "--json"],
        requiredInputs: [
          { name: "workType", option: "--work=<type>" },
          { name: "surface", option: "--surface=<value>", repeatable: true, optional: true },
          { name: "risk", option: "--risk=<value>", repeatable: true, optional: true },
          { name: "platform", option: "--platform=<value>", repeatable: true, optional: true },
        ],
      }],
      requiredArtifacts: contractArtifacts,
      missingArtifacts: [routeRel],
    });
  }
  const routeResult = await loadArtifact(
    () => readPersistedRoute(target, packageRoot, { taskId: explicitTaskId }),
    routeRel,
  );
  const requiredArtifacts = [...contractArtifacts, routeRel];
  const missingArtifacts = [...routeResult.missingArtifacts];

  if (routeResult.error) {
    return result({
      ...context,
      nextAction: NEXT_ACTIONS.RESOLVE_BLOCKER,
      reasons: [artifactError(
        routeResult.error.code === "ARTIFACT_MISSING" ? "E_ROUTE_MISSING" : "E_ROUTE_INVALID",
        routeResult.error.message,
        routeResult.error.artifacts ?? [],
      )],
      requiredArtifacts,
      missingArtifacts,
    });
  }

  const route = routeResult.value;
  const stale = staleReasons(state, contract, route);
  if (stale.length > 0) {
    return result({
      ...context,
      nextAction: NEXT_ACTIONS.RESOLVE_STALE_ROUTE,
      reasons: stale,
      requiredArtifacts,
    });
  }

  const phaseNeedsChronology = PHASES_REQUIRING_EXECUTION_CHRONOLOGY.has(state.phase);
  let executionPrerequisites = null;
  if (phaseNeedsChronology) {
    try {
      executionPrerequisites = await evaluateStartExecutionPrerequisites({ target, state, packageRoot, taskId: explicitTaskId, runtimeContext });
    } catch (error) {
      return result({
        ...context,
        nextAction: NEXT_ACTIONS.RESOLVE_BLOCKER,
        reasons: [artifactError(
          error?.code ?? "E_PHASE_CHRONOLOGY_INVALID",
          `Unable to evaluate post-execution prerequisites: ${error?.message ?? String(error)}`,
          Array.isArray(error?.artifacts) ? error.artifacts : [eventsRel],
        )],
        requiredArtifacts: [
          stateRel,
          contractRel,
          routeRel,
          preflightRel,
          eventsRel,
        ],
      });
    }
    if (executionPrerequisites.errors.length > 0) {
      return result({
        ...context,
        nextAction: NEXT_ACTIONS.RESOLVE_BLOCKER,
        reasons: executionPrerequisites.errors,
        requiredArtifacts: executionPrerequisites.requiredArtifacts,
      });
    }
  }

  const preflight = executionPrerequisites?.preflight ?? await evaluatePreflight({ target, packageRoot, taskId: explicitTaskId });
  const preflightArtifact = phaseNeedsChronology
    ? null
    : await loadArtifact(
      () => readJsonArtifact(target, preflightRel, "preflight", packageRoot),
      preflightRel,
    );
  const missingGates = preflight.requiredGates.filter((gate) => !preflight.satisfiedGates.includes(gate));
  const preflightArtifacts = [...requiredArtifacts, preflightRel];
  const persistedPreflightErrors = phaseNeedsChronology
    ? []
    : validatePersistedPreflight(preflightArtifact.value?.value, preflight);

  if (["ROUTED", "DESIGNING", "PLANNED"].includes(state.phase) && missingGates.length > 0) {
    return result({
      ...context,
      nextAction: NEXT_ACTIONS.SATISFY_GATES,
      reasons: missingGates.map((gate) => artifactError(
        "E_GATE_UNVERIFIED",
        `Required gate is missing or unverified: ${gate}`,
        [`${ARTIFACT_PATHS.gates}/${gate}.json`],
      )),
      requiredArtifacts: [...preflightArtifacts, ...missingGates.map((gate) => `${ARTIFACT_PATHS.gates}/${gate}.json`)],
      missingArtifacts: missingGates.map((gate) => `${ARTIFACT_PATHS.gates}/${gate}.json`),
    });
  }
  if (state.phase === "ROUTED") {
    if (persistedPreflightErrors.length > 0) {
      return result({
        ...context,
        nextAction: NEXT_ACTIONS.RUN_PREFLIGHT,
        reasons: persistedPreflightErrors,
        commands: [commandFor(NEXT_ACTIONS.RUN_PREFLIGHT)],
        requiredArtifacts: preflightArtifacts,
        missingArtifacts: preflightArtifact.missingArtifacts,
      });
    }
    return decision(context, NEXT_ACTIONS.PLAN, artifactError("PHASE_ROUTED", "Routing and required gates are ready for planning"));
  }
  if (state.phase === "DESIGNING") {
    return decision(context, NEXT_ACTIONS.PLAN, artifactError("PHASE_DESIGNING", "Required gates are ready for planning"));
  }
  if (state.phase === "PLANNED") {
    return resolvePlannedPhase({ target, packageRoot, explicitTaskId, state, runtimeContext, context, preflightArtifact });
  }
  if (state.phase === "EXECUTING") {
    const continuityAction = await evaluateContinuityNextAction({ target, packageRoot, context });
    if (continuityAction) return continuityAction;
    return decision(context, NEXT_ACTIONS.ENTER_VERIFYING, artifactError("PHASE_EXECUTING", "Execution is complete enough to enter verification"));
  }
  if (state.phase === "VERIFYING") {
    return resolveVerifyingPhase({ target, packageRoot, explicitTaskId, state, runtimeContext, context, requiredArtifacts, contract, route, preflight, authorityContext, stateRel, receiptRel });
  }
  if (state.phase === "DIAGNOSING") {
    return resolveDiagnosingPhase({ target, packageRoot, normalized, state, context, eventsRel, requiredArtifacts, stateRel });
  }
  if (state.phase === "CORRECTING") {
    return resolveCorrectingPhase({ target, packageRoot, normalized, state, context, requiredArtifacts });
  }
  if (state.phase === "REVIEWING") {
    return resolveReviewingPhase({ state, context, requiredArtifacts, target, packageRoot, contract, route, preflight, authorityContext, runtimeContext, explicitTaskId, eventsRel, receiptRel, stateRel, policyRecoveryAction });
  }
  if (state.phase === "COMPLETE") {
    const completion = await evaluateCompletion({ target, packageRoot, taskId: explicitTaskId, authorityContext, runtimeContext });
    if (completion.status === "VALID") {
      return decision(context, NEXT_ACTIONS.NONE, artifactError("PHASE_COMPLETE", "Completion is validator-backed and terminal"));
    }
    const policyAction = policyRecoveryAction(completion.errors);
    return result({
      ...context,
      nextAction: policyAction ?? NEXT_ACTIONS.RESOLVE_BLOCKER,
      reasons: completion.errors,
      requiredArtifacts: [...requiredArtifacts, receiptRel, eventsRel],
    });
  }
  if (state.phase === "BLOCKED") {
    return result({
      ...context,
      nextAction: NEXT_ACTIONS.RESOLVE_BLOCKER,
      reasons: state.blockers.map((blocker) => artifactError(
        "WORK_STATE_BLOCKED",
        blocker.reason ?? "Work state has a recorded blocker",
        [stateRel],
      )),
      requiredArtifacts,
    });
  }

  return decision(
    context,
    NEXT_ACTIONS.RESOLVE_BLOCKER,
    artifactError("E_PHASE_UNSUPPORTED", `Unsupported persisted phase: ${state.phase}`, [ARTIFACT_PATHS.state]),
    requiredArtifacts,
  );
}
