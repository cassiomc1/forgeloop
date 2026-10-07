import { canonicalFingerprint, readJsonArtifact, writeJsonArtifact } from "./artifacts.js";
import { assertSchema, readSchema } from "./schema-validation.js";
import { assertSecretFree } from "./receipt.js";
import { getPackageRoot } from "./templates.js";
import { currentChangedPaths } from "./repository.js";
import { readContract } from "./contract.js";
import { readPersistedRoute } from "./route-artifact.js";
import { readWorkState } from "./work-state.js";
import { resolveTaskClaimState } from "./task-claim-state.js";
import { normalizeWriteClaims } from "./task-scope.js";
import { taskResponsibilityPath } from "./task-paths.js";
import { ensureWithin, fileExists } from "./filesystem.js";
import { getOperationalStore, operationalArtifactExists } from "../storage/operational-context.js";
import { needsExistingProjectScope, withExistingProjectScope } from "../storage/existing-project-scope.js";
import { appendProtocolEvent, withEventLedgerAudit } from "./events.js";
import { withTaskTransaction } from "./transaction.js";
import { assertTaskMutationAllowed } from "./task-claim-state.js";
import { assertWorkspaceBinding } from "./workspace-binding.js";

function responsibilityError(code, message, artifacts = []) {
  const error = new Error(message);
  error.name = "ResponsibilityError";
  error.code = code;
  error.artifacts = artifacts;
  return error;
}

function normalizePaths(paths, label) {
  try {
    return normalizeWriteClaims(paths ?? []);
  } catch (error) {
    throw responsibilityError("E_RESPONSIBILITY_INVALID", `${label}: ${error.message}`);
  }
}

function coversPath(prefix, candidate) {
  if (prefix === ".") return true;
  return candidate === prefix || candidate.startsWith(`${prefix}/`);
}

function pathScopeErrors(responsibility, changedPaths) {
  if (changedPaths === null) {
    return [responsibilityError("E_RESPONSIBILITY_SCOPE_VIOLATION", "Changed paths cannot be resolved for responsibility validation")];
  }
  if (!Array.isArray(changedPaths)) {
    return [responsibilityError("E_RESPONSIBILITY_SCOPE_VIOLATION", "Changed paths must be a list of relative paths")];
  }
  const unsafePaths = [];
  const normalizedChangedPaths = [];
  for (const value of changedPaths) {
    try {
      normalizedChangedPaths.push(normalizeWriteClaims([value])[0]);
    } catch {
      unsafePaths.push(String(value));
    }
  }
  const allowed = responsibility.allowedPaths;
  const readOnly = responsibility.readOnlyPaths;
  const outOfScope = normalizedChangedPaths.filter((item) => !allowed.some((prefix) => coversPath(prefix, item)));
  const readOnlyChanges = normalizedChangedPaths.filter((item) => readOnly.some((prefix) => coversPath(prefix, item)));
  const errors = [];
  if (unsafePaths.length > 0) {
    errors.push(responsibilityError("E_RESPONSIBILITY_SCOPE_VIOLATION", `Changed paths are not safe relative paths: ${unsafePaths.join(", ")}`));
  }
  if (outOfScope.length > 0) {
    errors.push(responsibilityError("E_RESPONSIBILITY_SCOPE_VIOLATION", `Changed paths are outside allowed responsibility paths: ${outOfScope.join(", ")}`));
  }
  if (readOnlyChanges.length > 0) {
    errors.push(responsibilityError("E_RESPONSIBILITY_SCOPE_VIOLATION", `Changed paths violate read-only responsibility paths: ${readOnlyChanges.join(", ")}`));
  }
  return errors;
}

/** Validate the active responsibility boundary against canonical changed paths. */
export function validateResponsibilityScope(responsibility, changedPaths) {
  return pathScopeErrors(responsibility, changedPaths);
}

