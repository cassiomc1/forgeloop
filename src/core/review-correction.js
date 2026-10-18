export function isReviewCorrection(state) {
  return state.phase === "REVIEWING"
    || (state.phase === "CORRECTING" && state.previousPhase === "REVIEWING");
}

export function hasCurrentReview(state, events) {
  return isReviewCorrection(state) && events.some((event) => event.taskId === state.taskId
    && event.event === "REVIEW_STARTED"
    && event.details?.verificationCycle === state.verificationCycle);
}

export function reviewFailures(state) {
  return (state.checks ?? []).filter((check) => check.details?.verificationCycle === state.verificationCycle
    && ((check.status === "failed" && check.evidenceKind === "OBSERVED")
      || (check.status === "blocked" && check.evidenceKind === "BLOCKED")));
}

function prerequisite(code, message, artifacts = []) {
  return Object.assign(new Error(message), { code, artifacts });
}

export function assertCheckPhase(state, status, evidenceKind, stateRel) {
  const reviewFinding = isReviewCorrection(state) && ((status === "failed" && evidenceKind === "OBSERVED")
    || (status === "blocked" && evidenceKind === "BLOCKED"));
  if (state.phase !== "VERIFYING" && !reviewFinding) {
    throw prerequisite("E_PHASE_PREREQUISITE_MISSING", `record-check requires VERIFYING or a negative review finding; found ${state.phase}`, [stateRel]);
  }
  return reviewFinding;
}

export function assertDiagnosisPhase(state) {
  if (state.phase !== "DIAGNOSING" && !isReviewCorrection(state)) {
    throw prerequisite("E_PHASE_PREREQUISITE_MISSING", `Recording a diagnosis requires DIAGNOSING or a review finding, currently ${state.phase}`);
  }
}

export function assertReviewChronology(state, events, artifacts = []) {
  if (isReviewCorrection(state) && !hasCurrentReview(state, events)) {
    throw prerequisite("E_PHASE_CHRONOLOGY_INVALID", "Review findings require REVIEW_STARTED in the current verification cycle", artifacts);
  }
}

export function requiresFailureBinding(state, failureClass) {
  return failureClass === "VERIFICATION_FAILURE" || isReviewCorrection(state);
}

export function assertReviewRequirement(state, requirement, canonicalRequirement) {
  if (isReviewCorrection(state) && !canonicalRequirement) {
    throw prerequisite("E_CHECK_INVALID", `Review finding must reference a required contract or guide check: ${requirement}`);
  }
}
