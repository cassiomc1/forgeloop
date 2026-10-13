/**
 * Store-backed operational guards for the SQLite integration slice.
 *
 * Claim and reservation projections read the same operational records that
 * native mutations use, so authority decisions are derived from one state
 * history rather than a second compatibility adapter.
 */
import { buildTaskClaimEvidence, classifyTaskClaimState } from "../core/task-claim-state.js";
import { resolveEffectiveContractBootstrapRepairAnchor } from "../core/contract-bootstrap-recovery.js";
import { validateLedgerEvents } from "../core/events.js";
import { listArtifacts } from "./repository.js";

import { withLedgerEventSnapshot } from "./ledger-event-snapshot.js";
import { EVENT_RESERVATION_PROOF_PREDICATE } from "./schema.js";

const ERROR_CODES = Object.freeze({
  TASK_NOT_FOUND: "E_TASK_NOT_FOUND",
});

function guardError(code, message, extra = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, extra);
  return error;
}

function readTask(db, taskId) {
  const row = db
    .prepare("SELECT task_id, task_key, phase, revision, created_at, updated_at, descriptor_json, state_json FROM tasks WHERE task_id = ?")
    .get(taskId);
  if (!row) return null;
  return {
    taskId: row.task_id,
    taskKey: row.task_key,
    phase: row.phase,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    descriptor: JSON.parse(row.descriptor_json),
    state: row.state_json === null ? null : JSON.parse(row.state_json),
  };
}

/**
 * Classify operational claim state from store records.
 *
 * Mirrors the filesystem classification order: completion release, then active
 * recovery release, then active. Released claims are never treated as mutation
 * authority, and a task with no recorded claim evidence is inconsistent rather
 * than automatically permitted.
 */
export function resolveStoreClaimState(db, taskId) {
  return withLedgerEventSnapshot(db, taskId, (events) => classifyStoreClaimSnapshot(db, taskId, events));
}

function classifyStoreClaimSnapshot(db, taskId, events) {
  const task = readTask(db, taskId);
  if (!task) {
    throw guardError(ERROR_CODES.TASK_NOT_FOUND, `Task "${taskId}" not found in project`, { taskId });
  }

  const ledger = validateLedgerEvents(events);
  const recovery = listArtifacts(db, taskId, "recovery").at(-1)?.payload ?? null;
  const repairAnchor = resolveEffectiveContractBootstrapRepairAnchor(events);
  let repairArtifacts = null;
  if (repairAnchor) {
    const contract = listArtifacts(db, taskId, "contract").at(-1);
    const route = listArtifacts(db, taskId, "route").at(-1);
    const details = repairAnchor.details;
    repairArtifacts = {
      contract: contract ? { value: contract.payload, fingerprint: contract.fingerprint } : null,
      route: route ? { value: route.payload, fingerprint: route.fingerprint } : null,
      contractError: !contract ? "contract artifact is missing after a recorded repair"
        : contract.fingerprint !== details.contractFingerprint ? "contract fingerprint does not match marker contract fingerprint"
          : task.state?.contractFingerprint !== details.contractFingerprint ? "work-state contract fingerprint does not match marker contract fingerprint" : null,
      routeError: route?.payload?.contractFingerprint !== undefined && route.payload.contractFingerprint !== details.contractFingerprint
        ? "route artifact contract binding does not match repair anchor contract fingerprint" : null,
    };
  }
  const initialErrors = [];
  if (task.state && (task.phase !== task.state.phase || task.revision !== (task.state.revision ?? 0)
    || task.state.taskId !== taskId) || task.descriptor.taskId !== taskId || task.descriptor.taskKey !== task.taskKey) {
    initialErrors.push({ code: "E_TASK_CLAIM_OWNERSHIP_INCONSISTENT", causeCode: "E_STORAGE_PAYLOAD_MISMATCH", message: "Stored identity/phase/revision columns disagree with canonical task payloads" });
  }
  return classifyTaskClaimState(buildTaskClaimEvidence({ taskId, descriptor: task.descriptor, state: task.state, recovery, ledger, repairArtifacts, initialErrors }));
}

/** Reservation projection only: ACTIVE never grants mutation authority. */
export function resolveStoreReservationState(db, taskId) {
  const task = readTask(db, taskId);
  if (!task) throw guardError(ERROR_CODES.TASK_NOT_FOUND, `Task "${taskId}" not found in project`, { taskId });
  const recovery = db.prepare("SELECT 1 FROM task_artifacts WHERE task_id = ? AND kind = 'recovery' LIMIT 1").get(taskId);
  if (task.state?.phase !== "COMPLETE" && !recovery) {
    // Full classification cannot release a non-completed task without a
    // recovery artifact. Invalid history also retains claims. Preserve the
    // previous decoder/error path for malformed/non-object historical rows
    // and repair histories that may inspect contract/route artifacts. Read the
    // canonical payload, not the editable event_type index. This bounded SQL
    // scan is not a ledger or ownership validation result.
    const requiresFullProof = db.prepare(`SELECT 1 FROM events WHERE task_id = ?
      AND ${EVENT_RESERVATION_PROOF_PREDICATE} LIMIT 1`).get(taskId);
    if (!requiresFullProof) return "ACTIVE";
  }
  const projection = resolveStoreClaimState(db, taskId);
  return projection.valid && projection.effectiveWriteClaims.length === 0 && projection.claimState !== "ACTIVE"
    ? "RELEASED" : "ACTIVE";
}
