import { ledgerEventsOfTypes } from "./ledger-event-collection.js";
import { ledgerRelationSet } from "./ledger-relations.js";
import {
  LEGACY_RECOVERY_MIGRATION_EVENT,
  isLegacyRecoveryEventShape,
} from "./task-recovery-migration.js";

const RECOVERY_EVENT_TYPES = new Set([
  "TASK_RECOVERY_RECORDED",
  "OPERATOR_RECOVERY_RECORDED",
  "TASK_ABANDONED",
  LEGACY_RECOVERY_MIGRATION_EVENT,
]);

function recoveryError(message) {
  return {
    code: "E_TASK_RECOVERY_INCONSISTENT",
    message,
  };
}

function recoveryIdOf(event) {
  return typeof event?.details?.recoveryId === "string" && event.details.recoveryId !== ""
    ? event.details.recoveryId
    : null;
}

function recoveryCandidate(event, events, seenRecoveryIds, activeCycle, errors) {
  // The known legacy defect signature is never an owning recovery cycle by
  // itself. It remains non-owning historical evidence; ownership comes
  // exclusively from its valid LEGACY_RECOVERY_MIGRATION_RECORDED event,
  // which is validated (binding, uniqueness) by the ledger validator.
  if (!event.details?.recoveryId && isLegacyRecoveryEventShape(event)) return null;
  // A migration event only counts as a canonical recovery cycle when it
  // binds an actual legacy event present earlier in this ledger.
  if (event.event === LEGACY_RECOVERY_MIGRATION_EVENT
    && !events.some((candidate) => candidate.seq === event.details?.legacyEventSeq
      && isLegacyRecoveryEventShape(candidate))) {
    errors.push(recoveryError(
      `Legacy migration event at seq ${event?.seq ?? "unknown"} does not bind a legacy recovery event in this ledger`,
    ));
    return null;
  }
  const recoveryId = recoveryIdOf(event);
  if (!recoveryId) {
    errors.push(recoveryError(`Recovery event at seq ${event?.seq ?? "unknown"} has no recoveryId`));
    return null;
  }
  if (seenRecoveryIds.has(recoveryId)) {
    errors.push(recoveryError(`Recovery event at seq ${event.seq} reuses recovery id ${recoveryId}`));
    return null;
  }
  if (activeCycle) {
    errors.push(recoveryError(
      `Recovery ${recoveryId} was recorded while recovery ${activeCycle.recoveryId} is unresolved`,
    ));
    return null;
  }

  return {
    recoveryId,
    recoveryEventSeq: event.seq,
    resumedEventSeq: null,
    active: true,
    event,
    resumedEvent: null,
  };
}

function classifyHistory(events, { retainCycles = true, onRecovery = null } = {}) {
  const recoveries = [];
  const completedRecoveries = [];
  const errors = [];
  const seenRecoveryIds = ledgerRelationSet();
  let activeCycle = null;
  let completedRecoveryCount = 0;

  const relevant = Array.isArray(events) ? events : ledgerEventsOfTypes(events, [...RECOVERY_EVENT_TYPES, "TASK_RECOVERY_RESUMED"]);
  for (const event of relevant) {
    if (RECOVERY_EVENT_TYPES.has(event?.event)) {
      const candidate = recoveryCandidate(event, events, seenRecoveryIds, activeCycle, errors);
      if (!candidate) continue;
      activeCycle = candidate;
      seenRecoveryIds.add(activeCycle.recoveryId);
      if (retainCycles) recoveries.push(activeCycle);
      if (onRecovery) onRecovery(activeCycle);
      continue;
    }

    if (event?.event !== "TASK_RECOVERY_RESUMED") continue;

    const recoveryId = recoveryIdOf(event);
    if (!recoveryId || !activeCycle || activeCycle.recoveryId !== recoveryId) {
      errors.push(recoveryError(
        `TASK_RECOVERY_RESUMED at seq ${event?.seq ?? "unknown"} does not reference an active recovery`,
      ));
      continue;
    }
    if (!Number.isInteger(event.seq) || event.seq <= activeCycle.recoveryEventSeq) {
      errors.push(recoveryError(
        `Resume sequence for recovery ${recoveryId} must be greater than recovery sequence ${activeCycle.recoveryEventSeq}`,
      ));
      continue;
    }

    activeCycle.resumedEventSeq = event.seq;
    activeCycle.resumedEvent = event;
    activeCycle.active = false;
    completedRecoveryCount += 1;
    if (retainCycles) completedRecoveries.push(activeCycle);
    activeCycle = null;
  }

  const valid = errors.length === 0;
  return {
    ...(retainCycles ? { recoveries } : {}),
    activeRecoveryId: valid ? activeCycle?.recoveryId ?? null : null,
    activeRecovery: valid && activeCycle
      ? { recoveryId: activeCycle.recoveryId, event: activeCycle.event }
      : null,
    ...(retainCycles ? { completedRecoveries } : { completedRecoveryCount }),
    valid,
    errors,
  };
}

/** Public evidence keeps its historical arrays. Internal classification can stream claims. */
export function classifyRecoveryHistory(events = []) { return classifyHistory(events); }

export function summarizeRecoveryHistory(events, onRecovery) {
  return classifyHistory(events, { retainCycles: false, onRecovery });
}

export function resolveRecoveryHistory(events = []) {
  return classifyRecoveryHistory(events);
}
