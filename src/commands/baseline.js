import { withProjectReadSnapshot } from "../storage/project-read-snapshot.js";
import {
  computePersistedPolicyLockData,
  evaluateTargetPolicy,
  loadEffectiveRules,
  writePolicyLock,
  readTaskPolicySnapshot,
} from "../core/policy-engine.js";
import {
  createBaselineFromViolations,
  readBaseline,
  writeBaseline,
} from "../core/policy-baseline.js";
import { discoverTasks } from "../core/task-discovery.js";

function baselineError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

async function hasActivePolicySnapshot(target, packageRoot) {
  return withProjectReadSnapshot(target, async () => {
    const tasks = await discoverTasks(target, packageRoot);
    for (const task of tasks) {
      if (task.healthy && task.phase && task.phase !== "COMPLETE" && task.phase !== "BLOCKED"
        && await readTaskPolicySnapshot(target, task.taskId, packageRoot)) return true;
    }
    return false;
  });
}

export async function runBaseline({
  target = process.cwd(),
  packageRoot,
  record = false,
  update = false,
  policyResetAuthorized = false,
} = {}) {
  const policyEval = await evaluateTargetPolicy({ target, packageRoot });
  let baseline = await readBaseline(target, packageRoot);

  const hasActivePolicyTask = await hasActivePolicySnapshot(target, packageRoot);

  if (record) {
    if (hasActivePolicyTask && !policyResetAuthorized) {
      throw baselineError(
        "E_BASELINE_RECORD_DURING_ACTIVE_TASK",
        "Cannot re-record baseline during an active task with policy snapshot. Resolve new violations or use monotonic baseline --update.",
      );
    }

    const allViolations = [];
    for (const r of policyEval.rules) {
      if (r.violations) allViolations.push(...r.violations);
    }
    baseline = createBaselineFromViolations(allViolations);
    await writeBaseline(target, baseline, packageRoot);

    const rules = await loadEffectiveRules(target, packageRoot);
    const lock = await computePersistedPolicyLockData(target, packageRoot, rules, baseline);
    await writePolicyLock(target, lock, packageRoot);

    return {
      status: "RECORDED",
      baseline,
      violationCount: allViolations.length,
      lock: lock.digest,
    };
  }

  if (update && policyEval.ratchetedBaseline) {
    // Monotonic check: new baseline cannot contain any fingerprint not in old baseline
    const oldBaselineMap = new Map((baseline?.entries ?? []).map((e) => [e.ruleId, new Set(e.fingerprints ?? [])]));
    for (const entry of policyEval.ratchetedBaseline.entries) {
      const oldFps = oldBaselineMap.get(entry.ruleId) ?? new Set();
      const hasExpansion = entry.fingerprints.some((fp) => !oldFps.has(fp));
      if (hasExpansion) {
        throw baselineError(
          "E_BASELINE_EXPANSION",
          `Cannot expand baseline debt for rule ${entry.ruleId}. Monotonic ratchet down allows removing debt only.`,
        );
      }
    }

    baseline = policyEval.ratchetedBaseline;
    await writeBaseline(target, baseline, packageRoot);

    const rules = await loadEffectiveRules(target, packageRoot);
    const lock = await computePersistedPolicyLockData(target, packageRoot, rules, baseline);
    await writePolicyLock(target, lock, packageRoot);

    return {
      status: "UPDATED",
      baseline,
      resolvedCount: policyEval.resolvedViolations?.length ?? 0,
      remainingCount: baseline.entries.reduce((sum, e) => sum + e.fingerprints.length, 0),
      lock: lock.digest,
    };
  }

  return {
    status: baseline ? "VALID" : "NOT_PRESENT",
    baseline,
    baselinedViolations: policyEval.baselineViolations,
    newViolations: policyEval.newViolations?.length ?? 0,
    resolvedViolations: policyEval.resolvedViolations?.length ?? 0,
  };
}

export function formatBaselineResult(result) {
  const lines = [
    `FORGELOOP POLICY BASELINE: ${result.status}`,
    `Baselined Debt: ${result.baselinedViolations ?? (result.baseline?.entries?.reduce((sum, e) => sum + e.fingerprints.length, 0) ?? 0)}`,
    `New Violations: ${result.newViolations ?? 0}`,
    `Resolved Debt: ${result.resolvedViolations ?? result.resolvedCount ?? 0}`,
  ];
  if (result.lock) {
    lines.push(`Lock: ${result.lock}`);
  }
  return `${lines.join("\n")}\n`;
}
