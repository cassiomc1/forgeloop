import { validateEventLedger, validateStateLedgerCoherence } from "./events.js";
import { readPersistedRoute } from "./route-artifact.js";
import { directCommandSpec, NEXT_ACTIONS } from "./next-action-model.js";
import { resolveTaskClaimState } from "./task-claim-state.js";
import { sameCanonicalGuideList } from "./contract-bootstrap-recovery.js";
import { CHECKPOINT_REVALIDATION_PHASES } from "./checkpoint-revalidation.js";

/**
 * Select a safe pre-execution refresh mutation. Repository-only drift keeps
 * the checkpoint and its route identity; the legacy clear-state path remains
 * limited to a documented blocked-preflight recovery.
 */
export async function preExecutionRefreshGuidance({ target, packageRoot, state, contract, freshness }) {
  if (!["ROUTED", "DESIGNING", "PLANNED"].includes(state.phase)) return { nextAction: NEXT_ACTIONS.RESOLVE_BLOCKER };
  const ledger = await validateEventLedger(target, packageRoot, { taskId: state.taskId });
  if (!ledger.valid || ledger.events.some((entry) => entry.event === "EXECUTION_STARTED")) {
    return { nextAction: NEXT_ACTIONS.RESOLVE_BLOCKER };
  }
  if (CHECKPOINT_REVALIDATION_PHASES.includes(state.phase)
    && freshness?.status === "REVALIDATION_REQUIRED"
    && [...new Set(freshness.reasons ?? [])].sort().join(",") === "REPOSITORY_CHANGED"
    && state.contractFingerprint === contract.fingerprint) {
    try {
      const route = await readPersistedRoute(target, packageRoot, { taskId: state.taskId });
      const ownership = await resolveTaskClaimState(target, { taskId: state.taskId, packageRoot });
      const coherenceErrors = validateStateLedgerCoherence(state, ledger.events);
      const repositoryAvailable = typeof freshness.repository?.head === "string" && freshness.repository.head.length > 0;
      const routeIdentityValid = route.value?.contractFingerprint === contract.fingerprint
        && state.routeFingerprint === route.fingerprint
        && sameCanonicalGuideList(state.selectedGuides, route.value.guides);
      if (ownership.ownershipValid && ownership.mutationAllowed && repositoryAvailable
        && coherenceErrors.length === 0 && routeIdentityValid) {
        return {
          nextAction: NEXT_ACTIONS.REVALIDATE_CHECKPOINT,
          commands: [`forgeloop checkpoint-revalidate --task ${state.taskId} --json`],
          commandSpecs: [directCommandSpec("checkpoint-revalidate", state.taskId)],
        };
      }
    } catch {
      // Unsupported or ambiguous identity stays on the fail-closed blocker.
    }
  }
  const lastPreflight = ledger.events.filter((entry) => ["PREFLIGHT_READY", "PREFLIGHT_BLOCKED"].includes(entry.event)).at(-1);
  if (lastPreflight?.event !== "PREFLIGHT_BLOCKED") return { nextAction: NEXT_ACTIONS.RESOLVE_BLOCKER };
  let route;
  try { route = await readPersistedRoute(target, packageRoot, { taskId: state.taskId }); }
  catch { return { nextAction: NEXT_ACTIONS.RESOLVE_BLOCKER }; }
  if (route.value.contractFingerprint !== contract.fingerprint) return { nextAction: NEXT_ACTIONS.RESOLVE_BLOCKER };
  return {
    nextAction: NEXT_ACTIONS.RESOLVE_BLOCKER,
    commands: [`forgeloop clear-state --task ${state.taskId}`, `forgeloop preflight --task ${state.taskId}`],
    commandSpecs: [directCommandSpec("clear-state", state.taskId), directCommandSpec("preflight", state.taskId)],
  };
}
