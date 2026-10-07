import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { runInit } from "../src/commands/init.js";
import { runTaskCreate } from "../src/commands/task-create.js";
import { runRoute } from "../src/commands/route.js";
import { runActivate } from "../src/commands/activate.js";
import { runPreflight } from "../src/commands/preflight.js";
import { runAdvance } from "../src/commands/advance.js";
import { runCheck } from "../src/commands/run-check.js";
import { runPrepareCompletion } from "../src/commands/prepare-completion.js";
import { runComplete } from "../src/commands/complete.js";
import { runBaseline } from "../src/commands/baseline.js";
import { runNext } from "../src/commands/next.js";
import { getPackageRoot } from "../src/core/templates.js";
import { verifyRuleMutation } from "../src/core/policy-mutation.js";
import { diffPolicies } from "../src/core/policy-diff.js";
import {
  computePolicyLockData,
  detectPolicyCapability,
  evaluateTargetPolicy,
  loadEffectiveRules,
  readBaseline,
  readPolicyLock,
  readTaskPolicySnapshot,
  verifyPolicyLock,
  writePolicyLock,
  writeProjectRules,
} from "../src/core/policy-engine.js";
import { writeBaseline } from "../src/core/policy-baseline.js";
import { createContract, writeContract } from "../src/core/contract.js";
import { NEXT_ACTIONS, policyRecoveryAction } from "../src/core/next-action.js";
import { taskArtifactPath } from "../src/core/task-paths.js";

const packageRoot = getPackageRoot();
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = path.join(repositoryRoot, "src", "cli.js");

