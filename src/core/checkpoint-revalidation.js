import { canonicalFingerprint } from "./artifacts.js";
import {
  resolveCanonicalRouteEvolution,
  resolveCanonicalPostRepairRouteBinding,
  resolveEffectiveContractBootstrapRepairAnchor,
} from "./contract-bootstrap-recovery.js";

export const CHECKPOINT_REVALIDATED_EVENT = "CHECKPOINT_REVALIDATED";
export const CHECKPOINT_REVALIDATION_PHASES = Object.freeze(["ROUTED"]);

const REPOSITORY_FINGERPRINT_KEYS = Object.freeze(["branch", "head"]);
const REVALIDATION_DETAIL_KEYS = Object.freeze([
  "phase",
  "previousRepositoryFingerprint",
  "repositoryFingerprint",
  "contractFingerprint",
  "routeFingerprint",
  "previousStateRevision",
  "revalidatedStateRevision",
  "previousStateFingerprint",
  "revalidatedStateFingerprint",
]);

function invalid(message) {
  const error = new Error(message);
  error.code = "E_CHECKPOINT_REVALIDATION_UNSAFE";
  return error;
}

function isFingerprint(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

export function assertRepositoryFingerprint(value, label = "repository fingerprint", { requireHead = false } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== REPOSITORY_FINGERPRINT_KEYS.length
    || REPOSITORY_FINGERPRINT_KEYS.some((key) => !Object.prototype.hasOwnProperty.call(value, key))) {
    throw invalid(`${label} must contain exactly branch and head`);
  }
  for (const key of REPOSITORY_FINGERPRINT_KEYS) {
    if (value[key] !== null && (typeof value[key] !== "string" || !value[key].trim())) {
      throw invalid(`${label}.${key} must be a non-empty string or null`);
    }
  }
  if (requireHead && typeof value.head !== "string") {
    throw invalid(`${label}.head must be available`);
  }
  return value;
}

export function assertCheckpointRevalidatedDetails(details) {
  if (!details || typeof details !== "object" || Array.isArray(details)
    || Object.keys(details).length !== REVALIDATION_DETAIL_KEYS.length
    || REVALIDATION_DETAIL_KEYS.some((key) => !Object.prototype.hasOwnProperty.call(details, key))) {
    throw invalid(`${CHECKPOINT_REVALIDATED_EVENT} requires its exact state-transition detail set`);
  }
  if (!CHECKPOINT_REVALIDATION_PHASES.includes(details.phase)) {
    throw invalid(`${CHECKPOINT_REVALIDATED_EVENT} details.phase is unsupported`);
  }
  assertRepositoryFingerprint(details.previousRepositoryFingerprint, `${CHECKPOINT_REVALIDATED_EVENT} details.previousRepositoryFingerprint`);
  assertRepositoryFingerprint(details.repositoryFingerprint, `${CHECKPOINT_REVALIDATED_EVENT} details.repositoryFingerprint`, { requireHead: true });
  if (JSON.stringify(details.previousRepositoryFingerprint) === JSON.stringify(details.repositoryFingerprint)) {
    throw invalid(`${CHECKPOINT_REVALIDATED_EVENT} must record repository drift`);
  }
  for (const key of ["contractFingerprint", "routeFingerprint", "previousStateFingerprint", "revalidatedStateFingerprint"]) {
    if (!isFingerprint(details[key])) throw invalid(`${CHECKPOINT_REVALIDATED_EVENT} details.${key} must be a lowercase SHA-256 fingerprint`);
  }
  for (const key of ["previousStateRevision", "revalidatedStateRevision"]) {
    if (!Number.isInteger(details[key]) || details[key] < 0) {
      throw invalid(`${CHECKPOINT_REVALIDATED_EVENT} details.${key} must be a non-negative integer`);
    }
  }
  if (details.revalidatedStateRevision !== details.previousStateRevision + 1) {
    throw invalid(`${CHECKPOINT_REVALIDATED_EVENT} state revisions must advance exactly once`);
  }
  return details;
}

function sameRepositoryFingerprint(left, right) {
  return left?.branch === right?.branch && left?.head === right?.head;
}

function bindingError(message) {
  return { code: "E_CHECKPOINT_REVALIDATION_UNSAFE", message };
}

function eventHash(event) {
  const { hash, ...body } = event ?? {};
  return canonicalFingerprint(body);
}

function routeEvolutionAfter(events, sourceEvent, sourceRouteFingerprint, targetRouteFingerprint) {
  const sourceIndex = events.indexOf(sourceEvent);
  if (sourceIndex < 0 || !isFingerprint(sourceRouteFingerprint) || !isFingerprint(targetRouteFingerprint)) {
    return false;
  }

  const contractFingerprint = sourceEvent.details?.contractFingerprint;
  const canonical = resolveCanonicalRouteEvolution(events, {
    taskId: sourceEvent.taskId,
    sourceSeq: sourceEvent.seq,
    sourceRouteFingerprint,
    targetRouteFingerprint,
    contractFingerprint,
  });
  if (!canonical) return false;

  const anchor = resolveEffectiveContractBootstrapRepairAnchor(events);
  if (anchor?.details?.contractFingerprint === contractFingerprint) {
    const binding = resolveCanonicalPostRepairRouteBinding(
      events,
      anchor.sourceMarker,
      targetRouteFingerprint,
    );
    return Boolean(binding?.reboundEvents?.some(({ reboundEvent }) =>
      reboundEvent.seq > sourceEvent.seq
      && reboundEvent.details.routeFingerprint === targetRouteFingerprint));
  }
  return canonical.valid;
}

/**
 * Resolves the only valid transaction witness for a checkpoint revalidation.
 * The witness is intentionally positional: a later transaction commit cannot
 * retroactively authorize an earlier revalidation event.
 */
