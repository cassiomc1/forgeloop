import { canonicalFingerprint } from "../core/artifacts.js";
import { readContract } from "../core/contract.js";
import { appendProtocolEvent, validateEventLedger, validateStateLedgerCoherence } from "../core/events.js";
import { readPersistedRoute } from "../core/route-artifact.js";
import { resolveTaskContext } from "../core/task-context.js";
import { taskArtifactPath } from "../core/task-paths.js";
import {
  classifyLockStaleness,
  readLockInfo,
  releaseStaleTaskLockIfUnchanged,
  withProjectClaimsLock,
} from "../core/task-lock.js";
import { withTaskTransaction } from "../core/transaction.js";
import { readWorkState } from "../core/work-state.js";
import {
  CONTRACT_BOOTSTRAP_REPAIR_AUTHORITY,
  CONTRACT_BOOTSTRAP_REPAIR_MIGRATION_DEFECT,
  CONTRACT_BOOTSTRAP_REPAIR_MIGRATION_EVENT,
  CONTRACT_BOOTSTRAP_REPAIR_MIGRATION_VERSION,
  assertContractBootstrapRepairMigrationDetails,
  isLegacyContractBootstrapRepairMigrationCandidate,
  resolveEffectiveContractBootstrapRepairAnchor,
} from "../core/contract-bootstrap-recovery.js";
import {
  E_CONTRACT_BOOTSTRAP_REPAIR_MIGRATION_AUTHORIZATION_REQUIRED,
  E_CONTRACT_BOOTSTRAP_REPAIR_MIGRATION_INVALID,
  E_TASK_LOCKED,
} from "../core/error-codes.js";

function migrationError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  return error;
}

function routePath(taskId) {
  return taskArtifactPath(taskId, "route");
}

async function proveLegacyRepairState(target, packageRoot, taskId, marker) {
  const contract = await readContract(target, packageRoot, { taskId });
  if (contract.fingerprint !== marker.details.contractFingerprint) {
    throw migrationError(
      E_CONTRACT_BOOTSTRAP_REPAIR_MIGRATION_INVALID,
      "Current contract does not match the legacy repair marker fingerprint",
      { artifacts: [taskArtifactPath(taskId, "contract")] },
    );
  }

  const state = await readWorkState(target, { packageRoot, taskId });
  if (!state) {
    throw migrationError(
      E_CONTRACT_BOOTSTRAP_REPAIR_MIGRATION_INVALID,
      "Current work-state is required to prove the legacy repair boundary",
      { artifacts: [taskArtifactPath(taskId, "state")] },
    );
  }
  if (state.taskId !== taskId
    || state.phase !== marker.details.reconstructedPhase
    || state.contractFingerprint !== marker.details.contractFingerprint
    || canonicalFingerprint(state) !== marker.details.reconstructedStateFingerprint) {
    throw migrationError(
      E_CONTRACT_BOOTSTRAP_REPAIR_MIGRATION_INVALID,
      "Current work-state does not exactly match the legacy repair marker reconstruction",
      { artifacts: [taskArtifactPath(taskId, "state")] },
    );
  }
  if (!Number.isInteger(state.revision) || state.revision < 0) {
    throw migrationError(
      E_CONTRACT_BOOTSTRAP_REPAIR_MIGRATION_INVALID,
      "Current work-state revision is not a valid non-negative integer",
      { artifacts: [taskArtifactPath(taskId, "state")] },
    );
  }

  let route = null;
  if (state.phase === "ROUTED") {
    try {
      route = await readPersistedRoute(target, packageRoot, { taskId });
    } catch (error) {
      throw migrationError(
        E_CONTRACT_BOOTSTRAP_REPAIR_MIGRATION_INVALID,
        `ROUTED legacy repair requires a readable persisted route: ${error.message}`,
        { artifacts: [routePath(taskId)] },
      );
    }
    if (marker.details.routeFingerprint === null
      || state.routeFingerprint !== marker.details.routeFingerprint
      || route.fingerprint !== marker.details.routeFingerprint
      || route.value.contractFingerprint !== marker.details.contractFingerprint) {
      throw migrationError(
        E_CONTRACT_BOOTSTRAP_REPAIR_MIGRATION_INVALID,
        "Persisted route does not exactly match the legacy repair marker reconstruction",
        { artifacts: [routePath(taskId)] },
      );
    }
  } else if (marker.details.routeFingerprint !== null || state.routeFingerprint !== undefined) {
    throw migrationError(
      E_CONTRACT_BOOTSTRAP_REPAIR_MIGRATION_INVALID,
      "CONTRACT_READY legacy repair must not claim a route",
      { artifacts: [taskArtifactPath(taskId, "state")] },
    );
  }

  return { contract, state, route };
}

