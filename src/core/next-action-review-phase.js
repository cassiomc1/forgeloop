import { readJsonArtifact } from "./artifacts.js";
import { evaluateCompletion } from "./completion.js";
import { validateReceipt } from "./receipt.js";
import { completionRelationshipErrors } from "./completion-relationships.js";
import { evaluateRequiredEvidence, classifyRequirement, terminalRequirementsForContract } from "./evidence-readiness.js";
import { validateEventLedger, validateCompletionRecoveryAuthorization } from "./events.js";
import { NEXT_ACTIONS, commandFor, decision, recordTerminalResultCommandSpec, result } from "./next-action-model.js";
import { artifactError, checkListReasons, loadArtifact, requirementsAndCoverage } from "./next-action-artifacts.js";

export async function resolveReviewingPhase({ state, context, requiredArtifacts, target, packageRoot, contract, route, preflight, authorityContext, runtimeContext, explicitTaskId, eventsRel, receiptRel, stateRel, policyRecoveryAction }) {
    const invalidChecks = checkListReasons(state);
    if (invalidChecks.length > 0) {
      return result({
        ...context,
        nextAction: NEXT_ACTIONS.RESOLVE_BLOCKER,
        reasons: invalidChecks,
        requiredArtifacts,
      });
    }
    const evidence = await requirementsAndCoverage({
      target,
      packageRoot,
      contract,
      route,
      checks: state.checks,
      additionalEvidence: preflight.policy?.requiredEvidence ?? [],
      authorityContext,
      runtimeContext,
    });
    const readiness = evaluateRequiredEvidence({
      requirements: evidence.requirements,
      checks: state.checks,
      target,
      taskId: contract?.value?.taskId,
      options: { authorityContext, runtimeContext },
    });
    if (!readiness.ready) {
      let recoveryAuthorized = false;
      if (state.lastCompletionAttempt?.status === "REJECTED") {
        try {
          const ledger = await validateEventLedger(target, packageRoot, { taskId: explicitTaskId, eventsPath: eventsRel });
          let currentReceipt = null;
          try {
            const receiptArtifact = await readJsonArtifact(target, receiptRel, "execution-receipt", packageRoot);
            currentReceipt = receiptArtifact?.value;
          } catch {}
          const recoveryAuth = validateCompletionRecoveryAuthorization({
            state,
            receipt: currentReceipt,
            events: ledger.events,
          });
          recoveryAuthorized = recoveryAuth.authorized;
        } catch {
          recoveryAuthorized = false;
        }
      }
      return result({
        ...context,
        nextAction: recoveryAuthorized
          ? NEXT_ACTIONS.ENTER_VERIFYING
          : NEXT_ACTIONS.RESOLVE_BLOCKER,
        commands: recoveryAuthorized
          ? [commandFor(NEXT_ACTIONS.ENTER_VERIFYING)]
          : [],
        reasons: [...readiness.invalid, ...readiness.partial, ...readiness.missing]
          .map((item) => artifactError(
            readiness.missing.some((candidate) => candidate.id === item.id)
              ? "E_EVIDENCE_REQUIRED"
              : item.reasonCode ?? "E_EVIDENCE_PARTIAL",
            `Evidence is not ready: ${item.text}`,
            [stateRel],
          )),
        requiredArtifacts,
      });
    }
    const receipt = await loadArtifact(
      () => readJsonArtifact(target, receiptRel, "execution-receipt", packageRoot),
      receiptRel,
    );
    if (receipt.error) {
      if (receipt.error.code !== "ARTIFACT_MISSING") {
        return decision(
          context,
          NEXT_ACTIONS.RESOLVE_BLOCKER,
          artifactError("E_RECEIPT_INVALID", `Repair or remove the invalid execution receipt before continuing: ${receipt.error.message}`, [receiptRel]),
          [...requiredArtifacts, receiptRel],
        );
      }
      return decision(
        context,
        NEXT_ACTIONS.PREPARE_COMPLETION,
        artifactError(
          receipt.error.code === "ARTIFACT_MISSING" ? "E_RECEIPT_MISSING" : "E_RECEIPT_INVALID",
          receipt.error.message,
          [receiptRel],
        ),
        [...requiredArtifacts, receiptRel],
        receipt.missingArtifacts,
      );
    }
    try {
      await validateReceipt(receipt.value.value, packageRoot, {
        target,
        taskId: contract?.value?.taskId,
        authorityContext,
        runtimeContext,
      });
    } catch (error) {
      return decision(
        context,
        NEXT_ACTIONS.RESOLVE_BLOCKER,
        artifactError("E_RECEIPT_INVALID", `Repair or remove the invalid execution receipt before continuing: ${error.message}`, [receiptRel]),
        [...requiredArtifacts, receiptRel],
      );
    }
    const receiptRelationships = completionRelationshipErrors({
      contract,
      route,
      state,
      receipt: receipt.value.value,
      requiredEvidence: evidence.requirements,
      target,
      taskId: contract?.value?.taskId,
      authorityContext,
      runtimeContext,
    });
    if (receiptRelationships.length > 0) {
      if (receiptRelationships.some((err) => (
        err.code === "E_RECEIPT_STATE_MISMATCH"
        || err.code === "E_RECEIPT_CYCLE_MISMATCH"
        || err.code === "E_RECEIPT_CONTRACT_MISMATCH"
        || err.code === "E_ROUTE_GUIDE_MISMATCH"
        || err.code === "E_EVIDENCE_COVERAGE_INVALID"
      ))) {
        return decision(
          context,
          NEXT_ACTIONS.PREPARE_COMPLETION,
          artifactError("E_RECEIPT_STATE_MISMATCH", "Run forgeloop prepare-completion to refresh the execution receipt with current state", [receiptRel]),
          [...requiredArtifacts, receiptRel],
        );
      }
      return result({
        ...context,
        nextAction: NEXT_ACTIONS.RESOLVE_BLOCKER,
        reasons: receiptRelationships,
        requiredArtifacts: [...requiredArtifacts, receiptRel],
      });
    }

    const completion = await evaluateCompletion({ target, packageRoot, taskId: explicitTaskId, authorityContext, runtimeContext });
    if (completion.status !== "VALID") {
      const terminalPendingErrors = completion.errors.filter((err) => (
        err.code === "E_PUBLICATION_REQUIREMENT_PENDING" || err.code === "E_PRODUCTION_REQUIREMENT_PENDING"
      ));
      if (terminalPendingErrors.length > 0 && terminalPendingErrors.length === completion.errors.length) {
        const canonicalTerminalRequirements = terminalRequirementsForContract(contract.value, {
          additionalEvidence: preflight.policy?.requiredEvidence ?? [],
        });
        const terminalPendingReqs = terminalPendingErrors.map((err) => {
          const reqId = err.requirementId;
          const matchingReq = canonicalTerminalRequirements.find((r) => r.id === reqId)
            ?? canonicalTerminalRequirements.find((r) => r.text === reqId)
            ?? evidence.requirements.find((r) => r.id === reqId)
            ?? evidence.requirements.find((r) => r.text === reqId)
            ?? classifyRequirement(reqId ?? err.message);
          return matchingReq;
        });
        return result({
          ...context,
          nextAction: NEXT_ACTIONS.RECORD_TERMINAL_RESULT,
          commands: ["forgeloop record-terminal-result"],
          commandSpecs: terminalPendingReqs.map(recordTerminalResultCommandSpec),
          reasons: completion.errors,
          requiredArtifacts: [...requiredArtifacts, receiptRel, eventsRel],
        });
      }
      const policyAction = policyRecoveryAction(completion.errors);
      if (policyAction) {
        return result({
          ...context,
          nextAction: policyAction,
          reasons: completion.errors,
          requiredArtifacts: [...requiredArtifacts, receiptRel, eventsRel],
        });
      }
      return result({
        ...context,
        nextAction: NEXT_ACTIONS.RESOLVE_BLOCKER,
        reasons: completion.errors,
        requiredArtifacts: [...requiredArtifacts, receiptRel, eventsRel],
      });
    }
    return decision(context, NEXT_ACTIONS.RUN_COMPLETE, artifactError("COMPLETION_READY", "Completion artifacts and cross-artifact validation are valid"));
  }
