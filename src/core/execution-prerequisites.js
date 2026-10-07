import { ARTIFACT_PATHS, readJsonArtifact } from "./artifacts.js";
import { readContract } from "./contract.js";
import { validateEventLedger, validateStateLedgerCoherence } from "./events.js";
import { evaluatePreflight, validatePersistedPreflight } from "./preflight.js";
import { readPersistedRoute } from "./route-artifact.js";
import { stateIdentityErrors } from "./completion-relationships.js";
import { classifyLoadedWorkState } from "./work-state.js";
import { taskArtifactPath } from "./task-paths.js";
import { hasCurrentGateEvidence } from "./gate-provenance.js";

const START_EXECUTION_EVENTS = Object.freeze([
  "CONTRACT_VALIDATED",
  "ROUTE_VALIDATED",
  "PREFLIGHT_READY",
]);
const POST_EXECUTION_PHASES = new Set([
  "EXECUTING",
  "VERIFYING",
  "DIAGNOSING",
  "CORRECTING",
  "REVIEWING",
  "COMPLETE",
]);
export const PREFLIGHT_ROUTE_IDENTITY_ERROR_MESSAGE = "PREFLIGHT_READY event routing fingerprint does not match the current READY preflight and route";
export const PREFLIGHT_CONTRACT_IDENTITY_ERROR_MESSAGE = "PREFLIGHT_READY event contract fingerprint does not match the current READY preflight";

export function hasExecutionStarted(phase) {
  return POST_EXECUTION_PHASES.has(phase);
}

export function prerequisiteError(prerequisites) {
  const first = prerequisites.errors[0];
  if (!first) return null;
  const error = new Error(first.message);
  error.code = first.code;
  error.artifacts = first.artifacts;
  return error;
}

export async function assertExecutionPrerequisites(input = {}) {
  const prerequisites = await evaluateStartExecutionPrerequisites(input);
  const error = prerequisiteError(prerequisites);
  if (error) throw error;
  return prerequisites;
}

function issue(code, message, artifacts = []) {
  return { code, message, artifacts };
}

function sameStringSet(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  return left.length === new Set(left).size
    && right.length === new Set(right).size
    && left.length === right.length
    && left.every((value) => right.includes(value));
}

async function load(loadArtifact, code, message, artifacts, errors) {
  try {
    return await loadArtifact();
  } catch (error) {
    if (error.code === "E_STATE_REVISION_CONFLICT") throw error;
    errors.push(issue(code, `${message}: ${error.message}`, artifacts));
    return null;
  }
}

function freshnessErrors(state, freshness) {
  if (freshness.status !== "REVALIDATION_REQUIRED") return [];
  return [issue(
    "E_STATE_REVALIDATION_REQUIRED",
    `EXECUTING requires a fresh work-state checkpoint: ${freshness.reasons.join(", ")}`,
    [
      ARTIFACT_PATHS.state,
      ARTIFACT_PATHS.contract,
      ...(state.requiredArtifacts?.map((artifact) => artifact.path) ?? []),
    ],
  )];
}

function prerequisiteLedgerErrors(ledger, taskId, preflight, route) {
  const errors = (ledger.errors ?? []).map((error) => issue(
    error.code ?? "E_PHASE_CHRONOLOGY_INVALID",
    error.message,
    [ARTIFACT_PATHS.events],
  ));
  const events = ledger.events ?? [];
  if (events.some((event) => event.taskId !== taskId)) {
    errors.push(issue(
      "E_PHASE_CHRONOLOGY_INVALID",
      "EXECUTING requires protocol prerequisite events to belong to the current task",
      [ARTIFACT_PATHS.events, ARTIFACT_PATHS.state, ARTIFACT_PATHS.contract],
    ));
    return errors;
  }
  const currentEvents = events.filter((event) => event.taskId === taskId);
  for (const requiredEvent of START_EXECUTION_EVENTS) {
    if (!currentEvents.some((event) => event.event === requiredEvent)) {
      errors.push(issue(
        "E_PHASE_CHRONOLOGY_INVALID",
        `EXECUTING requires a ${requiredEvent} protocol event`,
        [ARTIFACT_PATHS.events],
      ));
    }
  }
  // Bind to the latest PREFLIGHT_READY: an append-only lifecycle may contain an
  // older READY event superseded by a BLOCKED outcome and a fresh READY with
  // current details (see preflight-reactivation recovery).
  const preflightEvent = currentEvents.findLast((event) => event.event === "PREFLIGHT_READY");
  if (preflightEvent && (!sameStringSet(preflightEvent.details?.requiredGates, preflight.requiredGates)
    || !sameStringSet(preflightEvent.details?.satisfiedGates, preflight.satisfiedGates))) {
    errors.push(issue(
      "E_PHASE_CHRONOLOGY_INVALID",
      "PREFLIGHT_READY event gate sets do not match the current READY preflight",
      [ARTIFACT_PATHS.events, ARTIFACT_PATHS.preflight],
    ));
  }
  if (preflightEvent && preflightEvent.fingerprint !== preflight.fingerprints.contract) {
    errors.push(issue(
      "E_PHASE_CHRONOLOGY_INVALID",
      PREFLIGHT_CONTRACT_IDENTITY_ERROR_MESSAGE,
      [ARTIFACT_PATHS.events, ARTIFACT_PATHS.preflight, ARTIFACT_PATHS.contract],
    ));
  }
  if (preflightEvent && (preflightEvent.details?.routingFingerprint !== preflight.fingerprints.routing
    || preflightEvent.details?.routingFingerprint !== route.fingerprint)) {
    errors.push(issue(
      "E_PHASE_CHRONOLOGY_INVALID",
      PREFLIGHT_ROUTE_IDENTITY_ERROR_MESSAGE,
      [ARTIFACT_PATHS.events, ARTIFACT_PATHS.preflight, ARTIFACT_PATHS.route],
    ));
  }
  const latestContractRevisionSeq = currentEvents.findLast((event) => event.event === "CONTRACT_REVISED")?.seq ?? 0;
  const currentEpochSatisfiedGates = new Set(preflight.requiredGates.filter((gate) => (
    hasCurrentGateEvidence(currentEvents, taskId, gate, latestContractRevisionSeq)
  )));
  for (const gate of preflight.requiredGates) {
    if (!currentEpochSatisfiedGates.has(gate)) {
      errors.push(issue(
        "E_PHASE_CHRONOLOGY_INVALID",
        `execution started before current-contract gate satisfaction: ${gate}`,
        [ARTIFACT_PATHS.events, ARTIFACT_PATHS.preflight],
      ));
    }
  }
  return errors;
}

