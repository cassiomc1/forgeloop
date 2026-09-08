import { assertSafePath, fileExists, ensureWithin, readBytes, writeFileAtomic } from "../core/filesystem.js";
import {
  createManifest,
  readManifest,
  sha256,
  writeManifest,
} from "../core/manifest.js";
import { readTemplateEntries } from "../core/templates.js";
import { PROJECT_ARTIFACT_PATHS } from "../core/task-paths.js";
import { isKitPath } from "../core/target-layout.js";
import { E_INIT_KIT_CONFLICT, E_POLICY_INITIALIZATION_FAILED } from "../core/error-codes.js";
import { isRepositoryCandidate } from "../repository-index/lifecycle.js";
import { setupRepositoryIndex } from "../repository-index/server.js";

// Compatibility re-exports: the canonical semantic definitions live in
// src/core/error-codes.js; this keeps existing import paths working while
// ensuring there is exactly one literal source for each constant.
export { E_INIT_KIT_CONFLICT, E_POLICY_INITIALIZATION_FAILED };

/**
 * Executable-policy artifacts initialized by `forgeloop init`. The manifest is
 * the initialization commit marker and must never be written before these have
 * been produced and verified.
 */
export const POLICY_INIT_ARTIFACTS = Object.freeze([
  PROJECT_ARTIFACT_PATHS.policyDiscovery,
  PROJECT_ARTIFACT_PATHS.policyBaseline,
  PROJECT_ARTIFACT_PATHS.policyLock,
]);

function policyInitializationError(cause) {
  const error = new Error(`Executable policy initialization failed: ${cause.message}`);
  error.code = E_POLICY_INITIALIZATION_FAILED;
  error.cause = cause;
  error.artifacts = [...POLICY_INIT_ARTIFACTS];
  return error;
}

function baselineSemanticallyEqual(a, b) {
  return a?.schemaVersion === b?.schemaVersion
    && JSON.stringify(a?.entries ?? []) === JSON.stringify(b?.entries ?? []);
}

function lockSemanticallyEqual(a, b) {
  return a?.algorithm === b?.algorithm
    && a?.digest === b?.digest
    && a?.rulesDigest === b?.rulesDigest
    && a?.baselineDigest === b?.baselineDigest;
}

/**
 * Reconciles an existing policy artifact against the freshly computed
 * canonical initialized state.
 *
 *   - missing             -> write it
 *   - valid + equal       -> reuse (resumable output of a failed init)
 *   - valid + different   -> not provably ForgeLoop-owned: preserve and fail
 *                            with a deterministic conflict
 *   - invalid/corrupt     -> fail closed; never overwrite unknown content
 */
async function reconcilePolicyArtifact(target, packageRoot, readExisting, expected, { semanticEqual, label }) {
  let existing = null;
  try {
    existing = await readExisting(target, packageRoot);
  } catch (cause) {
    throw policyInitializationError(
      new Error(`${label} exists but is invalid and cannot be safely reconciled: ${cause.message}`),
    );
  }
  if (existing === null) return { action: "write" };
  if (semanticEqual(existing, expected)) return { action: "reuse" };
  throw policyInitializationError(
    new Error(`${label} does not match the canonical initialized state and is not provably ForgeLoop-owned; preserve it or remove it before re-running init`),
  );
}

/**
 * Classifies an existing template destination against the shipped template.
 * Shared by the pre-mutation conflict scan and the mutation loop so the two
 * phases cannot drift apart:
 *
 *   - MATCH            existing bytes equal the shipped template (resumable)
 *   - PRESERVE_PROFILE custom PROJECT_PROFILE.md (intentionally preservable)
 *   - KIT_CONFLICT     canonical hidden kit content differs (fail closed)
 *   - PRESERVE_UNOWNED pre-existing root/brownfield file (preserve, unowned)
 */
