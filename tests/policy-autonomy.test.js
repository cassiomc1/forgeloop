import { removeTempTree } from "./helpers/rm-safe.js";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runInit } from "../src/commands/init.js";
import { runTaskCreate } from "../src/commands/task-create.js";
import { runRoute } from "../src/commands/route.js";
import { runActivate } from "../src/commands/activate.js";
import { runPreflight } from "../src/commands/preflight.js";
import { runAdvance } from "../src/commands/advance.js";
import { runCheck } from "../src/commands/run-check.js";
import { runPrepareCompletion } from "../src/commands/prepare-completion.js";
import { runComplete } from "../src/commands/complete.js";
import { runPolicyStatus } from "../src/commands/policy-status.js";
import { runBaseline } from "../src/commands/baseline.js";
import { getPackageRoot } from "../src/core/templates.js";
import { discoverPolicy } from "../src/core/policy-discovery.js";
import { evaluateBaselineViolations } from "../src/core/policy-baseline.js";
import { verifyRuleMutation } from "../src/core/policy-mutation.js";
import { diffPolicies } from "../src/core/policy-diff.js";
import { createContract, writeContract } from "../src/core/contract.js";
import { evaluateTargetPolicy, writeProjectRules } from "../src/core/policy-engine.js";

const packageRoot = getPackageRoot();

// Synthetic AWS-access-key-shaped values are assembled at runtime so committed
// test source contains no paste-ready secret literals (secret scanner hygiene).
const LEGACY_AWS_KEY = ["AKIA", "1234567890", "LEGACY"].join("");
const NEW_AWS_KEY = ["AKIA", "9999999999", "NEWSEC"].join("");

async function createTempTarget() {
  return mkdtemp(path.join(os.tmpdir(), "forgeloop-policy-test-"));
}

test("1. Zero-interaction acceptance test: clean repository unattended complete execution", async () => {
  const target = await createTempTarget();
  try {
    // 1. init
    const initRes = await runInit({ target, dryRun: false, packageRoot, packageVersion: "1.2.1" });
    assert.equal(initRes.actions.length > 0, true);

    // 2. task-create and contract
    const taskRes = await runTaskCreate({
      target,
      packageRoot,
      taskId: "task-zero-interaction",
    });
    assert.equal(taskRes.taskId, "task-zero-interaction");

    const contract = createContract({
      taskId: "task-zero-interaction",
      objective: "Verify zero prompt autonomous loop",
      deliverables: ["src/config.js"],
      constraints: ["offline"],
      risks: [],
      verification: ["tests"],
      successCriteria: ["tests"],
      stopConditions: ["blocked"],
      unresolvedDecisions: [],
      sourceRefs: [],
    });
    await writeContract(target, contract, packageRoot, { taskId: "task-zero-interaction" });

    // 3. route
    const routeRes = await runRoute({
      target,
      packageRoot,
      taskId: "task-zero-interaction",
      workType: "code",
      surfaces: ["config"],
      risks: [],
      platforms: ["server"],
    });
    assert.equal(routeRes.guides.includes("clean"), true);

    // 4. preflight
    const preflightRes = await runPreflight({
      target,
      packageRoot,
      taskId: "task-zero-interaction",
    });
    assert.equal(preflightRes.status, "READY");

    // 5. activate -> advance to PLANNED -> EXECUTING -> VERIFYING
    await runActivate({ target, packageRoot, taskId: "task-zero-interaction" });
    await runAdvance({ target, packageRoot, taskId: "task-zero-interaction", to: "PLANNED" });
    await runAdvance({ target, packageRoot, taskId: "task-zero-interaction", to: "EXECUTING" });
    await runAdvance({ target, packageRoot, taskId: "task-zero-interaction", to: "VERIFYING" });

    // 6. prepare initial receipt, record check, advance to REVIEWING, finalize receipt
    await runPrepareCompletion({
      target,
      packageRoot,
      taskId: "task-zero-interaction",
    });

    await runCheck({
      target,
      packageRoot,
      taskId: "task-zero-interaction",
      id: "check-1",
      requirement: "tests",
      argv: ["node", "-e", "process.exit(0)"],
    });

    await runAdvance({ target, packageRoot, taskId: "task-zero-interaction", to: "REVIEWING" });

    // 7. prepare-completion
    const prepRes = await runPrepareCompletion({
      target,
      packageRoot,
      taskId: "task-zero-interaction",
    });
    assert.ok(prepRes.path);

    // 8. complete
    const compRes = await runComplete({
      target,
      packageRoot,
      taskId: "task-zero-interaction",
    });
    assert.equal(compRes.status, "VALID");
  } finally {
    await removeTempTree(target);
  }
});

