/**
 * Store-backed operational guards for the SQLite integration slice.
 *
 * These are the selected-store equivalents of the filesystem helpers used by
 * `withTaskMutation`:
 *
 *   resolveTaskContext        -> resolveStoreTaskContext
 *   assertTaskMutationAllowed -> assertStoreTaskMutationAllowed
 *   assertWorkspaceBinding    -> assertStoreWorkspaceBinding
 *   withTaskTransaction       -> the store's own transaction
 *
 * Every one of these reads the same operational records the SQLite mutation
 * will read, so a guard decision and the write that follows are derived from one
 * state history rather than two.
 *
 * The external workspace-identity provider is deliberately NOT reimplemented:
 * `captureWorkspaceIdentity` still contacts git, so a store-routed dispatch
 * still proves the real current workspace identity. Only the stored binding
 * record comes from the store.
 *
 * Protocol rules and public error codes are reused from the domain modules so
 * rejection behavior stays identical to the filesystem path.
 */
import { captureWorkspaceIdentity } from "../core/workspace-binding.js";
import { buildTaskClaimEvidence, classifyTaskClaimState } from "../core/task-claim-state.js";
import { resolveEffectiveContractBootstrapRepairAnchor } from "../core/contract-bootstrap-recovery.js";
import { validateLedgerEvents } from "../core/events.js";
import { listArtifacts } from "./repository.js";

import { withLedgerEventSnapshot } from "./ledger-event-snapshot.js";
import { EVENT_RESERVATION_PROOF_PREDICATE } from "./schema.js";

const ERROR_CODES = Object.freeze({
  TASK_SELECTOR_CONFLICT: "E_TASK_SELECTOR_CONFLICT",
  TASK_NOT_FOUND: "E_TASK_NOT_FOUND",
  TASK_REQUIRED: "E_TASK_REQUIRED",
  CLAIM_OWNERSHIP_INCONSISTENT: "E_TASK_CLAIM_OWNERSHIP_INCONSISTENT",
  TASK_COMPLETE: "E_TASK_COMPLETE",
  TASK_RECOVERED: "E_TASK_RECOVERED",
  WORKSPACE_BINDING_MISMATCH: "E_WORKSPACE_BINDING_MISMATCH",
  WORKSPACE_IDENTITY_UNAVAILABLE: "E_WORKSPACE_IDENTITY_UNAVAILABLE",
  WORKSPACE_BINDING_INVALID: "E_WORKSPACE_BINDING_INVALID",
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
 * Resolve the selected task from the store.
 *
 * Mirrors `resolveTaskContext` selection semantics, including the explicit
 * selector versus `FORGELOOP_TASK` conflict, which is checked before any store
 * read. Ambiguity fails closed rather than picking a candidate.
 */
export function resolveStoreTaskContext(db, {
  taskId = null,
  envTaskId = process.env.FORGELOOP_TASK ?? null,
  explicitRequired = false,
} = {}) {
  const flagId = typeof taskId === "string" && taskId.trim() ? taskId.trim() : null;
  const envId = typeof envTaskId === "string" && envTaskId.trim() ? envTaskId.trim() : null;

  if (flagId && envId && flagId !== envId) {
    throw guardError(
      ERROR_CODES.TASK_SELECTOR_CONFLICT,
      `Task selector conflict: --task "${flagId}" conflicts with FORGELOOP_TASK="${envId}"`,
      { flagTaskId: flagId, envTaskId: envId },
    );
  }

  const selectedId = flagId ?? envId;
  if (selectedId) {
    const task = readTask(db, selectedId);
    if (!task) {
      throw guardError(ERROR_CODES.TASK_NOT_FOUND, `Task "${selectedId}" not found in project`, { taskId: selectedId });
    }
    return { taskId: task.taskId, taskKey: task.taskKey, descriptor: task.descriptor, phase: task.phase };
  }

  const rows = db.prepare("SELECT task_id FROM tasks ORDER BY task_id").all();
  if (rows.length === 0) {
    if (explicitRequired) {
      throw guardError(ERROR_CODES.TASK_NOT_FOUND, "No task found in project");
    }
    return null;
  }
  if (rows.length > 1) {
    // Fail closed: an ambiguous selection must never silently pick a task.
    throw guardError(
      ERROR_CODES.TASK_REQUIRED,
      "Multiple tasks found; an explicit task selector is required",
      { candidates: rows.map((row) => row.task_id) },
    );
  }
  const task = readTask(db, rows[0].task_id);
  return { taskId: task.taskId, taskKey: task.taskKey, descriptor: task.descriptor, phase: task.phase };
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


/**
 * Enforce mutation authority from store records, raising the same public error
 * codes as the filesystem guard.
 */
export function assertStoreTaskMutationAllowed(db, taskId) {
  const result = resolveStoreClaimState(db, taskId);
  if (result.mutationAllowed) return result;

  if (result.claimState === "INCONSISTENT") {
    throw guardError(
      ERROR_CODES.CLAIM_OWNERSHIP_INCONSISTENT,
      `Task ${result.taskId} claim ownership is inconsistent; ordinary mutation is blocked`,
      result,
    );
  }
  if (result.claimState === "RELEASED_BY_COMPLETION") {
    throw guardError(ERROR_CODES.TASK_COMPLETE, `Task ${result.taskId} is COMPLETE and cannot be mutated`, result);
  }
  throw guardError(
    ERROR_CODES.TASK_RECOVERED,
    `Task ${result.taskId} is RECOVERED and its write claims are released; run task-resume before ordinary mutation`,
    result,
  );
}

/**
 * Enforce the workspace binding, reading the stored binding from the store and
 * proving the current workspace identity through the established external git
 * provider.
 *
 * The comparison rule is identical to `resolveWorkspaceBindingStatus`; only the
 * source of the stored binding changes. A bound task whose identity no longer
 * matches is rejected rather than silently rebound.
 */
export async function assertStoreWorkspaceBinding(db, taskId, { target, operation = "mutation" } = {}) {
  const stored = listArtifacts(db, taskId, "workspaceBinding").at(-1)?.payload ?? null;

  // Unbound tasks are permitted, matching the filesystem rule.
  if (stored === null) return { status: "UNBOUND", taskId, binding: null, current: null };

  let current;
  try {
    current = await captureWorkspaceIdentity(target);
  } catch (error) {
    throw guardError(
      ERROR_CODES.WORKSPACE_IDENTITY_UNAVAILABLE,
      error?.message ?? "The current directory is not a Git worktree whose identity ForgeLoop can prove",
      { taskId, status: "UNAVAILABLE" },
    );
  }

  const matches = stored.repositoryIdentity === current.repositoryIdentity
    && stored.workspaceIdentity === current.workspaceIdentity;
  if (matches) return { status: "MATCH", taskId, binding: stored, current };

  throw guardError(
    ERROR_CODES.WORKSPACE_BINDING_MISMATCH,
    `Task ${taskId} is bound to a different workspace or repository identity`,
    { taskId, status: "MISMATCH", binding: stored, current, operation },
  );
}
