import { withProjectStorage } from "../src/storage/project-boundary.js";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { runActivate } from "../src/commands/activate.js";
import { runAdvance } from "../src/commands/advance.js";
import { runNext } from "../src/commands/next.js";
import { runPreflight } from "../src/commands/preflight.js";
import { runQualityBaseline } from "../src/commands/quality-baseline.js";
import { runQualityStatus } from "../src/commands/quality-status.js";
import { runQualityVerify } from "../src/commands/quality-verify.js";
import { runRecordDiagnosis } from "../src/commands/record-diagnosis.js";
import { runRoute } from "../src/commands/route.js";
import { runTaskCreate } from "../src/commands/task-create.js";
import { createConfig, writeConfig } from "../src/core/config.js";
import { createContract, writeContract } from "../src/core/contract.js";
import { createForgeLoopContext } from "../src/core/runtime-context.js";
import { getPackageRoot } from "../src/core/templates.js";
import { readWorkState } from "../src/core/work-state.js";

const packageRoot = getPackageRoot();
const taskId = "structural-quality-lifecycle-task";

function snapshot(qualitySignal) {
  return {
    quality_signal: qualitySignal,
    root_causes: Object.fromEntries([
      "modularity",
      "acyclicity",
      "depth",
      "equality",
      "redundancy",
    ].map((cause) => [cause, { score: qualitySignal, raw: qualitySignal / 10_000 }])),
    files: 3,
    lines: 120,
    import_edges: 4,
    cross_module_edges: 2,
  };
}

async function setupTask(target, selectedTaskId = taskId, qualityConfig = { mode: "gate", provider: "fake" }) {
  await runTaskCreate({ target, packageRoot, taskId: selectedTaskId, claims: [] });
  await writeConfig(target, createConfig({
    complianceMode: "standard",
    structuralQuality: qualityConfig,
  }), packageRoot);
  await writeContract(target, createContract({
    taskId: selectedTaskId,
    objective: "exercise structural-quality lifecycle",
    deliverables: ["src"],
    verification: [],
    successCriteria: [],
  }), packageRoot, { taskId: selectedTaskId });
  // The fixture isolates the structural-quality lifecycle itself; using the
  // documentation route keeps unrelated guide evidence out of its oracle.
  await runRoute({ target, packageRoot, taskId: selectedTaskId, workType: "documentation", surfaces: ["config"] });
  const preflight = await runPreflight({ target, packageRoot, taskId: selectedTaskId });
  assert.equal(preflight.status, "READY", JSON.stringify(preflight.errors));
  await runActivate({ target, packageRoot, taskId: selectedTaskId });
  await runAdvance({ target, packageRoot, taskId: selectedTaskId, to: "PLANNED" });
}

function fakeContext(sequence, scopeBinding = null, onScan = null) {
  let index = 0;
  const provider = {
    id: "fake",
    async detect() {
      return { available: true, providerId: "fake", providerVersion: "1.0.0", transport: "test", reasonCode: null };
    },
    async scan() {
      await onScan?.();
      const value = sequence[Math.min(index, sequence.length - 1)];
      index += 1;
      return { snapshot: snapshot(value), provider: { id: "fake", version: "1.0.0", transport: "test", executionMode: "test" } };
    },
  };
  if (scopeBinding) provider.scopeBinding = scopeBinding;
  return createForgeLoopContext({ structuralQualityProviders: { fake: provider } });
}