export async function validateResponsibilityContract(value, packageRoot = getPackageRoot()) {
  try {
    assertSchema(value, await readSchema("responsibility", packageRoot), "responsibility contract");
  } catch (error) {
    throw responsibilityError("E_RESPONSIBILITY_INVALID", error.message);
  }
  try {
    const allowedPaths = normalizePaths(value.allowedPaths, "allowedPaths");
    const readOnlyPaths = normalizePaths(value.readOnlyPaths, "readOnlyPaths");
    const requiredCheckIds = [...new Set(value.requiredCheckIds)].sort();
    if (requiredCheckIds.length !== value.requiredCheckIds.length) {
      throw responsibilityError("E_RESPONSIBILITY_INVALID", "requiredCheckIds must not contain duplicates");
    }
    if (allowedPaths.some((item) => item === ".forgeloop" || item.startsWith(".forgeloop/"))) {
      throw responsibilityError("E_RESPONSIBILITY_INVALID", "allowedPaths cannot include ForgeLoop protocol metadata");
    }
    if (readOnlyPaths.some((item) => item === ".forgeloop" || item.startsWith(".forgeloop/"))) {
      throw responsibilityError("E_RESPONSIBILITY_INVALID", "readOnlyPaths cannot include ForgeLoop protocol metadata");
    }
    const normalized = {
      ...value,
      allowedPaths,
      readOnlyPaths,
      requiredCheckIds,
      frozenInputs: {
        contract: value.frozenInputs?.contract === true,
        route: value.frozenInputs?.route === true,
        claims: value.frozenInputs?.claims === true,
      },
      baseline: {
        contractFingerprint: value.baseline.contractFingerprint,
        routeFingerprint: value.baseline.routeFingerprint ?? null,
        claimsFingerprint: value.baseline.claimsFingerprint,
      },
    };
    assertSecretFree(normalized);
    return normalized;
  } catch (error) {
    if (error.code === "E_RESPONSIBILITY_INVALID") throw error;
    throw responsibilityError("E_RESPONSIBILITY_INVALID", error.message);
  }
}

export async function readResponsibility(target, { taskId, packageRoot = getPackageRoot() } = {}) {
  if (await needsExistingProjectScope(target)) {
    return withExistingProjectScope(target, () => readResponsibility(target, { taskId, packageRoot }), { readOnly: true });
  }
  const relativePath = taskResponsibilityPath(taskId);
  if (!(operationalArtifactExists(target, relativePath) ?? await fileExists(ensureWithin(target, relativePath)))) return null;
  try {
    const artifact = await readJsonArtifact(target, relativePath, "responsibility", packageRoot);
    const value = await validateResponsibilityContract(artifact.value, packageRoot);
    if (value.taskId !== taskId) throw responsibilityError("E_RESPONSIBILITY_INVALID", "Responsibility taskId does not match its task namespace", [relativePath]);
    return { ...artifact, value };
  } catch (error) {
    if (error.code === "E_RESPONSIBILITY_INVALID") throw error;
    throw responsibilityError("E_RESPONSIBILITY_INVALID", `Responsibility contract is invalid: ${error.message}`, [relativePath]);
  }
}

async function currentResponsibilityInputs(target, { taskId, packageRoot }) {
  const [contract, route, state, claims] = await Promise.all([
    readContract(target, packageRoot, { taskId }),
    readPersistedRoute(target, packageRoot, { taskId }),
    readWorkState(target, { packageRoot, taskId }),
    resolveTaskClaimState(target, { packageRoot, taskId }),
  ]);
  return {
    contract,
    route,
    state,
    claims,
    claimsFingerprint: canonicalFingerprint(claims.effectiveWriteClaims ?? []),
  };
}

export function validateResponsibilityFrozenInputs(responsibility, inputs) {
  const errors = [];
  const baseline = responsibility.baseline;
  if (responsibility.frozenInputs.contract && baseline.contractFingerprint !== inputs.contract.fingerprint) {
    errors.push(responsibilityError("E_RESPONSIBILITY_FROZEN_INPUT_DRIFT", "The current contract differs from the responsibility baseline"));
  }
  if (responsibility.frozenInputs.route && baseline.routeFingerprint !== (inputs.route?.fingerprint ?? null)) {
    errors.push(responsibilityError("E_RESPONSIBILITY_FROZEN_INPUT_DRIFT", "The current route differs from the responsibility baseline"));
  }
  if (responsibility.frozenInputs.claims && baseline.claimsFingerprint !== inputs.claimsFingerprint) {
    errors.push(responsibilityError("E_RESPONSIBILITY_FROZEN_INPUT_DRIFT", "The current effective write claims differ from the responsibility baseline"));
  }
  return errors;
}

export function validateResponsibilityChecks(responsibility, state) {
  const checks = new Map((state?.checks ?? [])
    .filter((check) => (check.details?.verificationCycle ?? state?.verificationCycle ?? 1) === (state?.verificationCycle ?? 1))
    .map((check) => [check.id, check]));
  const missing = responsibility.requiredCheckIds.filter((id) => checks.get(id)?.status !== "passed");
  return missing.length === 0
    ? []
    : [responsibilityError("E_RESPONSIBILITY_REQUIRED_CHECK_MISSING", `Required responsibility checks are missing or not passed: ${missing.join(", ")}`)];
}

export async function resolveResponsibilityStatus(target, { taskId, packageRoot = getPackageRoot() } = {}) {
  const read = () => resolveLoadedResponsibilityStatus(target, { taskId, packageRoot });
  if (await needsExistingProjectScope(target)) {
    return withExistingProjectScope(target, () => resolveResponsibilityStatus(target, { taskId, packageRoot }), { readOnly: true });
  }
  if (getOperationalStore(target)) return withEventLedgerAudit(target, packageRoot, { taskId }, read);
  return read();
}

