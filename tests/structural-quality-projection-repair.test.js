import { removeTempTree } from "./helpers/rm-safe.js";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

import { runActivate } from "../src/commands/activate.js";
import { runAdvance } from "../src/commands/advance.js";
import { runPreflight } from "../src/commands/preflight.js";
import { runQualityBaseline } from "../src/commands/quality-baseline.js";
import { runQualityVerify } from "../src/commands/quality-verify.js";
import { runRoute } from "../src/commands/route.js";
import { runTaskCreate } from "../src/commands/task-create.js";
import { createConfig, writeConfig } from "../src/core/config.js";
import { createContract, writeContract } from "../src/core/contract.js";
import { createForgeLoopContext } from "../src/core/runtime-context.js";
import { getPackageRoot } from "../src/core/templates.js";
import { listStructuralQualityEvaluations, readStructuralQualityBaseline, writeStructuralQualityEvaluation } from "../src/core/structural-quality/artifacts.js";
import { readWorkState } from "../src/core/work-state.js";
import { createSentruxStructuralQualityProvider } from "../src/core/structural-quality/sentrux-mcp.js";
import { compareStructuralQuality, structuralQualityPolicyFingerprint } from "../src/core/structural-quality/policy.js";
import { computeMaterialSourceFingerprint } from "../src/core/structural-quality/source-fingerprint.js";

const execFileAsync = promisify(execFile);
const packageRoot = getPackageRoot();
const fakeServerPath = path.join(packageRoot, "tests", "fixtures", "fake-sentrux-mcp.mjs");

async function initGitRepository(target) {
  await execFileAsync("git", ["init", "-b", "main"], { cwd: target });
  await execFileAsync("git", ["config", "user.name", "ForgeLoop Test"], { cwd: target });
  await execFileAsync("git", ["config", "user.email", "test@forgeloop.local"], { cwd: target });
  await writeFile(path.join(target, "README.md"), "# Test Project\n");
  await execFileAsync("git", ["add", "README.md"], { cwd: target });
  await execFileAsync("git", ["commit", "-m", "initial commit"], { cwd: target });
}

async function setupTask(target, taskId, structuralQualityConfig = { mode: "gate", provider: "fake" }) {
  await initGitRepository(target);
  await runTaskCreate({ target, packageRoot, taskId, claims: ["README.md"] });
  await writeConfig(target, createConfig({
    complianceMode: "standard",
    structuralQuality: structuralQualityConfig,
  }), packageRoot);
  await writeContract(target, createContract({
    taskId,
    objective: "Test projection recovery",
    deliverables: ["projection-test"],
    successCriteria: ["projection-test"],
    stopConditions: ["projection-test"],
  }), packageRoot, { taskId });
  await runRoute({ target, packageRoot, taskId, workType: "documentation", surfaces: ["config"] });
  const preflight = await runPreflight({ target, packageRoot, taskId });
  assert.equal(preflight.status, "READY", JSON.stringify(preflight.errors));
  await runActivate({ target, packageRoot, taskId });
  await runAdvance({ target, packageRoot, taskId, to: "PLANNED" });
}