function prerequisiteArtifactPath(explicitPath, taskId, kind) {
  return explicitPath ?? (taskId ? taskArtifactPath(taskId, kind) : ARTIFACT_PATHS[kind]);
}

export async function evaluateStartExecutionPrerequisites({
  target,
  state,
  packageRoot,
  taskId = null,
  contractPath = null,
  routePath = null,
  statePath = null,
  preflightPath = null,
  eventsPath = null,
  readers = null,
} = {}) {
  const effectiveTaskId = taskId ?? null;
  const contractRel = prerequisiteArtifactPath(contractPath, effectiveTaskId, "contract");
  const routeRel = prerequisiteArtifactPath(routePath, effectiveTaskId, "route");
  const stateRel = prerequisiteArtifactPath(statePath, effectiveTaskId, "state");
  const preflightRel = prerequisiteArtifactPath(preflightPath, effectiveTaskId, "preflight");
  const eventsRel = prerequisiteArtifactPath(eventsPath, effectiveTaskId, "events");

  const errors = [];
  const requiredArtifacts = [
    stateRel,
    contractRel,
    routeRel,
    preflightRel,
    eventsRel,
  ];
  if (!state) {
    return {
      errors: [issue("E_PHASE_PREREQUISITE_MISSING", "EXECUTING requires a work state", [stateRel])],
      requiredArtifacts,
    };
  }

  const contract = await load(
    () => (readers?.readContract ?? readContract)(target, packageRoot, { taskId: effectiveTaskId, contractPath }),
    "E_PHASE_PREREQUISITE_MISSING",
    `EXECUTING requires ${contractRel}`,
    [contractRel],
    errors,
  );
  const route = await load(
    () => (readers?.readRoute ?? readPersistedRoute)(target, packageRoot, { taskId: effectiveTaskId, routePath }),
    "E_PHASE_PREREQUISITE_MISSING",
    `EXECUTING requires ${routeRel}`,
    [routeRel],
    errors,
  );
  if (!contract || !route) return { errors, requiredArtifacts, contract, route };

  if (state.routeFingerprint !== route.fingerprint) {
    errors.push(issue(
      "E_ROUTE_STALE",
      "EXECUTING requires work state and route to match the current contract",
      [stateRel, routeRel, contractRel],
    ));
  }
  errors.push(...stateIdentityErrors({ contract, route, state }));

  const freshness = await (readers?.classifyState ?? classifyLoadedWorkState)({
    target,
    state,
    contractFile: contractRel,
  });
  errors.push(...freshnessErrors(state, freshness));

  const preflight = await evaluatePreflight({ target, packageRoot, taskId: effectiveTaskId, contractPath, routePath, statePath, readers });
  let persistedPreflight = null;
  try {
    persistedPreflight = await (readers?.readPreflight ?? readJsonArtifact)(target, preflightRel, "preflight", packageRoot);
  } catch (error) {
    if (error.code === "E_STATE_REVISION_CONFLICT") throw error;
    // validatePersistedPreflight reports the stable, actionable preflight reason.
  }
  const persistedPreflightErrors = validatePersistedPreflight(persistedPreflight?.value, preflight);
  if (!sameStringSet(state.requiredGates, preflight.requiredGates)
    || !sameStringSet(state.satisfiedGates, preflight.satisfiedGates)) {
    errors.push(issue(
      "E_PREFLIGHT_GATES_STALE",
      "Work state gate sets do not match the current preflight evaluation",
      [stateRel, preflightRel, ARTIFACT_PATHS.gates],
    ));
  }

  const ledger = await (readers?.validateLedger ?? validateEventLedger)(target, packageRoot, { taskId: effectiveTaskId, eventsPath });
  errors.push(...prerequisiteLedgerErrors(ledger, contract.value.taskId, preflight, route));
  errors.push(...validateStateLedgerCoherence(state, ledger.events).map((error) => issue(
    error.code,
    error.message,
    [stateRel, eventsRel],
  )));
  errors.push(...persistedPreflightErrors);
  return { errors, requiredArtifacts, contract, route, preflight, persistedPreflight, ledger };
}