async function resolveLoadedResponsibilityStatus(target, { taskId, packageRoot }) {
  const artifact = await readResponsibility(target, { taskId, packageRoot });
  if (!artifact) return { status: "NOT_APPLICABLE", taskId, path: taskResponsibilityPath(taskId), responsibility: null, errors: [] };
  let inputs;
  try {
    inputs = await currentResponsibilityInputs(target, { taskId, packageRoot });
  } catch (error) {
    return { status: "INVALID", taskId, path: artifact.path, responsibility: artifact.value, errors: [{ code: error.code ?? "E_RESPONSIBILITY_INVALID", message: error.message }] };
  }
  const changedPaths = await currentChangedPaths(target);
  const errors = [
    ...validateResponsibilityScope(artifact.value, changedPaths),
    ...validateResponsibilityFrozenInputs(artifact.value, inputs),
    ...validateResponsibilityChecks(artifact.value, inputs.state),
  ];
  return {
    status: errors.length === 0 ? "VALID" : "INVALID",
    taskId,
    path: artifact.path,
    fingerprint: artifact.fingerprint,
    responsibility: artifact.value,
    changedPaths,
    errors: errors.map((error) => ({ code: error.code, message: error.message })),
  };
}

export async function assertResponsibilityValid(target, options = {}) {
  const result = await resolveResponsibilityStatus(target, options);
  if (result.status === "NOT_APPLICABLE" || result.status === "VALID") return result;
  const first = result.errors[0] ?? { code: "E_RESPONSIBILITY_INVALID", message: "Responsibility constraints are invalid" };
  throw responsibilityError(first.code, first.message, [result.path]);
}

export async function buildResponsibilityContract(target, {
  taskId,
  label,
  allowedPaths,
  readOnlyPaths = [],
  requiredCheckIds = [],
  frozenInputs = {},
  packageRoot = getPackageRoot(),
  createdAt = new Date().toISOString(),
} = {}) {
  const inputs = await currentResponsibilityInputs(target, { taskId, packageRoot });
  const value = {
    schemaVersion: 1,
    protocolVersion: 1,
    taskId,
    label,
    createdAt,
    allowedPaths: normalizePaths(allowedPaths ?? inputs.claims.effectiveWriteClaims, "allowedPaths"),
    readOnlyPaths: normalizePaths(readOnlyPaths, "readOnlyPaths"),
    requiredCheckIds: [...new Set(requiredCheckIds)].sort(),
    frozenInputs: {
      contract: frozenInputs.contract === true,
      route: frozenInputs.route === true,
      claims: frozenInputs.claims === true,
    },
    baseline: {
      contractFingerprint: inputs.contract.fingerprint,
      routeFingerprint: inputs.route?.fingerprint ?? null,
      claimsFingerprint: inputs.claimsFingerprint,
    },
  };
  return validateResponsibilityContract(value, packageRoot);
}

export async function setResponsibilityContract(target, options = {}) {
  const { taskId, packageRoot = getPackageRoot() } = options;
  const relativePath = taskResponsibilityPath(taskId);
  return withTaskTransaction({ target, taskId, packageRoot, operation: "responsibility-set", recordCommitEvent: true }, async () => {
    await assertTaskMutationAllowed(target, { taskId, packageRoot });
    await assertWorkspaceBinding(target, { taskId, packageRoot, operation: "responsibility-set" });
    if (operationalArtifactExists(target, relativePath) ?? await fileExists(ensureWithin(target, relativePath))) {
      throw responsibilityError("E_RESPONSIBILITY_INVALID", "Responsibility contract is immutable during a pass", [relativePath]);
    }
    const state = await readWorkState(target, { packageRoot, taskId });
    if (state && ["EXECUTING", "VERIFYING", "DIAGNOSING", "CORRECTING", "REVIEWING", "COMPLETE"].includes(state.phase)) {
      throw responsibilityError("E_RESPONSIBILITY_INVALID", `Responsibility must be established before execution begins (current phase: ${state.phase})`, [relativePath]);
    }
    const value = await buildResponsibilityContract(target, options);
    const artifact = await writeJsonArtifact(target, relativePath, value, "responsibility", packageRoot, { taskId, operation: "responsibility-set" });
    await appendProtocolEvent(target, {
      taskId,
      event: "RESPONSIBILITY_SET",
      fingerprint: artifact.fingerprint,
      details: { responsibilityFingerprint: artifact.fingerprint, label: value.label },
    }, packageRoot, { taskId });
    return { taskId, path: relativePath, fingerprint: artifact.fingerprint, responsibility: value };
  });
}
