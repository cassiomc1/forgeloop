import { ARTIFACT_PATHS } from "./artifacts.js";
import { readContract } from "./contract.js";
import { readPersistedRoute } from "./route-artifact.js";
import { appendProtocolEvent, validateEventLedger, withEventLedgerAudit } from "./events.js";
import { readWorkState } from "./work-state.js";
import { assertStateIdentity } from "./completion-relationships.js";
import { ensureResumableState, synchronizePreflightState } from "./resumability.js";
import {
  issue,
  PREFLIGHT_IDENTITY_BARRIER_CODES,
  preflightError,
  sameStringSet,
  sortIssues,
  validatePersistedPreflight,
} from "./preflight-model.js";

import { ledgerEventsOfTypes, ledgerTypeSummary } from "./ledger-event-collection.js";
import { taskArtifactPath } from "./task-paths.js";

async function readOptionalIdentityArtifact(readArtifact, invalidCode, artifactPath) {
  try {
    return await readArtifact();
  } catch (error) {
    if (error.code === "ARTIFACT_MISSING") return null;
    throw preflightError(invalidCode, error.message, [artifactPath]);
  }
}

export async function assertPreflightPersistenceSafety(target, packageRoot, taskIdOrOptions = {}, maybeOptions = {}) {
  const options = typeof taskIdOrOptions === "object" && taskIdOrOptions !== null ? taskIdOrOptions : maybeOptions;
  const taskId = typeof taskIdOrOptions === "string" ? taskIdOrOptions : (options.taskId ?? null);
  const contractRel = options.contractPath ?? (taskId && taskId !== "unknown" ? taskArtifactPath(taskId, "contract") : ARTIFACT_PATHS.contract);
  const routeRel = options.routePath ?? (taskId && taskId !== "unknown" ? taskArtifactPath(taskId, "route") : ARTIFACT_PATHS.route);
  const stateRel = options.statePath ?? (taskId && taskId !== "unknown" ? taskArtifactPath(taskId, "state") : ARTIFACT_PATHS.state);
  const eventsRel = options.eventsPath ?? (taskId && taskId !== "unknown" ? taskArtifactPath(taskId, "events") : ARTIFACT_PATHS.events);

  let state;
  try {
    state = await readWorkState(target, { packageRoot, taskId, statePath: options.statePath });
  } catch (error) {
    throw preflightError("E_STATE_INVALID", error.message, [stateRel]);
  }
  const contract = await readOptionalIdentityArtifact(
    () => readContract(target, packageRoot, { taskId, contractPath: options.contractPath }),
    "E_CONTRACT_INVALID",
    contractRel,
  );
  const route = await readOptionalIdentityArtifact(
    () => readPersistedRoute(target, packageRoot, { taskId, routePath: options.routePath }),
    "E_ROUTE_INVALID",
    routeRel,
  );
  if (state && (contract || route)) assertStateIdentity({ contract, route, state });

  const effectiveTaskId = taskId ?? contract?.value?.taskId ?? state?.taskId ?? null;
  if (effectiveTaskId === "unknown" || !effectiveTaskId) return null;
  const ledger = await validateEventLedger(target, packageRoot, { taskId, eventsPath: options.eventsPath });
  if (!ledger.valid) {
    const first = ledger.errors[0];
    throw preflightError(first.code, first.message, [eventsRel]);
  }
  if (ledger.events.some((event) => event.taskId !== effectiveTaskId)) {
    throw preflightError(
      "E_PHASE_CHRONOLOGY_INVALID",
      "Preflight cannot append events to a ledger owned by a different task",
      [eventsRel, contractRel],
    );
  }
  return ledger;
}

export function assertPreflightResultPersistenceSafety(result) {
  const identityError = result.errors.find((error) => PREFLIGHT_IDENTITY_BARRIER_CODES.has(error.code));
  if (identityError) throw preflightError(identityError.code, identityError.message, identityError.artifacts);
}

function sameReadyPreflightEvent(event, result) {
  return event.fingerprint === result.fingerprints.contract
    && event.details?.routingFingerprint === result.fingerprints.routing
    && sameStringSet(event.details?.requiredGates, result.requiredGates)
    && sameStringSet(event.details?.satisfiedGates, result.satisfiedGates);
}

function latestContractRevisionSeq(events) {
  return ledgerTypeSummary(events, "CONTRACT_REVISED").latest?.seq ?? 0;
}

function hasCurrentRevisionGate(events, taskId, gate) {
  const revisionSeq = latestContractRevisionSeq(events);
  for (const event of ledgerEventsOfTypes(events, ["GATE_SATISFIED"])) {
    if (event.taskId === taskId && event.details?.gate === gate && event.seq > revisionSeq) return true;
  }
  return false;
}