test("gate lifecycle captures a baseline, fails closed on regression, and passes after correction", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-structural-lifecycle-"));
  try {
    await setupTask(target);
    const runtimeContext = fakeContext([9000, 8999, 9000]);

    const baseline = await runQualityBaseline({ target, packageRoot, taskId, runtimeContext });
    assert.equal(baseline.status, "CAPTURED");
    await runAdvance({ target, packageRoot, taskId, to: "EXECUTING" });
    await runAdvance({ target, packageRoot, taskId, to: "VERIFYING" });

    const failed = await runQualityVerify({ target, packageRoot, taskId, runtimeContext });
    assert.equal(failed.evaluation.status, "FAIL");
    assert.equal(failed.check.status, "failed");
    assert.equal(failed.check.evidenceKind, "OBSERVED");
    assert.equal(failed.check.details.bottleneck, "modularity");
    assert.equal((await runQualityStatus({ target, packageRoot, taskId })).current.status, "FAIL");
    assert.equal((await runNext({ target, packageRoot, taskId })).nextAction, "DIAGNOSE_STRUCTURAL_QUALITY_REGRESSION");

    await runAdvance({ target, packageRoot, taskId, to: "DIAGNOSING" });
    await runRecordDiagnosis({
      target,
      packageRoot,
      taskId,
      hypothesis: "The changed graph reduced the aggregate structural signal.",
      failureClass: "REGRESSION_FAILURE",
      evidenceRefs: ["structural-quality"],
      settledBy: "quality-verify artifact",
      nextSafeAction: "Correct the graph and rerun structural-quality verification.",
    });
    await runAdvance({ target, packageRoot, taskId, to: "CORRECTING" });
    await runAdvance({ target, packageRoot, taskId, to: "VERIFYING" });

    const passed = await runQualityVerify({ target, packageRoot, taskId, runtimeContext });
    assert.equal(passed.evaluation.status, "PASS");
    assert.equal(passed.check.status, "passed");
    assert.equal((await runQualityStatus({ target, packageRoot, taskId })).current.status, "PASS");
    const next = await runNext({ target, packageRoot, taskId });
    assert.equal(next.nextAction, "ENTER_REVIEWING", JSON.stringify(next));
    await runAdvance({ target, packageRoot, taskId, to: "REVIEWING" });
  } finally {
    await rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("observe mode records provider absence without blocking the task", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-structural-observe-"));
  try {
    await runTaskCreate({ target, packageRoot, taskId: `${taskId}-observe`, claims: [] });
    await writeConfig(target, createConfig({ structuralQuality: { mode: "observe", provider: "missing" } }), packageRoot);
    const value = createContract({ taskId: `${taskId}-observe`, objective: "observe unavailable provider", verification: [], successCriteria: [] });
    await writeContract(target, value, packageRoot, { taskId: `${taskId}-observe` });
    await runRoute({ target, packageRoot, taskId: `${taskId}-observe`, workType: "code", surfaces: ["config"], executableChange: true });
    await runPreflight({ target, packageRoot, taskId: `${taskId}-observe` });
    await runActivate({ target, packageRoot, taskId: `${taskId}-observe` });
    await runAdvance({ target, packageRoot, taskId: `${taskId}-observe`, to: "PLANNED" });
    const plannedNext = await runNext({ target, packageRoot, taskId: `${taskId}-observe` });
    assert.equal(plannedNext.nextAction, "START_EXECUTION");
    assert.equal(plannedNext.optionalActions[0].action, "CAPTURE_STRUCTURAL_QUALITY_BASELINE");
    const result = await runQualityBaseline({ target, packageRoot, taskId: `${taskId}-observe`, runtimeContext: fakeContext([9000]) });
    assert.equal(result.status, "NOT_OBSERVED");
    await runAdvance({ target, packageRoot, taskId: `${taskId}-observe`, to: "EXECUTING" });
    await runAdvance({ target, packageRoot, taskId: `${taskId}-observe`, to: "VERIFYING" });
    const verification = await runQualityVerify({ target, packageRoot, taskId: `${taskId}-observe`, runtimeContext: fakeContext([9000]) });
    assert.equal(verification.evaluation.status, "NOT_OBSERVED");
    assert.equal(verification.check.status, "not-run");
  } finally {
    await rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("a passed structural evaluation becomes stale before lifecycle review when source changes", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-structural-freshness-source-"));
  const selectedTaskId = `${taskId}-fresh-source`;
  try {
    await setupTask(target, selectedTaskId);
    const runtimeContext = fakeContext([9000]);
    await runQualityBaseline({ target, packageRoot, taskId: selectedTaskId, runtimeContext });
    await runAdvance({ target, packageRoot, taskId: selectedTaskId, to: "EXECUTING", runtimeContext });
    await runAdvance({ target, packageRoot, taskId: selectedTaskId, to: "VERIFYING", runtimeContext });
    await runQualityVerify({ target, packageRoot, taskId: selectedTaskId, runtimeContext });
    await writeFile(path.join(target, "source-change.txt"), "changed after quality verification\n");

    const status = await runQualityStatus({ target, packageRoot, taskId: selectedTaskId });
    assert.equal(status.persistedStatus, "PASS");
    assert.equal(status.freshness, "STALE");
    assert.equal(status.current.status, "BLOCKED");
    assert.ok(status.reasonCodes.includes("E_STRUCTURAL_QUALITY_EVIDENCE_STALE"));
    const next = await runNext({ target, packageRoot, taskId: selectedTaskId });
    assert.equal(next.nextAction, "VERIFY_STRUCTURAL_QUALITY", JSON.stringify(next));
  } finally {
    await rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("provider scope changes make an evaluation incomparable", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-structural-freshness-scope-"));
  const selectedTaskId = `${taskId}-fresh-scope`;
  let providerConfigFingerprint = "a".repeat(64);
  try {
    await setupTask(target, selectedTaskId);
    const runtimeContext = fakeContext([9000], async () => ({ providerConfigFingerprint }));
    await runQualityBaseline({ target, packageRoot, taskId: selectedTaskId, runtimeContext });
    await runAdvance({ target, packageRoot, taskId: selectedTaskId, to: "EXECUTING", runtimeContext });
    providerConfigFingerprint = "b".repeat(64);
    await runAdvance({ target, packageRoot, taskId: selectedTaskId, to: "VERIFYING", runtimeContext });
    const changed = await runQualityVerify({ target, packageRoot, taskId: selectedTaskId, runtimeContext });
    assert.equal(changed.evaluation.status, "BLOCKED");
    assert.equal(changed.evaluation.comparison.comparable, false);
    assert.ok(changed.evaluation.reasonCodes.includes("PROVIDER_CONFIG_CHANGED"));
    assert.equal(changed.check.status, "blocked");
  } finally {
    await rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("custom providers remain independent of Sentrux rules configuration", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-structural-custom-scope-"));
  const selectedTaskId = `${taskId}-custom-scope`;
  try {
    await setupTask(target, selectedTaskId, { mode: "gate", provider: "fake" });
    await mkdir(path.join(target, ".sentrux"), { recursive: true });
    await writeFile(path.join(target, ".sentrux", "rules.toml"), "rule = \"A\"\n");
    const runtimeContext = fakeContext([9000]);
    await runQualityBaseline({ target, packageRoot, taskId: selectedTaskId, runtimeContext });
    await runAdvance({ target, packageRoot, taskId: selectedTaskId, to: "EXECUTING", runtimeContext });
    await runAdvance({ target, packageRoot, taskId: selectedTaskId, to: "VERIFYING", runtimeContext });
    await writeFile(path.join(target, ".sentrux", "rules.toml"), "rule = \"B\"\n");
    const result = await runQualityVerify({ target, packageRoot, taskId: selectedTaskId, runtimeContext });
    assert.equal(result.evaluation.status, "PASS");
    assert.equal(result.evaluation.comparison.comparable, true);
  } finally {
    await rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("concurrent quality evaluations allocate unique attempts under the task lock", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-structural-concurrent-"));
  const selectedTaskId = `${taskId}-concurrent`;
  try {
    await setupTask(target, selectedTaskId, {
      mode: "gate",
      provider: "fake",
      optimization: { mode: "bounded", maxExtraEvaluations: 2, minGainPoints: 25 },
    });
    const runtimeContext = fakeContext([9000, 9000]);
    await runQualityBaseline({ target, packageRoot, taskId: selectedTaskId, runtimeContext });
    await runAdvance({ target, packageRoot, taskId: selectedTaskId, to: "EXECUTING" });
    await runAdvance({ target, packageRoot, taskId: selectedTaskId, to: "VERIFYING" });

    const results = await Promise.all([
      runQualityVerify({ target, packageRoot, taskId: selectedTaskId, runtimeContext }),
      runQualityVerify({ target, packageRoot, taskId: selectedTaskId, runtimeContext }),
    ]);
    assert.deepEqual(results.map((result) => result.evaluation.attempt).sort((a, b) => a - b), [1, 2]);
    assert.ok(results.every((result) => result.evaluation.status === "PASS"));
    const status = await runQualityStatus({ target, packageRoot, taskId: selectedTaskId });
    assert.equal(status.current.attempt, 2);
    assert.equal(status.optimization.attempts, 2);
    assert.equal(status.optimization.gain, 0);
    assert.equal(status.optimization.converged, true);
    const state = await readWorkState(target, { packageRoot, taskId: selectedTaskId });
    const qualityCheck = state.checks.find((check) => check.id === "structural-quality");
    assert.equal(qualityCheck.details.attempt, 2);
    assert.equal(qualityCheck.status, "passed");
    const optional = await runQualityVerify({ target, packageRoot, taskId: selectedTaskId, runtimeContext });
    assert.equal(optional.evaluation.status, "PASS");
    const converged = await runQualityVerify({ target, packageRoot, taskId: selectedTaskId, runtimeContext });
    assert.equal(converged.status, "CONVERGED");
    assert.equal(converged.evaluation.status, "PASS");
  } finally {
    await rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("native SQLite concurrent quality evaluations preserve attempt allocation and checks", { timeout: 60_000 }, async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-structural-native-concurrent-"));
  const selectedTaskId = `${taskId}-native-concurrent`;
  try {
    await setupTask(target, selectedTaskId, {
      mode: "gate",
      provider: "fake",
      optimization: { mode: "bounded", maxExtraEvaluations: 2, minGainPoints: 25 },
    });
    let providerCalls = 0;
    let releaseObservations;
    const overlappingObservations = new Promise(resolve => { releaseObservations = resolve; });
    const runtimeContext = fakeContext([9000, 9000], null, () => {
      providerCalls += 1;
      if (providerCalls === 1) return; // Baseline is captured before verification.
      if (providerCalls === 3) releaseObservations();
      // Both observations must precede persistence. A later caller may instead
      // reconcile an existing unprojected evaluation without taking a new scan.
      return overlappingObservations;
    });
    await runQualityBaseline({ target, packageRoot, taskId: selectedTaskId, runtimeContext });
    await runAdvance({ target, packageRoot, taskId: selectedTaskId, to: "EXECUTING" });
    await runAdvance({ target, packageRoot, taskId: selectedTaskId, to: "VERIFYING" });

    await withProjectStorage(target, store => {
      assert.equal(store.db.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
    }, { readOnly: true });
    const verify = () => withProjectStorage(target, () => runQualityVerify({ target, packageRoot, taskId: selectedTaskId, runtimeContext }), { runtimeContext });
    const results = await Promise.all([
      verify(),
      verify(),
    ]);
    assert.deepEqual(results.map((result) => result.evaluation.attempt).sort((a, b) => a - b), [1, 2]);
    assert.ok(results.every((result) => result.evaluation.status === "PASS"));
    assert.equal(providerCalls, 3, "one baseline and two observations; persistence retries must not call the provider");
    const status = await withProjectStorage(target, () => runQualityStatus({ target, packageRoot, taskId: selectedTaskId }), { readOnly: true, runtimeContext });
    assert.equal(status.current.attempt, 2);
    assert.equal(status.optimization.attempts, 2);
    assert.equal(status.optimization.gain, 0);
    assert.equal(status.optimization.converged, true);
    const state = await withProjectStorage(target, () => readWorkState(target, { packageRoot, taskId: selectedTaskId }), { readOnly: true, runtimeContext });
    const qualityCheck = state.checks.find((check) => check.id === "structural-quality");
    assert.equal(qualityCheck.details.attempt, 2);
    assert.equal(qualityCheck.status, "passed");
    const optional = await verify();
    assert.equal(optional.evaluation.status, "PASS");
    const converged = await verify();
    assert.equal(converged.status, "CONVERGED");
    assert.equal(converged.evaluation.status, "PASS");
  } finally {
    await rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("bounded attempt limits preserve a blocked gate outcome", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-structural-limit-"));
  const selectedTaskId = `${taskId}-limit`;
  try {
    await setupTask(target, selectedTaskId);
    await runQualityBaseline({ target, packageRoot, taskId: selectedTaskId, runtimeContext: fakeContext([9000]) });
    await runAdvance({ target, packageRoot, taskId: selectedTaskId, to: "EXECUTING" });
    await runAdvance({ target, packageRoot, taskId: selectedTaskId, to: "VERIFYING" });
    const unavailable = createForgeLoopContext({ structuralQualityProviders: {
      fake: {
        id: "fake",
        async detect() { return { available: false, providerId: "fake", providerVersion: null, transport: "test", reasonCode: "E_STRUCTURAL_QUALITY_PROVIDER_UNAVAILABLE" }; },
        async scan() { throw new Error("scan must not run when detection is unavailable"); },
      },
    } });
    const first = await runQualityVerify({ target, packageRoot, taskId: selectedTaskId, runtimeContext: unavailable });
    assert.equal(first.evaluation.status, "BLOCKED");
    const limited = await runQualityVerify({ target, packageRoot, taskId: selectedTaskId, runtimeContext: unavailable });
    assert.equal(limited.status, "BLOCKED");
    assert.equal(limited.evaluation.status, "BLOCKED");
  } finally {
    await rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