test("2. Brownfield autonomy acceptance test: pre-existing violations baselined, new violations blocked", async () => {
  const target = await createTempTarget();
  try {
    await runInit({ target, dryRun: false, packageRoot, packageVersion: "1.2.1" });

    // Create legacy file with secret
    await mkdir(path.join(target, "src/legacy"), { recursive: true });
    await writeFile(
      path.join(target, "src/legacy/old-credentials.js"),
      `const legacyKey = '${LEGACY_AWS_KEY}';\nmodule.exports = { legacyKey };\n`,
    );

    // Record baseline
    const baseRecord = await runBaseline({ target, packageRoot, record: true });
    assert.equal(baseRecord.status, "RECORDED");
    assert.equal(baseRecord.violationCount >= 1, true);

    // Status shows valid with baselined debt
    const statusBefore = await runPolicyStatus({ target, packageRoot });
    assert.equal(statusBefore.status, "VALID");
    assert.equal(statusBefore.baselineViolations >= 1, true);
    assert.equal(statusBefore.newViolations.length, 0);

    // Introduce a new violation in another file
    await mkdir(path.join(target, "src/new"), { recursive: true });
    await writeFile(
      path.join(target, "src/new/new-credentials.js"),
      `const newSecret = '${NEW_AWS_KEY}';\n`,
    );

    // Status now reports NEW_VIOLATION and INVALID
    const statusAfter = await runPolicyStatus({ target, packageRoot });
    assert.equal(statusAfter.status, "INVALID");
    assert.equal(statusAfter.newViolations.length >= 1, true);
    assert.equal(statusAfter.errors.some((e) => e.code === "NEW_VIOLATION"), true);
  } finally {
    await removeTempTree(target);
  }
});

test("3. Unknown architecture acceptance test: unknown directory structure produces UNKNOWN and READY", async () => {
  const target = await createTempTarget();
  try {
    await runInit({ target, dryRun: false, packageRoot, packageVersion: "1.2.1" });
    await mkdir(path.join(target, "src"), { recursive: true });
    await mkdir(path.join(target, "misc"), { recursive: true });
    await mkdir(path.join(target, "helpers"), { recursive: true });
    await mkdir(path.join(target, "stuff"), { recursive: true });

    const discovery = await discoverPolicy({ target });
    assert.equal(discovery.architecture.confidence, "LOW");
    assert.equal(discovery.architecture.value, null);

    const taskRes = await runTaskCreate({
      target,
      packageRoot,
      taskId: "task-unknown-arch",
    });
    assert.equal(taskRes.taskId, "task-unknown-arch");

    const contract = createContract({
      taskId: "task-unknown-arch",
      objective: "Verify preflight succeeds without mandatory arch declaration",
      deliverables: ["src/config.js"],
      constraints: ["offline"],
      risks: [],
      verification: ["clean-structure"],
      successCriteria: ["clean-structure"],
      stopConditions: ["blocked"],
      unresolvedDecisions: [],
      sourceRefs: [],
    });
    await writeContract(target, contract, packageRoot, { taskId: "task-unknown-arch" });

    await runRoute({
      target,
      packageRoot,
      taskId: "task-unknown-arch",
      workType: "code",
      surfaces: ["config"],
      risks: [],
      platforms: ["server"],
    });

    const preflight = await runPreflight({ target, packageRoot, taskId: "task-unknown-arch" });
    assert.equal(preflight.status, "READY");
  } finally {
    await removeTempTree(target);
  }
});

