import { needsExistingProjectScope } from "../../storage/existing-project-scope.js";
import { withProjectReadSnapshot } from "../../storage/project-read-snapshot.js";
import { canonicalFingerprint, readJsonArtifact } from "../artifacts.js";
import { readConfig } from "../config.js";
import { readContract } from "../contract.js";
import { readPersistedRoute } from "../route-artifact.js";
import { readWorkState } from "../work-state.js";
import { evaluatePreflight, validatePersistedPreflight } from "../preflight.js";
import { taskArtifactPath } from "../task-paths.js";
import {
  E_STRUCTURAL_QUALITY_BASELINE_BINDING_MISMATCH,
  E_STRUCTURAL_QUALITY_BASELINE_MISSING,
  E_STRUCTURAL_QUALITY_EVALUATION_INCOMPARABLE,
  E_STRUCTURAL_QUALITY_EVIDENCE_STALE,
  E_STRUCTURAL_QUALITY_MEASUREMENT_MODEL_MISMATCH,
  E_STRUCTURAL_QUALITY_OBSERVATION_EPOCH_STALE,
  E_STRUCTURAL_QUALITY_PROVIDER_UNAVAILABLE,
  E_STRUCTURAL_QUALITY_SOURCE_DRIFT,
  E_STRUCTURAL_QUALITY_SOURCE_FINGERPRINT_UNAVAILABLE,
} from "../error-codes.js";
import {
  STRUCTURAL_QUALITY_CHECK_ID,
  STRUCTURAL_QUALITY_DEFAULT_TIMEOUT_MS,
  STRUCTURAL_QUALITY_MEASUREMENT_MODEL,
  STRUCTURAL_QUALITY_REQUIREMENT,
  structuralQualityError,
} from "./constants.js";
import { normalizeStructuralQualityConfig, compareStructuralQuality, structuralQualityPolicyFingerprint } from "./policy.js";
import { normalizeStructuralQualityDetection, normalizeStructuralQualitySnapshot, providerInputFor, resolveStructuralQualityProvider, structuralQualityProviderCompatibility } from "./provider.js";
import {
  assertStructuralQualityBindings,
  listStructuralQualityEvaluations,
  readStructuralQualityBaseline,
  validateStructuralQualityArtifact,
  writeStructuralQualityBaseline,
  writeStructuralQualityEvaluation,
} from "./artifacts.js";
import { appendProtocolEvent } from "../events.js";
import { getPackageRoot } from "../templates.js";
import { withTaskMutation } from "../task-command.js";
import { withTaskTransaction } from "../transaction.js";
import { getOperationalStore } from "../../storage/operational-context.js";

async function withQualityMutation(target, options, operation, callback) {
  const native = Boolean(getOperationalStore(target)) || await needsExistingProjectScope(target);
  for (let retry = 0; ; retry += 1) {
    try {
      return await withTaskMutation(target, options, operation, callback);
    } catch (error) {
      // These callbacks persist an already captured observation. A native
      // conflict discards their staged writes; rerun admission and bindings
      // against current records without invoking the provider again.
      if (!native || error.code !== "E_STATE_REVISION_CONFLICT" || retry >= 2) throw error;
    }
  }
}
import { findTaskById } from "../task-discovery.js";
import { currentChangedPaths } from "../repository.js";
import { assertClaimsCoverChangedPaths } from "../task-scope.js";
import { computeMaterialSourceFingerprint } from "./source-fingerprint.js";

