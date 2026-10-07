import { needsExistingProjectScope, withExistingProjectScope } from "../storage/existing-project-scope.js";
import { operationalArtifactExists } from "../storage/operational-context.js";
import { canonicalFingerprint, readJsonArtifact, writeJsonArtifact } from "./artifacts.js";
import { assertSchema, readSchema } from "./schema-validation.js";
import { getPackageRoot } from "./templates.js";
import { currentRepositoryFingerprint } from "./repository.js";
import { resolveRevisionProvider } from "./revision/provider.js";
import { REVISION_PROVIDERS } from "./revision/registry.js";
import { readScopedCheckerCapabilities } from "./verification-scope-capability.js";
import { readContract } from "./contract.js";
import { readPersistedRoute } from "./route-artifact.js";
import { readWorkState } from "./work-state.js";
import { resolveTaskClaimState } from "./task-claim-state.js";
import { taskVerificationScopePath } from "./task-paths.js";
import { ensureWithin, fileExists } from "./filesystem.js";
import { appendProtocolEvent } from "./events.js";
import { withTaskTransaction } from "./transaction.js";
import { assertTaskMutationAllowed } from "./task-claim-state.js";
import { assertWorkspaceBinding } from "./workspace-binding.js";
import path from "node:path";

const MODES = Object.freeze(["AUTO", "CHANGED", "CLAIMED", "FULL"]);

function scopeError(code, message, artifacts = []) {
  const error = new Error(message);
  error.name = "VerificationScopeError";
  error.code = code;
  error.artifacts = artifacts;
  return error;
}

function normalizeScopePath(value, label = "path") {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
    throw scopeError("E_VERIFICATION_SCOPE_INVALID", `${label} must be a non-empty relative path`);
  }
  const replaced = value.replaceAll("\\", "/");
  if (replaced.startsWith("/") || /^[A-Za-z]:\//u.test(replaced)) {
    throw scopeError("E_VERIFICATION_SCOPE_INVALID", `${label} must be relative: ${value}`);
  }
  const normalized = path.posix.normalize(replaced);
  const canonical = normalized.replace(/^\.\//u, "");
  if (canonical === ".." || canonical.startsWith("../") || canonical === ".forgeloop" || canonical.startsWith(".forgeloop/")) {
    throw scopeError("E_VERIFICATION_SCOPE_INVALID", `${label} is outside the source boundary: ${value}`);
  }
  if (replaced !== canonical && replaced !== `./${canonical}`) {
    throw scopeError("E_VERIFICATION_SCOPE_INVALID", `${label} must use a canonical relative path: ${value}`);
  }
  return canonical;
}

function sortedPaths(paths, label = "paths") {
  if (!Array.isArray(paths)) throw scopeError("E_VERIFICATION_SCOPE_INVALID", `${label} must be an array`);
  return [...new Set(paths.map((value, index) => normalizeScopePath(value, `${label}[${index}]`)))].sort();
}

function pathCovered(pathValue, claims) {
  return claims.includes(".") || claims.some((claim) => pathValue === claim || pathValue.startsWith(`${claim}/`));
}

function requirementText(requirement) {
  return typeof requirement === "string" ? requirement : requirement?.text ?? "";
}

function requiresFullVerification(contract) {
  return [...(contract?.value?.verification ?? []), ...(contract?.value?.successCriteria ?? [])]
    .some((requirement) => /(?:full|entire|whole|global)\s+(?:project|repository|repo|suite|verification)|all\s+(?:tests|checks)/iu.test(requirementText(requirement)));
}

async function currentChangedPathsFromRevisionProvider(target) {
  try {
    const provider = await resolveRevisionProvider({ target, registry: REVISION_PROVIDERS });
    const entries = await provider.getChangedEntries({ target, headRevision: "WORKTREE" });
    return [...new Set(entries
      .flatMap((entry) => [entry.path, entry.sourcePath].filter(Boolean)))].sort((left, right) => left.localeCompare(right));
  } catch {
    return null;
  }
}

async function currentInputs(target, { taskId, packageRoot }) {
  const [contract, route, state, claims, repositoryFingerprint, changedPaths, checkerCapabilities] = await Promise.all([
    readContract(target, packageRoot, { taskId }),
    readPersistedRoute(target, packageRoot, { taskId }),
    readWorkState(target, { packageRoot, taskId }),
    resolveTaskClaimState(target, { packageRoot, taskId }),
    currentRepositoryFingerprint(target),
    currentChangedPathsFromRevisionProvider(target),
    readScopedCheckerCapabilities(target, packageRoot),
  ]);
  return {
    contract,
    route,
    state,
    claims,
    claimsFingerprint: canonicalFingerprint(claims.effectiveWriteClaims ?? []),
    repositoryFingerprint,
    changedPaths: changedPaths === null ? null : sortedPaths(changedPaths),
    checkerCapabilities,
  };
}

function normalizeMode(value) {
  const mode = String(value ?? "AUTO").toUpperCase();
  if (!MODES.includes(mode)) throw scopeError("E_VERIFICATION_SCOPE_INVALID", `Unsupported verification scope mode: ${value}`);
  return mode;
}