export function classifyExistingInitTemplate({ entry, existingBytes }) {
  const existingHash = sha256(existingBytes);
  const templateHash = sha256(entry.bytes);

  if (existingHash === templateHash) {
    return { kind: "MATCH", existingHash, templateHash };
  }
  if (entry.sourcePath === "PROJECT_PROFILE.md") {
    return { kind: "PRESERVE_PROFILE", existingHash, templateHash };
  }
  if (isKitPath(entry.relativePath)) {
    return { kind: "KIT_CONFLICT", existingHash, templateHash };
  }
  return { kind: "PRESERVE_UNOWNED", existingHash, templateHash };
}

function kitConflictError(relativePath) {
  const error = new Error(
    `Canonical ForgeLoop kit file conflicts with shipped template: ${relativePath}`,
  );
  error.code = E_INIT_KIT_CONFLICT;
  error.artifacts = [relativePath];
  return error;
}

async function prepareRepositoryIndexForInit({ target, dryRun, packageRoot, repositoryIndex, repositoryIndexOptions, actions }) {
  if (!repositoryIndex) return { status: "DISABLED", required: false };
  if (!(await isRepositoryCandidate(target))) {
    return { status: "DEFERRED", required: true, reason: "target is not a Git repository" };
  }
  if (dryRun) {
    return {
      status: "WOULD_SETUP",
      required: true,
      reason: "dry-run does not provision or execute the native index engine",
    };
  }

  const setup = await setupRepositoryIndex(target, { ...repositoryIndexOptions, packageRoot });
  actions.push({ action: "repository-index-ready", path: ".forgeloop/repository-index", reason: "managed tgrep index and watcher are ready" });
  return {
    status: "READY",
    required: true,
    health: setup.status?.health ?? "READY",
    engine: setup.status?.engine ?? "tgrep",
    engineVersion: setup.status?.engineVersion ?? null,
    indexPath: setup.status?.indexPath ?? null,
    server: setup.status?.server ?? null,
  };
}

/**
 * Initializes a target project with the ForgeLoop kit and executable-policy
 * bootstrap, committing manifest authority LAST.
 *
 * Execution order:
 *   PHASE 1 — READ / PLAN (no writes):
 *     1. validate all destination paths
 *     2. read template entries
 *     3. inspect the manifest
 *     4. classify every existing template destination; a canonical kit
 *        conflict throws E_INIT_KIT_CONFLICT before ANY write
 *     5. compute policy discovery, baseline, effective rules, and policy.lock
 *        in memory
 *     6. pre-reconcile existing policy artifacts (read-only) so a policy
 *        conflict also fails before any write
 *   PHASE 2 — MUTATE:
 *     7. write/reuse allowed kit files per the precomputed plan
 *     8. write/reuse policy artifacts per the precomputed decisions
 *     9. verify executable-policy capability and policy.lock
 *    10. write manifest atomically
 *    11. return success
 *
 * Any policy-bootstrap failure raises E_POLICY_INITIALIZATION_FAILED and
 * leaves no committed manifest, so a retry reconciles already-correct files
 * without manual cleanup.
 *
 * `init --dry-run` performs the same deterministic initialization planning and
 * conflict detection as real init (existing manifest, unsafe paths, canonical
 * kit conflicts, invalid or conflicting policy artifacts, and the computable
 * policy state), but performs NO mutation: it does not simulate filesystem
 * failures that only occur during a real write, power loss, post-write races,
 * or verification of bytes that were never written.
 *
 * `hooks` is a deterministic failure-injection seam used only by tests:
 *   afterPolicyDiscovery(discovery, { target, packageRoot })
 *   beforeBaselineWrite({ target, packageRoot, baseline })
 *   beforePolicyLockWrite({ target, packageRoot, lock })
 *   beforeManifestWrite({ target, packageRoot, manifest, actions })
 */
