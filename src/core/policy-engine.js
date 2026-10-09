import { withNativeReadScope } from "./native-storage.js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileExists } from "./filesystem.js";
import { PROJECT_ARTIFACT_PATHS, taskArtifactPath } from "./task-paths.js";
import { assertJsonLimits } from "./json-safety.js";
import { assertSchema, readSchema } from "./schema-validation.js";
import { canonicalFingerprint, readJsonArtifact, writeJsonArtifact } from "./artifacts.js";
import { operationalArtifactExists } from "../storage/operational-context.js";
import { sha256 } from "./manifest.js";
import { BUILTIN_POLICY_RULES, discoverPolicy } from "./policy-discovery.js";
import { getPolicyAdapter } from "./policy-adapters.js";
import { evaluateBaselineViolations, readBaseline, writeBaseline } from "./policy-baseline.js";
import { verifyRuleMutation } from "./policy-mutation.js";
import { diffPolicies } from "./policy-diff.js";

export { readBaseline, writeBaseline, evaluateBaselineViolations };

export async function readProjectRules(target, packageRoot) {
  const relPath = PROJECT_ARTIFACT_PATHS.policyRules;
  const fullPath = path.join(target, relPath);
  if (!(await fileExists(fullPath))) {
    return null;
  }
  const raw = await readFile(fullPath, "utf8");
  assertJsonLimits(raw, relPath);
  const parsed = JSON.parse(raw);
  const schema = await readSchema("policy-rules", packageRoot);
  assertSchema(parsed, schema, "policy-rules");
  return parsed.rules ?? [];
}

export async function writeProjectRules(target, rules, packageRoot) {
  const relPath = PROJECT_ARTIFACT_PATHS.policyRules;
  const payload = { schemaVersion: 1, rules };
  const schema = await readSchema("policy-rules", packageRoot);
  assertSchema(payload, schema, "policy-rules");
  await writeJsonArtifact(target, relPath, payload, "policy-rules", packageRoot);
  return payload;
}

export async function readDiscoveryReport(target, packageRoot) {
  const relPath = PROJECT_ARTIFACT_PATHS.policyDiscovery;
  const fullPath = path.join(target, relPath);
  if (!(await fileExists(fullPath))) {
    return null;
  }
  const raw = await readFile(fullPath, "utf8");
  assertJsonLimits(raw, relPath);
  const parsed = JSON.parse(raw);
  const schema = await readSchema("policy-discovery", packageRoot);
  assertSchema(parsed, schema, "policy-discovery");
  return parsed;
}

export async function writeDiscoveryReport(target, discovery, packageRoot) {
  const relPath = PROJECT_ARTIFACT_PATHS.policyDiscovery;
  const schema = await readSchema("policy-discovery", packageRoot);
  assertSchema(discovery, schema, "policy-discovery");
  await writeJsonArtifact(target, relPath, discovery, "policy-discovery", packageRoot);
  return discovery;
}

export async function readPolicyLock(target, packageRoot) {
  const relPath = PROJECT_ARTIFACT_PATHS.policyLock;
  const fullPath = path.join(target, relPath);
  if (!(await fileExists(fullPath))) {
    return null;
  }
  const raw = await readFile(fullPath, "utf8");
  assertJsonLimits(raw, relPath);
  const parsed = JSON.parse(raw);
  const schema = await readSchema("policy-lock", packageRoot);
  assertSchema(parsed, schema, "policy-lock");
  return parsed;
}

export async function writePolicyLock(target, lock, packageRoot) {
  const relPath = PROJECT_ARTIFACT_PATHS.policyLock;
  const schema = await readSchema("policy-lock", packageRoot);
  assertSchema(lock, schema, "policy-lock");
  await writeJsonArtifact(target, relPath, lock, "policy-lock", packageRoot);
  return lock;
}