test("4. Inert inference acceptance test: discovered inert downgraded; project inert fails", async () => {
  const target = await createTempTarget();
  try {
    await runInit({ target, dryRun: false, packageRoot, packageVersion: "1.2.1" });

    // Discovered inert check evaluation
    const policyEval = await evaluateTargetPolicy({ target, packageRoot });
    assert.equal(policyEval.status, "VALID");

    // Add explicit project-configured blocking rule with non-existent adapter/scope
    await writeProjectRules(target, [
      {
        id: "PROJECT.INERT_RULE",
        severity: "HIGH",
        source: "project",
        blocking: true,
        why: "Explicit rule",
        fix: "Provide target",
        check: {
          type: "adapter",
          adapter: "architecture-layers",
        },
      },
    ], packageRoot);

    const projectPolicyEval = await evaluateTargetPolicy({ target, packageRoot });
    assert.equal(projectPolicyEval.status, "INVALID");
    assert.equal(projectPolicyEval.errors.some((e) => e.code === "CHECK_INERT"), true);
  } finally {
    await removeTempTree(target);
  }
});

test("5. Policy weakening test: increasing complexity threshold is classified as WEAKEN", async () => {
  const beforePolicy = {
    rules: [
      {
        id: "GRAIN.MAX_COMPLEXITY",
        severity: "HIGH",
        blocking: true,
        check: { type: "adapter", adapter: "grain-complexity", threshold: 15 },
      },
    ],
  };

  const afterPolicy = {
    rules: [
      {
        id: "GRAIN.MAX_COMPLEXITY",
        severity: "HIGH",
        blocking: true,
        check: { type: "adapter", adapter: "grain-complexity", threshold: 30 },
      },
    ],
  };

  const diff = diffPolicies(beforePolicy, afterPolicy);
  assert.equal(diff.classification, "WEAKEN");
  assert.equal(diff.changes.some((c) => c.path === "rules.GRAIN.MAX_COMPLEXITY.threshold"), true);

  // Restore policy
  const restoredDiff = diffPolicies(afterPolicy, beforePolicy);
  assert.equal(restoredDiff.classification, "TIGHTEN");
});

test("6. Policy tightening test: lowering complexity threshold is classified as TIGHTEN", async () => {
  const beforePolicy = {
    rules: [
      {
        id: "GRAIN.MAX_COMPLEXITY",
        severity: "HIGH",
        blocking: true,
        check: { type: "adapter", adapter: "grain-complexity", threshold: 15 },
      },
    ],
  };

  const afterPolicy = {
    rules: [
      {
        id: "GRAIN.MAX_COMPLEXITY",
        severity: "HIGH",
        blocking: true,
        check: { type: "adapter", adapter: "grain-complexity", threshold: 12 },
      },
    ],
  };

  const diff = diffPolicies(beforePolicy, afterPolicy);
  assert.equal(diff.classification, "TIGHTEN");
});

test("7. Mutation failure test: broken checker fails detection and returns UNPROVEN", async () => {
  const brokenChecker = {
    id: "broken-checker",
    check: async () => ({ passed: true, scannedFiles: 1 }), // Always returns pass
  };

  const rule = {
    id: "SECURITY.NO_HARDCODED_SECRET",
    check: { type: "adapter", adapter: "secret-detection" },
  };

  const result = await verifyRuleMutation({
    rule,
    overrideChecker: brokenChecker,
  });

  assert.equal(result.status, "UNPROVEN");
  assert.equal(result.errorCode, "CHECK_MUTATION_NOT_DETECTED");
});

test("8. Mutation recovery test: functioning checker passes mutation and returns PROVEN", async () => {
  const rule = {
    id: "SECURITY.NO_HARDCODED_SECRET",
    check: { type: "adapter", adapter: "secret-detection" },
  };

  const result = await verifyRuleMutation({ rule });
  assert.equal(result.status, "PROVEN");
  assert.equal(result.observed, "FAIL");
  assert.equal(result.expected, "FAIL");
  assert.equal(typeof result.proofDigest, "string");
});

