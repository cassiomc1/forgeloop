const MAX_EXPLANATION_TEXT = 240;
const MAX_EXPLANATION_REASONS = 3;
const MAX_EXPLANATION_ARTIFACTS = 6;

const REQUIRED_CHANGES = Object.freeze({
  E_CONTRACT_STALE: "Refresh the contract-bound checkpoint and route before continuing.",
  E_ROUTE_STALE: "Re-run the canonical route for the current contract before continuing.",
  E_REPOSITORY_CHANGED: "Revalidate the repository and record new evidence before continuing.",
  E_RECEIPT_STALE: "Inspect the receipt boundary and obtain a fresh independently verifiable receipt.",
  E_RECEIPT_MISSING: "Provide the required task-bound receipt or record the check as unavailable.",
  E_CHECK_OBSERVATION_REQUIRED: "Run the required check through an observable verification boundary and record its result.",
  E_TASK_SCOPE_CONFLICT: "Resolve the overlapping task ownership through the canonical task recovery or coordination path.",
  E_VERIFICATION_EXECUTION_INVALID: "Repair or replace the verification execution boundary before recording evidence.",
  E_PUBLICATION_REQUIREMENT_PENDING: "Obtain independently verifiable publication evidence; do not infer publication from local checks.",
});

function bounded(value, limit = MAX_EXPLANATION_TEXT) {
  const text = String(value ?? "").trim();
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
}

function reasonExplanation(reason) {
  const artifacts = [...new Set((reason.artifacts ?? [])
    .filter((artifact) => typeof artifact === "string" && artifact.length > 0))]
    .slice(0, MAX_EXPLANATION_ARTIFACTS);
  return {
    code: reason.code,
    failedInvariant: bounded(reason.message),
    safeArtifacts: artifacts,
    requiredChange: REQUIRED_CHANGES[reason.code] ?? "Satisfy the canonical condition described by this reason before continuing.",
    evidenceNeeded: artifacts.length > 0
      ? `Inspect or update only the listed protocol artifacts, then re-run the canonical next action.`
      : "Provide a fresh, scoped, independently observable result for the blocked condition.",
  };
}

export function explainNextAction(result) {
  const reasons = (result?.reasons ?? []).slice(0, MAX_EXPLANATION_REASONS).map(reasonExplanation);
  const mutating = (result?.commandSpecs ?? []).some((spec) => [
    "advance",
    "clear-state",
    "complete",
    "record-check",
    "record-diagnosis",
    "record-intervention",
    "prepare-completion",
    "route",
  ].includes(spec.commandId));
  return {
    schemaVersion: 1,
    summary: bounded(`Next action ${result?.nextAction ?? "UNKNOWN"} is required for phase ${result?.currentPhase ?? "UNKNOWN"}.`),
    actionKind: mutating ? "MUTATING_COMMAND_MAY_BE_REQUIRED" : "READ_ONLY_OR_HOST_ACTION",
    requiresExternalAuthority: Boolean(result?.authorityRequired || result?.hostActionRequired || result?.approvalRequired),
    reasons,
    bounded: true,
  };
}
