import { ARTIFACT_PATHS, canonicalFingerprint, readJsonArtifact, writeJsonArtifact } from "./artifacts.js";
import { appendProtocolEvent, validateCompletionRecoveryAuthorization, validateEventLedger } from "./events.js";
import { createReceipt } from "./receipt.js";
import { taskArtifactPath } from "./task-paths.js";
import { mutateWorkState, readWorkState } from "./work-state.js";
import { getTaskTransaction, withTaskTransaction } from "./transaction.js";

function resolveArtifactPath(key, taskId, override) {
  if (override) return override;
  return taskId ? taskArtifactPath(taskId, key) : ARTIFACT_PATHS[key];
}

const FINGERPRINT_MISMATCH_CODES = new Set([
  "E_COMPLETION_REJECTION_STATE_FINGERPRINT_MISMATCH",
  "E_COMPLETION_REJECTION_RECEIPT_FINGERPRINT_MISMATCH",
]);

export function isFingerprintOnlyRecoveryMismatch(errors = []) {
  return Array.isArray(errors)
    && errors.length > 0
    && errors.every((error) => FINGERPRINT_MISMATCH_CODES.has(error?.code));
}

function sortedValues(values) {
  return [...new Set(values ?? [])].sort();
}

function sameSortedValues(left, right) {
  return JSON.stringify(sortedValues(left)) === JSON.stringify(sortedValues(right));
}

function findMatchingRejectionEvent(events, attempt, cycle) {
  let latestReviewIndex = -1;
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (event.event === "REVIEW_STARTED" && (event.details?.verificationCycle ?? 1) === cycle) {
      latestReviewIndex = index;
    }
  }
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.event !== "COMPLETION_REJECTED") continue;
    if ((event.details?.verificationCycle ?? 1) !== cycle) continue;
    if (index < latestReviewIndex) continue;
    return { event, index };
  }
  return null;
}

/**
 * Rebind a persisted REJECTED completion attempt to the current work-state
 * checkpoint when the only authorization failures are fingerprint mismatches.
 *
 * Repository drift or a recovery/resume cycle can mutate work-state after a
 * completion rejection was persisted, so the ledger snapshot no longer matches
 * the live checkpoint. Without rebinding, every sanctioned closure path refuses
 * (reconcile-closure and REVIEWING -> VERIFYING require authorized completion
 * recovery; complete cannot persist a fresh evidence-only rejection while the
 * checkpoint is stale), which deadlocks the task.
 *
 * The rebind is append-only and logically conservative:
 *   - the rejection reasonCodes, missingRequirementIds, and verification cycle
 *     must be logically identical between work-state and the latest matching
 *     ledger rejection; any logical difference is refused,
 *   - the original COMPLETION_REJECTED event is never modified; a rebound
 *     rejection carrying the current fingerprints is appended,
 *   - the execution receipt is re-bound to the current checkpoint when present.
 */
export async function rebindCompletionRejectionSnapshot(options = {}) {
  if (await getTaskTransaction(options.target)) return rebindRejectionInTransaction(options);
  const state = await readWorkState(options.target, { packageRoot: options.packageRoot,
    taskId: options.taskId, statePath: resolveArtifactPath("state", options.taskId, options.statePath) });
  if (!state) return { rebound: false };
  return withTaskTransaction({ target: options.target, taskId: options.taskId ?? state.taskId,
    packageRoot: options.packageRoot, operation: "rebind-completion-rejection" }, () => rebindRejectionInTransaction(options));
}

