import { taskArtifactPath } from "./task-paths.js";
import { createHash } from "node:crypto";
import { getOperationalStore } from "../storage/operational-context.js";
import { needsExistingProjectScope, withExistingProjectScope } from "../storage/existing-project-scope.js";
import { iterateEvents, validateEventLedger, withEventLedgerAudit } from "./events.js";
import { readWorkState } from "./work-state.js";
import { canonicalFingerprint } from "./artifacts.js";

async function ledgerTail(target, packageRoot, options) {
  let last = null;
  for await (const event of iterateEvents(target, packageRoot, options)) last = event;
  return {
    sequence: last?.seq ?? 0,
    hash: last?.hash ?? null,
  };
}

async function buildPortableTaskSnapshot({
  target,
  packageRoot,
  taskId = null,
  eventsPath = null,
  stateFile = null,
} = {}) {
  const options = { packageRoot, taskId, ...(eventsPath ? { eventsPath } : {}) };
  const state = await readWorkState(target, { ...options, ...(stateFile ? { statePath: stateFile } : {}) });
  const before = {
    stateRevision: state?.revision ?? null,
    ...await ledgerTail(target, packageRoot, options),
  };

  const validation = await validateEventLedger(target, packageRoot, options);

  const rereadState = await readWorkState(target, { ...options, ...(stateFile ? { statePath: stateFile } : {}) });
  const after = {
    stateRevision: rereadState?.revision ?? null,
    ...await ledgerTail(target, packageRoot, options),
  };

  const consistent = JSON.stringify(before) === JSON.stringify(after);

  return {
    consistent,
    taskId: taskId ?? state?.taskId ?? rereadState?.taskId ?? null,
    anchors: before,
    capturedAt: new Date().toISOString(),
    integrity: {
      valid: validation.valid,
      errors: validation.errors,
      eventCount: validation.events.length,
      fingerprint: canonicalFingerprint(validation.events.map(({ seq, event, at }) => ({ seq, event, at }))),
    },
    state: rereadState,
    events: validation.events,
  };
}


function eventSummaryFingerprint(events) {
  const digest = createHash("sha256");
  digest.update("[");
  let first = true;
  for (const { seq, event, at } of events) {
    if (!first) digest.update(",");
    first = false;
    // Same sorted keys/undefined omission as canonicalFingerprint({seq,event,at}).
    digest.update(JSON.stringify({ at, event, seq }));
  }
  return digest.update("]").digest("hex");
}

/** Internal callback keeps event source owned until the projection finishes. */
export async function withTaskSnapshot(options, callback) {
  const { target, packageRoot, taskId = null, eventsPath = null, stateFile = null } = options;
  if (await needsExistingProjectScope(target)) {
    return withExistingProjectScope(target, () => withTaskSnapshot(options, callback), { readOnly: true });
  }
  if (!getOperationalStore(target) || (stateFile && (!taskId || stateFile !== taskArtifactPath(taskId, "state")))) {
    return callback(await buildPortableTaskSnapshot(options));
  }
  return withEventLedgerAudit(target, packageRoot, { taskId, ...(eventsPath ? { eventsPath } : {}) }, async validation => {
    if (Array.isArray(validation.events)) return callback(await buildPortableTaskSnapshot(options));
    const state = await readWorkState(target, { packageRoot, taskId, ...(stateFile ? { statePath: stateFile } : {}) });
    const tail = validation.events.at(-1);
    return callback({ consistent: true, taskId: taskId ?? state?.taskId ?? null,
      anchors: { stateRevision: state?.revision ?? null, sequence: tail?.seq ?? 0, hash: tail?.hash ?? null },
      capturedAt: new Date().toISOString(),
      integrity: { valid: validation.valid, errors: validation.errors, eventCount: validation.events.length,
        fingerprint: eventSummaryFingerprint(validation.events) },
      state, events: validation.events });
  });
}

export async function buildTaskSnapshot(options = {}) {
  return withTaskSnapshot(options, snapshot => ({ ...snapshot, events: Array.isArray(snapshot.events) ? snapshot.events : [...snapshot.events] }));
}