export async function runInit({
  target,
  dryRun,
  packageRoot,
  packageVersion,
  hooks = {},
  repositoryIndex,
  repositoryIndexOptions,
} = {}) {
  const entries = await readTemplateEntries(packageRoot);
  const existingManifest = await readManifest(target);
  if (existingManifest) {
    throw new Error("Target is already initialized; run forgeloop update instead.");
  }
  const manifest = createManifest(packageVersion);
  const actions = [];

  // 1. Validate every destination before any write so a symlinked kit cannot
  // leave a partially initialized target behind.
  for (const entry of entries) await assertSafePath(target, entry.relativePath);
  for (const relativePath of POLICY_INIT_ARTIFACTS) await assertSafePath(target, relativePath);

  // 4. Pre-scan every existing template destination during planning. A
  // deterministic canonical kit conflict must fail before ANY initialization
  // write: no adapter, no kit file, no policy artifact, no manifest.
  const initPlan = new Map();
  for (const entry of entries) {
    const destination = ensureWithin(target, entry.relativePath);
    if (!(await fileExists(destination))) continue;
    const existingBytes = await readBytes(destination);
    const classification = classifyExistingInitTemplate({ entry, existingBytes });
    if (classification.kind === "KIT_CONFLICT") {
      throw kitConflictError(entry.relativePath);
    }
    initPlan.set(entry.relativePath, { ...classification, existingBytes });
  }

  // 5. Compute the full executable-policy bootstrap in memory first. Unknown
  // or low-confidence discovery is legitimate autonomy and succeeds; only
  // genuine discovery/serialization/computation failures fail closed.
  const { discoverPolicy } = await import("../core/policy-discovery.js");
  const {
    loadEffectiveRules,
    computePersistedPolicyLockData,
    writeDiscoveryReport,
    writePolicyLock,
    detectPolicyCapability,
    verifyPolicyLock,
    readDiscoveryReport,
    readPolicyLock,
    readBaseline,
    writeBaseline,
  } = await import("../core/policy-engine.js");
  const { createBaselineFromViolations } = await import("../core/policy-baseline.js");

  let discovery;
  let baseline;
  let effectiveRules;
  let lock;
  try {
    discovery = await discoverPolicy({ target });
    if (hooks.afterPolicyDiscovery) {
      discovery = await hooks.afterPolicyDiscovery(discovery, { target, packageRoot });
    }
    baseline = createBaselineFromViolations([]);
    effectiveRules = await loadEffectiveRules(target, packageRoot);
    lock = await computePersistedPolicyLockData(target, packageRoot, effectiveRules, baseline);
  } catch (cause) {
    throw policyInitializationError(cause);
  }

  // 6. Pre-reconcile existing policy artifacts during planning (read-only) for
  // BOTH real init and dry-run, so a deterministic policy conflict is detected
  // with identical semantics and before any mutation. dry-run stays zero-write
  // and only reports the resulting plan.
  const discoveryReconcile = await reconcilePolicyArtifact(
    target,
    packageRoot,
    readDiscoveryReport,
    discovery,
    { semanticEqual: (a, b) => JSON.stringify(a) === JSON.stringify(b), label: `${PROJECT_ARTIFACT_PATHS.policyDiscovery}` },
  );
  const baselineReconcile = await reconcilePolicyArtifact(
    target,
    packageRoot,
    readBaseline,
    baseline,
    { semanticEqual: baselineSemanticallyEqual, label: `${PROJECT_ARTIFACT_PATHS.policyBaseline}` },
  );
  const lockReconcile = await reconcilePolicyArtifact(
    target,
    packageRoot,
    readPolicyLock,
    lock,
    { semanticEqual: lockSemanticallyEqual, label: `${PROJECT_ARTIFACT_PATHS.policyLock}` },
  );

  // 7. Mutate: write kit files per the precomputed plan. Existing files that
  // match the shipped template are resumable init output; PROJECT_PROFILE.md
  // is preserved by contract; canonical hidden kit conflicts were already
  // rejected in planning; other pre-existing (brownfield) files are preserved
  // as unowned.
  for (const entry of entries) {
    const destination = ensureWithin(target, entry.relativePath);
    const planned = initPlan.get(entry.relativePath);
    if (planned) {
      if (planned.kind === "MATCH") {
        actions.push({ action: "reuse", path: entry.relativePath, reason: "matches template" });
      } else if (planned.kind === "PRESERVE_PROFILE") {
        actions.push({ action: "skip", path: entry.relativePath, reason: "preserved" });
        manifest.files[entry.relativePath] = {
          sha256: planned.existingHash,
          preserve: true,
        };
        continue;
      } else {
        actions.push({ action: "skip", path: entry.relativePath, reason: "pre-existing" });
        continue;
      }
      manifest.files[entry.relativePath] = {
        sha256: planned.templateHash,
        preserve: entry.sourcePath === "PROJECT_PROFILE.md",
      };
      continue;
    }

    actions.push({
      action: dryRun ? "would-create" : "created",
      path: entry.relativePath,
    });
    await writeFileAtomic(destination, entry.bytes, { dryRun });
    manifest.files[entry.relativePath] = {
      sha256: sha256(entry.bytes),
      preserve: entry.sourcePath === "PROJECT_PROFILE.md",
    };
  }

  // 8-9. Write/reuse policy artifacts and verify before committing authority.
  // dry-run performs no mutation but reports the accurate plan (reuse vs
  // would-write) computed by the read-only reconciliation above.
  if (dryRun) {
    actions.push(
      { action: discoveryReconcile.action === "reuse" ? "reuse" : "would-write", path: PROJECT_ARTIFACT_PATHS.policyDiscovery, reason: discoveryReconcile.action === "reuse" ? "matches canonical state" : "dry-run" },
      { action: baselineReconcile.action === "reuse" ? "reuse" : "would-write", path: PROJECT_ARTIFACT_PATHS.policyBaseline, reason: baselineReconcile.action === "reuse" ? "matches canonical state" : "dry-run" },
      { action: lockReconcile.action === "reuse" ? "reuse" : "would-write", path: PROJECT_ARTIFACT_PATHS.policyLock, reason: lockReconcile.action === "reuse" ? "matches canonical state" : "dry-run" },
    );
  } else {
    actions.push(
      { action: discoveryReconcile.action === "reuse" ? "reuse" : "created", path: PROJECT_ARTIFACT_PATHS.policyDiscovery, reason: discoveryReconcile.action === "reuse" ? "matches canonical state" : "initialized" },
      { action: baselineReconcile.action === "reuse" ? "reuse" : "created", path: PROJECT_ARTIFACT_PATHS.policyBaseline, reason: baselineReconcile.action === "reuse" ? "matches canonical state" : "initialized" },
      { action: lockReconcile.action === "reuse" ? "reuse" : "created", path: PROJECT_ARTIFACT_PATHS.policyLock, reason: lockReconcile.action === "reuse" ? "matches canonical state" : "initialized" },
    );

    try {
      if (discoveryReconcile.action === "write") {
        await writeDiscoveryReport(target, discovery, packageRoot);
      }
      if (hooks.beforeBaselineWrite) {
        await hooks.beforeBaselineWrite({ target, packageRoot, baseline });
      }
      if (baselineReconcile.action === "write") {
        await writeBaseline(target, baseline, packageRoot);
      }
      if (hooks.beforePolicyLockWrite) {
        await hooks.beforePolicyLockWrite({ target, packageRoot, lock });
      }
      if (lockReconcile.action === "write") {
        await writePolicyLock(target, lock, packageRoot);
      }
    } catch (cause) {
      throw policyInitializationError(cause);
    }

    // 9. Verify canonical policy state before committing authority.
    try {
      const capability = await detectPolicyCapability(target, packageRoot);
      if (capability !== "AVAILABLE") {
        throw new Error(`Executable policy capability is ${capability} after bootstrap`);
      }
      const lockVerification = await verifyPolicyLock(target, packageRoot);
      if (lockVerification.status !== "VALID") {
        throw new Error(`Executable policy lock verification failed: ${lockVerification.status}`);
      }
    } catch (cause) {
      throw policyInitializationError(cause);
    }
  }

  const repositoryIndexResult = await prepareRepositoryIndexForInit({
    target,
    dryRun,
    packageRoot,
    repositoryIndex,
    repositoryIndexOptions,
    actions,
  });

  // 10. Commit manifest authority LAST: successful initialization is only
  // real once the manifest exists.
  if (hooks.beforeManifestWrite) {
    try {
      await hooks.beforeManifestWrite({ target, packageRoot, manifest, actions });
    } catch (cause) {
      throw policyInitializationError(cause);
    }
  }
  await writeManifest(target, manifest, { dryRun });

  return { actions, manifest, repositoryIndex: repositoryIndexResult };
}