async function rebindRejectionInTransaction({
  target,
  packageRoot,
  taskId = null,
  statePath = null,
  receiptPath = null,
  eventsPath = null,
  authorityContext,
  runtimeContext,
} = {}) {
  const statePathResolved = resolveArtifactPath("state", taskId, statePath);
  const receiptPathResolved = resolveArtifactPath("receipt", taskId, receiptPath);
  const state = await readWorkState(target, { packageRoot, taskId, statePath: statePathResolved });
  if (!state || state.phase !== "REVIEWING") {
    return { rebound: false };
  }
  const attempt = state.lastCompletionAttempt;
  if (!attempt || attempt.status !== "REJECTED") {
    return { rebound: false };
  }

  const ledger = await validateEventLedger(target, packageRoot, { taskId, eventsPath });
  if (!ledger.valid) {
    return { rebound: false };
  }
  const cycle = attempt.verificationCycle ?? state.verificationCycle ?? 1;
  const matching = findMatchingRejectionEvent(ledger.events, attempt, cycle);
  if (!matching) {
    return { rebound: false };
  }
  const details = matching.event.details ?? {};
  const logicalMatch = (details.verificationCycle ?? 1) === cycle
    && sameSortedValues(details.reasonCodes, attempt.reasonCodes)
    && sameSortedValues(details.missingRequirementIds, attempt.missingRequirementIds);
  if (!logicalMatch) {
    return { rebound: false };
  }

  const next = await mutateWorkState(target, {
    expectedRevision: state.revision ?? 0,
    packageRoot,
    taskId,
    statePath: statePathResolved,
  }, () => ({
    ...state,
    revision: (state.revision ?? 0) + 1,
    lastUpdated: new Date().toISOString(),
  }));

  let reboundReceiptFingerprint;
  try {
    const receipt = await readJsonArtifact(target, receiptPathResolved, "execution-receipt", packageRoot);
    const reboundReceipt = await createReceipt({
      ...receipt.value,
      stateFingerprint: canonicalFingerprint(next),
      verificationCycle: next.verificationCycle ?? receipt.value.verificationCycle ?? 1,
    }, packageRoot, { target, taskId, authorityContext, runtimeContext });
    await writeJsonArtifact(target, receiptPathResolved, reboundReceipt, "execution-receipt", packageRoot);
    reboundReceiptFingerprint = canonicalFingerprint(reboundReceipt);
  } catch (error) {
    if (error.code !== "ARTIFACT_MISSING") throw error;
  }

  await appendProtocolEvent(target, {
    taskId: state.taskId,
    event: "COMPLETION_REJECTED",
    details: {
      verificationCycle: cycle,
      reasonCodes: sortedValues(details.reasonCodes),
      missingRequirementIds: sortedValues(details.missingRequirementIds),
      stateFingerprint: canonicalFingerprint(next),
      ...(reboundReceiptFingerprint ? { receiptFingerprint: reboundReceiptFingerprint } : {}),
      ...(details.stateFingerprint ? { reboundFromStateFingerprint: details.stateFingerprint } : {}),
    },
  }, packageRoot, { taskId, eventsPath });

  return { rebound: true, state: next };
}

export async function authorizeCompletionRecoveryOrRebind({
  target,
  packageRoot,
  taskId = null,
  statePath = null,
  receiptPath = null,
  eventsPath = null,
  authorityContext,
  runtimeContext,
} = {}) {
  const statePathResolved = resolveArtifactPath("state", taskId, statePath);
  const receiptPathResolved = resolveArtifactPath("receipt", taskId, receiptPath);
  const resolveArtifacts = async () => {
    const state = await readWorkState(target, { packageRoot, taskId, statePath: statePathResolved });
    let receipt = null;
    try {
      receipt = (await readJsonArtifact(target, receiptPathResolved, "execution-receipt", packageRoot))?.value ?? null;
    } catch {
      receipt = null;
    }
    const events = (await validateEventLedger(target, packageRoot, { taskId, eventsPath })).events;
    return { state, receipt, events };
  };

  const initial = await resolveArtifacts();
  const recoveryAuth = validateCompletionRecoveryAuthorization(initial);
  if (recoveryAuth.authorized || !isFingerprintOnlyRecoveryMismatch(recoveryAuth.errors)) {
    return { ...initial, recoveryAuth, rebound: false };
  }

  const reboundResult = await rebindCompletionRejectionSnapshot({
    target,
    packageRoot,
    taskId,
    statePath,
    receiptPath,
    eventsPath,
    authorityContext,
    runtimeContext,
  });
  if (!reboundResult.rebound) {
    return { ...initial, recoveryAuth, rebound: false };
  }

  const rebounded = await resolveArtifacts();
  const reboundAuth = validateCompletionRecoveryAuthorization(rebounded);
  return { ...rebounded, recoveryAuth: reboundAuth, rebound: reboundAuth.authorized };
}
