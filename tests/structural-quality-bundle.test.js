import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { exportTaskBundle, readTaskBundle } from "../src/core/bundles.js";
import { canonicalFingerprint, writeJsonArtifact } from "../src/core/artifacts.js";
import { createCheck } from "../src/core/checks.js";
import { createConfig, writeConfig } from "../src/core/config.js";
import { createContract, contractFingerprint, writeContract } from "../src/core/contract.js";
import { evaluateRoute } from "../src/core/router.js";
import { persistRoute } from "../src/core/route-artifact.js";
import { normalizeStructuralQualityConfig, structuralQualityPolicyFingerprint } from "../src/core/structural-quality/policy.js";
import { writeStructuralQualityBaseline, writeStructuralQualityEvaluation } from "../src/core/structural-quality/artifacts.js";
import { normalizeStructuralQualitySnapshot } from "../src/core/structural-quality/provider.js";
import { buildTaskArtifactPaths } from "../src/core/task-paths.js";
import { ensureFixtureTask, readRawFixtureText } from "./helpers/native-storage-fixture.js";
import { getPackageRoot } from "../src/core/templates.js";

const packageRoot = getPackageRoot();
const taskId = "structural-quality-bundle-task";
const ARTIFACT_PATHS = buildTaskArtifactPaths(taskId);

function snapshot(signal) {
  return normalizeStructuralQualitySnapshot({
    qualitySignal: signal,
    rootCauses: Object.fromEntries([
      "modularity",
      "acyclicity",
      "depth",
      "equality",
      "redundancy",
    ].map((cause) => [cause, { score: signal, raw: signal / 10_000 }])),
    statistics: { files: 3, lines: 120, importEdges: 4, crossModuleEdges: 2 },
    diagnostics: null,
  });
}