export async function validateVerificationScope(scope, packageRoot = getPackageRoot()) {
  try {
    assertSchema(scope, await readSchema("verification-scope", packageRoot), "verification scope");
  } catch (error) {
    throw scopeError("E_VERIFICATION_SCOPE_INVALID", error.message);
  }
  if (scope.taskId.length === 0 || scope.requestedMode === "IMPACTED" || scope.resolvedMode === "IMPACTED") {
    throw scopeError("E_VERIFICATION_SCOPE_INVALID", "IMPACTED is reserved for an explicit future mapping capability");
  }
  const canonical = {
    ...scope,
    changedPaths: sortedPaths(scope.changedPaths),
    claimedPaths: sortedPaths(scope.claimedPaths),
    selectedPaths: sortedPaths(scope.selectedPaths),
    reasons: [...scope.reasons],
  };
  return canonical;
}

export async function readVerificationScope(target, { taskId, packageRoot = getPackageRoot(), scopePath = null } = {}) {
  if (await needsExistingProjectScope(target)) {
    return withExistingProjectScope(target, () => readVerificationScope(target, { taskId, packageRoot, scopePath }), { readOnly: true });
  }
  const relativePath = scopePath ?? taskVerificationScopePath(taskId);
  if (!(operationalArtifactExists(target, relativePath) ?? await fileExists(ensureWithin(target, relativePath)))) {
    throw scopeError("E_VERIFICATION_SCOPE_INVALID", `Verification scope is missing: ${relativePath}`, [relativePath]);
  }
  try {
    const artifact = await readJsonArtifact(target, relativePath, "verification-scope", packageRoot);
    return { ...artifact, value: await validateVerificationScope(artifact.value, packageRoot) };
  } catch (error) {
    if (error.code === "E_VERIFICATION_SCOPE_INVALID") throw error;
    throw scopeError("E_VERIFICATION_SCOPE_INVALID", error.message, [relativePath]);
  }
}

export async function validateVerificationScopeFreshness(target, {
  taskId,
  scope,
  packageRoot = getPackageRoot(),
} = {}) {
  const current = await currentInputs(target, { taskId, packageRoot });
  const mismatches = [];
  if (scope.taskId !== taskId) mismatches.push("taskId");
  if (scope.verificationCycle !== (current.state?.verificationCycle ?? 1)) mismatches.push("verificationCycle");
  if (scope.contractFingerprint !== current.contract.fingerprint) mismatches.push("contractFingerprint");
  if (JSON.stringify(scope.repositoryFingerprint) !== JSON.stringify(current.repositoryFingerprint)) mismatches.push("repositoryFingerprint");
  if (JSON.stringify(sortedPaths(scope.changedPaths)) !== JSON.stringify(current.changedPaths)) mismatches.push("changedPaths");
  if (scope.claimsFingerprint && scope.claimsFingerprint !== current.claimsFingerprint) mismatches.push("claimsFingerprint");
  if (JSON.stringify(sortedPaths(scope.claimedPaths)) !== JSON.stringify(sortedPaths(current.claims.effectiveWriteClaims ?? []))) mismatches.push("claimedPaths");
  if (scope.checkerCapabilityFingerprint !== undefined
    && scope.checkerCapabilityFingerprint !== current.checkerCapabilities.fingerprint) mismatches.push("checkerCapabilityFingerprint");
  if (mismatches.length > 0) {
    throw scopeError("E_VERIFICATION_SCOPE_STALE", `Verification scope is stale; changed bindings: ${mismatches.join(", ")}`, [taskVerificationScopePath(taskId)]);
  }
  return { fresh: true, current };
}

