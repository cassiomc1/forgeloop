import { validateEventLedger } from "./events.js";
import { NEXT_ACTIONS, commandFor, decision, recordDiagnosisCommandSpec, recordInterventionCommandSpec, result } from "./next-action-model.js";
import { artifactError } from "./next-action-artifacts.js";
import { resolveCurrentCycleDiagnostic } from "./diagnostic-projection.js";
import { buildTaskReflection } from "./reflection.js";
import { evaluateProgress, PROGRESS_STATUS } from "./progress.js";
import { reviewCorrectionAction } from "./next-action-review-correction.js";

export async function resolveDiagnosingPhase({ target, packageRoot, normalized, state, context, eventsRel, requiredArtifacts, stateRel }) {
    const ledger = await validateEventLedger(target, packageRoot, { taskId: normalized.taskId ?? null });
    const cycle = state.verificationCycle ?? 1;
    const diagEvent = resolveCurrentCycleDiagnostic(ledger.events, state.taskId, cycle);
    if (!diagEvent) {
      return result({
        ...context,
        nextAction: NEXT_ACTIONS.RECORD_DIAGNOSIS,
        reasons: [
          artifactError(
            "E_DIAGNOSIS_REQUIRED",
            "Current correction cycle has no append-only diagnosis record.",
            [eventsRel],
          ),
        ],
        commandSpecs: [recordDiagnosisCommandSpec()],
        requiredArtifacts: [...requiredArtifacts, eventsRel],
      });
    }
    const progress = evaluateProgress({ state, events: ledger.events });
    if (progress.status === PROGRESS_STATUS.STALLED) {
      let oscillating = false;
      try {
        const reflection = await buildTaskReflection({ target, packageRoot, taskId: normalized.taskId ?? null });
        oscillating = reflection.oscillation.detected;
      } catch {
        // Reflection is advisory guidance; stall handling must not depend on it.
      }
      return result({
        ...context,
        nextAction: NEXT_ACTIONS.CHANGE_STRATEGY,
        reasons: [
          artifactError(
            "E_PROGRESS_STALLED",
            "The current correction strategy has no new diagnostic information.",
            [stateRel, eventsRel],
          ),
        ],
        progress,
        diagnosticGuidance: {
          action: oscillating ? NEXT_ACTIONS.INTRODUCE_NEW_OBSERVATION : NEXT_ACTIONS.REQUIRE_NEW_DIAGNOSTIC_INFORMATION,
          signals: oscillating ? ["OSCILLATING_STRATEGY"] : ["NO_INFORMATION_GAIN", ...progress.signals.map((signal) => signal.code)],
          errorCodes: oscillating ? ["E_STRATEGY_OSCILLATION", "E_PROGRESS_STALLED"] : ["E_PROGRESS_STALLED"],
        },
        requiredArtifacts,
      });
    }
    return result({
      ...context,
      nextAction: NEXT_ACTIONS.CORRECT,
      commands: [commandFor(NEXT_ACTIONS.CORRECT)],
      reasons: [
        artifactError("PHASE_DIAGNOSING", "The persisted diagnosis hypothesis permits correction"),
      ],
      ...(progress.status === PROGRESS_STATUS.WATCH ? { progress } : {}),
      requiredArtifacts,
    });
  }

export async function resolveCorrectingPhase({ target, packageRoot, normalized, state, context, requiredArtifacts }) {
    const correction = await reviewCorrectionAction({ target, packageRoot, taskId: normalized.taskId ?? null, state, context, requiredArtifacts });
    if (correction) return correction;
    const ledgerForCorrection = await validateEventLedger(target, packageRoot, { taskId: normalized.taskId ?? null });
    const correctionCycle = state.verificationCycle ?? 1;
    const hasStructuredCase = ledgerForCorrection.events.some(
      (event) => event.event === "DIAGNOSTIC_CASE_RECORDED"
        && event.taskId === state.taskId
        && event.details?.verificationCycle === correctionCycle,
    );
    const hasIntervention = ledgerForCorrection.events.some(
      (event) => event.event === "INTERVENTION_RECORDED"
        && event.taskId === state.taskId
        && event.details?.verificationCycle === correctionCycle,
    );
    if (hasStructuredCase && !hasIntervention) {
      return result({
        ...context,
        nextAction: NEXT_ACTIONS.ENTER_VERIFYING,
        reasons: [
          artifactError("PHASE_CORRECTING", "A structured diagnostic case is awaiting a recorded intervention"),
        ],
        diagnosticGuidance: {
          action: NEXT_ACTIONS.RECORD_INTERVENTION,
          signals: ["INTERVENTION_NOT_BOUND_TO_HYPOTHESIS"],
          errorCodes: [],
          commandSpecs: [recordInterventionCommandSpec(normalized.taskId)],
        },
        requiredArtifacts,
      });
    }
    return decision(context, NEXT_ACTIONS.ENTER_VERIFYING, artifactError("PHASE_CORRECTING", "Correction is ready for verification"));
  }