async function setupBundleTarget(target) {
  await ensureFixtureTask(target, taskId, packageRoot);
  const config = createConfig({ structuralQuality: { mode: "gate", provider: "fake" } });
  await writeConfig(target, config, packageRoot);
  const contract = createContract({
    taskId,
    objective: "bundle structural-quality evidence",
    verification: [],
    successCriteria: [],
  });
  await writeContract(target, contract, packageRoot, { taskId });
  const route = evaluateRoute({ workType: "documentation" });
  const routeArtifact = await persistRoute(target, route, packageRoot, { contractFingerprint: contractFingerprint(contract), taskId });
  await writeJsonArtifact(target, ARTIFACT_PATHS.state, {
    schemaVersion: 1,
    protocolVersion: 1,
    taskId,
    contractFingerprint: contractFingerprint(contract),
    repositoryFingerprint: { branch: null, head: null },
    phase: "ROUTED",
    selectedGuides: route.guides,
    completedSteps: [],
    pendingSteps: [],
    requiredArtifacts: [],
    checks: [],
    failures: [],
    blockers: [],
    verificationEvidence: [],
    lastUpdated: "2026-09-01T00:00:00.000Z",
  }, "work-state", packageRoot);

  const policy = normalizeStructuralQualityConfig(config.structuralQuality);
  const scope = { kind: "PROJECT", projectRoot: ".", providerConfigFingerprint: null };
  const sourceMaterialFingerprint = "b".repeat(64);
  const base = {
    contractFingerprint: contractFingerprint(contract),
    routeFingerprint: routeArtifact.fingerprint,
    policyFingerprint: structuralQualityPolicyFingerprint(policy),
    scopeFingerprint: canonicalFingerprint({ providerId: "fake", ...scope }),
  };
  const baselineValue = {
    schemaVersion: 1,
    protocolVersion: 1,
    role: "BASELINE",
    taskId,
    capturedAt: "2026-09-01T00:00:00.000Z",
    verificationCycle: null,
    attempt: 1,
    status: "PASS",
    reasonCodes: [],
    bindings: { ...base, baselineFingerprint: null, sourceMaterialFingerprint, stateRevision: 0 },
    sourceObservation: { beforeFingerprint: sourceMaterialFingerprint, afterFingerprint: sourceMaterialFingerprint, stable: true },
    provider: { id: "fake", version: "1.0.0", transport: "test", executionMode: "test" },
    detection: { available: true, providerId: "fake", providerVersion: "1.0.0", transport: "test", reasonCode: null },
    scope,
    snapshot: snapshot(9000),
  };
  const baseline = await writeStructuralQualityBaseline(target, taskId, baselineValue, packageRoot, { phase: "PLANNED", taskId });
  const evaluationValue = {
    schemaVersion: 1,
    protocolVersion: 1,
    role: "EVALUATION",
    taskId,
    capturedAt: "2026-09-01T00:01:00.000Z",
    verificationCycle: 1,
    attempt: 1,
    status: "PASS",
    reasonCodes: [],
    bindings: { ...base, baselineFingerprint: baseline.fingerprint, sourceMaterialFingerprint, stateRevision: 0 },
    sourceObservation: { beforeFingerprint: sourceMaterialFingerprint, afterFingerprint: sourceMaterialFingerprint, stable: true },
    provider: { id: "fake", version: "1.0.0", transport: "test", executionMode: "test" },
    detection: { available: true, providerId: "fake", providerVersion: "1.0.0", transport: "test", reasonCode: null },
    scope,
    baselineSignal: 9000,
    currentSignal: 9000,
    snapshot: snapshot(9000),
    comparison: {
      comparable: true,
      qualityDelta: 0,
      rootCauseDeltas: { modularity: 0, acyclicity: 0, depth: 0, equality: 0, redundancy: 0 },
      failedConditions: [],
      status: "PASS",
      reasonCodes: [],
    },
  };
  const evaluation = await writeStructuralQualityEvaluation(target, taskId, 1, 1, evaluationValue, packageRoot, { transactionTaskId: taskId });
  const check = createCheck({
    id: "structural-quality",
    kind: "structural-quality",
    requirement: "Structural quality must not regress beyond the configured budget",
    status: "passed",
    evidenceKind: "OBSERVED",
    source: "structural-quality",
    details: {
      artifactRef: evaluation.path,
      artifactFingerprint: evaluation.fingerprint,
      verificationCycle: 1,
    },
  }, { target, taskId, packageRoot });
  const state = JSON.parse(await readRawFixtureText(target, ARTIFACT_PATHS.state));
  state.checks = [check];
  await writeJsonArtifact(target, ARTIFACT_PATHS.state, state, "work-state", packageRoot);
  return { contract, evaluation, check };
}

test("bundle export/import preserves typed quality evidence without rescanning", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-structural-bundle-"));
  try {
    const prepared = await setupBundleTarget(target);
    const bundle = await exportTaskBundle(target, taskId, packageRoot);
    assert.ok(bundle.artifacts.includes("structural-quality/baseline.json"));
    assert.ok(bundle.artifacts.includes("structural-quality/evaluations/cycle-1-attempt-1.json"));
    const loaded = await readTaskBundle(target, taskId, packageRoot);
    assert.equal(loaded.artifacts.structuralQuality.baseline.taskId, taskId);
    assert.equal(loaded.artifacts.structuralQuality.evaluations[0].currentSignal, 9000);
    assert.equal(loaded.artifacts.state.checks[0].details.artifactFingerprint, prepared.evaluation.fingerprint);
  } finally {
    await rm(target, { recursive: true, force: true });
  }
});

test("bundle reads reject tampered quality artifacts and stale check fingerprints", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-structural-bundle-tamper-"));
  try {
    await setupBundleTarget(target);
    await exportTaskBundle(target, taskId, packageRoot);
    const evalPath = path.join(target, ".forgeloop", "tasks", taskId, "structural-quality", "evaluations", "cycle-1-attempt-1.json");
    const value = JSON.parse(await readFile(evalPath, "utf8"));
    value.currentSignal = 8999;
    await writeFile(evalPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await assert.rejects(
      () => readTaskBundle(target, taskId, packageRoot),
      /fingerprint does not match|stale|does not match|bytes disagree with manifest/i,
    );
  } finally {
    await rm(target, { recursive: true, force: true });
  }
});