export async function readTaskPolicySnapshot(target, taskId, packageRoot) {
  return withNativeReadScope(target, async () => {
    const relPath = taskArtifactPath(taskId, "policySnapshot");
    const selected = operationalArtifactExists(target, relPath);
    if (selected !== null) return selected ? (await readJsonArtifact(target, relPath, "policy-snapshot", packageRoot)).value : null;
    const fullPath = path.join(target, relPath);
    if (!(await fileExists(fullPath))) {
      return null;
    }
    const raw = await readFile(fullPath, "utf8");
    assertJsonLimits(raw, relPath);
    const parsed = JSON.parse(raw);
    const schema = await readSchema("policy-snapshot", packageRoot);
    assertSchema(parsed, schema, "policy-snapshot");
    return parsed;
  });
}

export async function writeTaskPolicySnapshot(target, taskId, snapshot, packageRoot) {
  const relPath = taskArtifactPath(taskId, "policySnapshot");
  const schema = await readSchema("policy-snapshot", packageRoot);
  assertSchema(snapshot, schema, "policy-snapshot");
  await writeJsonArtifact(target, relPath, snapshot, "policy-snapshot", packageRoot, { taskId });
  return snapshot;
}

export async function loadEffectiveRules(target, packageRoot) {
  const ruleMap = new Map();

  // 1. Built-in rules
  for (const rule of BUILTIN_POLICY_RULES) {
    ruleMap.set(rule.id, { ...rule });
  }

  // 2. Discovered rules
  let discovery = await readDiscoveryReport(target, packageRoot);
  if (!discovery) {
    discovery = await discoverPolicy({ target });
  }
  for (const rule of discovery.discoveredRules ?? []) {
    ruleMap.set(rule.id, { ...rule });
  }

  // 3. Project rules (highest precedence)
  const projectRules = await readProjectRules(target, packageRoot);
  if (projectRules) {
    for (const rule of projectRules) {
      ruleMap.set(rule.id, { ...rule, source: "project" });
    }
  }

  return [...ruleMap.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export async function detectPolicyCapability(target, packageRoot) {
  const rulesRel = PROJECT_ARTIFACT_PATHS.policyRules;
  const baselineRel = PROJECT_ARTIFACT_PATHS.policyBaseline;
  const discoveryRel = PROJECT_ARTIFACT_PATHS.policyDiscovery;
  const lockRel = PROJECT_ARTIFACT_PATHS.policyLock;
  const capabilityRel = PROJECT_ARTIFACT_PATHS.capabilityPolicy;

  const hasRules = await fileExists(path.join(target, rulesRel));
  const hasBaseline = await fileExists(path.join(target, baselineRel));
  const hasDiscovery = await fileExists(path.join(target, discoveryRel));
  const hasLock = await fileExists(path.join(target, lockRel));
  const hasCapabilityPolicy = await fileExists(path.join(target, capabilityRel));

  if (!hasRules && !hasBaseline && !hasDiscovery && !hasLock && !hasCapabilityPolicy) {
    return "NOT_PRESENT";
  }

  try {
    if (hasRules) await readProjectRules(target, packageRoot);
    if (hasBaseline) await readBaseline(target, packageRoot);
    if (hasDiscovery) await readDiscoveryReport(target, packageRoot);
    if (hasLock) await readPolicyLock(target, packageRoot);
    // A capability policy is policy configuration: its presence makes the
    // executable-policy subsystem applicable and it must fail closed when
    // malformed.
    if (hasCapabilityPolicy) {
      const { loadCapabilityPolicy } = await import("./capability-policy.js");
      await loadCapabilityPolicy(target, packageRoot);
    }
    return "AVAILABLE";
  } catch {
    return "INVALID";
  }
}

export function canonicalizeRules(rules) {
  const seenIds = new Set();
  const sorted = [...(rules ?? [])].sort((a, b) => a.id.localeCompare(b.id));
  for (const r of sorted) {
    if (seenIds.has(r.id)) {
      throw new Error(`Duplicate rule ID detected: ${r.id}`);
    }
    seenIds.add(r.id);
  }
  return sorted;
}

export function canonicalizeBaseline(baseline) {
  if (!baseline || !Array.isArray(baseline.entries)) {
    return { schemaVersion: 1, entries: [] };
  }
  const entries = baseline.entries.map((entry) => {
    const fps = entry.fingerprints ?? [];
    if (new Set(fps).size !== fps.length) {
      throw new Error(`Duplicate fingerprint detected for rule ${entry.ruleId}`);
    }
    return {
      ruleId: entry.ruleId,
      fingerprints: [...fps].sort(),
      ...(entry.reviewBy ? { reviewBy: entry.reviewBy } : {}),
    };
  });
  return {
    schemaVersion: baseline.schemaVersion ?? 1,
    entries: entries.sort((a, b) => a.ruleId.localeCompare(b.ruleId)),
  };
}

export function computePolicyLockData(rules, baseline, capabilityPolicy = null) {
  const canonicalRules = canonicalizeRules(rules);
  const canonicalBase = canonicalizeBaseline(baseline);
  const rulesDigest = sha256(canonicalFingerprint(canonicalRules));
  const baselineDigest = sha256(canonicalFingerprint(canonicalBase));
  // The capability policy participates in the lock only when the artifact
  // exists, keeping historical locks stable for projects that never adopt
  // durable actions.
  const capabilityPolicyDigest =
    capabilityPolicy && typeof capabilityPolicy === "object"
      ? sha256(canonicalFingerprint(capabilityPolicy))
      : null;
  const fullDigest =
    capabilityPolicyDigest === null
      ? sha256(`${rulesDigest}:${baselineDigest}`)
      : sha256(`${rulesDigest}:${baselineDigest}:${capabilityPolicyDigest}`);

  return {
    schemaVersion: 1,
    algorithm: "sha256",
    digest: `sha256:${fullDigest}`,
    rulesDigest: `sha256:${rulesDigest}`,
    baselineDigest: `sha256:${baselineDigest}`,
    ...(capabilityPolicyDigest === null
      ? {}
      : { capabilityPolicyDigest: `sha256:${capabilityPolicyDigest}` }),
    capturedAt: new Date().toISOString(),
  };
}

export async function readCapabilityPolicyIdentityForLock(target, packageRoot) {
  const { readCapabilityPolicyIdentity } = await import("./capability-policy.js");
  return readCapabilityPolicyIdentity(target, packageRoot);
}

/**
 * Canonical policy identity for durable-action authorization. Fails closed
 * with deterministic codes whenever the capability policy, the persisted
 * lock, or the task snapshot do not agree.
 */
export async function loadPolicyIdentity(target, packageRoot, taskId) {
  const { E_ACTION_POLICY_DRIFT, E_ACTION_POLICY_LOCK_REQUIRED } = await import("./error-codes.js");
  const capability = await readCapabilityPolicyIdentityForLock(target, packageRoot);
  const lock = await verifyPolicyLock(target, packageRoot);
  const snapshot = taskId ? await readTaskPolicySnapshot(target, taskId, packageRoot) : null;

  if (capability.policy && lock.status !== "VALID") {
    return {
      status: lock.status === "MISMATCH" ? "DRIFT" : "INVALID",
      code: lock.status === "MISMATCH" ? E_ACTION_POLICY_DRIFT : E_ACTION_POLICY_LOCK_REQUIRED,
      ...(lock.status === "MISMATCH" ? { mismatches: lock.mismatches } : {}),
    };
  }

  // A modern task snapshot must bind the current capability policy before any
  // side-effecting action may be authorized.
  if (
    capability.digest
    && snapshot
    && snapshot.capabilityPolicyDigest !== capability.digest
  ) {
    return {
      status: "DRIFT",
      code: E_ACTION_POLICY_DRIFT,
    };
  }

  // A modern capability policy without a task snapshot has no epoch to bind:
  // authorization cannot proceed for a task-scoped action.
  if (capability.digest && taskId && !snapshot) {
    return {
      status: "INVALID",
      code: E_ACTION_POLICY_LOCK_REQUIRED,
    };
  }

  return {
    status: "VALID",
    lockDigest: lock.digest ?? null,
    taskPolicyDigest: snapshot?.policyDigest ?? null,
    capabilityPolicyFingerprint: capability.fingerprint,
    capabilityPolicyDigest: capability.digest,
  };
}

/**
 * Compute policy-lock data for persistence, binding the current capability
 * policy whenever it exists so locks, snapshots, and authorization evidence
 * share one policy identity.
 */
export async function computePersistedPolicyLockData(target, packageRoot, rules, baseline) {
  const identity = await readCapabilityPolicyIdentityForLock(target, packageRoot);
  return computePolicyLockData(rules, baseline, identity.policy);
}

export async function verifyPolicyLock(target, packageRoot) {
  const capability = await detectPolicyCapability(target, packageRoot);
  if (capability === "NOT_PRESENT") {
    return { status: "NOT_APPLICABLE" };
  }
  if (capability === "INVALID") {
    return { status: "INVALID", error: "Policy artifacts are malformed" };
  }

  const persistedLock = await readPolicyLock(target, packageRoot);
  if (!persistedLock) {
    return { status: "MISMATCH", error: "Policy lockfile is missing" };
  }

  const rules = await loadEffectiveRules(target, packageRoot);
  const baseline = await readBaseline(target, packageRoot);
  let capabilityPolicy = null;
  try {
    const { loadCapabilityPolicy } = await import("./capability-policy.js");
    const loadedCapabilityPolicy = await loadCapabilityPolicy(target, packageRoot);
    capabilityPolicy = loadedCapabilityPolicy?.policy ?? null;
  } catch (error) {
    if (error.code === "E_POLICY_INVALID") {
      return { status: "INVALID", error: "Capability policy artifact is malformed" };
    }
    throw error;
  }
  const expectedLock = computePolicyLockData(rules, baseline, capabilityPolicy);

  const mismatches = [];
  if (persistedLock.algorithm !== expectedLock.algorithm) {
    mismatches.push("algorithm");
  }
  if (persistedLock.digest !== expectedLock.digest) {
    mismatches.push("digest");
  }
  if (persistedLock.rulesDigest !== expectedLock.rulesDigest) {
    mismatches.push("rulesDigest");
  }
  if (persistedLock.baselineDigest !== expectedLock.baselineDigest) {
    mismatches.push("baselineDigest");
  }
  if (
    expectedLock.capabilityPolicyDigest !== undefined &&
    persistedLock.capabilityPolicyDigest !== expectedLock.capabilityPolicyDigest
  ) {
    mismatches.push("capabilityPolicyDigest");
  }

  if (mismatches.length > 0) {
    return {
      status: "MISMATCH",
      mismatches,
      expected: {
        algorithm: expectedLock.algorithm,
        digest: expectedLock.digest,
        rulesDigest: expectedLock.rulesDigest,
        baselineDigest: expectedLock.baselineDigest,
      },
      observed: {
        algorithm: persistedLock.algorithm ?? null,
        digest: persistedLock.digest ?? null,
        rulesDigest: persistedLock.rulesDigest ?? null,
        baselineDigest: persistedLock.baselineDigest ?? null,
        ...(expectedLock.capabilityPolicyDigest === undefined
          ? {}
          : { capabilityPolicyDigest: persistedLock.capabilityPolicyDigest ?? null }),
      },
    };
  }

  return {
    status: "VALID",
    digest: expectedLock.digest,
  };
}

export async function evaluateTargetPolicy({
  target = process.cwd(),
  packageRoot,
  taskId = null,
  files = null,
  overrideAdapters = null,
  now = new Date().toISOString(),
} = {}) {
  const capability = await detectPolicyCapability(target, packageRoot);
  if (capability === "NOT_PRESENT") {
    return {
      status: "VALID",
      capability: "NOT_PRESENT",
      rules: [],
      provenRules: 0,
      inertRules: 0,
      unsupportedRules: 0,
      baselineViolations: 0,
      newViolations: [],
      resolvedViolations: [],
      ratchetedBaseline: null,
      lock: { status: "NOT_APPLICABLE" },
      drift: { detected: false },
      errors: [],
      warnings: [],
    };
  }

  if (capability === "INVALID") {
    return {
      status: "INVALID",
      capability: "INVALID",
      rules: [],
      provenRules: 0,
      inertRules: 0,
      unsupportedRules: 0,
      baselineViolations: 0,
      newViolations: [],
      resolvedViolations: [],
      ratchetedBaseline: null,
      lock: { status: "INVALID" },
      drift: { detected: false },
      errors: [
        {
          code: "E_POLICY_INVALID",
          why: "Policy configuration or baseline artifacts are malformed or fail schema validation.",
          fix: "Validate and repair rules.json, baseline.json, or discovery.json against schemas.",
        },
      ],
      warnings: [],
    };
  }

  const rules = await loadEffectiveRules(target, packageRoot);
  const baseline = await readBaseline(target, packageRoot);
  const errors = [];
  const warnings = [];
  const evaluatedRules = [];
  const rawViolations = [];

  // Active lock verification
  const lockVerification = await verifyPolicyLock(target, packageRoot);
  if (lockVerification.status === "MISMATCH") {
    const expStr = typeof lockVerification.expected === "object" ? lockVerification.expected.digest : lockVerification.expected;
    const obsStr = typeof lockVerification.observed === "object" ? lockVerification.observed.digest : lockVerification.observed;
    errors.push({
      code: "POLICY_LOCK_MISMATCH",
      why: `Persisted policy lock does not match current effective policy: expected ${expStr}, observed ${obsStr}`,
      fix: "Re-evaluate effective rules and update policy.lock or restore modified rules.",
    });
  }

  for (const rule of rules) {
    const adapterId = rule.check?.adapter ?? (typeof rule.check === "string" ? rule.check : null);
    const adapter = overrideAdapters?.[adapterId] ?? getPolicyAdapter(adapterId);

    if (!adapter) {
      evaluatedRules.push({
        ruleId: rule.id,
        rule,
        status: "UNSUPPORTED",
        why: `No policy adapter found for ${adapterId}`,
        fix: "Configure an existing adapter or remove the rule.",
      });
      continue;
    }

    let checkResult;
    try {
      checkResult = await adapter.check({ target, rule, files });
    } catch (error) {
      errors.push({
        code: "POLICY_EVALUATION_FAILED",
        ruleId: rule.id,
        why: `Policy evaluation threw an unexpected error for rule ${rule.id}: ${error.message}`,
        fix: "Inspect adapter check logic and target files for unhandled exceptions.",
      });
      checkResult = { passed: false, isInert: false, violations: [], error: error.message };
    }

    // Handle inert checks
    if (checkResult.isInert) {
      if (rule.source === "discovered") {
        // Gracefully downgrade discovered rules
        evaluatedRules.push({
          ruleId: rule.id,
          rule,
          status: "UNSUPPORTED",
          isInert: true,
          why: "Discovered rule is currently inert (no applicable files in repository).",
          fix: "Rule will automatically activate when matching files are present.",
        });
        continue;
      } else if (rule.source === "project" && rule.blocking) {
        errors.push({
          code: "CHECK_INERT",
          ruleId: rule.id,
          why: `Configured blocking check ${rule.id} has no effective target scope.`,
          fix: "Provide an applicable target scope or mark rule non-blocking.",
        });
        evaluatedRules.push({
          ruleId: rule.id,
          rule,
          status: "INERT",
          isInert: true,
          errorCode: "CHECK_INERT",
          why: `Configured blocking check ${rule.id} has no effective target scope.`,
          fix: "Provide an applicable target scope or mark rule non-blocking.",
        });
        continue;
      } else {
        evaluatedRules.push({
          ruleId: rule.id,
          rule,
          status: "INERT",
          isInert: true,
          why: "Check is enabled but has no effective target.",
          fix: "Configure an applicable scope or mark the rule as unsupported.",
        });
        continue;
      }
    }

    // Verify mutation for blocking rules
    let mutationProof = null;
    if (rule.blocking) {
      mutationProof = await verifyRuleMutation({ target, rule, adapter });
      if (mutationProof.status !== "PROVEN") {
        if (mutationProof.errorCode === "CHECK_MUTATION_EXECUTION_ERROR") {
          errors.push({
            code: "CHECK_MUTATION_EXECUTION_ERROR",
            ruleId: rule.id,
            why: mutationProof.why,
            fix: mutationProof.fix,
          });
        } else {
          errors.push({
            code: "CHECK_MUTATION_NOT_DETECTED",
            ruleId: rule.id,
            why: mutationProof.why,
            fix: mutationProof.fix,
          });
        }
      }
    }

    if (checkResult.violations && checkResult.violations.length > 0) {
      rawViolations.push(...checkResult.violations);
    }

    evaluatedRules.push({
      ruleId: rule.id,
      rule,
      status: rule.blocking
        ? mutationProof?.status === "PROVEN" ? "PROVEN" : "UNPROVEN"
        : "ACTIVE",
      mutationProof,
      violations: checkResult.violations ?? [],
    });
  }

  // Baseline evaluation
  const baselineEval = evaluateBaselineViolations(baseline, rawViolations, { now });
  warnings.push(...baselineEval.warnings);

  for (const newViolation of baselineEval.newViolations) {
    const matchingRule = rules.find((r) => r.id === newViolation.ruleId);
    if (matchingRule?.blocking) {
      errors.push({
        code: "NEW_VIOLATION",
        ruleId: newViolation.ruleId,
        file: newViolation.file,
        line: newViolation.line,
        fingerprint: newViolation.fingerprint,
        why: `New policy violation detected not present in baseline: ${newViolation.message}`,
        fix: matchingRule.fix || "Resolve the violation before completing the task.",
      });
    } else {
      warnings.push({
        code: "NEW_ADVISORY_VIOLATION",
        ruleId: newViolation.ruleId,
        file: newViolation.file,
        message: newViolation.message,
      });
    }
  }

  // Drift evaluation against task policy snapshot
  let drift = null;
  if (taskId) {
    const taskSnapshot = await readTaskPolicySnapshot(target, taskId, packageRoot);
    if (taskSnapshot) {
      const currentLock = await computePersistedPolicyLockData(target, packageRoot, rules, baseline);
      if (taskSnapshot.policyDigest !== currentLock.digest) {
        const policyDiff = diffPolicies(
          { rules: taskSnapshot.rules, baseline: taskSnapshot.baseline, baselineDigest: taskSnapshot.baselineDigest },
          { rules, baseline, baselineDigest: currentLock.baselineDigest },
        );
        drift = {
          detected: true,
          classification: policyDiff.classification,
          snapshotDigest: taskSnapshot.policyDigest,
          currentDigest: currentLock.digest,
          changes: policyDiff.changes,
        };

        if (policyDiff.classification === "WEAKEN") {
          errors.push({
            code: "POLICY_WEAKENING",
            why: "Policy weakening detected relative to task activation snapshot.",
            fix: "Restore the original policy rules or obtain explicit project authority.",
          });
        } else if (policyDiff.classification === "UNKNOWN") {
          errors.push({
            code: "POLICY_DRIFT_UNKNOWN",
            why: "Policy drift detected against task snapshot but baseline state cannot be semantically compared.",
            fix: "Re-verify the task under the current policy state.",
          });
        } else if (policyDiff.classification === "TIGHTEN") {
          warnings.push({
            code: "POLICY_TIGHTENING",
            why: "Policy tightened after task activation. Re-verification required.",
            fix: "Re-run verification checks under the tightened policy.",
          });
        }
      }
    }
  }

  const currentLock = await computePersistedPolicyLockData(target, packageRoot, rules, baseline);

  return {
    status: errors.length === 0 ? "VALID" : "INVALID",
    rules: evaluatedRules,
    provenRules: evaluatedRules.filter((r) => r.status === "PROVEN").length,
    inertRules: evaluatedRules.filter((r) => r.status === "INERT").length,
    unsupportedRules: evaluatedRules.filter((r) => r.status === "UNSUPPORTED").length,
    baselineViolations: baselineEval.baselinedViolations.length,
    newViolations: baselineEval.newViolations,
    resolvedViolations: baselineEval.resolvedViolations,
    ratchetedBaseline: baselineEval.ratchetedBaseline,
    lock: currentLock,
    drift: drift ?? { detected: false },
    errors,
    warnings,
  };
}
