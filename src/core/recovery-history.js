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

export function classifyRecoveryHistory(events = []) {
  const recoveries = [];
  const completedRecoveries = [];
  const errors = [];
  const seenRecoveryIds = new Set();
  let activeCycle = null;

  for (const event of events) {
    if (RECOVERY_EVENT_TYPES.has(event?.event)) {
      // The known legacy defect signature is never an owning recovery cycle by
      // itself. It remains non-owning historical evidence; ownership comes
      // exclusively from its valid LEGACY_RECOVERY_MIGRATION_RECORDED event,
      // which is validated (binding, uniqueness) by the ledger validator.
      if (!event.details?.recoveryId && isLegacyRecoveryEventShape(event)) continue;
      // A migration event only counts as a canonical recovery cycle when it
      // binds an actual legacy event present earlier in this ledger.
      if (event.event === LEGACY_RECOVERY_MIGRATION_EVENT
        && !events.some((candidate) => candidate.seq === event.details?.legacyEventSeq
          && isLegacyRecoveryEventShape(candidate))) {
        errors.push(recoveryError(
          `Legacy migration event at seq ${event?.seq ?? "unknown"} does not bind a legacy recovery event in this ledger`,
        ));
        continue;
      }
      const recoveryId = recoveryIdOf(event);
      if (!recoveryId) {
        errors.push(recoveryError(`Recovery event at seq ${event?.seq ?? "unknown"} has no recoveryId`));
        continue;
      }
      if (seenRecoveryIds.has(recoveryId)) {
        errors.push(recoveryError(`Recovery event at seq ${event.seq} reuses recovery id ${recoveryId}`));
        continue;
      }
      if (activeCycle) {
        errors.push(recoveryError(
          `Recovery ${recoveryId} was recorded while recovery ${activeCycle.recoveryId} is unresolved`,
        ));
        continue;
      }

      activeCycle = {
        recoveryId,
        recoveryEventSeq: event.seq,
        resumedEventSeq: null,
        active: true,
        event,
        resumedEvent: null,
      };
      seenRecoveryIds.add(recoveryId);
      recoveries.push(activeCycle);
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
    completedRecoveries.push(activeCycle);
    activeCycle = null;
  }

  const valid = errors.length === 0;
  return {
    recoveries,
    activeRecoveryId: valid ? activeCycle?.recoveryId ?? null : null,
    activeRecovery: valid && activeCycle
      ? { recoveryId: activeCycle.recoveryId, event: activeCycle.event }
      : null,
    completedRecoveries,
    valid,
    errors,
  };
}

export function resolveRecoveryHistory(events = []) {
  return classifyRecoveryHistory(events);
}
