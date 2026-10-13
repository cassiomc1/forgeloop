import { isLedgerEventCollection } from "./ledger-event-collection.js";
import { LIFECYCLE_MILESTONES, validateStateLedgerCoherence } from "./events.js";

export const CANONICAL_COMPLETION_EVENT = "COMPLETION_VALIDATED";

function completionCandidates(events, taskId) {
  let count = 0;
  let candidate = null;
  for (const event of events) {
    if (event.event !== CANONICAL_COMPLETION_EVENT || event.taskId !== taskId) continue;
    count += 1;
    candidate = event;
  }
  return { count, candidate };
}

/**
 * Canonical completion ownership proof: the minimal, validator-backed evidence
 * that the lifecycle itself officially reached COMPLETE. This is intentionally
 * NOT a re-run of full publication/receipt/evidence semantics — it only proves
 * that claim ownership may be released because canonical completion exists.
 *
 * Returns `{ valid: true, completionEvent }` or `{ valid: false, errors }`.
 */
export function validateCompletionOwnershipProof({ taskId, state, ledger }) {
  const errors = [];
  if (!taskId || typeof taskId !== "string") {
    return { valid: false, errors: [{ code: "E_COMPLETION_OWNERSHIP_UNPROVEN", message: "Completion ownership proof requires a taskId" }] };
  }
  if (!state || state.phase !== "COMPLETE") {
    errors.push({ code: "E_COMPLETION_OWNERSHIP_UNPROVEN", message: "Work-state phase is not COMPLETE" });
  }
  if (!ledger || ledger.valid !== true) {
    errors.push({
      code: "E_COMPLETION_OWNERSHIP_UNPROVEN",
      message: `Task event ledger is invalid; completion cannot be proven${ledger?.errors?.length
        ? `: ${ledger.errors.map((error) => error.message).join("; ")}`
        : ""}`,
    });
  }

  let completionEvent = null;
  if (ledger && isLedgerEventCollection(ledger.events)) {
    if (ledger.events.some((event) => event.taskId !== taskId)) {
      errors.push({
        code: "E_COMPLETION_OWNERSHIP_UNPROVEN",
        message: "Ledger contains an event belonging to a different task",
      });
    }
    const { count, candidate } = completionCandidates(ledger.events, taskId);
    if (count === 0) {
      errors.push({
        code: "E_COMPLETION_OWNERSHIP_UNPROVEN",
        message: `No canonical ${CANONICAL_COMPLETION_EVENT} event exists for this task`,
      });
    } else if (count > 1) {
      errors.push({
        code: "E_COMPLETION_OWNERSHIP_UNPROVEN",
        message: `Multiple ${CANONICAL_COMPLETION_EVENT} events exist; completion is ambiguous`,
      });
    } else {
      completionEvent = candidate;
    }
  }

  if (state && ledger && isLedgerEventCollection(ledger.events)) {
    const coherenceErrors = validateStateLedgerCoherence(state, ledger.events);
    if (coherenceErrors.length > 0) {
      for (const error of coherenceErrors) {
        errors.push({
          code: "E_COMPLETION_OWNERSHIP_UNPROVEN",
          message: `State/ledger coherence invalid: ${error.message}`,
        });
      }
    }
  }

  // No contradictory lifecycle activity may follow the canonical completion:
  // any milestone at or after VERIFICATION_RECORDED occurring after the
  // completion event means the lifecycle moved past terminal state.
  if (completionEvent && ledger && isLedgerEventCollection(ledger.events)) {
    const completionIndex = ledger.events.indexOf(completionEvent);
    const contradiction = ledger.events.slice(completionIndex + 1).find((event) => {
      const index = LIFECYCLE_MILESTONES.indexOf(event.event);
      return index >= LIFECYCLE_MILESTONES.indexOf("VERIFICATION_RECORDED");
    });
    if (contradiction) {
      errors.push({
        code: "E_COMPLETION_OWNERSHIP_UNPROVEN",
        message: `Lifecycle event ${contradiction.event} follows canonical completion; terminal state contradicted`,
      });
    }
  }

  if (errors.length > 0) {
    return { valid: false, completionEvent: null, errors };
  }
  return { valid: true, completionEvent };
}
