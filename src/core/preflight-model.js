import { ARTIFACT_PATHS } from "./artifacts.js";

export function issue(code, message, artifacts = [], details = {}) {
  return { code, message, artifacts, ...details };
}

export function sortIssues(errors) {
  const unique = [...new Map(errors.map((error) => [
    `${error.code}\0${error.artifacts.join("\0")}\0${error.message}`,
    error,
  ])).values()];
  return unique.sort((left, right) => left.code.localeCompare(right.code)
    || left.artifacts.join("\0").localeCompare(right.artifacts.join("\0"))
    || left.message.localeCompare(right.message));
}

export function preflightError(code, message, artifacts = []) {
  const error = new Error(message);
  error.code = code;
  error.artifacts = artifacts;
  return error;
}

export function sameStringSet(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  return leftSet.size === left.length
    && rightSet.size === right.length
    && leftSet.size === rightSet.size
    && [...leftSet].every((value) => rightSet.has(value));
}

export function validatePersistedPreflight(persisted, current, readError = null) {
  if (readError?.taskIdentityMismatch) return [issue("E_PREFLIGHT_TASK_MISMATCH", "Persisted preflight does not belong to the current task", [ARTIFACT_PATHS.preflight, ARTIFACT_PATHS.contract])];
  return validatePersistedPreflightPayload(persisted, current);
}

function validatePersistedPreflightPayload(persisted, current) {
  const errors = [];
  if (persisted?.status !== "READY") {
    if (Array.isArray(persisted?.errors) && persisted.errors.length > 0) {
      errors.push(...persisted.errors);
    } else {
      errors.push(issue("E_PREFLIGHT_NOT_READY", "A persisted READY preflight is required", [ARTIFACT_PATHS.preflight]));
    }
    return errors;
  }
  if (current?.status !== "READY") {
    if (Array.isArray(current?.errors) && current.errors.length > 0) {
      errors.push(...current.errors);
    } else {
      errors.push(issue("E_PREFLIGHT_NOT_READY", "The current preflight evaluation is not READY", [ARTIFACT_PATHS.preflight]));
    }
  }
  if (persisted.taskId !== current?.taskId) {
    errors.push(issue(
      "E_PREFLIGHT_TASK_MISMATCH",
      "Persisted preflight does not belong to the current task",
      [ARTIFACT_PATHS.preflight, ARTIFACT_PATHS.contract],
    ));
  }
  if (persisted.fingerprints?.contract !== current?.fingerprints?.contract
    || persisted.contract?.fingerprint !== current?.contract?.fingerprint) {
    errors.push(issue(
      "E_PREFLIGHT_CONTRACT_STALE",
      "Persisted preflight does not match the current contract fingerprint",
      [ARTIFACT_PATHS.preflight, ARTIFACT_PATHS.contract],
    ));
  }
  if (persisted.fingerprints?.routing !== current?.fingerprints?.routing
    || persisted.routing?.fingerprint !== current?.routing?.fingerprint) {
    errors.push(issue(
      "E_PREFLIGHT_ROUTE_STALE",
      "Persisted preflight does not match the current routing fingerprint",
      [ARTIFACT_PATHS.preflight, ARTIFACT_PATHS.route],
    ));
  }
  if (!sameStringSet(persisted.requiredGates, current?.requiredGates)
    || !sameStringSet(persisted.satisfiedGates, current?.satisfiedGates)) {
    errors.push(issue(
      "E_PREFLIGHT_GATES_STALE",
      "Persisted preflight gate sets do not match the current evaluation",
      [ARTIFACT_PATHS.preflight, ARTIFACT_PATHS.gates],
    ));
  }
  return sortIssues(errors);
}

export const PREFLIGHT_IDENTITY_BARRIER_CODES = new Set([
  "E_CONTRACT_STALE",
  "E_GATE_TASK_MISMATCH",
  "E_ROUTE_STALE",
  "E_STATE_TASK_MISMATCH",
  "E_ROUTE_GUIDE_MISMATCH",
]);
