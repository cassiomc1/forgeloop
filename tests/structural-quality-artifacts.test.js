import { ensureFixtureTask } from "./helpers/native-storage-fixture.js";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { writeJsonArtifact } from "../src/core/artifacts.js";
import {
  assertStructuralQualityBindings,
  listStructuralQualityEvaluations,
  readStructuralQualityBaseline,
  readStructuralQualityEvaluation,
  structuralQualityArtifactRef,
  validateStructuralQualityArtifact,
  writeStructuralQualityBaseline,
  writeStructuralQualityEvaluation,
} from "../src/core/structural-quality/artifacts.js";
import { normalizeStructuralQualitySnapshot } from "../src/core/structural-quality/provider.js";
import {
  taskStructuralQualityBaselinePath,
  taskStructuralQualityEvaluationPath,
} from "../src/core/task-paths.js";
import { getPackageRoot } from "../src/core/templates.js";

const packageRoot = getPackageRoot();
const taskId = "structural-artifact-task";
const fingerprint = "a".repeat(64);

function snapshot(overrides = {}) {
  return normalizeStructuralQualitySnapshot({
    qualitySignal: 9000,
    rootCauses: {
      modularity: { score: 9000, raw: 0.9 },
      acyclicity: { score: 9000, raw: 0.9 },
      depth: { score: 9000, raw: 0.9 },
      equality: { score: 9000, raw: 0.9 },
      redundancy: { score: 9000, raw: 0.9 },
    },
    statistics: { files: 3, lines: 120, importEdges: 4, crossModuleEdges: 2 },
    diagnostics: null,
    ...overrides,
  });
}

function bindings(baselineFingerprint = null) {
  return {
    contractFingerprint: fingerprint,
    routeFingerprint: fingerprint,
    policyFingerprint: fingerprint,
    scopeFingerprint: fingerprint,
    baselineFingerprint,
    sourceMaterialFingerprint: fingerprint,
    stateRevision: 0,
  };
}

function baselineValue(overrides = {}) {
  return {
    schemaVersion: 1,
    protocolVersion: 1,
    role: "BASELINE",
    taskId,
    capturedAt: "2026-09-01T00:00:00.000Z",
    verificationCycle: null,
    attempt: 1,
    status: "PASS",
    reasonCodes: [],
    bindings: bindings(),
    sourceObservation: { beforeFingerprint: fingerprint, afterFingerprint: fingerprint, stable: true },
    provider: { id: "fake", version: "1.0.0", transport: "test", executionMode: "runtime-context" },
    detection: { available: true, providerId: "fake", providerVersion: "1.0.0", transport: "test", reasonCode: null },
    scope: { kind: "PROJECT", projectRoot: ".", providerConfigFingerprint: null },
    snapshot: snapshot(),
    ...overrides,
  };
}

function evaluationValue(baselineFingerprint, overrides = {}) {
  return {
    schemaVersion: 1,
    protocolVersion: 1,
    role: "EVALUATION",
    taskId,
    capturedAt: "2026-09-01T00:01:00.000Z",
    verificationCycle: 1,
    attempt: 1,
    status: "PASS",
    reasonCodes: [],
    bindings: bindings(baselineFingerprint),
    sourceObservation: { beforeFingerprint: fingerprint, afterFingerprint: fingerprint, stable: true },
    provider: { id: "fake", version: "1.0.0", transport: "test", executionMode: "runtime-context" },
    detection: { available: true, providerId: "fake", providerVersion: "1.0.0", transport: "test", reasonCode: null },
    scope: { kind: "PROJECT", projectRoot: ".", providerConfigFingerprint: null },
    baselineSignal: 9000,
    currentSignal: 9000,
    snapshot: snapshot(),
    comparison: {
      comparable: true,
      qualityDelta: 0,
      rootCauseDeltas: { modularity: 0, acyclicity: 0, depth: 0, equality: 0, redundancy: 0 },
      failedConditions: [],
      status: "PASS",
      reasonCodes: [],
    },
    ...overrides,
  };
}

test("quality artifacts are task-scoped, schema-validated, and numerically listed", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-structural-artifacts-"));
  try {
    await ensureFixtureTask(target, taskId, packageRoot);
    const baseline = await writeStructuralQualityBaseline(target, taskId, baselineValue(), packageRoot, { phase: "PLANNED", taskId });
    const evaluation = await writeStructuralQualityEvaluation(
      target,
      taskId,
      1,
      1,
      evaluationValue(baseline.fingerprint),
      packageRoot,
      { transactionTaskId: taskId },
    );
    assert.equal(baseline.path, taskStructuralQualityBaselinePath(taskId));
    assert.equal(evaluation.path, taskStructuralQualityEvaluationPath(taskId, 1, 1));
    assert.equal(structuralQualityArtifactRef(taskId, evaluation.path), evaluation.path);
    assert.equal((await readStructuralQualityBaseline(target, taskId, packageRoot)).fingerprint, baseline.fingerprint);
    assert.deepEqual((await listStructuralQualityEvaluations(target, taskId, packageRoot)).map((item) => item.path), [evaluation.path]);
    assert.throws(() => structuralQualityArtifactRef(taskId, `${taskStructuralQualityBaselinePath(taskId)}/../latest.json`), { code: "E_STRUCTURAL_QUALITY_EVIDENCE_STALE" });
  } finally {
    await rm(target, { recursive: true, force: true });
  }
});