export async function validateReadyProtocolConsistency({
  target,
  packageRoot,
  persisted,
  current = null,
  evaluateCurrentPreflight,
  taskId = null,
} = {}) {
  if (persisted?.status !== "READY") return [];
  const result = current ?? await evaluateCurrentPreflight({ target, packageRoot, taskId });
  return withEventLedgerAudit(target, packageRoot, { taskId }, async ledger => {
    const errors = [...validatePersistedPreflight(persisted, result)];

    const stateRel = taskId ? taskArtifactPath(taskId, "state") : ARTIFACT_PATHS.state;
    const eventsRel = taskId ? taskArtifactPath(taskId, "events") : ARTIFACT_PATHS.events;
    const preflightRel = taskId ? taskArtifactPath(taskId, "preflight") : ARTIFACT_PATHS.preflight;
    const contractRel = taskId ? taskArtifactPath(taskId, "contract") : ARTIFACT_PATHS.contract;
    const routeRel = taskId ? taskArtifactPath(taskId, "route") : ARTIFACT_PATHS.route;
    const gatesRel = taskId ? taskArtifactPath(taskId, "gates") : ARTIFACT_PATHS.gates;

    let state = null;
    try {
      state = await readWorkState(target, { packageRoot, taskId });
    } catch (error) {
      errors.push(issue("E_STATE_INVALID", error.message, [stateRel]));
    }
    if (!state) {
      errors.push(issue(
        "E_STATE_MISSING_AFTER_PREFLIGHT_READY",
        "A persisted READY preflight must have a resumable work-state checkpoint",
        [preflightRel, stateRel],
      ));
    } else {
      if (state.taskId !== persisted.taskId) {
        errors.push(issue("E_STATE_TASK_MISMATCH", "The resumable checkpoint does not belong to the READY preflight task", [stateRel, preflightRel]));
      }
      if (state.contractFingerprint !== result.fingerprints.contract) {
        errors.push(issue("E_CONTRACT_STALE", "The resumable checkpoint does not match the READY contract fingerprint", [stateRel, contractRel]));
      }
      if (state.routeFingerprint !== result.fingerprints.routing) {
        errors.push(issue("E_ROUTE_STALE", "The resumable checkpoint does not match the READY routing fingerprint", [stateRel, routeRel]));
      }
      if (JSON.stringify(state.selectedGuides) !== JSON.stringify(result.routing.guides)) {
        errors.push(issue("E_ROUTE_GUIDE_MISMATCH", "The resumable checkpoint guides do not match the READY routing result", [stateRel, routeRel]));
      }
      if (!sameStringSet(state.requiredGates ?? [], persisted.requiredGates)
        || !sameStringSet(state.satisfiedGates ?? [], persisted.satisfiedGates)) {
        errors.push(issue("E_PREFLIGHT_GATES_STALE", "The resumable checkpoint gate sets do not match the READY preflight", [stateRel, preflightRel, gatesRel]));
      }
    }

    if (!ledger.valid) {
      errors.push(...ledger.errors.map((error) => issue(error.code ?? "E_EVENT_INVALID", error.message, [eventsRel])));
    }
    const events = ledger.events ?? [];
    const requiredEvents = ["CONTRACT_VALIDATED", "ROUTE_VALIDATED"];
    const observedEvents = new Set();
    for (const event of ledgerEventsOfTypes(events, requiredEvents)) {
      if (event.taskId === persisted.taskId) observedEvents.add(event.event);
    }
    for (const requiredEvent of requiredEvents) {
      if (!observedEvents.has(requiredEvent)) {
        errors.push(issue("E_PREFLIGHT_EVENT_MISSING", `READY preflight is missing lifecycle event: ${requiredEvent}`, [eventsRel, preflightRel]));
      }
    }
    for (const gate of persisted.satisfiedGates ?? []) {
      if (!hasCurrentRevisionGate(events, persisted.taskId, gate)) {
        errors.push(issue("E_PREFLIGHT_GATE_EVENT_MISSING", `READY preflight is missing lifecycle gate event: ${gate}`, [eventsRel, `${gatesRel}/${gate}.json`]));
      }
    }
    let readyCount = 0;
    let readyMatches = false;
    for (const event of ledgerEventsOfTypes(events, ["PREFLIGHT_READY"])) {
      if (event.taskId !== persisted.taskId) continue;
      readyCount++;
      if (sameReadyPreflightEvent(event, result)) readyMatches = true;
    }
    if (readyCount === 0) {
      errors.push(issue("E_PREFLIGHT_READY_EVENT_MISSING", "Persisted READY preflight is missing the matching PREFLIGHT_READY lifecycle event", [preflightRel, eventsRel]));
    } else if (!readyMatches) {
      errors.push(issue("E_PREFLIGHT_READY_EVENT_MISMATCH", "PREFLIGHT_READY lifecycle details do not match the persisted READY preflight", [preflightRel, eventsRel]));
    }
    return sortIssues(errors);
  });
}

function sameBlockedPreflightEvent(event, result) {
  return event.event === "PREFLIGHT_BLOCKED"
    && event.taskId === result.taskId
    && event.fingerprint === (result.fingerprints.contract ?? undefined)
    && sameStringSet(event.details?.requiredGates, result.requiredGates)
    && sameStringSet(event.details?.satisfiedGates, result.satisfiedGates)
    && event.details?.routingFingerprint === result.fingerprints.routing;
}