export async function resolveVerificationScope(target, {
  taskId,
  mode = "AUTO",
  packageRoot = getPackageRoot(),
  createdAt = new Date().toISOString(),
} = {}) {
  const requestedMode = normalizeMode(mode);
  const inputs = await currentInputs(target, { taskId, packageRoot });
  if (!inputs.state) throw scopeError("E_VERIFICATION_SCOPE_UNRESOLVED", "Work state is required to resolve verification scope");
  const changedPaths = inputs.changedPaths;
  const claimedPaths = sortedPaths(inputs.claims.effectiveWriteClaims ?? []);
  const hasTrustedScopedChecker = inputs.checkerCapabilities.valid && inputs.checkerCapabilities.checkers.length > 0;
  const reasons = [];
  let resolvedMode = requestedMode;
  let selectedPaths = [];
  let fallback = null;

  const changedIsSafe = changedPaths !== null
    && inputs.claims.valid
    && changedPaths.every((item) => pathCovered(item, claimedPaths));
  if (requiresFullVerification(inputs.contract)) {
    if (requestedMode !== "FULL") reasons.push("The current contract explicitly requires full-project verification.");
    resolvedMode = "FULL";
    selectedPaths = [];
  } else if (requestedMode === "FULL") {
    resolvedMode = "FULL";
    reasons.push("Full verification was explicitly requested.");
  } else if (requestedMode === "CHANGED") {
    if (!hasTrustedScopedChecker) throw scopeError("E_VERIFICATION_SCOPE_UNRESOLVED", "CHANGED scope requires a trusted scoped-checker capability");
    if (changedPaths === null) throw scopeError("E_VERIFICATION_SCOPE_UNRESOLVED", "CHANGED scope cannot be proved because repository changes are unavailable");
    if (!inputs.claims.valid || !changedIsSafe) {
      throw scopeError("E_VERIFICATION_SCOPE_UNRESOLVED", "CHANGED scope cannot be used because every changed path is not inside valid effective task claims");
    }
    resolvedMode = "CHANGED";
    selectedPaths = changedPaths;
    reasons.push("Selected exact canonical changed paths inside effective task claims.");
  } else if (requestedMode === "CLAIMED") {
    if (!hasTrustedScopedChecker) throw scopeError("E_VERIFICATION_SCOPE_UNRESOLVED", "CLAIMED scope requires a trusted scoped-checker capability");
    if (!inputs.claims.valid || claimedPaths.length === 0) {
      throw scopeError("E_VERIFICATION_SCOPE_UNRESOLVED", "CLAIMED scope cannot be proved because effective task claims are unavailable");
    }
    resolvedMode = "CLAIMED";
    selectedPaths = claimedPaths;
    reasons.push("Selected the canonical effective task claims.");
  } else if (hasTrustedScopedChecker && changedIsSafe) {
    resolvedMode = "CHANGED";
    selectedPaths = changedPaths;
    reasons.push("AUTO selected exact changed paths because a trusted scoped checker exists and all paths are inside valid effective task claims.");
  } else if (hasTrustedScopedChecker && inputs.claims.valid && claimedPaths.length > 0 && changedPaths !== null) {
    resolvedMode = "CLAIMED";
    selectedPaths = claimedPaths;
    fallback = { from: "CHANGED", to: "CLAIMED", reason: "Changed paths could not be safely narrowed to the effective claims." };
    reasons.push("AUTO escalated to effective claims because a narrower changed-path boundary was not provable.");
  } else {
    resolvedMode = "FULL";
    selectedPaths = [];
    fallback = {
      from: "CHANGED",
      to: "FULL",
      reason: hasTrustedScopedChecker
        ? "Repository changes or claim ownership could not be proved."
        : "No trusted scoped-checker capability was established.",
    };
    reasons.push(hasTrustedScopedChecker
      ? "AUTO escalated to full verification because a narrow boundary was not provable."
      : "AUTO selected full verification because no trusted scoped-checker capability was established.");
  }

  const scope = await validateVerificationScope({
    schemaVersion: 1,
    protocolVersion: 1,
    taskId,
    requestedMode,
    resolvedMode,
    verificationCycle: inputs.state.verificationCycle ?? 1,
    changedPaths: changedPaths ?? [],
    claimedPaths,
    selectedPaths,
    reasons,
    fallback,
    contractFingerprint: inputs.contract.fingerprint,
    repositoryFingerprint: inputs.repositoryFingerprint,
    claimsFingerprint: inputs.claimsFingerprint,
    ...(inputs.checkerCapabilities.fingerprint
      ? { checkerCapabilityFingerprint: inputs.checkerCapabilities.fingerprint }
      : {}),
    createdAt,
  }, packageRoot);
  return { scope, inputs };
}

export async function persistVerificationScope(target, scope, options = {}) {
  return withTaskTransaction({ target, taskId: options.taskId, packageRoot: options.packageRoot, operation: "verify-scope" }, () => persistVerificationScopeInTransaction(target, scope, options));
}

async function persistVerificationScopeInTransaction(target, scope, { taskId, packageRoot = getPackageRoot() } = {}) {
  const relativePath = taskVerificationScopePath(taskId);
  const artifact = await writeJsonArtifact(target, relativePath, scope, "verification-scope", packageRoot, { taskId, operation: "verify-scope" });
  await appendProtocolEvent(target, {
    taskId,
    event: "VERIFICATION_SCOPE_CAPTURED",
    fingerprint: artifact.fingerprint,
    details: { scopeFingerprint: artifact.fingerprint, resolvedMode: scope.resolvedMode, verificationCycle: scope.verificationCycle },
  }, packageRoot, { taskId });
  return { path: relativePath, fingerprint: artifact.fingerprint, scope };
}

export async function captureVerificationScope(target, options = {}) {
  return withTaskTransaction({ target, taskId: options.taskId, packageRoot: options.packageRoot, operation: "verify-scope", recordCommitEvent: true }, async () => {
    await assertTaskMutationAllowed(target, { taskId: options.taskId, packageRoot: options.packageRoot });
    await assertWorkspaceBinding(target, { taskId: options.taskId, packageRoot: options.packageRoot, operation: "verify-scope" });
    const result = await resolveVerificationScope(target, options);
    return persistVerificationScope(target, result.scope, options);
  });
}