test("baseline capture is idempotent, replaceable only before execution, and records bindings", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-structural-baseline-"));
  try {
    await ensureFixtureTask(target, taskId, packageRoot);
    const first = await writeStructuralQualityBaseline(target, taskId, baselineValue(), packageRoot, { phase: "PLANNED", taskId });
    const identical = await writeStructuralQualityBaseline(target, taskId, baselineValue(), packageRoot, { phase: "PLANNED", taskId });
    assert.equal(identical.identical, true);
    assert.equal(identical.fingerprint, first.fingerprint);

    const changed = baselineValue({ snapshot: snapshot({ qualitySignal: 9100 }) });
    await assert.rejects(
      () => writeStructuralQualityBaseline(target, taskId, changed, packageRoot, { phase: "PLANNED", taskId }),
      { code: "E_STRUCTURAL_QUALITY_BASELINE_EXISTS" },
    );
    const replaced = await writeStructuralQualityBaseline(target, taskId, changed, packageRoot, { phase: "PLANNED", replace: true, taskId });
    assert.equal(replaced.existing, true);
    assert.notEqual(replaced.fingerprint, first.fingerprint);
    await assert.rejects(
      () => writeStructuralQualityBaseline(target, taskId, baselineValue(), packageRoot, { phase: "EXECUTING", replace: true, taskId }),
      { code: "E_STRUCTURAL_QUALITY_BASELINE_PHASE_INVALID" },
    );
    assert.doesNotThrow(() => assertStructuralQualityBindings(replaced.value, {
      contractFingerprint: fingerprint,
      routeFingerprint: fingerprint,
      policyFingerprint: fingerprint,
      scopeFingerprint: fingerprint,
      providerId: "fake",
    }));
  } finally {
    await rm(target, { recursive: true, force: true });
  }
});

test("semantic tampering is rejected even when the JSON schema still matches", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-structural-tamper-"));
  try {
    await ensureFixtureTask(target, taskId, packageRoot);
    const baseline = await writeStructuralQualityBaseline(target, taskId, baselineValue(), packageRoot, { phase: "PLANNED", taskId });
    const invalid = evaluationValue(baseline.fingerprint, {
      status: "PASS",
      comparison: {
        comparable: true,
        qualityDelta: 0,
        rootCauseDeltas: { modularity: 0, acyclicity: 0, depth: 0, equality: 0, redundancy: 0 },
        failedConditions: [],
        status: "FAIL",
        reasonCodes: [],
      },
    });
    const relativePath = taskStructuralQualityEvaluationPath(taskId, 1, 1);
    await writeJsonArtifact(target, relativePath, invalid, "structural-quality", packageRoot);
    assert.throws(
      () => validateStructuralQualityArtifact(invalid, relativePath),
      { code: "E_STRUCTURAL_QUALITY_EVIDENCE_STALE" },
    );
    await assert.rejects(() => readStructuralQualityEvaluation(target, taskId, 1, 1, packageRoot), { code: "E_STRUCTURAL_QUALITY_EVIDENCE_STALE" });
  } finally {
    await rm(target, { recursive: true, force: true });
  }
});

test("observed artifacts require a stable source binding", () => {
  assert.throws(
    () => validateStructuralQualityArtifact(baselineValue({
      bindings: { ...bindings(), sourceMaterialFingerprint: null },
    }), "baseline.json"),
    { code: "E_STRUCTURAL_QUALITY_EVIDENCE_STALE" },
  );
  assert.throws(
    () => validateStructuralQualityArtifact(baselineValue({
      sourceObservation: { beforeFingerprint: fingerprint, afterFingerprint: "b".repeat(64), stable: true },
    }), "baseline.json"),
    { code: "E_STRUCTURAL_QUALITY_EVIDENCE_STALE" },
  );
  assert.throws(
    () => validateStructuralQualityArtifact(evaluationValue(fingerprint, {
      sourceObservation: { beforeFingerprint: fingerprint, afterFingerprint: "b".repeat(64), stable: false },
    }), "evaluation.json"),
    { code: "E_STRUCTURAL_QUALITY_EVIDENCE_STALE" },
  );
});