test("9. Policy drift test: task activated with policy A detects drift when policy changed to B", async () => {
  const target = await createTempTarget();
  try {
    await runInit({ target, dryRun: false, packageRoot, packageVersion: "1.2.1" });
    await runTaskCreate({
      target,
      packageRoot,
      taskId: "task-drift",
    });

    const contract = createContract({
      taskId: "task-drift",
      objective: "Verify policy drift detection",
      deliverables: ["src/config.js"],
      constraints: ["offline"],
      risks: [],
      verification: ["clean-structure"],
      successCriteria: ["clean-structure"],
      stopConditions: ["blocked"],
      unresolvedDecisions: [],
      sourceRefs: [],
    });
    await writeContract(target, contract, packageRoot, { taskId: "task-drift" });

    await runRoute({
      target,
      packageRoot,
      taskId: "task-drift",
      workType: "code",
      surfaces: ["config"],
      risks: [],
      platforms: ["server"],
    });

    // Run preflight which captures task policy snapshot
    await runPreflight({ target, packageRoot, taskId: "task-drift" });

    // Status before modification: no drift
    const statusBefore = await runPolicyStatus({ target, packageRoot, taskId: "task-drift" });
    assert.equal(statusBefore.drift.detected, false);

    // Modify policy rules
    await writeProjectRules(target, [
      {
        id: "GRAIN.MAX_COMPLEXITY",
        severity: "HIGH",
        source: "project",
        blocking: false,
        why: "Weakened threshold",
        fix: "Restore",
        check: { type: "adapter", adapter: "grain-complexity", threshold: 50 },
      },
    ], packageRoot);

    // Status after modification: drift detected
    const statusAfter = await runPolicyStatus({ target, packageRoot, taskId: "task-drift" });
    assert.equal(statusAfter.drift.detected, true);
  } finally {
    await removeTempTree(target);
  }
});

test("10. New violation test: unbaselined violation blocks completion", async () => {
  const baseline = {
    schemaVersion: 1,
    createdAt: "2026-08-19T00:00:00Z",
    entries: [
      { ruleId: "SECURITY.NO_HARDCODED_SECRET", fingerprints: ["sha256:abc1", "sha256:abc2"] },
    ],
  };

  const currentViolations = [
    { ruleId: "SECURITY.NO_HARDCODED_SECRET", fingerprint: "sha256:abc1", message: "Legacy 1" },
    { ruleId: "SECURITY.NO_HARDCODED_SECRET", fingerprint: "sha256:abc2", message: "Legacy 2" },
    { ruleId: "SECURITY.NO_HARDCODED_SECRET", fingerprint: "sha256:abc3", message: "New secret" },
  ];

  const evalResult = evaluateBaselineViolations(baseline, currentViolations);
  assert.equal(evalResult.baselinedViolations.length, 2);
  assert.equal(evalResult.newViolations.length, 1);
  assert.equal(evalResult.newViolations[0].fingerprint, "sha256:abc3");
});

test("11. Reduced debt test: fixing baseline debt ratchets baseline downward monotonically", async () => {
  const baseline = {
    schemaVersion: 1,
    createdAt: "2026-08-19T00:00:00Z",
    entries: [
      { ruleId: "SECURITY.NO_HARDCODED_SECRET", fingerprints: ["sha256:a", "sha256:b", "sha256:c"] },
    ],
  };

  // Fixed violation 'b'
  const currentViolations = [
    { ruleId: "SECURITY.NO_HARDCODED_SECRET", fingerprint: "sha256:a" },
    { ruleId: "SECURITY.NO_HARDCODED_SECRET", fingerprint: "sha256:c" },
  ];

  const evalResult = evaluateBaselineViolations(baseline, currentViolations);
  assert.equal(evalResult.resolvedViolations.length, 1);
  assert.equal(evalResult.resolvedViolations[0].fingerprint, "sha256:b");

  const ratcheted = evalResult.ratchetedBaseline;
  assert.deepEqual(ratcheted.entries[0].fingerprints, ["sha256:a", "sha256:c"]);
});
