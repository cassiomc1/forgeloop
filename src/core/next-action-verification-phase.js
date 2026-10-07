import { receiptReadFailure } from "./completion.js";
import { readJsonArtifact } from "./artifacts.js";
import { taskArtifactPath, taskStructuralQualityDirectory } from "./task-paths.js";
import { validateReceipt } from "./receipt.js";
import { completionRelationshipErrors } from "./completion-relationships.js";
import { evaluateRequiredEvidence, authoritativeChecksForRequirements, ordinaryLeafRequirements } from "./evidence-readiness.js";
import { NEXT_ACTIONS, commandFor, decision, recordCheckCommandSpec, result } from "./next-action-model.js";
import { artifactError, checkListReasons, loadArtifact, requirementsAndCoverage } from "./next-action-artifacts.js";
import { projectStructuralQualityStatus } from "./structural-quality/service.js";
import { structuralQualityOptionalActions } from "./next-action-quality-guidance.js";

export async function resolveVerifyingPhase({ target, packageRoot, explicitTaskId, state, runtimeContext, context, requiredArtifacts, contract, route, preflight, authorityContext, stateRel, receiptRel }) {
    const quality = await projectStructuralQualityStatus({ target, packageRoot, taskId: explicitTaskId ?? state.taskId, runtimeContext });
    if (quality.mode === "gate") {
      if (quality.baseline.status !== "OBSERVED") {
        return result({
          ...context,
          nextAction: NEXT_ACTIONS.RESOLVE_STRUCTURAL_QUALITY_BLOCKER,
          reasons: [artifactError("E_STRUCTURAL_QUALITY_BASELINE_MISSING", "Structural-quality gate cannot verify without its immutable baseline", [taskArtifactPath(state.taskId, "structuralQuality")])],
          requiredArtifacts: [taskArtifactPath(state.taskId, "structuralQuality")],
        });
      }
      if (!quality.current.artifactRef || quality.current.verificationCycle !== (state.verificationCycle ?? 1)) {
        return result({
          ...context,
          nextAction: NEXT_ACTIONS.VERIFY_STRUCTURAL_QUALITY,
          commands: [commandFor(NEXT_ACTIONS.VERIFY_STRUCTURAL_QUALITY).replace("<id>", state.taskId)],
          reasons: [artifactError("E_STRUCTURAL_QUALITY_EVIDENCE_STALE", "The current verification cycle has no structural-quality evaluation", [taskStructuralQualityDirectory(state.taskId)])],
          requiredArtifacts: [taskStructuralQualityDirectory(state.taskId)],
        });
      }
      if (quality.freshness === "STALE") {
        return result({
          ...context,
          nextAction: NEXT_ACTIONS.VERIFY_STRUCTURAL_QUALITY,
          commands: [commandFor(NEXT_ACTIONS.VERIFY_STRUCTURAL_QUALITY).replace("<id>", state.taskId)],
          reasons: [artifactError("E_STRUCTURAL_QUALITY_EVIDENCE_STALE", "Structural-quality evidence is stale; fresh verification is required before review", [quality.current.artifactRef])],
          requiredArtifacts: [taskStructuralQualityDirectory(state.taskId)],
        });
      }
      if (quality.current.status === "FAIL") {
        return decision(context, NEXT_ACTIONS.DIAGNOSE_STRUCTURAL_QUALITY_REGRESSION, artifactError("E_STRUCTURAL_QUALITY_REGRESSION", "Structural-quality verification detected a regression", [quality.current.artifactRef]));
      }
      if (quality.current.status === "BLOCKED") {
        return decision(context, NEXT_ACTIONS.RESOLVE_STRUCTURAL_QUALITY_BLOCKER, artifactError("E_STRUCTURAL_QUALITY_EVALUATION_INCOMPARABLE", "Structural-quality verification is blocked", [quality.current.artifactRef]));
      }
    }
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
    const authoritative = authoritativeChecksForRequirements({
      requirements: ordinaryLeafRequirements(evidence.requirements),
      checks: state.checks,
    });
    const failed = authoritative.find(({ check }) => check?.status === "failed");
    if (failed) {
      return decision(
        context,
        NEXT_ACTIONS.DIAGNOSE,
        artifactError("E_CHECK_FAILED", `Observed check failed: ${failed.check.id}`, [stateRel]),
      );
    }
    const blocked = authoritative.find(({ check }) => check?.status === "blocked");
    if (blocked) {
      return decision(
        context,
        NEXT_ACTIONS.RESOLVE_BLOCKER,
        artifactError("E_CHECK_BLOCKED", `Observed check is blocked: ${blocked.check.id}`, [stateRel]),
      );
    }
    const receipt = await loadArtifact(
      () => readJsonArtifact(target, receiptRel, "execution-receipt", packageRoot),
      receiptRel,
    );
    if (receipt.error) {
      if (receipt.error.code === "ARTIFACT_MISSING") {
        return decision(
          context,
          NEXT_ACTIONS.PREPARE_COMPLETION,
          artifactError("E_RECEIPT_MISSING", "Prepare the execution receipt before recording verification checks", [receiptRel]),
          [...requiredArtifacts, receiptRel],
          receipt.missingArtifacts,
        );
      }
      return decision(
        context,
        NEXT_ACTIONS.RESOLVE_BLOCKER,
        receiptReadFailure(receipt.error, receiptRel),
        [...requiredArtifacts, receiptRel],
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
    const readiness = evaluateRequiredEvidence({
      requirements: evidence.requirements,
      checks: state.checks,
      target,
      taskId: contract?.value?.taskId,
      options: { authorityContext, runtimeContext },
    });
    const receiptRelationships = completionRelationshipErrors({
      contract,
      route,
      state,
      receipt: receipt.value.value,
      requiredEvidence: evidence.requirements,
      requireRequiredChecks: false,
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
    if (readiness.ready) {
      return decision(
        context,
        NEXT_ACTIONS.ENTER_REVIEWING,
        artifactError("EVIDENCE_COVERED", "All required observed verification evidence is covered"),
        [],
        [],
        structuralQualityOptionalActions(quality, state.taskId),
      );
    }
    const uncovered = [...readiness.invalid, ...readiness.partial, ...readiness.missing];
    return result({
      ...context,
      nextAction: NEXT_ACTIONS.RECORD_VERIFICATION,
      commands: ["forgeloop record-check"],
      commandSpecs: uncovered.map((item) => recordCheckCommandSpec(item.text)),
      reasons: uncovered
        .map((item) => artifactError(
          readiness.invalid.some((candidate) => candidate.id === item.id)
            ? "E_EVIDENCE_INVALID"
            : readiness.partial.some((candidate) => candidate.id === item.id)
              ? "E_EVIDENCE_PARTIAL"
              : "E_EVIDENCE_REQUIRED",
          "Run the required check and record observed evidence through the structured command specification.",
          [stateRel],
        )),
      requiredArtifacts: requiredArtifacts,
      optionalActions: structuralQualityOptionalActions(quality, state.taskId),
    });
  }