/**
 * Returns the latest recorded preflight outcome event (READY or BLOCKED) for
 * the task. An append-only lifecycle may legitimately contain an older READY
 * event that was superseded by a later BLOCKED outcome (for example after the
 * contract evolved or a gate requirement was added); the binding chronology is
 * the latest outcome, not the first READY ever recorded.
 */
function latestPreflightOutcomeEvent(events, taskId) {
  let latest = null;
  for (const event of events) {
    if ((event.event === "PREFLIGHT_READY" || event.event === "PREFLIGHT_BLOCKED")
      && event.taskId === taskId) {
      latest = event;
    }
  }
  return latest;
}

export function assertExistingReadyLifecycleCompatibility(ledger, result) {
  if (result.status !== "READY") return;
  const events = ledger?.events ?? [];
  const existingReady = events.findLast((event) => event.event === "PREFLIGHT_READY" && event.taskId === result.taskId);
  if (!existingReady) return;
  const latestOutcome = latestPreflightOutcomeEvent(events, result.taskId);
  const revisedAfterReady = events.some((event) => event.event === "CONTRACT_REVISED"
    && event.taskId === result.taskId
    && event.seq > existingReady.seq);
  // A READY outcome superseded by a later BLOCKED outcome may be replaced by a
  // fresh READY with different details once the blocked preflight is resolved.
  if (latestOutcome?.event === "PREFLIGHT_BLOCKED" || revisedAfterReady) return;
  if (!sameReadyPreflightEvent(existingReady, result)) {
    throw preflightError(
      "E_PHASE_CHRONOLOGY_INVALID",
      "PREFLIGHT_READY already exists with different READY preflight details; repair the contract, route, or gate lifecycle before refreshing preflight",
      [ARTIFACT_PATHS.preflight, ARTIFACT_PATHS.events, ARTIFACT_PATHS.contract, ARTIFACT_PATHS.route, ARTIFACT_PATHS.gates],
    );
  }
}

export async function appendActivationEvents(target, packageRoot, ledger, result, options = {}) {
  const events = [...(ledger?.events ?? [])];
  const hasEvent = (eventName) => events.some((event) => event.event === eventName && event.taskId === result.taskId);
  const append = async (input) => {
    const event = await appendProtocolEvent(target, input, packageRoot, options);
    events.push(event);
  };

  if (events.length === 0) await append({ taskId: result.taskId, event: "TASK_RECEIVED" });
  if (result.contract.status === "valid" && !hasEvent("CONTRACT_VALIDATED")) {
    await append({ taskId: result.taskId, event: "CONTRACT_VALIDATED", fingerprint: result.fingerprints.contract });
  }
  if (result.routing.status === "valid" && !hasEvent("ROUTE_VALIDATED")) {
    await append({ taskId: result.taskId, event: "ROUTE_VALIDATED", fingerprint: result.fingerprints.routing });
  }
  for (const gate of result.satisfiedGates) {
    if (!hasCurrentRevisionGate(events, result.taskId, gate)) {
      await append({ taskId: result.taskId, event: "GATE_SATISFIED", details: { gate } });
    }
  }

  const existingReady = events.findLast((event) => event.event === "PREFLIGHT_READY" && event.taskId === result.taskId);
  const latestOutcome = latestPreflightOutcomeEvent(events, result.taskId);
  const readySupersededByBlocked = existingReady && latestOutcome?.event === "PREFLIGHT_BLOCKED";
  const readySupersededByContractRevision = existingReady && events.some((event) => event.event === "CONTRACT_REVISED"
    && event.taskId === result.taskId
    && event.seq > existingReady.seq);
  if (result.status === "READY") {
    if (existingReady && !readySupersededByBlocked && !readySupersededByContractRevision && !sameReadyPreflightEvent(existingReady, result)) {
      throw preflightError(
        "E_PHASE_CHRONOLOGY_INVALID",
        "PREFLIGHT_READY already exists with different READY preflight details; repair the contract, route, or gate lifecycle before refreshing preflight",
        [ARTIFACT_PATHS.preflight, ARTIFACT_PATHS.events, ARTIFACT_PATHS.contract, ARTIFACT_PATHS.route, ARTIFACT_PATHS.gates],
      );
    }
    if (!existingReady || readySupersededByBlocked || readySupersededByContractRevision) {
      await append({
        taskId: result.taskId,
        event: "PREFLIGHT_READY",
        fingerprint: result.fingerprints.contract ?? undefined,
        details: {
          requiredGates: result.requiredGates,
          satisfiedGates: result.satisfiedGates,
          routingFingerprint: result.fingerprints.routing,
        },
      });
    }
  } else if (!events.some((event) => sameBlockedPreflightEvent(event, result))) {
    await append({
      taskId: result.taskId,
      event: "PREFLIGHT_BLOCKED",
      fingerprint: result.fingerprints.contract ?? undefined,
      details: {
        requiredGates: result.requiredGates,
        satisfiedGates: result.satisfiedGates,
        routingFingerprint: result.fingerprints.routing,
      },
    });
  }
  return events;
}

export { ensureResumableState, synchronizePreflightState };