function qualityError(code, message, artifacts = []) {
  return structuralQualityError(code, message, artifacts);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function loadOptionalConfig(target, packageRoot) {
  try {
    return await readConfig(target, packageRoot);
  } catch (error) {
    if (error.code === "ARTIFACT_MISSING") return null;
    throw error;
  }
}

function configuredPolicy(config) {
  if (!config?.structuralQuality) return null;
  return normalizeStructuralQualityConfig(config.structuralQuality);
}

async function scopeIdentity(target, provider = null, providerId = null) {
  let providerConfigFingerprint = null;
  let architectureRulesFingerprint = null;
  const effectiveProviderId = provider?.id ?? providerId;
  if (provider && typeof provider.scopeBinding === "function") {
    const binding = await provider.scopeBinding({ projectPath: target });
    providerConfigFingerprint = binding?.providerConfigFingerprint ?? null;
    architectureRulesFingerprint = binding?.architectureRulesFingerprint ?? null;
  }
  const scope = {
    kind: "PROJECT",
    projectRoot: ".",
    providerConfigFingerprint,
    ...(architectureRulesFingerprint !== null ? { architectureRulesFingerprint } : {}),
  };
  return {
    scope,
    // Architecture rules are a separate policy sensor. They are retained for
    // provenance, but must not make identical Structural Quality measurements
    // incomparable when a project rule changes.
    scopeFingerprint: canonicalFingerprint({
      providerId: effectiveProviderId,
      kind: scope.kind,
      projectRoot: scope.projectRoot,
      providerConfigFingerprint: scope.providerConfigFingerprint,
    }),
  };
}

async function resolveProviderForContext({ target, taskId, policy, runtimeContext, timeoutMs, maxOutputBytes } = {}) {
  if (!policy || policy.mode === "off") return null;
  try {
    return await resolveStructuralQualityProvider({
      providerName: policy.provider,
      target,
      taskId,
      timeoutMs,
      maxOutputBytes,
      runtimeContext,
    });
  } catch (error) {
    if (error.code === E_STRUCTURAL_QUALITY_PROVIDER_UNAVAILABLE) return null;
    throw error;
  }
}

function providerMetadata(provider, detection) {
  const metadata = provider?.metadata ?? provider;
  const id = metadata?.id ?? detection.providerId;
  const version = metadata?.version ?? detection.providerVersion ?? null;
  return {
    id,
    version,
    transport: metadata?.transport ?? detection.transport ?? "runtime",
    executionMode: metadata?.executionMode ?? "runtime-context",
    measurementModel: metadata?.measurementModel ?? detection.measurementModel ?? STRUCTURAL_QUALITY_MEASUREMENT_MODEL,
    compatibilityKey: metadata?.compatibilityKey ?? detection.compatibilityKey ?? null,
  };
}

function providerDetection(value, providerId) {
  return normalizeStructuralQualityDetection(value, { providerId, id: providerId, transport: "runtime" });
}

function normalizeScanResult(result, provider, detection, projectPath) {
  const source = isRecord(result) ? result : { snapshot: result };
  const snapshot = normalizeStructuralQualitySnapshot(source.snapshot ?? source, { projectPath });
  const metadata = providerMetadata(source.provider, detection);
  if (metadata.id !== provider.id) {
    throw qualityError(E_STRUCTURAL_QUALITY_BASELINE_BINDING_MISMATCH, "Structural-quality scan returned a different provider identity");
  }
  return {
    snapshot,
    provider: metadata,
    detection: providerDetection(source.detection ?? detection, provider.id),
    providerScopeBinding: source.providerScopeBinding ?? null,
  };
}

export async function resolveStructuralQualityContext(options = {}) {
  return withProjectReadSnapshot(options.target, () => resolveStructuralQualityContextObservation(options));
}

async function resolveStructuralQualityContextObservation({
  target,
  packageRoot = getPackageRoot(),
  taskId,
  runtimeContext,
  timeoutMs,
  maxOutputBytes,
  resolveProvider = true,
} = {}) {
  if (typeof taskId !== "string" || taskId.trim() === "") {
    throw qualityError(E_STRUCTURAL_QUALITY_BASELINE_BINDING_MISMATCH, "Structural-quality operations require a task ID");
  }
  const state = await readWorkState(target, { packageRoot, taskId });
  if (!state) throw qualityError(E_STRUCTURAL_QUALITY_BASELINE_MISSING, "Structural-quality operations require task work-state", [taskArtifactPath(taskId, "state")]);
  const contract = await readContract(target, packageRoot, { taskId });
  const route = await readPersistedRoute(target, packageRoot, { taskId });
  const config = await loadOptionalConfig(target, packageRoot);
  const policy = configuredPolicy(config);
  const provider = resolveProvider
    ? await resolveProviderForContext({ target, taskId, policy, runtimeContext, timeoutMs, maxOutputBytes })
    : null;
  const scopeData = await scopeIdentity(target, provider, policy?.provider ?? null);
  return {
    state,
    contract,
    route,
    config,
    policy,
    provider,
    providerId: provider?.id ?? policy?.provider ?? null,
    scope: scopeData.scope,
    scopeFingerprint: scopeData.scopeFingerprint,
  };
}

async function taskInputs(target, packageRoot, taskId, options = {}) {
  return resolveStructuralQualityContext({ target, packageRoot, taskId, ...options });
}

function baseBindings(inputs, policyFingerprint, baselineFingerprint = null, sourceMaterialFingerprint = null) {
  return {
    contractFingerprint: inputs.contract.fingerprint,
    routeFingerprint: inputs.route.fingerprint,
    policyFingerprint,
    scopeFingerprint: inputs.scopeFingerprint,
    baselineFingerprint,
    sourceMaterialFingerprint,
    stateRevision: inputs.state.revision ?? 0,
  };
}

function statusForComparison(policy, comparison) {
  if (comparison.status === "PASS") return "PASS";
  if (comparison.status === "FAIL") return "FAIL";
  return policy.mode === "gate" ? "BLOCKED" : "NOT_OBSERVED";
}

function checkProjection(policy, evaluation) {
  if (evaluation.status === "PASS") return { status: "passed", evidenceKind: "OBSERVED" };
  if (evaluation.status === "FAIL") return { status: "failed", evidenceKind: "OBSERVED" };
  if (policy.mode === "gate" && evaluation.status === "BLOCKED") return { status: "blocked", evidenceKind: "BLOCKED" };
  return { status: "not-run", evidenceKind: "NOT_VERIFIED" };
}

function evaluationDetails(evaluation) {
  const comparison = evaluation.comparison ?? {};
  return {
    verificationCycle: evaluation.verificationCycle,
    attempt: evaluation.attempt,
    artifactRef: evaluation.artifactRef,
    artifactFingerprint: evaluation.artifactFingerprint,
    baselineSignal: evaluation.baselineSignal ?? null,
    currentSignal: evaluation.currentSignal ?? null,
    delta: comparison.qualityDelta ?? null,
    bottleneck: evaluation.snapshot?.bottleneck ?? null,
    rootCauseDeltas: comparison.rootCauseDeltas ?? {},
    reasonCodes: [...(evaluation.reasonCodes ?? [])],
    failedConditions: [...(comparison.failedConditions ?? [])],
  };
}

async function assertReadyPreflight(target, packageRoot, taskId) {
  const preflightPath = taskArtifactPath(taskId, "preflight");
  const persisted = await readJsonArtifact(target, preflightPath, "preflight", packageRoot);
  const current = await evaluatePreflight({ target, packageRoot, taskId });
  const errors = validatePersistedPreflight(persisted.value, current);
  if (current.status !== "READY" || errors.length > 0) {
    const first = errors[0] ?? current.errors?.[0];
    throw qualityError(first?.code ?? "E_PREFLIGHT_NOT_READY", first?.message ?? "A READY preflight is required before structural-quality baseline capture", [preflightPath]);
  }
}

async function invokeProvider({ target, taskId, policy, provider: suppliedProvider = null, runtimeContext, timeoutMs, maxOutputBytes }) {
  const provider = suppliedProvider ?? await resolveStructuralQualityProvider({
    providerName: policy.provider,
    target,
    taskId,
    timeoutMs,
    maxOutputBytes,
    runtimeContext,
  });
  const input = providerInputFor({
    projectPath: target,
    taskId,
    timeoutMs: timeoutMs ?? STRUCTURAL_QUALITY_DEFAULT_TIMEOUT_MS,
    maxOutputBytes: maxOutputBytes ?? 2 * 1024 * 1024,
  });
  if (typeof provider.observe === "function") {
    const result = await provider.observe(input);
    return normalizeScanResult(result, provider, result.detection, target);
  }
  let detection;
  try {
    detection = providerDetection(await provider.detect(input), provider.id);
  } catch (error) {
    detection = providerDetection({
      available: false,
      providerId: provider.id,
      providerVersion: null,
      transport: "runtime",
      measurementModel: STRUCTURAL_QUALITY_MEASUREMENT_MODEL,
      compatibilityKey: null,
      reasonCode: error.code ?? E_STRUCTURAL_QUALITY_PROVIDER_UNAVAILABLE,
    }, provider.id);
  }
  if (!detection.available) {
    throw qualityError(detection.reasonCode ?? E_STRUCTURAL_QUALITY_PROVIDER_UNAVAILABLE, `Structural-quality provider ${provider.id} is unavailable`);
  }
  const result = await provider.scan(input);
  return normalizeScanResult(result, provider, detection, target);
}

function emptyProjection(policy, reasonCodes = []) {
  return {
    mode: policy?.mode ?? "off",
    provider: policy?.mode && policy.mode !== "off" ? policy.provider : null,
    baseline: { status: policy ? "MISSING" : "NOT_REQUESTED", qualitySignal: null, artifactRef: null, fingerprint: null },
    current: { status: "NOT_OBSERVED", verificationCycle: null, attempt: null, qualitySignal: null, delta: null, bottleneck: null, artifactRef: null },
    comparable: null,
    completionRequired: policy?.mode === "gate",
    reasonCodes: [...new Set(reasonCodes)].sort(),
    next: policy?.mode === "gate" ? "CAPTURE_STRUCTURAL_QUALITY_BASELINE" : null,
    optimization: policy ? optimizationProjection(policy, [], null) : null,
  };
}

export async function captureStructuralQualityBaseline({ target, packageRoot = getPackageRoot(), taskId, replace = false, timeoutMs, maxOutputBytes, runtimeContext } = {}) {
  const inputs = await taskInputs(target, packageRoot, taskId, { runtimeContext, timeoutMs, maxOutputBytes });
  const policy = inputs.policy;
  if (!policy || policy.mode === "off") return { status: "NOT_REQUESTED", mode: "off", provider: null, artifactRef: null };
  if (inputs.state.phase !== "PLANNED") {
    throw qualityError("E_STRUCTURAL_QUALITY_BASELINE_PHASE_INVALID", `Structural-quality baseline capture requires PLANNED; found ${inputs.state.phase}`, [taskArtifactPath(taskId, "state")]);
  }
  await assertReadyPreflight(target, packageRoot, taskId);
  const existing = await readStructuralQualityBaseline(target, taskId, packageRoot);
  if (existing && !replace) {
    return {
      status: "EXISTING",
      mode: policy.mode,
      provider: existing.value.provider,
      artifactRef: existing.path,
      artifactFingerprint: existing.fingerprint,
      baseline: existing.value,
      existing: true,
      identical: true,
    };
  }
  const policyFingerprint = structuralQualityPolicyFingerprint(policy);
  const sourceFingerprintBefore = await computeMaterialSourceFingerprint(target);
  let scan;
  try {
    scan = await invokeProvider({ target, taskId, policy, provider: inputs.provider, runtimeContext, timeoutMs, maxOutputBytes });
  } catch (error) {
    if (policy.mode === "observe") {
      return {
        status: "NOT_OBSERVED",
        mode: policy.mode,
        provider: {
          id: policy.provider,
          version: null,
          transport: "runtime",
          executionMode: "runtime-context",
          measurementModel: STRUCTURAL_QUALITY_MEASUREMENT_MODEL,
          compatibilityKey: null,
        },
        artifactRef: null,
        artifactFingerprint: null,
        reasonCodes: [error.code ?? E_STRUCTURAL_QUALITY_PROVIDER_UNAVAILABLE],
        errorCode: error.code ?? E_STRUCTURAL_QUALITY_PROVIDER_UNAVAILABLE,
        existing: false,
        identical: false,
      };
    }
    throw error;
  }
  const sourceFingerprintAfter = await computeMaterialSourceFingerprint(target);
  if (sourceFingerprintBefore !== sourceFingerprintAfter) {
    if (policy.mode === "observe") {
      return {
        status: "NOT_OBSERVED",
        mode: policy.mode,
        provider: scan.provider,
        artifactRef: null,
        artifactFingerprint: null,
        reasonCodes: [E_STRUCTURAL_QUALITY_SOURCE_DRIFT],
        errorCode: E_STRUCTURAL_QUALITY_SOURCE_DRIFT,
        existing: false,
        identical: false,
      };
    }
    throw qualityError(E_STRUCTURAL_QUALITY_SOURCE_DRIFT, "Source material was mutated during structural-quality baseline capture");
  }

  const updatedInputs = inputs;

  const value = {
    schemaVersion: 1,
    protocolVersion: 1,
    role: "BASELINE",
    taskId,
    capturedAt: new Date().toISOString(),
    verificationCycle: null,
    attempt: 1,
    status: "PASS",
    reasonCodes: [],
    bindings: baseBindings(updatedInputs, policyFingerprint, null, sourceFingerprintBefore),
    sourceObservation: {
      beforeFingerprint: sourceFingerprintBefore,
      afterFingerprint: sourceFingerprintAfter,
      stable: true,
    },
    provider: scan.provider,
    detection: scan.detection,
    scope: updatedInputs.scope,
    snapshot: scan.snapshot,
  };
  return withTaskTransaction({ target, taskId, packageRoot, operation: "quality-baseline" }, async () => {
    const currentInputs = await taskInputs(target, packageRoot, taskId, { runtimeContext, timeoutMs, maxOutputBytes });
    if (currentInputs.state.phase !== "PLANNED"
      || currentInputs.contract.fingerprint !== inputs.contract.fingerprint
      || currentInputs.route.fingerprint !== inputs.route.fingerprint
      || structuralQualityPolicyFingerprint(currentInputs.policy) !== policyFingerprint
      || currentInputs.scopeFingerprint !== inputs.scopeFingerprint) {
      throw qualityError(E_STRUCTURAL_QUALITY_OBSERVATION_EPOCH_STALE, "Task baseline configuration changed during observation");
    }
    await assertReadyPreflight(target, packageRoot, taskId);
    const currentBaseline = await readStructuralQualityBaseline(target, taskId, packageRoot);
    const written = await writeStructuralQualityBaseline(target, taskId, value, packageRoot, { phase: currentInputs.state.phase, replace, taskId });
    if (!written.identical) {
      await appendProtocolEvent(target, {
        taskId,
        event: "STRUCTURAL_QUALITY_BASELINE_RECORDED",
        details: {
          artifactRef: written.path,
          artifactFingerprint: written.fingerprint,
          providerId: scan.provider.id,
          providerVersion: scan.provider.version,
          replaced: Boolean(currentBaseline),
          supersededFingerprint: currentBaseline?.fingerprint ?? null,
        },
      }, packageRoot, { taskId });
    }
    return {
      status: written.existing ? "REPLACED" : "CAPTURED",
      mode: policy.mode,
      provider: scan.provider,
      artifactRef: written.path,
      artifactFingerprint: written.fingerprint,
      baseline: written.value,
      existing: written.existing,
      identical: written.identical,
    };
  });
}

async function persistEvaluationAndCheck({ target, packageRoot, taskId, inputs, persisted, authorityContext, runtimeContext }) {
  const { prepareCompletion, recordCheck } = await import("../completion-artifacts.js");
  const staleRecoveryResult = (freshness, effectiveTaskId = taskId) => ({
    status: inputs.policy.mode === "gate" ? "BLOCKED" : "NOT_OBSERVED",
    mode: inputs.policy.mode,
    evaluation: persisted,
    check: null,
    receipt: null,
    attempts: persisted.attempt,
    reasonCodes: freshness.reasonCodes,
    errorCode: E_STRUCTURAL_QUALITY_EVIDENCE_STALE,
    taskId: effectiveTaskId,
  });
  if (["PASS", "FAIL"].includes(persisted.status)) {
    const initialFreshness = await validateStructuralQualityEvaluationFreshness({
      target,
      packageRoot,
      taskId,
      artifact: persisted,
      inputs,
      runtimeContext,
    });
    if (!initialFreshness.valid) return staleRecoveryResult(initialFreshness);
  }
  const record = (context, evaluation) => recordCheck({
    target,
    packageRoot,
    id: STRUCTURAL_QUALITY_CHECK_ID,
    kind: "structural-quality",
    requirement: STRUCTURAL_QUALITY_REQUIREMENT,
    status: checkProjection(inputs.policy, evaluation).status,
    evidenceKind: checkProjection(inputs.policy, evaluation).evidenceKind,
    result: `structural quality ${evaluation.status}`,
    details: evaluationDetails(evaluation),
    authorityContext,
    runtimeContext,
    taskId: context?.taskId ?? taskId,
  });
  const recorded = await withQualityMutation(target, { taskId, packageRoot }, "quality-verify-check", async (context) => {
    const effectiveTaskId = context?.taskId ?? taskId;
    const evaluations = await listStructuralQualityEvaluations(target, effectiveTaskId, packageRoot);
    const latest = evaluations
      .filter((item) => item.value.verificationCycle === persisted.verificationCycle)
      .at(-1);
    const evaluation = latest && latest.value.attempt > persisted.attempt
      ? { ...latest.value, artifactRef: latest.path, artifactFingerprint: latest.fingerprint }
      : persisted;
    if (["PASS", "FAIL"].includes(evaluation.status)) {
      const freshness = await validateStructuralQualityEvaluationFreshness({
        target,
        packageRoot,
        taskId: effectiveTaskId,
        artifact: evaluation,
        inputs: await resolveStructuralQualityContext({ target, packageRoot, taskId: effectiveTaskId, runtimeContext }),
        runtimeContext,
      });
      if (!freshness.valid) return staleRecoveryResult(freshness, effectiveTaskId);
    }
    const publish = () => record(context, evaluation);
    try {
      return await publish();
    } catch (error) {
      if (error.code !== "E_RECEIPT_MISSING") throw error;
      await prepareCompletion({
        target,
        packageRoot,
        authorityContext,
        runtimeContext,
        taskId: effectiveTaskId,
      });
      return publish();
    }
  });
  return { evaluation: persisted, check: recorded.check, receipt: recorded };
}

function nonPassEvaluation({ taskId, inputs, cycle, attempt, policy, reasonCode, reasonCodes = [], providerId = policy.provider, providerVersion = null, detection = null, baseline = null, sourceObservation = null, sourceMaterialFingerprint = null }) {
  const status = policy.mode === "gate" ? "BLOCKED" : "NOT_OBSERVED";
  const detectionValue = detection ?? {
    available: false,
    providerId,
    providerVersion,
    transport: "runtime",
    measurementModel: STRUCTURAL_QUALITY_MEASUREMENT_MODEL,
    compatibilityKey: null,
    reasonCode,
  };
  const policyFingerprint = structuralQualityPolicyFingerprint(policy);
  return {
    schemaVersion: 1,
    protocolVersion: 1,
    role: "EVALUATION",
    taskId,
    capturedAt: new Date().toISOString(),
    verificationCycle: cycle,
    attempt,
    status,
    reasonCodes: [...new Set([reasonCode, ...reasonCodes])],
    errorCode: reasonCode,
    bindings: baseBindings(inputs, policyFingerprint, baseline?.fingerprint ?? null, sourceMaterialFingerprint),
    ...(sourceObservation ? { sourceObservation } : {}),
    provider: {
      id: providerId,
      version: providerVersion,
      transport: detectionValue.transport,
      executionMode: "runtime-context",
      measurementModel: detectionValue.measurementModel ?? STRUCTURAL_QUALITY_MEASUREMENT_MODEL,
      compatibilityKey: detectionValue.compatibilityKey ?? null,
    },
    detection: detectionValue,
    scope: inputs.scope,
    ...(baseline?.value?.snapshot ? { baselineSignal: baseline.value.snapshot.qualitySignal } : {}),
    comparison: {
      comparable: false,
      qualityDelta: null,
      rootCauseDeltas: Object.fromEntries(["modularity", "acyclicity", "depth", "equality", "redundancy"].map((key) => [key, null])),
      failedConditions: [],
      status: "NOT_OBSERVED",
      reasonCodes: [...new Set([reasonCode, ...reasonCodes])],
    },
  };
}

export async function evaluateStructuralQuality({ target, packageRoot = getPackageRoot(), taskId, timeoutMs, maxOutputBytes, authorityContext, runtimeContext } = {}) {
  const initialInputs = await taskInputs(target, packageRoot, taskId, { runtimeContext, timeoutMs, maxOutputBytes });
  const policy = initialInputs.policy;
  if (!policy || policy.mode === "off") return { status: "NOT_REQUESTED", mode: "off", check: null };

  if (initialInputs.state.phase !== "VERIFYING") {
    throw qualityError(E_STRUCTURAL_QUALITY_EVIDENCE_STALE, `Structural-quality verification requires VERIFYING; found ${initialInputs.state.phase}`, [taskArtifactPath(taskId, "state")]);
  }

  const cycle = initialInputs.state.verificationCycle ?? 1;
  const prior = await listStructuralQualityEvaluations(target, taskId, packageRoot);
  const attemptsInCycle = prior.filter((item) => item.value.verificationCycle === cycle);
  const latestEvaluation = attemptsInCycle.at(-1);

  // Check if projection reconciliation is needed for an existing evaluation
  if (latestEvaluation) {
    let checkProjected = false;
    try {
      const receiptArtifact = await readJsonArtifact(target, taskArtifactPath(taskId, "receipt"), "execution-receipt", packageRoot);
      const matchingCheck = receiptArtifact.value?.checks?.find((c) => c.id === STRUCTURAL_QUALITY_CHECK_ID);
      if (matchingCheck
        && matchingCheck.details?.artifactRef === latestEvaluation.path
        && matchingCheck.details?.artifactFingerprint === latestEvaluation.fingerprint) {
        checkProjected = true;
      }
    } catch {
      checkProjected = false;
    }

    if (!checkProjected) {
      // Reconcile and repair the orphaned check projection without rescanning or consuming another attempt
      return persistEvaluationAndCheck({
        target,
        packageRoot,
        taskId,
        inputs: initialInputs,
        persisted: {
          ...latestEvaluation.value,
          artifactRef: latestEvaluation.path,
          artifactFingerprint: latestEvaluation.fingerprint,
        },
        authorityContext,
        runtimeContext,
      });
    }
  }

  const maxAttempts = 1 + (policy.optimization.mode === "bounded" ? policy.optimization.maxExtraEvaluations : 0);
  if (attemptsInCycle.length >= maxAttempts) {
    const last = attemptsInCycle.at(-1);
    const evalVal = last ? { ...last.value, artifactRef: last.path, artifactFingerprint: last.fingerprint } : null;
    const evaluationStatus = evalVal?.status ?? (policy.mode === "gate" ? "BLOCKED" : "NOT_OBSERVED");
    return {
      status: evaluationStatus === "PASS" ? "CONVERGED" : evaluationStatus,
      mode: policy.mode,
      evaluation: evalVal,
      check: null,
      attempts: attemptsInCycle.length,
    };
  }

  const attempt = attemptsInCycle.length + 1;
  const reservationEpoch = {
    stateRevision: initialInputs.state.revision ?? 0,
    cycle,
  };

  const baseline = await readStructuralQualityBaseline(target, taskId, packageRoot);

  // Execute provider observation OUTSIDE task mutation lock
  const sourceFingerprintBefore = await computeMaterialSourceFingerprint(target);
  // Every non-pass branch binds the same reserved task/cycle and source epoch.
  const evaluationInputs = {
    taskId,
    inputs: initialInputs,
    cycle,
    attempt,
    policy,
    baseline,
    sourceMaterialFingerprint: sourceFingerprintBefore,
  };
  let evaluation;

  if (!baseline) {
    evaluation = nonPassEvaluation({
      ...evaluationInputs,
      reasonCode: E_STRUCTURAL_QUALITY_BASELINE_MISSING,
      sourceObservation: { beforeFingerprint: sourceFingerprintBefore, afterFingerprint: sourceFingerprintBefore, stable: true },
    });
  } else {
    try {
      const scopeChanged = baseline.value.bindings?.scopeFingerprint !== initialInputs.scopeFingerprint;
      if (scopeChanged) {
        evaluation = nonPassEvaluation({
          ...evaluationInputs,
          reasonCode: E_STRUCTURAL_QUALITY_EVALUATION_INCOMPARABLE,
          reasonCodes: ["PROVIDER_CONFIG_CHANGED"],
          sourceObservation: { beforeFingerprint: sourceFingerprintBefore, afterFingerprint: sourceFingerprintBefore, stable: true },
        });
        evaluation.comparison.reasonCodes = [E_STRUCTURAL_QUALITY_EVALUATION_INCOMPARABLE, "PROVIDER_CONFIG_CHANGED"];
      } else {
        assertStructuralQualityBindings(baseline.value, {
          taskId,
          contractFingerprint: initialInputs.contract.fingerprint,
          routeFingerprint: initialInputs.route.fingerprint,
          policyFingerprint: structuralQualityPolicyFingerprint(policy),
          scopeFingerprint: initialInputs.scopeFingerprint,
        });
        const scan = await invokeProvider({ target, taskId, policy, provider: initialInputs.provider, runtimeContext, timeoutMs, maxOutputBytes });
        const sourceFingerprintAfter = await computeMaterialSourceFingerprint(target);
        const isStable = sourceFingerprintBefore === sourceFingerprintAfter;

        if (!isStable) {
          evaluation = nonPassEvaluation({
          ...evaluationInputs,
          reasonCode: E_STRUCTURAL_QUALITY_SOURCE_DRIFT,
          providerId: scan.provider.id,
          providerVersion: scan.provider.version,
          detection: scan.detection,
          sourceObservation: { beforeFingerprint: sourceFingerprintBefore, afterFingerprint: sourceFingerprintAfter, stable: false },
          });
        } else {
          const updatedInputs = initialInputs;
          const comparison = compareStructuralQuality({
          baseline: baseline.value,
          current: {
            ...scan,
            bindings: baseBindings(updatedInputs, structuralQualityPolicyFingerprint(policy), baseline.fingerprint, sourceFingerprintBefore),
            scope: initialInputs.scope,
          },
          policy,
          });
          const status = statusForComparison(policy, comparison);
          evaluation = {
          schemaVersion: 1,
          protocolVersion: 1,
          role: "EVALUATION",
          taskId,
          capturedAt: new Date().toISOString(),
          verificationCycle: cycle,
          attempt,
          status,
          reasonCodes: comparison.reasonCodes,
          errorCode: null,
          bindings: baseBindings(updatedInputs, structuralQualityPolicyFingerprint(policy), baseline.fingerprint, sourceFingerprintBefore),
          sourceObservation: {
            beforeFingerprint: sourceFingerprintBefore,
            afterFingerprint: sourceFingerprintAfter,
            stable: true,
          },
          provider: scan.provider,
          detection: scan.detection,
          scope: initialInputs.scope,
          baselineSignal: baseline.value.snapshot?.qualitySignal,
          currentSignal: scan.snapshot.qualitySignal,
          snapshot: scan.snapshot,
          comparison,
          };
        }
      }
    } catch (error) {
      const sourceFingerprintAfter = await computeMaterialSourceFingerprint(target).catch(() => sourceFingerprintBefore);
      const code = error.code ?? E_STRUCTURAL_QUALITY_PROVIDER_UNAVAILABLE;
      evaluation = nonPassEvaluation({
        ...evaluationInputs,
        reasonCode: code,
        providerId: policy.provider,
        sourceObservation: {
          beforeFingerprint: sourceFingerprintBefore,
          afterFingerprint: sourceFingerprintAfter,
          stable: sourceFingerprintBefore === sourceFingerprintAfter,
        },
        });
      }
  }

  // Commit under task mutation lock
  const captured = await withQualityMutation(target, { taskId, packageRoot }, "quality-verify-evaluation", async (context) => {
    const lockedTaskId = context?.taskId ?? taskId;
    const inputs = await taskInputs(target, packageRoot, lockedTaskId, { runtimeContext, timeoutMs, maxOutputBytes });
    if (inputs.state.phase !== "VERIFYING") {
      throw qualityError(E_STRUCTURAL_QUALITY_OBSERVATION_EPOCH_STALE, `Task phase changed during observation; found ${inputs.state.phase}`);
    }
    if ((inputs.state.verificationCycle ?? 1) !== reservationEpoch.cycle) {
      throw qualityError(E_STRUCTURAL_QUALITY_OBSERVATION_EPOCH_STALE, "Task verification cycle changed during observation");
    }
    if (inputs.contract.fingerprint !== initialInputs.contract.fingerprint
      || inputs.route.fingerprint !== initialInputs.route.fingerprint
      || structuralQualityPolicyFingerprint(inputs.policy) !== structuralQualityPolicyFingerprint(initialInputs.policy)
      || inputs.scopeFingerprint !== initialInputs.scopeFingerprint) {
      throw qualityError(E_STRUCTURAL_QUALITY_OBSERVATION_EPOCH_STALE, "Task state configuration changed during observation");
    }

    const currentAttempts = (await listStructuralQualityEvaluations(target, lockedTaskId, packageRoot))
      .filter((item) => item.value.verificationCycle === cycle);
    const assignedAttempt = currentAttempts.length + 1;

    if (assignedAttempt > maxAttempts) {
      const last = currentAttempts.at(-1);
      return {
        inputs,
        evaluation: last ? { ...last.value, artifactRef: last.path, artifactFingerprint: last.fingerprint } : null,
        converged: true,
        attempts: currentAttempts.length,
      };
    }

    const assignedEvaluation = {
      ...evaluation,
      attempt: assignedAttempt,
      bindings: {
        ...evaluation.bindings,
        stateRevision: inputs.state.revision ?? 0,
      },
    };

    const written = await writeStructuralQualityEvaluation(
      target,
      lockedTaskId,
      assignedEvaluation.verificationCycle,
      assignedEvaluation.attempt,
      assignedEvaluation,
      packageRoot,
      { transactionTaskId: lockedTaskId },
    );
    return {
      inputs,
      evaluation: { ...assignedEvaluation, artifactRef: written.path, artifactFingerprint: written.fingerprint },
      converged: false,
      attempts: assignedAttempt,
    };
  });

  if (captured.converged) {
    const evaluationStatus = captured.evaluation?.status ?? (policy.mode === "gate" ? "BLOCKED" : "NOT_OBSERVED");
    return {
      status: evaluationStatus === "PASS" ? "CONVERGED" : evaluationStatus,
      mode: policy.mode,
      evaluation: captured.evaluation,
      check: null,
      attempts: captured.attempts,
    };
  }

  return persistEvaluationAndCheck({
    target,
    packageRoot,
    taskId: captured.inputs.state.taskId,
    inputs: captured.inputs,
    persisted: captured.evaluation,
    authorityContext,
    runtimeContext,
  });
}

async function optimizationScopeStatus(target, packageRoot, taskId) {
  try {
    const task = await findTaskById(target, taskId, packageRoot);
    const claims = task?.effectiveWriteClaims ?? task?.writeClaims ?? [];
    if (!Array.isArray(claims) || claims.length === 0) return { status: "UNAVAILABLE", reasonCodes: ["SCOPE_UNAVAILABLE"] };
    const changed = await currentChangedPaths(target);
    if (changed === null) return { status: "UNAVAILABLE", reasonCodes: ["REPOSITORY_STATUS_UNAVAILABLE"] };
    try {
      assertClaimsCoverChangedPaths(claims, changed);
      return { status: "SAFE", reasonCodes: [] };
    } catch {
      return { status: "UNSAFE", reasonCodes: ["SCOPE_DRIFT"] };
    }
  } catch {
    return { status: "UNAVAILABLE", reasonCodes: ["SCOPE_UNAVAILABLE"] };
  }
}

function optimizationProjection(policy, evaluations, current, scopeStatus = { status: "UNAVAILABLE", reasonCodes: ["SCOPE_UNAVAILABLE"] }) {
  const optimization = {
    mode: policy.optimization.mode,
    maxExtraEvaluations: policy.optimization.maxExtraEvaluations,
    minGainPoints: policy.optimization.minGainPoints,
    attempts: 0,
    gain: null,
    converged: false,
    scope: scopeStatus.status,
    reasonCodes: [...(scopeStatus.reasonCodes ?? [])],
    next: null,
  };
  if (policy.optimization.mode !== "bounded") return optimization;
  const currentValue = current?.value ?? current;
  const cycle = currentValue?.verificationCycle;
  const sameCycle = (evaluations ?? []).filter((item) => item.value.verificationCycle === cycle);
  optimization.attempts = sameCycle.length;
  if (sameCycle.length < 2) {
    if (currentValue?.status === "PASS" && sameCycle.length < 1 + policy.optimization.maxExtraEvaluations && scopeStatus.status === "SAFE") {
      optimization.next = "OPTIONAL_STRUCTURAL_QUALITY_EVALUATION";
    }
    return optimization;
  }
  const previous = sameCycle.at(-2)?.value;
  const latest = sameCycle.at(-1)?.value;
  if (previous?.comparison?.comparable !== true || latest?.comparison?.comparable !== true
    || !Number.isInteger(previous.currentSignal) || !Number.isInteger(latest.currentSignal)) {
    optimization.reasonCodes = [...new Set([...optimization.reasonCodes, "COMPARISON_UNAVAILABLE"])].sort();
    return optimization;
  }
  optimization.gain = latest.currentSignal - previous.currentSignal;
  optimization.converged = optimization.gain < policy.optimization.minGainPoints;
  if (!optimization.converged
    && sameCycle.length < 1 + policy.optimization.maxExtraEvaluations
    && scopeStatus.status === "SAFE"
    && latest.status === "PASS") {
    optimization.next = "OPTIONAL_STRUCTURAL_QUALITY_EVALUATION";
  }
  return optimization;
}

function projectionFromArtifacts(policy, baseline, current, state, evaluations = [], optimizationScope = null, freshness = null, baselineFreshness = null) {
  if (!policy || policy.mode === "off") return emptyProjection(null);
  const projection = emptyProjection(policy);
  projection.persistedStatus = current?.value?.status ?? null;
  projection.freshness = current ? (freshness?.valid === false ? "STALE" : "CURRENT") : "MISSING";
  projection.baselineFreshness = baseline ? (baselineFreshness?.valid === false ? "STALE" : "CURRENT") : "MISSING";
  if (baseline) {
    projection.baseline = {
      status: baseline.value.status === "PASS" ? "OBSERVED" : baseline.value.status,
      qualitySignal: baseline.value.snapshot?.qualitySignal ?? null,
      artifactRef: baseline.path,
      fingerprint: baseline.fingerprint,
    };
  }
  if (current) {
    const currentStatus = freshness?.valid === false ? statusForComparison(policy, { status: "BLOCKED" }) : current.value.status;
    projection.current = {
      status: currentStatus,
      verificationCycle: current.value.verificationCycle,
      attempt: current.value.attempt,
      qualitySignal: current.value.snapshot?.qualitySignal ?? null,
      delta: current.value.comparison?.qualityDelta ?? null,
      bottleneck: current.value.snapshot?.bottleneck ?? null,
      artifactRef: current.path,
    };
    projection.comparable = current.value.comparison?.comparable ?? null;
    projection.reasonCodes = [...new Set([...(current.value.reasonCodes ?? []), ...(freshness?.reasonCodes ?? [])])].sort();
  } else if (!baseline) {
    projection.reasonCodes = [E_STRUCTURAL_QUALITY_BASELINE_MISSING];
  }
  projection.optimization = optimizationProjection(policy, evaluations, current, optimizationScope ?? undefined);
  if (freshness?.valid === false) {
    projection.next = policy.mode === "gate" ? "VERIFY_STRUCTURAL_QUALITY" : "OPTIONAL_VERIFY_STRUCTURAL_QUALITY";
  } else if (baselineFreshness?.valid === false) {
    projection.next = policy.mode === "gate" ? "RESOLVE_STRUCTURAL_QUALITY_BLOCKER" : null;
  } else if (!baseline) {
    projection.next = policy.mode === "gate"
      ? "CAPTURE_STRUCTURAL_QUALITY_BASELINE"
      : (policy.mode === "observe" ? "OPTIONAL_CAPTURE_STRUCTURAL_QUALITY_BASELINE" : null);
  } else if (!current || current.value.verificationCycle !== (state?.verificationCycle ?? 1)) {
    projection.next = policy.mode === "gate"
      ? "VERIFY_STRUCTURAL_QUALITY"
      : (policy.mode === "observe" ? "OPTIONAL_VERIFY_STRUCTURAL_QUALITY" : null);
  } else if (current.value.status === "FAIL") {
    projection.next = "DIAGNOSE_STRUCTURAL_QUALITY_REGRESSION";
  } else if (current.value.status === "BLOCKED") {
    projection.next = "RESOLVE_STRUCTURAL_QUALITY_BLOCKER";
  } else {
    projection.next = null;
  }
  return projection;
}

export async function projectStructuralQualityStatus(options = {}) {
  return withProjectReadSnapshot(options.target, () => projectStructuralQualityStatusObservation(options));
}

async function projectStructuralQualityStatusObservation({ target, packageRoot = getPackageRoot(), taskId, runtimeContext } = {}) {
  const config = await loadOptionalConfig(target, packageRoot);
  const policy = configuredPolicy(config);
  if (!policy || policy.mode === "off") return emptyProjection(null);
  let state = null;
  try { state = await readWorkState(target, { packageRoot, taskId }); } catch { /* status remains read-only and structured */ }
  let baseline = null;
  let current = null;
  let evaluations = [];
  let inputs = null;
  try {
    inputs = await resolveStructuralQualityContext({ target, packageRoot, taskId, runtimeContext });
  } catch (error) {
    return { ...emptyProjection(policy, [error.code ?? E_STRUCTURAL_QUALITY_EVIDENCE_STALE]), baseline: { status: "INVALID", qualitySignal: null, artifactRef: null, fingerprint: null } };
  }
  try { baseline = await readStructuralQualityBaseline(target, taskId, packageRoot); } catch (error) {
    return { ...emptyProjection(policy, [error.code ?? E_STRUCTURAL_QUALITY_EVIDENCE_STALE]), baseline: { status: "INVALID", qualitySignal: null, artifactRef: null, fingerprint: null } };
  }
  try {
    evaluations = await listStructuralQualityEvaluations(target, taskId, packageRoot);
    current = evaluations.at(-1) ?? null;
  } catch (error) {
    return { ...projectionFromArtifacts(policy, baseline, null, state), reasonCodes: [error.code ?? E_STRUCTURAL_QUALITY_EVIDENCE_STALE] };
  }
  const baselineFreshness = baseline
    ? await validateStructuralQualityEvaluationFreshness({ target, packageRoot, taskId, artifact: baseline, inputs, runtimeContext })
    : null;
  const currentFreshness = current
    ? await validateStructuralQualityEvaluationFreshness({ target, packageRoot, taskId, artifact: current, inputs, runtimeContext })
    : null;
  const optimizationScope = policy.optimization.mode === "bounded" && current?.value?.status === "PASS"
    ? await optimizationScopeStatus(target, packageRoot, taskId)
    : null;
  return projectionFromArtifacts(policy, baseline, current, state, evaluations, optimizationScope, currentFreshness, baselineFreshness);
}

export async function validateStructuralQualityCheckProvenance(check, { target, packageRoot = getPackageRoot(), taskId, state, contract, route, config, runtimeContext } = {}) {
  if (check?.kind !== "structural-quality") return [];
  const details = check.details ?? {};
  const artifactRef = details.artifactRef;
  if (typeof artifactRef !== "string" || !artifactRef) return [qualityError(E_STRUCTURAL_QUALITY_EVIDENCE_STALE, "Structural-quality check is missing artifactRef")];
  try {
    const artifact = await readJsonArtifact(target, artifactRef, "structural-quality", packageRoot);
    const policy = configuredPolicy(config ?? await loadOptionalConfig(target, packageRoot));
    if (!policy || policy.mode === "off") return [qualityError(E_STRUCTURAL_QUALITY_EVIDENCE_STALE, "Structural-quality check is configured off")];
    const active = await resolveStructuralQualityContext({
      target,
      packageRoot,
      taskId,
      runtimeContext,
    });
    const freshness = await validateStructuralQualityEvaluationFreshness({
      target,
      packageRoot,
      taskId,
      artifact,
      inputs: { ...active, contract: contract ?? active.contract, route: route ?? active.route, policy },
      runtimeContext,
      check,
    });
    return freshness.errors;
  } catch (error) {
    return [error.code ? error : qualityError(E_STRUCTURAL_QUALITY_EVIDENCE_STALE, error.message)];
  }
}

function validateBindingErrors(value, expected) {
  const errors = [];
  const bindings = value.bindings ?? {};
  if (expected.taskId !== undefined && value.taskId !== expected.taskId) {
    errors.push(qualityError(E_STRUCTURAL_QUALITY_BASELINE_BINDING_MISMATCH, "Structural-quality task ID does not match the active task"));
  }
  for (const key of ["contractFingerprint", "routeFingerprint", "policyFingerprint", "scopeFingerprint"]) {
    if (expected[key] !== undefined && bindings[key] !== expected[key]) errors.push(qualityError(E_STRUCTURAL_QUALITY_BASELINE_BINDING_MISMATCH, `Structural-quality ${key} is stale`));
  }
  if (expected.providerId && value.provider?.id !== expected.providerId) errors.push(qualityError(E_STRUCTURAL_QUALITY_BASELINE_BINDING_MISMATCH, "Structural-quality provider binding is stale"));
  if (expected.baselineFingerprint !== undefined && value.role === "EVALUATION" && bindings.baselineFingerprint !== expected.baselineFingerprint) errors.push(qualityError(E_STRUCTURAL_QUALITY_BASELINE_BINDING_MISMATCH, "Structural-quality baseline binding is stale"));
  if (expected.verificationCycle !== undefined && value.role === "EVALUATION" && value.verificationCycle !== expected.verificationCycle) errors.push(qualityError(E_STRUCTURAL_QUALITY_EVIDENCE_STALE, "Structural-quality evaluation is from a stale verification cycle"));
  return errors;
}

function providerCompatibilityErrors(baselineProvider, currentProvider) {
  const errors = [];
  for (const provider of [baselineProvider, currentProvider]) {
    if (provider?.id !== "sentrux" || provider.version === undefined || provider.version === null) continue;
    if (!structuralQualityProviderCompatibility(provider).supported) {
      errors.push(qualityError("E_STRUCTURAL_QUALITY_PROVIDER_VERSION_UNSUPPORTED", "Structural-quality provider version is not in the verified compatibility table"));
    }
  }
  if (!baselineProvider || !currentProvider) return errors;
  if (baselineProvider.measurementModel && currentProvider.measurementModel
    && baselineProvider.measurementModel !== currentProvider.measurementModel) {
    errors.push(qualityError(E_STRUCTURAL_QUALITY_MEASUREMENT_MODEL_MISMATCH, "Structural-quality measurement model differs from the captured baseline"));
  }
  if (baselineProvider.compatibilityKey && currentProvider.compatibilityKey
    && baselineProvider.compatibilityKey !== currentProvider.compatibilityKey) {
    errors.push(qualityError(E_STRUCTURAL_QUALITY_EVALUATION_INCOMPARABLE, "Structural-quality compatibility key differs from the captured baseline"));
  }
  if (baselineProvider.version !== currentProvider.version) {
    const sameCompatibility = baselineProvider.compatibilityKey
      && currentProvider.compatibilityKey
      && baselineProvider.compatibilityKey === currentProvider.compatibilityKey;
    if (!sameCompatibility) {
      errors.push(qualityError(E_STRUCTURAL_QUALITY_EVALUATION_INCOMPARABLE, "Structural-quality provider version differs from the captured baseline"));
    }
  }
  return errors;
}

/**
 * Validates persisted evidence against the active task without invoking a
 * provider observation. This is the only freshness decision used by status,
 * provenance, and projection recovery.
 */
export async function validateStructuralQualityEvaluationFreshness({
  target,
  packageRoot = getPackageRoot(),
  taskId,
  artifact,
  inputs = null,
  runtimeContext,
  check = null,
} = {}) {
  const value = artifact?.value ?? artifact;
  const errors = [];
  if (!value || typeof value !== "object") {
    return { valid: false, errors: [qualityError(E_STRUCTURAL_QUALITY_EVIDENCE_STALE, "Structural-quality evidence is missing")], reasonCodes: [E_STRUCTURAL_QUALITY_EVIDENCE_STALE] };
  }
  try {
    validateStructuralQualityArtifact(value, artifact?.path ?? "structural-quality artifact");
  } catch (error) {
    errors.push(error.code ? error : qualityError(E_STRUCTURAL_QUALITY_EVIDENCE_STALE, error.message));
  }

  let active = inputs;
  if (!active) {
    try {
      active = await resolveStructuralQualityContext({ target, packageRoot, taskId, runtimeContext });
    } catch (error) {
      errors.push(error.code ? error : qualityError(E_STRUCTURAL_QUALITY_EVIDENCE_STALE, error.message));
    }
  }
  if (active) {
    errors.push(...validateBindingErrors(value, {
      taskId,
      contractFingerprint: active.contract.fingerprint,
      routeFingerprint: active.route.fingerprint,
      policyFingerprint: active.policy ? structuralQualityPolicyFingerprint(active.policy) : undefined,
      scopeFingerprint: active.scopeFingerprint,
      providerId: active.policy?.provider,
      verificationCycle: value.role === "EVALUATION" ? active.state.verificationCycle : undefined,
    }));
  }

  let baseline = null;
  if (value.role === "EVALUATION") {
    try {
      baseline = await readStructuralQualityBaseline(target, taskId, packageRoot);
      if (!baseline) errors.push(qualityError(E_STRUCTURAL_QUALITY_BASELINE_MISSING, "Structural-quality evaluation has no captured baseline"));
    } catch (error) {
      errors.push(error.code ? error : qualityError(E_STRUCTURAL_QUALITY_EVIDENCE_STALE, error.message));
    }
    if (baseline) {
      try {
        validateStructuralQualityArtifact(baseline.value, baseline.path);
      } catch (error) {
        errors.push(error.code ? error : qualityError(E_STRUCTURAL_QUALITY_EVIDENCE_STALE, error.message));
      }
      if (active) {
        errors.push(...validateBindingErrors(baseline.value, {
          taskId,
          contractFingerprint: active.contract.fingerprint,
          routeFingerprint: active.route.fingerprint,
          policyFingerprint: active.policy ? structuralQualityPolicyFingerprint(active.policy) : undefined,
          scopeFingerprint: active.scopeFingerprint,
          providerId: active.policy?.provider,
        }));
      }
      errors.push(...validateBindingErrors(value, { baselineFingerprint: baseline.fingerprint }));
      errors.push(...providerCompatibilityErrors(baseline.value.provider, value.provider));
    }
  } else {
    errors.push(...providerCompatibilityErrors(value.provider, value.provider));
  }

  if (["BASELINE", "EVALUATION"].includes(value.role) && value.bindings?.sourceMaterialFingerprint) {
    try {
      const currentSourceFingerprint = await computeMaterialSourceFingerprint(target);
      if (currentSourceFingerprint !== value.bindings.sourceMaterialFingerprint) {
        errors.push(qualityError(E_STRUCTURAL_QUALITY_EVIDENCE_STALE, `Structural-quality ${value.role.toLowerCase()} source material has changed since capture`));
      }
    } catch (error) {
      errors.push(error.code ? error : qualityError(E_STRUCTURAL_QUALITY_SOURCE_FINGERPRINT_UNAVAILABLE, error.message));
    }
  }
  if (check) {
    if (!active?.policy) errors.push(qualityError(E_STRUCTURAL_QUALITY_EVIDENCE_STALE, "Structural-quality policy is unavailable"));
    else if (check.status !== checkProjection(active.policy, value).status) {
      errors.push(qualityError(E_STRUCTURAL_QUALITY_EVIDENCE_STALE, "Structural-quality check status does not match its persisted evaluation"));
    }
    if (artifact?.fingerprint && check.details?.artifactFingerprint !== artifact.fingerprint) {
      errors.push(qualityError(E_STRUCTURAL_QUALITY_EVIDENCE_STALE, "Structural-quality check fingerprint does not match its artifact"));
    }
  }
  return {
    valid: errors.length === 0,
    errors,
    reasonCodes: [...new Set(errors.map((error) => error.code ?? E_STRUCTURAL_QUALITY_EVIDENCE_STALE))].sort(),
  };
}

export async function assertStructuralQualityExecutionReady({ target, packageRoot = getPackageRoot(), taskId, runtimeContext } = {}) {
  const config = await loadOptionalConfig(target, packageRoot);
  const policy = configuredPolicy(config);
  if (!policy || policy.mode !== "gate") return { required: false, baseline: null };
  const baseline = await readStructuralQualityBaseline(target, taskId, packageRoot);
  if (!baseline) throw qualityError(E_STRUCTURAL_QUALITY_BASELINE_MISSING, "Gate mode requires a captured structural-quality baseline before EXECUTING", [taskArtifactPath(taskId, "structuralQuality")]);
  const inputs = await taskInputs(target, packageRoot, taskId, { runtimeContext });
  const errors = validateBindingErrors(baseline.value, {
    contractFingerprint: inputs.contract.fingerprint,
    routeFingerprint: inputs.route.fingerprint,
    policyFingerprint: structuralQualityPolicyFingerprint(policy),
    scopeFingerprint: inputs.scopeFingerprint,
    providerId: policy.provider,
  });
  if (errors.length > 0) throw errors[0];
  return { required: true, baseline };
}