test("orphaned evaluation artifact is reconciled and projected to receipt on retry without rescanning", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-projection-repair-"));
  const taskId = "projection-repair-task";
  try {
    await setupTask(target, taskId, {
      mode: "gate",
      provider: "fake",
      optimization: { mode: "bounded", maxExtraEvaluations: 2, minGainPoints: 25 },
    });
    let scanCount = 0;
    const sentruxProvider = createSentruxStructuralQualityProvider({
      projectPath: target,
      executable: process.execPath,
      args: [fakeServerPath],
    });
    const providerWrapper = {
      id: "fake",
      async detect(input) {
        const res = await sentruxProvider.detect(input);
        return { ...res, providerId: "fake" };
      },
      async observe(input) {
        scanCount += 1;
        const res = await sentruxProvider.observe(input);
        return {
          ...res,
          provider: { ...res.provider, id: "fake" },
          detection: { ...res.detection, providerId: "fake" },
        };
      },
      async scan(input) {
        return this.observe(input);
      },
    };
    const runtimeContext = createForgeLoopContext({ structuralQualityProviders: { fake: providerWrapper } });

    // Baseline capture
    await runQualityBaseline({ target, packageRoot, taskId, runtimeContext });
    assert.equal(scanCount, 1);

    await runAdvance({ target, packageRoot, taskId, to: "EXECUTING" });
    await runAdvance({ target, packageRoot, taskId, to: "VERIFYING" });

    // Simulate an orphaned evaluation: the evaluation artifact was written to disk, but the check was never projected (e.g. crash before receipt update)
    const baseline = await readStructuralQualityBaseline(target, taskId, packageRoot);
    const sourceFingerprint = await computeMaterialSourceFingerprint(target);
    const fakeSnapshot = baseline.value.snapshot;
    const policy = {
      mode: "gate",
      provider: "fake",
      maxRegressionPoints: 0,
      dimensionBudgets: { modularity: null, acyclicity: null, depth: null, equality: null, redundancy: null },
      forbidNewCycles: true,
      minQualitySignal: null,
      minimums: {},
      optimization: { mode: "bounded", maxExtraEvaluations: 2, minGainPoints: 25 },
    };
    const comparison = compareStructuralQuality({
      baseline: baseline.value,
      current: {
        snapshot: fakeSnapshot,
        provider: { id: "fake", version: "0.5.7", measurementModel: "structural-root-causes-v1", compatibilityKey: "sentrux-structural-root-causes-v1" },
        scope: { kind: "PROJECT", projectRoot: ".", providerConfigFingerprint: null },
      },
      policy,
    });
    const orphanedEvaluation = {
      schemaVersion: 1,
      protocolVersion: 1,
      role: "EVALUATION",
      taskId,
      capturedAt: new Date().toISOString(),
      verificationCycle: 1,
      attempt: 1,
      status: "PASS",
      reasonCodes: [],
      errorCode: null,
      bindings: {
        contractFingerprint: baseline.value.bindings.contractFingerprint,
        routeFingerprint: baseline.value.bindings.routeFingerprint,
        policyFingerprint: structuralQualityPolicyFingerprint(policy),
        scopeFingerprint: baseline.value.bindings.scopeFingerprint,
        baselineFingerprint: baseline.fingerprint,
        sourceMaterialFingerprint: sourceFingerprint,
        stateRevision: 3,
      },
      sourceObservation: {
        beforeFingerprint: sourceFingerprint,
        afterFingerprint: sourceFingerprint,
        stable: true,
      },
      provider: {
        id: "fake",
        version: "0.5.7",
        transport: "mcp-stdio",
        executionMode: "runtime-context",
        measurementModel: "structural-root-causes-v1",
        compatibilityKey: "sentrux-structural-root-causes-v1",
      },
      detection: {
        available: true,
        providerId: "fake",
        providerVersion: "0.5.7",
        transport: "mcp-stdio",
        measurementModel: "structural-root-causes-v1",
        compatibilityKey: "sentrux-structural-root-causes-v1",
        reasonCode: null,
      },
      scope: { kind: "PROJECT", projectRoot: ".", providerConfigFingerprint: null },
      baselineSignal: baseline.value.snapshot.qualitySignal,
      currentSignal: fakeSnapshot.qualitySignal,
      snapshot: fakeSnapshot,
      comparison,
    };
    const writtenOrphan = await writeStructuralQualityEvaluation(target, taskId, 1, 1, orphanedEvaluation, packageRoot);

    // Verify retry: should recognize orphaned evaluation, repair the check in receipt, NOT increment scanCount, NOT increment attempt
    const repairVerify = await runQualityVerify({ target, packageRoot, taskId, runtimeContext });
    assert.equal(scanCount, 1, "provider must NOT be rescanned when repairing orphaned projection");
    assert.equal(repairVerify.evaluation.attempt, 1, "attempt must NOT be incremented during projection repair");
    assert.equal(repairVerify.check.status, "passed");
    assert.equal(repairVerify.check.details.artifactRef, writtenOrphan.path);

    const evaluations = await listStructuralQualityEvaluations(target, taskId, packageRoot);
    assert.equal(evaluations.length, 1, "no extra evaluation artifact should be created");

    const state = await readWorkState(target, { packageRoot, taskId });
    const check = state.checks.find((c) => c.id === "structural-quality");
    assert.ok(check, "repaired check must be present in state");
    assert.equal(check.status, "passed");
    assert.equal(check.details.attempt, 1);
  } finally {
    await removeTempTree(target);
  }
});