function migrationResult(taskId, candidate, migrationEvent, alreadyMigrated) {
  return {
    taskId,
    migrated: !alreadyMigrated,
    alreadyMigrated,
    legacyMarkerSeq: candidate.marker.seq,
    legacyRepairCommitSeq: candidate.repairCommit.seq,
    migrationEventSeq: migrationEvent?.seq ?? null,
    repairId: candidate.marker.details.repairId,
    reconstructedPhase: candidate.marker.details.reconstructedPhase,
  };
}

async function inspectAlreadyMigrated(target, packageRoot, taskId, ledger) {
  const anchor = resolveEffectiveContractBootstrapRepairAnchor(ledger.events);
  if (!ledger.valid || !anchor || anchor.kind !== "MIGRATED_LEGACY") {
    throw migrationError(
      E_CONTRACT_BOOTSTRAP_REPAIR_MIGRATION_INVALID,
      "Existing contract bootstrap migration is invalid or the ledger is not strict",
    );
  }
  const proof = await proveLegacyRepairState(target, packageRoot, taskId, anchor.sourceMarker);
  const coherenceErrors = validateStateLedgerCoherence(proof.state, ledger.events);
  if (coherenceErrors.length > 0) {
    throw migrationError(
      E_CONTRACT_BOOTSTRAP_REPAIR_MIGRATION_INVALID,
      "Current work-state no longer satisfies the migrated ledger boundary",
      { errors: coherenceErrors },
    );
  }
  return migrationResult(taskId, { marker: anchor.sourceMarker, repairCommit: ledger.events[anchor.sourceMarker.seq] }, anchor.migrationEvent, true);
}

