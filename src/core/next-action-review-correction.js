import { validateEventLedger } from "./events.js";
import { resolveCurrentCycleDiagnostic } from "./diagnostic-projection.js";
import { hasCurrentReview, reviewFailures } from "./review-correction.js";
import { NEXT_ACTIONS, decision, recordCheckCommandSpec, recordDiagnosisCommandSpec, result } from "./next-action-model.js";
import { artifactError } from "./next-action-artifacts.js";

export async function reviewCorrectionAction({ target, packageRoot, taskId, state, context, requiredArtifacts }) {
  const failures = reviewFailures(state);
  if (state.phase === "REVIEWING" && failures.length === 0) return null;
  const ledger = await validateEventLedger(target, packageRoot, { taskId });
  if (!ledger.valid || !hasCurrentReview(state, ledger.events)) return null;
  if (failures.length === 0) {
    return result({ ...context, nextAction: NEXT_ACTIONS.RECORD_VERIFICATION,
      reasons: [artifactError("E_REVIEW_FINDING_REQUIRED", "Record an observed failed or blocked review finding before diagnosis or retry")],
      commandSpecs: [recordCheckCommandSpec("<reviewed requirement>")], requiredArtifacts });
  }
  const diagnosis = resolveCurrentCycleDiagnostic(ledger.events, state.taskId, state.verificationCycle);
  if (!diagnosis) {
    return result({ ...context, nextAction: NEXT_ACTIONS.RECORD_DIAGNOSIS,
      reasons: [artifactError("E_DIAGNOSIS_REQUIRED", "Diagnose the failed review finding using evidence from the current verification cycle")],
      commandSpecs: [recordDiagnosisCommandSpec()], requiredArtifacts });
  }
  return state.phase === "REVIEWING"
    ? decision(context, NEXT_ACTIONS.CORRECT, artifactError("PHASE_REVIEWING", "The diagnosed review finding requires correction"))
    : null;
}