export function resolveCheckpointRevalidationBoundary(events = [], revalidationEvent) {
  const index = events.findIndex((candidate) => candidate === revalidationEvent
    || (candidate?.seq === revalidationEvent?.seq
      && candidate?.taskId === revalidationEvent?.taskId
      && candidate?.event === CHECKPOINT_REVALIDATED_EVENT));
  if (index < 0) return null;
  const commitEvent = events[index + 1];
  if (!commitEvent
    || revalidationEvent?.event !== CHECKPOINT_REVALIDATED_EVENT
    || commitEvent.event !== "TRANSACTION_COMMITTED"
    || commitEvent.seq !== revalidationEvent.seq + 1
    || commitEvent.previousHash !== revalidationEvent.hash
    || revalidationEvent.hash !== eventHash(revalidationEvent)
    || commitEvent.hash !== eventHash(commitEvent)
    || commitEvent.taskId !== revalidationEvent.taskId
    || typeof commitEvent.details?.transactionId !== "string"
    || !commitEvent.details.transactionId
    || commitEvent.details.operation !== "checkpoint-revalidate") {
    return null;
  }
  return { revalidationEvent, transactionCommitEvent: commitEvent };
}

export function validateCheckpointRevalidationEventBindings(events = []) {
  const errors = [];
  const revalidations = events.filter((event) => event.event === CHECKPOINT_REVALIDATED_EVENT);
  for (let index = 0; index < revalidations.length; index += 1) {
    const event = revalidations[index];
    let details;
    try {
      details = assertCheckpointRevalidatedDetails(event.details);
    } catch (error) {
      errors.push(bindingError(`event ${event.seq}: ${error.message}`));
      continue;
    }
    if (!resolveCheckpointRevalidationBoundary(events, event)) {
      errors.push(bindingError(`event ${event.seq} must be immediately followed by its checkpoint-revalidate transaction commit`));
    }
    const previous = revalidations[index - 1]?.details;
    if (previous) {
      if (!sameRepositoryFingerprint(details.previousRepositoryFingerprint, previous.repositoryFingerprint)) {
        errors.push(bindingError(`event ${event.seq} is disconnected from the previous checkpoint revalidation repository`));
      }
      if (details.previousStateRevision < previous.revalidatedStateRevision) {
        errors.push(bindingError(`event ${event.seq} rolls back the previous checkpoint revalidation revision`));
      }
      if (details.previousStateRevision === previous.revalidatedStateRevision
        && details.previousStateFingerprint !== previous.revalidatedStateFingerprint) {
        errors.push(bindingError(`event ${event.seq} does not continue the previous checkpoint revalidation state fingerprint`));
      }
      if (details.contractFingerprint !== previous.contractFingerprint) {
        errors.push(bindingError(`event ${event.seq} changes the checkpoint revalidation contract identity`));
      }
      if (details.routeFingerprint !== previous.routeFingerprint) {
        const evolved = details.previousStateRevision > previous.revalidatedStateRevision
          && routeEvolutionAfter(events, revalidations[index - 1], previous.routeFingerprint, details.routeFingerprint);
        if (!evolved) {
          errors.push(bindingError(`event ${event.seq} changes the checkpoint revalidation route identity without canonical route provenance`));
        }
      }
    } else {
      const anchor = resolveEffectiveContractBootstrapRepairAnchor(events);
      if (anchor?.details?.reconstructedStateRevision === details.previousStateRevision
        && anchor.details.reconstructedStateFingerprint !== details.previousStateFingerprint) {
        errors.push(bindingError(`event ${event.seq} does not bind the repaired checkpoint state fingerprint`));
      }
    }
  }
  return errors;
}

export function validateCheckpointRevalidationCurrentBinding(state, events = []) {
  const errors = [];
  const revalidations = events.filter((event) => event.event === CHECKPOINT_REVALIDATED_EVENT);
  const latest = revalidations.at(-1);
  for (const event of revalidations) {
    const details = event.details;
    if (state?.contractFingerprint && details?.contractFingerprint !== state.contractFingerprint) {
      errors.push(bindingError(`event ${event.seq} does not bind the current contract identity`));
    }
    if (state?.routeFingerprint && details?.routeFingerprint !== state.routeFingerprint) {
      const routeChangedAfterCheckpoint = Number.isInteger(state.revision)
        && Number.isInteger(details?.revalidatedStateRevision)
        && state.revision > details.revalidatedStateRevision;
      const evolved = routeChangedAfterCheckpoint
        && routeEvolutionAfter(events, event, details.routeFingerprint, state.routeFingerprint);
      if (!evolved) {
        errors.push(bindingError(`event ${event.seq} does not bind the current route identity through canonical route provenance`));
      }
    }
  }
  if (state && latest && state.revision === latest.details.revalidatedStateRevision) {
    const details = latest.details;
    if (!sameRepositoryFingerprint(state.repositoryFingerprint, details.repositoryFingerprint)) {
      errors.push(bindingError(`event ${latest.seq} does not bind the current repository fingerprint`));
    }
    if (state.phase !== details.phase || canonicalFingerprint(state) !== details.revalidatedStateFingerprint) {
      errors.push(bindingError(`event ${latest.seq} does not bind the current checkpoint state`));
    }
  }
  return errors;
}

/**
 * Validates the semantic chain of checkpoint-revalidation events. The event
 * hash proves bytes were not changed accidentally; these checks prove that a
 * rehashed event still describes a valid state transition.
 */
export function validateCheckpointRevalidationBindings(state, events = []) {
  return [
    ...validateCheckpointRevalidationEventBindings(events),
    ...validateCheckpointRevalidationCurrentBinding(state, events),
  ];
}