export async function runTaskMigrateContractBootstrapRepair({ target, packageRoot, taskId, acknowledgeMigration } = {}) {
  if (!acknowledgeMigration) {
    throw migrationError(
      E_CONTRACT_BOOTSTRAP_REPAIR_MIGRATION_AUTHORIZATION_REQUIRED,
      "task-migrate-contract-bootstrap-repair requires fresh explicit --acknowledge-migration",
    );
  }

  const context = await resolveTaskContext(target, { taskId, packageRoot, explicitRequired: true });
  const effectiveTaskId = context.taskId;
  const initial = await validateEventLedger(target, packageRoot, {
    taskId: effectiveTaskId,
    allowUnmigratedLegacyContractBootstrapRepairMarkers: true,
  });
  if (!initial.valid) {
    const strict = await validateEventLedger(target, packageRoot, { taskId: effectiveTaskId });
    if (strict.valid) return inspectAlreadyMigrated(target, packageRoot, effectiveTaskId, strict);
    throw migrationError(
      E_CONTRACT_BOOTSTRAP_REPAIR_MIGRATION_INVALID,
      "Ledger is not structurally trustworthy for legacy contract bootstrap migration",
      { errors: initial.errors },
    );
  }
  const initialCandidate = isLegacyContractBootstrapRepairMigrationCandidate(initial.events, effectiveTaskId);
  if (!initialCandidate) {
    const strict = await validateEventLedger(target, packageRoot, { taskId: effectiveTaskId });
    if (strict.valid) return inspectAlreadyMigrated(target, packageRoot, effectiveTaskId, strict);
    throw migrationError(
      E_CONTRACT_BOOTSTRAP_REPAIR_MIGRATION_INVALID,
      "Ledger does not match the exact legacy contract bootstrap repair migration boundary",
      { errors: initial.errors },
    );
  }

  return withProjectClaimsLock(target, "task-migrate-contract-bootstrap-repair", async () => {
    const lock = await readLockInfo(target, effectiveTaskId);
    const status = classifyLockStaleness(lock);
    if (status.status === "LIVE") throw migrationError(E_TASK_LOCKED, `Task ${effectiveTaskId} has a live mutation lock`);
    if (status.status === "UNKNOWN" || status.status === "CORRUPT") {
      throw migrationError(
        E_CONTRACT_BOOTSTRAP_REPAIR_MIGRATION_INVALID,
        `Task ${effectiveTaskId} lock state is ${status.status}; refusing unsafe migration`,
      );
    }
    if (status.status === "STALE") {
      const released = await releaseStaleTaskLockIfUnchanged(target, effectiveTaskId, lock);
      if (!released.released && released.reason !== "LOCK_MISSING") {
        throw migrationError(
          E_CONTRACT_BOOTSTRAP_REPAIR_MIGRATION_INVALID,
          `Task ${effectiveTaskId} stale lock could not be safely released: ${released.reason}`,
        );
      }
    }

    const result = await withTaskTransaction({
      target,
      taskId: effectiveTaskId,
      operation: "task-migrate-contract-bootstrap-repair",
      packageRoot,
      recordCommitEvent: true,
    }, async () => {
      const locked = await validateEventLedger(target, packageRoot, {
        taskId: effectiveTaskId,
        allowUnmigratedLegacyContractBootstrapRepairMarkers: true,
      });
      if (!locked.valid) {
        const strict = await validateEventLedger(target, packageRoot, { taskId: effectiveTaskId });
        if (strict.valid) return inspectAlreadyMigrated(target, packageRoot, effectiveTaskId, strict);
        throw migrationError(
          E_CONTRACT_BOOTSTRAP_REPAIR_MIGRATION_INVALID,
          "Pre-commit ledger revalidation failed inside the migration transaction",
          { errors: locked.errors },
        );
      }
      const candidate = isLegacyContractBootstrapRepairMigrationCandidate(locked.events, effectiveTaskId);
      if (!candidate
        || candidate.marker.seq !== initialCandidate.marker.seq
        || candidate.marker.hash !== initialCandidate.marker.hash
        || candidate.repairCommit.hash !== initialCandidate.repairCommit.hash) {
        const strict = await validateEventLedger(target, packageRoot, { taskId: effectiveTaskId });
        if (strict.valid) return inspectAlreadyMigrated(target, packageRoot, effectiveTaskId, strict);
        throw migrationError(
          E_CONTRACT_BOOTSTRAP_REPAIR_MIGRATION_INVALID,
          "Ledger changed between inspection and migration lock; aborting",
        );
      }

      const proof = await proveLegacyRepairState(target, packageRoot, effectiveTaskId, candidate.marker);
      const coherenceErrors = validateStateLedgerCoherence(proof.state, locked.events);
      if (coherenceErrors.length > 0) {
        throw migrationError(
          E_CONTRACT_BOOTSTRAP_REPAIR_MIGRATION_INVALID,
          "Work-state and ledger are not coherent at the legacy repair boundary",
          { errors: coherenceErrors },
        );
      }
      const migratedAt = new Date().toISOString();
      const details = {
        migrationVersion: CONTRACT_BOOTSTRAP_REPAIR_MIGRATION_VERSION,
        defect: CONTRACT_BOOTSTRAP_REPAIR_MIGRATION_DEFECT,
        legacyMarkerSeq: candidate.marker.seq,
        legacyMarkerHash: candidate.marker.hash,
        legacyRepairId: candidate.marker.details.repairId,
        legacyRepairCommitSeq: candidate.repairCommit.seq,
        legacyRepairCommitHash: candidate.repairCommit.hash,
        legacyRepairTransactionId: candidate.repairCommit.details.transactionId,
        taskId: effectiveTaskId,
        contractFingerprint: candidate.marker.details.contractFingerprint,
        reconstructedPhase: candidate.marker.details.reconstructedPhase,
        routeFingerprint: candidate.marker.details.routeFingerprint,
        reconstructedStateFingerprint: candidate.marker.details.reconstructedStateFingerprint,
        reconstructedStateRevision: proof.state.revision,
        migratedAt,
        authorityKind: CONTRACT_BOOTSTRAP_REPAIR_AUTHORITY,
      };
      assertContractBootstrapRepairMigrationDetails(details);
      const migrationEvent = await appendProtocolEvent(target, {
        taskId: effectiveTaskId,
        event: CONTRACT_BOOTSTRAP_REPAIR_MIGRATION_EVENT,
        at: migratedAt,
        details,
      }, packageRoot, { taskId: effectiveTaskId });
      return migrationResult(effectiveTaskId, candidate, migrationEvent, false);
    });

    const finalLedger = await validateEventLedger(target, packageRoot, { taskId: effectiveTaskId });
    if (!finalLedger.valid) {
      throw migrationError(
        E_CONTRACT_BOOTSTRAP_REPAIR_MIGRATION_INVALID,
        "Post-migration ledger validation failed; the legacy repair remains unverified",
        { errors: finalLedger.errors },
      );
    }
    return result;
  });
}

export function formatTaskMigrateContractBootstrapRepairResult(result) {
  return [
    `taskId: ${result.taskId}`,
    `migration: ${result.alreadyMigrated ? "already migrated" : "migrated"}`,
    `legacy marker seq: ${result.legacyMarkerSeq}`,
    `migration event seq: ${result.migrationEventSeq}`,
    `repairId: ${result.repairId}`,
    "",
  ].join("\n");
}