function runCli(target, ...args) {
  return spawnSync(process.execPath, [cliPath, ...args, "--path", target], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
}

async function withTarget(fn) {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-hardening-"));
  try {
    await fn(target);
  } finally {
    await rm(target, { recursive: true, force: true });
  }
}

// --------------------------------------------------------------------------
// M1 - M4: Mutation Verifier Tests
// --------------------------------------------------------------------------

test("M1: checker catches mutant -> PROVEN with proof digest", async () => {
  const rule = {
    id: "SECURITY.NO_HARDCODED_SECRET",
    check: { adapter: "secret-detection" },
    blocking: true,
  };
  const result = await verifyRuleMutation({ rule });
  assert.equal(result.status, "PROVEN");
  assert.equal(result.observed, "FAIL");
  assert.ok(result.proofDigest?.startsWith("sha256:"));
});

test("M2: checker misses mutant -> CHECK_MUTATION_NOT_DETECTED", async () => {
  const rule = {
    id: "SECURITY.NO_HARDCODED_SECRET",
    check: { adapter: "secret-detection" },
    blocking: true,
  };
  const mockAdapter = {
    check: async () => ({ passed: true, violations: [] }),
  };
  const result = await verifyRuleMutation({ rule, overrideChecker: mockAdapter });
  assert.equal(result.status, "UNPROVEN");
  assert.equal(result.observed, "PASS");
  assert.equal(result.errorCode, "CHECK_MUTATION_NOT_DETECTED");
  assert.equal(result.proofDigest, null);
});

test("M3: checker throws exception -> CHECK_MUTATION_EXECUTION_ERROR and observed ERROR", async () => {
  const rule = {
    id: "SECURITY.NO_HARDCODED_SECRET",
    check: { adapter: "secret-detection" },
    blocking: true,
  };
  const throwingAdapter = {
    check: async () => {
      throw new Error("Checker crashed unexpectedly");
    },
  };
  const result = await verifyRuleMutation({ rule, overrideChecker: throwingAdapter });
  assert.equal(result.status, "UNPROVEN");
  assert.equal(result.observed, "ERROR");
  assert.equal(result.errorCode, "CHECK_MUTATION_EXECUTION_ERROR");
  assert.equal(result.proofDigest, null);
  assert.match(result.why, /Checker crashed unexpectedly/);
});

test("M4: proof digest is null when checker throws", async () => {
  const rule = {
    id: "TEST.FAILING",
    check: { adapter: "secret-detection" },
    blocking: true,
  };
  const throwingAdapter = {
    check: async () => {
      throw new TypeError("Cannot read property of undefined");
    },
  };
  const result = await verifyRuleMutation({ rule, overrideChecker: throwingAdapter });
  assert.equal(result.proofDigest, null);
  assert.equal(result.status, "UNPROVEN");
});

// --------------------------------------------------------------------------
// P1 - P6: Policy Capability & Fail-Closed Tests
// --------------------------------------------------------------------------

test("P1: policy absent -> legacy-compatible capability NOT_PRESENT and VALID status", async () => {
  await withTarget(async (target) => {
    const capability = await detectPolicyCapability(target, packageRoot);
    assert.equal(capability, "NOT_PRESENT");

    const policyEval = await evaluateTargetPolicy({ target, packageRoot });
    assert.equal(policyEval.status, "VALID");
    assert.equal(policyEval.capability, "NOT_PRESENT");
    assert.equal(policyEval.errors.length, 0);
  });
});

test("P2: rules.json malformed -> INVALID capability and completion rejected", async () => {
  await withTarget(async (target) => {
    await runInit({ target, packageRoot, packageVersion: "1.2.1" });
    await mkdir(path.join(target, ".forgeloop", "policy"), { recursive: true });
    await writeFile(path.join(target, ".forgeloop", "policy", "rules.json"), "MALFORMED_JSON{{{");

    const capability = await detectPolicyCapability(target, packageRoot);
    assert.equal(capability, "INVALID");

    const policyEval = await evaluateTargetPolicy({ target, packageRoot });
    assert.equal(policyEval.status, "INVALID");
    assert.ok(policyEval.errors.some((e) => e.code === "E_POLICY_INVALID"));
  });
});

test("P3: baseline.json malformed -> INVALID capability and completion rejected", async () => {
  await withTarget(async (target) => {
    await runInit({ target, packageRoot, packageVersion: "1.2.1" });
    await mkdir(path.join(target, ".forgeloop", "policy"), { recursive: true });
    await writeFile(path.join(target, ".forgeloop", "policy", "baseline.json"), "CORRUPT_BASELINE");

    const capability = await detectPolicyCapability(target, packageRoot);
    assert.equal(capability, "INVALID");

    const policyEval = await evaluateTargetPolicy({ target, packageRoot });
    assert.equal(policyEval.status, "INVALID");
    assert.ok(policyEval.errors.some((e) => e.code === "E_POLICY_INVALID"));
  });
});

test("P4: policy.lock malformed -> INVALID capability", async () => {
  await withTarget(async (target) => {
    await runInit({ target, packageRoot, packageVersion: "1.2.1" });
    await mkdir(path.join(target, ".forgeloop", "policy"), { recursive: true });
    await writeFile(path.join(target, ".forgeloop", "policy", "policy.lock"), "{ \"schemaVersion\": 999 }");

    const capability = await detectPolicyCapability(target, packageRoot);
    assert.equal(capability, "INVALID");
  });
});

test("P5 / EVAL-1: policy evaluation throws unexpectedly -> fails closed with exact POLICY_EVALUATION_FAILED", async () => {
  await withTarget(async (target) => {
    await runInit({ target, packageRoot, packageVersion: "1.2.1" });
    const throwingAdapter = {
      check: async () => {
        throw new Error("intentional policy evaluation failure");
      },
    };
    const policyEval = await evaluateTargetPolicy({
      target,
      packageRoot,
      overrideAdapters: { "secret-detection": throwingAdapter },
    });
    assert.equal(policyEval.status, "INVALID");
    assert.ok(policyEval.errors.some((e) => e.code === "POLICY_EVALUATION_FAILED"));
  });
});

test("P6: discovery.json malformed -> INVALID capability", async () => {
  await withTarget(async (target) => {
    await runInit({ target, packageRoot, packageVersion: "1.2.1" });
    await mkdir(path.join(target, ".forgeloop", "policy"), { recursive: true });
    await writeFile(path.join(target, ".forgeloop", "policy", "discovery.json"), "CORRUPT_DISCOVERY{{{");

    const capability = await detectPolicyCapability(target, packageRoot);
    assert.equal(capability, "INVALID");
  });
});

// --------------------------------------------------------------------------
// PF1 - PF6: Preflight Policy Invariants
// --------------------------------------------------------------------------

test("PF1: policy absent -> preflight behavior unchanged (READY possible)", async () => {
  await withTarget(async (target) => {
    await runTaskCreate({ target, taskId: "task-pf1", packageRoot });
    const contract = createContract({
      taskId: "task-pf1",
      objective: "Verify preflight with absent policy",
      deliverables: ["src/app.js"],
      constraints: ["offline"],
      risks: [],
      verification: ["tests"],
      successCriteria: ["tests"],
      stopConditions: ["blocked"],
      unresolvedDecisions: [],
      sourceRefs: [],
    });
    await writeContract(target, contract, packageRoot, { taskId: "task-pf1" });
    await runRoute({ target, taskId: "task-pf1", workType: "code", surfaces: ["config"], packageRoot });

    const preRes = await runPreflight({ target, taskId: "task-pf1", packageRoot });
    assert.equal(preRes.status, "READY");
  });
});

test("PF2: policy available and valid -> snapshot captured and READY", async () => {
  await withTarget(async (target) => {
    await runInit({ target, packageRoot, packageVersion: "1.2.1" });
    await runTaskCreate({ target, taskId: "task-pf2", packageRoot });
    const contract = createContract({
      taskId: "task-pf2",
      objective: "Verify preflight with valid policy",
      deliverables: ["src/app.js"],
      constraints: ["offline"],
      risks: [],
      verification: ["tests"],
      successCriteria: ["tests"],
      stopConditions: ["blocked"],
      unresolvedDecisions: [],
      sourceRefs: [],
    });
    await writeContract(target, contract, packageRoot, { taskId: "task-pf2" });
    await runRoute({ target, taskId: "task-pf2", workType: "code", surfaces: ["config"], packageRoot });

    const preRes = await runPreflight({ target, taskId: "task-pf2", packageRoot });
    assert.equal(preRes.status, "READY");

    const snapshot = await readTaskPolicySnapshot(target, "task-pf2", packageRoot);
    assert.ok(snapshot);
    assert.ok(snapshot.policyDigest);
  });
});

test("PF3: policy.lock malformed -> preflight throws E_POLICY_INVALID", async () => {
  await withTarget(async (target) => {
    await runInit({ target, packageRoot, packageVersion: "1.2.1" });
    await runTaskCreate({ target, taskId: "task-pf3", packageRoot });
    const contract = createContract({
      taskId: "task-pf3",
      objective: "Verify preflight with malformed lock",
      deliverables: ["src/app.js"],
      constraints: ["offline"],
      risks: [],
      verification: ["tests"],
      successCriteria: ["tests"],
      stopConditions: ["blocked"],
      unresolvedDecisions: [],
      sourceRefs: [],
    });
    await writeContract(target, contract, packageRoot, { taskId: "task-pf3" });
    await runRoute({ target, taskId: "task-pf3", workType: "code", surfaces: ["config"], packageRoot });

    // Corrupt lockfile
    await writeFile(path.join(target, ".forgeloop", "policy", "policy.lock"), "{ \"schemaVersion\": 999 }");

    await assert.rejects(
      async () => {
        await runPreflight({ target, taskId: "task-pf3", packageRoot });
      },
      (err) => {
        assert.equal(err.code, "E_POLICY_INVALID");
        return true;
      },
    );
  });
});

test("PF4: rules.json malformed -> preflight throws E_POLICY_INVALID", async () => {
  await withTarget(async (target) => {
    await runInit({ target, packageRoot, packageVersion: "1.2.1" });
    await runTaskCreate({ target, taskId: "task-pf4", packageRoot });
    const contract = createContract({
      taskId: "task-pf4",
      objective: "Verify preflight with malformed rules",
      deliverables: ["src/app.js"],
      constraints: ["offline"],
      risks: [],
      verification: ["tests"],
      successCriteria: ["tests"],
      stopConditions: ["blocked"],
      unresolvedDecisions: [],
      sourceRefs: [],
    });
    await writeContract(target, contract, packageRoot, { taskId: "task-pf4" });
    await runRoute({ target, taskId: "task-pf4", workType: "code", surfaces: ["config"], packageRoot });

    // Corrupt rules.json
    await writeFile(path.join(target, ".forgeloop", "policy", "rules.json"), "MALFORMED_RULES_JSON{{{");

    await assert.rejects(
      async () => {
        await runPreflight({ target, taskId: "task-pf4", packageRoot });
      },
      (err) => {
        assert.equal(err.code, "E_POLICY_INVALID");
        return true;
      },
    );
  });
});

test("PF5: baseline.json malformed -> preflight throws E_POLICY_INVALID", async () => {
  await withTarget(async (target) => {
    await runInit({ target, packageRoot, packageVersion: "1.2.1" });
    await runTaskCreate({ target, taskId: "task-pf5", packageRoot });
    const contract = createContract({
      taskId: "task-pf5",
      objective: "Verify preflight with malformed baseline",
      deliverables: ["src/app.js"],
      constraints: ["offline"],
      risks: [],
      verification: ["tests"],
      successCriteria: ["tests"],
      stopConditions: ["blocked"],
      unresolvedDecisions: [],
      sourceRefs: [],
    });
    await writeContract(target, contract, packageRoot, { taskId: "task-pf5" });
    await runRoute({ target, taskId: "task-pf5", workType: "code", surfaces: ["config"], packageRoot });

    // Corrupt baseline.json
    await writeFile(path.join(target, ".forgeloop", "policy", "baseline.json"), "MALFORMED_BASELINE{{{");

    await assert.rejects(
      async () => {
        await runPreflight({ target, taskId: "task-pf5", packageRoot });
      },
      (err) => {
        assert.equal(err.code, "E_POLICY_INVALID");
        return true;
      },
    );
  });
});

test("PF6: discovery.json malformed -> preflight throws E_POLICY_INVALID", async () => {
  await withTarget(async (target) => {
    await runInit({ target, packageRoot, packageVersion: "1.2.1" });
    await runTaskCreate({ target, taskId: "task-pf6", packageRoot });
    const contract = createContract({
      taskId: "task-pf6",
      objective: "Verify preflight with malformed discovery",
      deliverables: ["src/app.js"],
      constraints: ["offline"],
      risks: [],
      verification: ["tests"],
      successCriteria: ["tests"],
      stopConditions: ["blocked"],
      unresolvedDecisions: [],
      sourceRefs: [],
    });
    await writeContract(target, contract, packageRoot, { taskId: "task-pf6" });
    await runRoute({ target, taskId: "task-pf6", workType: "code", surfaces: ["config"], packageRoot });

    // Corrupt discovery.json
    await writeFile(path.join(target, ".forgeloop", "policy", "discovery.json"), "MALFORMED_DISCOVERY{{{");

    await assert.rejects(
      async () => {
        await runPreflight({ target, taskId: "task-pf6", packageRoot });
      },
      (err) => {
        assert.equal(err.code, "E_POLICY_INVALID");
        return true;
      },
    );
  });
});

// --------------------------------------------------------------------------
// SNAP-1: Snapshot Write Failure Test
// --------------------------------------------------------------------------

test("SNAP-1: legacy snapshot destination conflict is refused before native preflight mutation", async () => {
  await withTarget(async (target) => {
    await runInit({ target, packageRoot, packageVersion: "1.2.1" });
    await runTaskCreate({ target, taskId: "task-snap1", packageRoot });
    const contract = createContract({
      taskId: "task-snap1",
      objective: "Verify snapshot write failure",
      deliverables: ["src/app.js"],
      constraints: ["offline"],
      risks: [],
      verification: ["tests"],
      successCriteria: ["tests"],
      stopConditions: ["blocked"],
      unresolvedDecisions: [],
      sourceRefs: [],
    });
    await writeContract(target, contract, packageRoot, { taskId: "task-snap1" });
    await runRoute({ target, taskId: "task-snap1", workType: "code", surfaces: ["config"], packageRoot });

    const database = path.join(target, ".forgeloop/state.sqlite");
    const before = await readFile(database);
    // Create conflict where snapshot file is expected to be written
    const snapRel = taskArtifactPath("task-snap1", "policySnapshot");
    const snapshotPath = path.join(target, snapRel);
    await mkdir(snapshotPath, { recursive: true });

    await assert.rejects(
      async () => {
        await runPreflight({ target, taskId: "task-snap1", packageRoot });
      },
      (err) => {
        assert.equal(err.code, "E_STORAGE_MIGRATION_REQUIRED");
        return true;
      },
    );
    assert.deepEqual(await readFile(database), before);
  });
});

// --------------------------------------------------------------------------
// L1 - L5 / LOCK-S1 - LOCK-S8: Policy Lock Integrity Tests
// --------------------------------------------------------------------------

test("LOCK-S1: rulesDigest missing -> not VALID", async () => {
  await withTarget(async (target) => {
    await runInit({ target, packageRoot, packageVersion: "1.2.1" });
    const lock = await readPolicyLock(target, packageRoot);
    delete lock.rulesDigest;
    await writeFile(path.join(target, ".forgeloop", "policy", "policy.lock"), JSON.stringify(lock, null, 2));

    const lockResult = await verifyPolicyLock(target, packageRoot);
    assert.notEqual(lockResult.status, "VALID");
    if (lockResult.mismatches) {
      assert.ok(lockResult.mismatches.includes("rulesDigest"));
    }
  });
});

test("LOCK-S2: baselineDigest missing -> not VALID", async () => {
  await withTarget(async (target) => {
    await runInit({ target, packageRoot, packageVersion: "1.2.1" });
    const lock = await readPolicyLock(target, packageRoot);
    delete lock.baselineDigest;
    await writeFile(path.join(target, ".forgeloop", "policy", "policy.lock"), JSON.stringify(lock, null, 2));

    const lockResult = await verifyPolicyLock(target, packageRoot);
    assert.notEqual(lockResult.status, "VALID");
    if (lockResult.mismatches) {
      assert.ok(lockResult.mismatches.includes("baselineDigest"));
    }
  });
});

test("LOCK-S3: rulesDigest incorrect -> MISMATCH", async () => {
  await withTarget(async (target) => {
    await runInit({ target, packageRoot, packageVersion: "1.2.1" });
    const lock = await readPolicyLock(target, packageRoot);
    lock.rulesDigest = "sha256:1111111111111111111111111111111111111111111111111111111111111111";
    await writePolicyLock(target, lock, packageRoot);

    const lockResult = await verifyPolicyLock(target, packageRoot);
    assert.equal(lockResult.status, "MISMATCH");
    assert.ok(lockResult.mismatches.includes("rulesDigest"));
  });
});

test("LOCK-S4: baselineDigest incorrect -> MISMATCH", async () => {
  await withTarget(async (target) => {
    await runInit({ target, packageRoot, packageVersion: "1.2.1" });
    const lock = await readPolicyLock(target, packageRoot);
    lock.baselineDigest = "sha256:2222222222222222222222222222222222222222222222222222222222222222";
    await writePolicyLock(target, lock, packageRoot);

    const lockResult = await verifyPolicyLock(target, packageRoot);
    assert.equal(lockResult.status, "MISMATCH");
    assert.ok(lockResult.mismatches.includes("baselineDigest"));
  });
});

test("LOCK-S5: capturedAt removed -> VALID (capturedAt is optional and non-semantic)", async () => {
  await withTarget(async (target) => {
    await runInit({ target, packageRoot, packageVersion: "1.2.1" });
    const lock = await readPolicyLock(target, packageRoot);
    delete lock.capturedAt;
    await writePolicyLock(target, lock, packageRoot);

    const lockResult = await verifyPolicyLock(target, packageRoot);
    assert.equal(lockResult.status, "VALID");
  });
});

test("LOCK-S6: capturedAt changed only -> VALID", async () => {
  await withTarget(async (target) => {
    await runInit({ target, packageRoot, packageVersion: "1.2.1" });
    const lock = await readPolicyLock(target, packageRoot);
    lock.capturedAt = "2099-01-01T00:00:00.000Z";
    await writePolicyLock(target, lock, packageRoot);

    const lockResult = await verifyPolicyLock(target, packageRoot);
    assert.equal(lockResult.status, "VALID");
  });
});

test("LOCK-S7: all semantic fields intact -> lock status VALID", async () => {
  await withTarget(async (target) => {
    await runInit({ target, packageRoot, packageVersion: "1.2.1" });
    const lockResult = await verifyPolicyLock(target, packageRoot);
    assert.equal(lockResult.status, "VALID");
    assert.ok(lockResult.digest.startsWith("sha256:"));
  });
});

test("LOCK-S8: top-level digest intact + rulesDigest missing -> not VALID", async () => {
  await withTarget(async (target) => {
    await runInit({ target, packageRoot, packageVersion: "1.2.1" });
    const lock = await readPolicyLock(target, packageRoot);
    delete lock.rulesDigest;
    await writeFile(path.join(target, ".forgeloop", "policy", "policy.lock"), JSON.stringify(lock, null, 2));

    const lockResult = await verifyPolicyLock(target, packageRoot);
    assert.notEqual(lockResult.status, "VALID");
  });
});

test("LOCK-F1: top digest modified -> MISMATCH", async () => {
  await withTarget(async (target) => {
    await runInit({ target, packageRoot, packageVersion: "1.2.1" });
    const lock = await readPolicyLock(target, packageRoot);
    lock.digest = "sha256:0000000000000000000000000000000000000000000000000000000000000000";
    await writePolicyLock(target, lock, packageRoot);

    const lockResult = await verifyPolicyLock(target, packageRoot);
    assert.equal(lockResult.status, "MISMATCH");
    assert.ok(lockResult.mismatches.includes("digest"));
  });
});

test("LOCK-F4: algorithm invalid -> MISMATCH or INVALID", async () => {
  await withTarget(async (target) => {
    await runInit({ target, packageRoot, packageVersion: "1.2.1" });
    const lock = await readPolicyLock(target, packageRoot);
    const tampered = { ...lock, algorithm: "sha512" };
    await writeFile(path.join(target, ".forgeloop", "policy", "policy.lock"), JSON.stringify(tampered, null, 2));

    const lockResult = await verifyPolicyLock(target, packageRoot);
    assert.ok(["MISMATCH", "INVALID"].includes(lockResult.status));
  });
});

test("L2: project rule modified without updating lock -> lock status MISMATCH", async () => {
  await withTarget(async (target) => {
    await runInit({ target, packageRoot, packageVersion: "1.2.1" });
    // Tamper with project rules without updating lock
    await writeProjectRules(
      target,
      [
        {
          id: "CUSTOM.TAMPERED",
          name: "Tampered rule",
          description: "Unauthorized rule addition",
          source: "project",
          severity: "LOW",
          blocking: false,
          check: { type: "adapter", adapter: "secret-detection" },
          why: "Tampered rule",
          fix: "Remove tampered rule",
        },
      ],
      packageRoot,
    );

    const lockResult = await verifyPolicyLock(target, packageRoot);
    assert.equal(lockResult.status, "MISMATCH");
    assert.notEqual(lockResult.expected, lockResult.observed);
  });
});

test("L3: baseline modified without updating lock -> lock status MISMATCH", async () => {
  await withTarget(async (target) => {
    await runInit({ target, packageRoot, packageVersion: "1.2.1" });
    // Tamper with baseline without updating lock
    await writeBaseline(
      target,
      {
        schemaVersion: 1,
        createdAt: new Date().toISOString(),
        entries: [
          {
            ruleId: "SECURITY.NO_HARDCODED_SECRET",
            fingerprints: ["sha256:1111111111111111111111111111111111111111111111111111111111111111"],
          },
        ],
      },
      packageRoot,
    );

    const lockResult = await verifyPolicyLock(target, packageRoot);
    assert.equal(lockResult.status, "MISMATCH");
  });
});

test("L4: rules reordered only -> produces identical lock digest", () => {
  const ruleA = { id: "RULE_A", severity: "HIGH", blocking: true, check: "test" };
  const ruleB = { id: "RULE_B", severity: "LOW", blocking: false, check: "test" };

  const lock1 = computePolicyLockData([ruleA, ruleB], { schemaVersion: 1, entries: [] });
  const lock2 = computePolicyLockData([ruleB, ruleA], { schemaVersion: 1, entries: [] });

  assert.equal(lock1.digest, lock2.digest);
  assert.equal(lock1.rulesDigest, lock2.rulesDigest);
});

test("L5: baseline fingerprints reordered only -> produces identical lock digest", () => {
  const rules = [{ id: "RULE_A", severity: "HIGH", blocking: true, check: "test" }];
  const baseline1 = {
    schemaVersion: 1,
    entries: [{ ruleId: "RULE_A", fingerprints: ["sha256:bbb", "sha256:aaa"] }],
  };
  const baseline2 = {
    schemaVersion: 1,
    entries: [{ ruleId: "RULE_A", fingerprints: ["sha256:aaa", "sha256:bbb"] }],
  };

  const lock1 = computePolicyLockData(rules, baseline1);
  const lock2 = computePolicyLockData(rules, baseline2);

  assert.equal(lock1.digest, lock2.digest);
  assert.equal(lock1.baselineDigest, lock2.baselineDigest);
});

// --------------------------------------------------------------------------
// B1 - B5: Baseline Semantic Drift Tests
// --------------------------------------------------------------------------

test("B1: A B C -> A B = TIGHTEN", () => {
  const before = {
    rules: [],
    baseline: {
      schemaVersion: 1,
      entries: [{ ruleId: "R1", fingerprints: ["fp1", "fp2", "fp3"] }],
    },
  };
  const after = {
    rules: [],
    baseline: {
      schemaVersion: 1,
      entries: [{ ruleId: "R1", fingerprints: ["fp1", "fp2"] }],
    },
  };
  const diff = diffPolicies(before, after);
  assert.equal(diff.classification, "TIGHTEN");
});

test("B2: A B C -> A B C D = WEAKEN", () => {
  const before = {
    rules: [],
    baseline: {
      schemaVersion: 1,
      entries: [{ ruleId: "R1", fingerprints: ["fp1", "fp2", "fp3"] }],
    },
  };
  const after = {
    rules: [],
    baseline: {
      schemaVersion: 1,
      entries: [{ ruleId: "R1", fingerprints: ["fp1", "fp2", "fp3", "fp4"] }],
    },
  };
  const diff = diffPolicies(before, after);
  assert.equal(diff.classification, "WEAKEN");
});

test("B3: A B C -> A C D = WEAKEN", () => {
  const before = {
    rules: [],
    baseline: {
      schemaVersion: 1,
      entries: [{ ruleId: "R1", fingerprints: ["fp1", "fp2", "fp3"] }],
    },
  };
  const after = {
    rules: [],
    baseline: {
      schemaVersion: 1,
      entries: [{ ruleId: "R1", fingerprints: ["fp1", "fp3", "fp4"] }],
    },
  };
  const diff = diffPolicies(before, after);
  assert.equal(diff.classification, "WEAKEN");
});

test("B4: A B C -> A B C = NEUTRAL", () => {
  const before = {
    rules: [],
    baseline: {
      schemaVersion: 1,
      entries: [{ ruleId: "R1", fingerprints: ["fp1", "fp2", "fp3"] }],
    },
  };
  const after = {
    rules: [],
    baseline: {
      schemaVersion: 1,
      entries: [{ ruleId: "R1", fingerprints: ["fp1", "fp2", "fp3"] }],
    },
  };
  const diff = diffPolicies(before, after);
  assert.equal(diff.classification, "NEUTRAL");
});

test("B5: legacy snapshot with digest mismatch but no baseline state = UNKNOWN", () => {
  const before = {
    rules: [],
    baselineDigest: "sha256:old-digest",
    // baseline property is undefined
  };
  const after = {
    rules: [],
    baselineDigest: "sha256:new-digest",
    baseline: {
      schemaVersion: 1,
      entries: [{ ruleId: "R1", fingerprints: ["fp1"] }],
    },
  };
  const diff = diffPolicies(before, after);
  assert.equal(diff.classification, "UNKNOWN");
});

// --------------------------------------------------------------------------
// R1 - R4: Baseline Command Protections
// --------------------------------------------------------------------------

test("R1: initial adoption baseline --record is allowed without active task", async () => {
  await withTarget(async (target) => {
    await runInit({ target, packageRoot, packageVersion: "1.2.1" });
    const result = await runBaseline({ target, packageRoot, record: true });
    assert.equal(result.status, "RECORDED");
    assert.ok(result.lock);
  });
});

test("R2: active task rejects baseline --record with E_BASELINE_RECORD_DURING_ACTIVE_TASK", async () => {
  await withTarget(async (target) => {
    await runInit({ target, packageRoot, packageVersion: "1.2.1" });
    await runTaskCreate({ target, taskId: "active-task", packageRoot });
    const contract = createContract({
      taskId: "active-task",
      objective: "Active task for baseline protection test",
      deliverables: ["src/app.js"],
      constraints: ["offline"],
      risks: [],
      verification: ["tests"],
      successCriteria: ["tests"],
      stopConditions: ["blocked"],
      unresolvedDecisions: [],
      sourceRefs: [],
    });
    await writeContract(target, contract, packageRoot, { taskId: "active-task" });
    await runRoute({ target, taskId: "active-task", workType: "code", surfaces: ["config"], packageRoot });
    await runActivate({ target, taskId: "active-task", packageRoot });
    await runPreflight({ target, taskId: "active-task", packageRoot });
    await runAdvance({ target, taskId: "active-task", to: "PLANNED", packageRoot });
    await runAdvance({ target, taskId: "active-task", to: "EXECUTING", packageRoot });

    await assert.rejects(
      async () => {
        await runBaseline({ target, packageRoot, record: true });
      },
      (err) => {
        assert.equal(err.code, "E_BASELINE_RECORD_DURING_ACTIVE_TASK");
        return true;
      },
    );
  });
});

test("R3: active task allows baseline --update that monotonically removes debt", async () => {
  await withTarget(async (target) => {
    await runInit({ target, packageRoot, packageVersion: "1.2.1" });
    await runBaseline({ target, packageRoot, record: true });

    await runTaskCreate({ target, taskId: "ratchet-task", packageRoot });
    const contract = createContract({
      taskId: "ratchet-task",
      objective: "Ratchet task for baseline test",
      deliverables: ["src/app.js"],
      constraints: ["offline"],
      risks: [],
      verification: ["tests"],
      successCriteria: ["tests"],
      stopConditions: ["blocked"],
      unresolvedDecisions: [],
      sourceRefs: [],
    });
    await writeContract(target, contract, packageRoot, { taskId: "ratchet-task" });
    await runRoute({ target, taskId: "ratchet-task", workType: "code", surfaces: ["config"], packageRoot });
    await runActivate({ target, taskId: "ratchet-task", packageRoot });
    await runPreflight({ target, taskId: "ratchet-task", packageRoot });

    const result = await runBaseline({ target, packageRoot, update: true });
    assert.ok(["UPDATED", "VALID"].includes(result.status));
  });
});

test("R4: explicit --policy-reset-authorized allows re-recording during active task", async () => {
  await withTarget(async (target) => {
    await runInit({ target, packageRoot, packageVersion: "1.2.1" });
    await runTaskCreate({ target, taskId: "reset-task", packageRoot });
    const contract = createContract({
      taskId: "reset-task",
      objective: "Reset task for baseline test",
      deliverables: ["src/app.js"],
      constraints: ["offline"],
      risks: [],
      verification: ["tests"],
      successCriteria: ["tests"],
      stopConditions: ["blocked"],
      unresolvedDecisions: [],
      sourceRefs: [],
    });
    await writeContract(target, contract, packageRoot, { taskId: "reset-task" });
    await runRoute({ target, taskId: "reset-task", workType: "code", surfaces: ["config"], packageRoot });
    await runActivate({ target, taskId: "reset-task", packageRoot });
    await runPreflight({ target, taskId: "reset-task", packageRoot });

    const result = await runBaseline({ target, packageRoot, record: true, policyResetAuthorized: true });
    assert.equal(result.status, "RECORDED");
  });
});

// --------------------------------------------------------------------------
// CLI-B1 - CLI-B4: CLI Baseline Reset Authorization Tests
// --------------------------------------------------------------------------

test("CLI-B1 to CLI-B3: real CLI processes --policy-reset-authorized flag correctly", async () => {
  await withTarget(async (target) => {
    // 1. init
    const initRes = runCli(target, "init");
    assert.equal(initRes.status, 0);

    // 2. create task and preflight
    const createRes = runCli(target, "task-create", "--task=cli-b-task");
    assert.equal(createRes.status, 0);

    const contract = createContract({
      taskId: "cli-b-task",
      objective: "Verify CLI baseline flag",
      deliverables: ["src/app.js"],
      constraints: ["offline"],
      risks: [],
      verification: ["tests"],
      successCriteria: ["tests"],
      stopConditions: ["blocked"],
      unresolvedDecisions: [],
      sourceRefs: [],
    });
    const { withProjectStorage } = await import("../src/storage/project-boundary.js");
    await withProjectStorage(target, () => writeContract(target, contract, packageRoot, { taskId: "cli-b-task" }));
    runCli(target, "route", "--task=cli-b-task", "--work=code", "--surface=config");
    runCli(target, "activate", "--task=cli-b-task");
    runCli(target, "preflight", "--task=cli-b-task");

    // CLI-B2: without --policy-reset-authorized, baseline --record fails during active task
    const blockedRes = runCli(target, "baseline", "--record");
    assert.notEqual(blockedRes.status, 0);

    // CLI-B3: with --policy-reset-authorized, baseline --record succeeds
    const allowedRes = runCli(target, "baseline", "--record", "--policy-reset-authorized");
    assert.equal(allowedRes.status, 0, allowedRes.stderr || allowedRes.stdout);
  });
});

test("CLI-B4: default baseline without explicit flag sets policyResetAuthorized to false", async () => {
  await withTarget(async (target) => {
    const initRes = runCli(target, "init");
    assert.equal(initRes.status, 0);
    const baselineRes = runCli(target, "baseline", "--record");
    assert.equal(baselineRes.status, 0);
  });
});

// --------------------------------------------------------------------------
// NEXT-P1 - NEXT-P6: forgeloop next Policy Recovery Action Mapping
// --------------------------------------------------------------------------

test("NEXT-P1: E_POLICY_WEAKENING maps to RESTORE_POLICY", () => {
  const action = policyRecoveryAction([{ code: "E_POLICY_WEAKENING", message: "Policy weakened" }]);
  assert.equal(action, NEXT_ACTIONS.RESTORE_POLICY);
});

test("NEXT-P2: E_CHECK_MUTATION_EXECUTION_ERROR maps to REPAIR_CHECKER", () => {
  const action = policyRecoveryAction([{ code: "E_CHECK_MUTATION_EXECUTION_ERROR", message: "Mutation execution error" }]);
  assert.equal(action, NEXT_ACTIONS.REPAIR_CHECKER);
});

test("NEXT-P3: E_POLICY_INVALID maps to REPAIR_POLICY", () => {
  const action = policyRecoveryAction([{ code: "E_POLICY_INVALID", message: "Invalid policy" }]);
  assert.equal(action, NEXT_ACTIONS.REPAIR_POLICY);
});

test("NEXT-P4: E_BASELINE_EXPANSION maps to RESTORE_BASELINE", () => {
  const action = policyRecoveryAction([{ code: "E_BASELINE_EXPANSION", message: "Baseline expansion" }]);
  assert.equal(action, NEXT_ACTIONS.RESTORE_BASELINE);
});

test("NEXT-P5: E_BASELINE_RECORD_DURING_ACTIVE_TASK maps to CONTINUE_WITH_EXISTING_BASELINE", () => {
  const action = policyRecoveryAction([{ code: "E_BASELINE_RECORD_DURING_ACTIVE_TASK", message: "Active task recording" }]);
  assert.equal(action, NEXT_ACTIONS.CONTINUE_WITH_EXISTING_BASELINE);
});

test("NEXT-P6: non-policy error returns null (preserves standard handling)", () => {
  const action = policyRecoveryAction([{ code: "E_RECEIPT_STALE", message: "Receipt stale" }]);
  assert.equal(action, null);
});

// --------------------------------------------------------------------------
// E2E Next Policy Recovery Tests
// --------------------------------------------------------------------------

test("E2E Next Recovery: policy weakening causes forgeloop next to return RESTORE_POLICY", async () => {
  await withTarget(async (target) => {
    // 1. init repository
    await runInit({ target, packageRoot, packageVersion: "1.2.1" });

    // 2. add a project rule with strict threshold
    const initialRule = {
      id: "CUSTOM.COMPLEXITY",
      name: "Complexity limit",
      description: "Checks complexity threshold",
      source: "project",
      severity: "HIGH",
      blocking: true,
      check: {
        type: "adapter",
        adapter: "secret-detection",
      },
      why: "Ensure code quality",
      fix: "Refactor complex code",
    };
    await writeProjectRules(target, [initialRule], packageRoot);
    const rules = await loadEffectiveRules(target, packageRoot);
    const baseline = await readBaseline(target, packageRoot);
    const lock = computePolicyLockData(rules, baseline);
    await writePolicyLock(target, lock, packageRoot);

    // 3. create task, contract, route
    await runTaskCreate({ target, taskId: "weaken-recovery-task", claim: ["src"], packageRoot });
    const contract = createContract({
      taskId: "weaken-recovery-task",
      objective: "Verify E2E next action policy recovery",
      deliverables: ["src/config.js"],
      constraints: ["offline"],
      risks: [],
      verification: ["tests"],
      successCriteria: ["tests"],
      stopConditions: ["blocked"],
      unresolvedDecisions: [],
      sourceRefs: [],
    });
    await writeContract(target, contract, packageRoot, { taskId: "weaken-recovery-task" });
    await runRoute({ target, taskId: "weaken-recovery-task", workType: "code", surfaces: ["config"], packageRoot });

    // 4. preflight (captures policy snapshot)
    const preflightRes = await runPreflight({ target, taskId: "weaken-recovery-task", packageRoot });
    assert.equal(preflightRes.status, "READY");

    // 5. activate and advance through lifecycle to REVIEWING
    await runActivate({ target, taskId: "weaken-recovery-task", packageRoot });
    await runAdvance({ target, taskId: "weaken-recovery-task", to: "PLANNED", packageRoot });
    await runAdvance({ target, taskId: "weaken-recovery-task", to: "EXECUTING", packageRoot });
    await runAdvance({ target, taskId: "weaken-recovery-task", to: "VERIFYING", packageRoot });

    await runPrepareCompletion({ target, taskId: "weaken-recovery-task", packageRoot });
    await runCheck({
      target,
      taskId: "weaken-recovery-task",
      id: "check-1",
      requirement: "tests",
      argv: ["node", "-e", "process.exit(0)"],
      packageRoot,
    });
    await runAdvance({ target, taskId: "weaken-recovery-task", to: "REVIEWING", packageRoot });
    await runPrepareCompletion({ target, taskId: "weaken-recovery-task", packageRoot });

    // 6. Weaken the policy by weakening the blocking rule
    const weakenedRule = {
      ...initialRule,
      severity: "LOW",
      blocking: false,
    };
    await writeProjectRules(target, [weakenedRule], packageRoot);
    const weakenedRules = await loadEffectiveRules(target, packageRoot);
    const weakenedLock = computePolicyLockData(weakenedRules, baseline);
    await writePolicyLock(target, weakenedLock, packageRoot);

    // 7. Run forgeloop next (runNext)
    const nextResult = await runNext({ target, taskId: "weaken-recovery-task", packageRoot });

    // 8. Assert RESTORE_POLICY and E_POLICY_WEAKENING
    assert.equal(nextResult.nextAction, NEXT_ACTIONS.RESTORE_POLICY);
    assert.ok(nextResult.reasons.some((r) => r.code === "E_POLICY_WEAKENING"));
  });
});

// --------------------------------------------------------------------------
// End-to-End Autonomy Invariant Test
// --------------------------------------------------------------------------

test("End-to-End Autonomy Invariant: complete unattended execution works without prompt or blocking", async () => {
  await withTarget(async (target) => {
    // 1. init
    const initRes = await runInit({ target, packageRoot, packageVersion: "1.2.1" });
    assert.equal(initRes.actions.length > 0, true);

    // 2. task create and contract
    const createRes = await runTaskCreate({ target, taskId: "autonomy-hardened", claim: ["src"], packageRoot });
    assert.equal(createRes.taskId, "autonomy-hardened");

    const contract = createContract({
      taskId: "autonomy-hardened",
      objective: "Verify hardened autonomous execution",
      deliverables: ["src/config.js"],
      constraints: ["offline"],
      risks: [],
      verification: ["tests"],
      successCriteria: ["tests"],
      stopConditions: ["blocked"],
      unresolvedDecisions: [],
      sourceRefs: [],
    });
    await writeContract(target, contract, packageRoot, { taskId: "autonomy-hardened" });

    // 3. route
    const routeRes = await runRoute({ target, taskId: "autonomy-hardened", workType: "code", surfaces: ["config"], packageRoot });
    assert.equal(routeRes.guides.includes("clean"), true);

    // 4. preflight -> activate -> advance to PLANNED -> EXECUTING -> VERIFYING
    const preRes = await runPreflight({ target, taskId: "autonomy-hardened", packageRoot });
    assert.equal(preRes.status, "READY");

    await runActivate({ target, taskId: "autonomy-hardened", packageRoot });
    await runAdvance({ target, taskId: "autonomy-hardened", to: "PLANNED", packageRoot });
    await runAdvance({ target, taskId: "autonomy-hardened", to: "EXECUTING", packageRoot });
    await runAdvance({ target, taskId: "autonomy-hardened", to: "VERIFYING", packageRoot });

    // 5. prepare initial completion receipt
    await runPrepareCompletion({ target, taskId: "autonomy-hardened", packageRoot });

    // 6. run check
    await runCheck({
      target,
      taskId: "autonomy-hardened",
      id: "check-1",
      requirement: "tests",
      argv: ["node", "-e", "process.exit(0)"],
      packageRoot,
    });

    // 7. advance to REVIEWING
    await runAdvance({ target, taskId: "autonomy-hardened", to: "REVIEWING", packageRoot });

    // 8. prepare-completion
    const prepRes = await runPrepareCompletion({
      target,
      taskId: "autonomy-hardened",
      packageRoot,
    });
    assert.ok(prepRes.path);

    // 9. complete
    const compRes = await runComplete({ target, taskId: "autonomy-hardened", packageRoot });
    assert.equal(compRes.status, "VALID");
  });
});

test("native baseline guard retains task policy proof across concurrent snapshot deletion", async () => {
  await withTarget(async (target) => {
    await runInit({ target, packageRoot, packageVersion: "1.2.1" });
    await runTaskCreate({ target, taskId: "active-task", packageRoot });
    const contract = createContract({
      taskId: "active-task",
      objective: "Active task for baseline protection test",
      deliverables: ["src/app.js"],
      constraints: ["offline"],
      risks: [],
      verification: ["tests"],
      successCriteria: ["tests"],
      stopConditions: ["blocked"],
      unresolvedDecisions: [],
      sourceRefs: [],
    });
    await writeContract(target, contract, packageRoot, { taskId: "active-task" });
    await runRoute({ target, taskId: "active-task", workType: "code", surfaces: ["config"], packageRoot });
    await runActivate({ target, taskId: "active-task", packageRoot });
    await runPreflight({ target, taskId: "active-task", packageRoot });
    await runAdvance({ target, taskId: "active-task", to: "PLANNED", packageRoot });
    await runAdvance({ target, taskId: "active-task", to: "EXECUTING", packageRoot });

    const { openStorageDatabase } = await import("../src/storage/index.js");
    const { withOperationalStore } = await import("../src/storage/unit-of-work.js");
    const filename = path.join(target, ".forgeloop/state.sqlite");
    const db = openStorageDatabase(filename);
    const writer = openStorageDatabase(filename);
    try {
      await withOperationalStore({ db, target }, async source => {
        const prototype = Object.getPrototypeOf(source);
        const read = prototype.readText;
        let changed = false;
        prototype.readText = function(relativePath) {
          const value = read.call(this, relativePath);
          if (!changed && this.target === target && relativePath === taskArtifactPath("active-task", "state")) {
            changed = true;
            assert.equal(writer.prepare("DELETE FROM task_artifacts WHERE task_id = ? AND kind = 'policySnapshot'").run("active-task").changes, 1);
          }
          return value;
        };
        try {
          await assert.rejects(runBaseline({ target, packageRoot, record: true }), { code: "E_BASELINE_RECORD_DURING_ACTIVE_TASK" });
          assert.equal(changed, true);
          assert.throws(() => source.commit(), { code: "E_STATE_REVISION_CONFLICT" });
        } finally { prototype.readText = read; }
      });
    } finally { writer.close(); db.close(); }
  });
});
