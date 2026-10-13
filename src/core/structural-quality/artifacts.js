import { needsExistingProjectScope, withExistingProjectScope } from "../../storage/existing-project-scope.js";
import { readdir } from "node:fs/promises";
import { listOperationalArtifactNames, operationalArtifactExists } from "../../storage/operational-context.js";

import {
  canonicalFingerprint,
  readJsonArtifact,
  writeJsonArtifact,
} from "../artifacts.js";
import { fileExists, ensureWithin, assertSafePath } from "../filesystem.js";
import {
  E_STRUCTURAL_QUALITY_BASELINE_BINDING_MISMATCH,
  E_STRUCTURAL_QUALITY_BASELINE_EXISTS,
  E_STRUCTURAL_QUALITY_BASELINE_PHASE_INVALID,
  E_STRUCTURAL_QUALITY_EVIDENCE_STALE,
} from "../error-codes.js";
import { getPackageRoot } from "../templates.js";
import {
  taskStructuralQualityBaselinePath,
  taskStructuralQualityDirectory,
  taskStructuralQualityEvaluationPath,
  taskStructuralQualityEvaluationsDirectory,
} from "../task-paths.js";
import { STRUCTURAL_QUALITY_ROOT_CAUSES, structuralQualityError } from "./constants.js";
import { normalizeStructuralQualityDetection, normalizeStructuralQualitySnapshot } from "./provider.js";

const PRE_EXECUTION_PHASES = new Set([
  "RECEIVED",
  "DISCOVERING",
  "CONTRACT_READY",
  "ROUTED",
  "DESIGNING",
  "PLANNED",
]);

function qualityArtifactError(code, message, artifacts = []) {
  return structuralQualityError(code, message, artifacts);
}

function normalizeCycle(value, label) {
  if (!Number.isInteger(value) || value < 1) {
    throw qualityArtifactError(E_STRUCTURAL_QUALITY_EVIDENCE_STALE, `${label} must be a positive integer`);
  }
  return value;
}

function normalizeAttempt(value) {
  if (!Number.isInteger(value) || value < 1) {
    throw qualityArtifactError(E_STRUCTURAL_QUALITY_EVIDENCE_STALE, "structural-quality attempt must be a positive integer");
  }
  return value;
}

function readFailure(error, relativePath, missingCode) {
  if (error?.code === "ARTIFACT_MISSING") {
    return qualityArtifactError(missingCode, `Structural-quality artifact is missing: ${relativePath}`, [relativePath]);
  }
  if (error?.code?.startsWith("E_STRUCTURAL_QUALITY")) return error;
  return qualityArtifactError(E_STRUCTURAL_QUALITY_EVIDENCE_STALE, `Structural-quality artifact is invalid: ${error.message}`, [relativePath]);
}

export function validateStructuralQualityArtifact(value, label = "structural-quality artifact") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw qualityArtifactError(E_STRUCTURAL_QUALITY_EVIDENCE_STALE, `${label} must be an object`);
  }
  if (value.role === "BASELINE") {
    if (value.verificationCycle !== null) throw qualityArtifactError(E_STRUCTURAL_QUALITY_EVIDENCE_STALE, `${label} baseline verificationCycle must be null`);
    if (value.status !== "PASS") throw qualityArtifactError(E_STRUCTURAL_QUALITY_EVIDENCE_STALE, `${label} baseline status must be PASS`);
    if (value.bindings?.baselineFingerprint !== undefined && value.bindings.baselineFingerprint !== null) {
      throw qualityArtifactError(E_STRUCTURAL_QUALITY_BASELINE_BINDING_MISMATCH, `${label} baselineFingerprint must be null`);
    }
  } else if (value.role === "EVALUATION") {
    if (!Number.isInteger(value.verificationCycle) || value.verificationCycle < 1) {
      throw qualityArtifactError(E_STRUCTURAL_QUALITY_EVIDENCE_STALE, `${label} evaluation verificationCycle must be positive`);
    }
    if (!Number.isInteger(value.attempt) || value.attempt < 1) {
      throw qualityArtifactError(E_STRUCTURAL_QUALITY_EVIDENCE_STALE, `${label} evaluation attempt must be positive`);
    }
    if (!Array.isArray(value.reasonCodes) || (value.status !== "PASS" && value.reasonCodes.length === 0)) {
      throw qualityArtifactError(E_STRUCTURAL_QUALITY_EVIDENCE_STALE, `${label} non-PASS evaluations require a reason code`);
    }
    if (!value.comparison || typeof value.comparison !== "object") {
      throw qualityArtifactError(E_STRUCTURAL_QUALITY_EVIDENCE_STALE, `${label} evaluation comparison is required`);
    }
    const comparisonStatus = value.comparison.status;
    if (value.status === "PASS" && comparisonStatus !== "PASS") {
      throw qualityArtifactError(E_STRUCTURAL_QUALITY_EVIDENCE_STALE, `${label} PASS status requires a PASS comparison`);
    }
    if (value.status === "FAIL" && comparisonStatus !== "FAIL") {
      throw qualityArtifactError(E_STRUCTURAL_QUALITY_EVIDENCE_STALE, `${label} FAIL status requires a FAIL comparison`);
    }
    if (["BLOCKED", "NOT_OBSERVED"].includes(value.status) && comparisonStatus === "PASS") {
      throw qualityArtifactError(E_STRUCTURAL_QUALITY_EVIDENCE_STALE, `${label} unavailable evaluation cannot contain a PASS comparison`);
    }
  } else {
    throw qualityArtifactError(E_STRUCTURAL_QUALITY_EVIDENCE_STALE, `${label} role must be BASELINE or EVALUATION`);
  }
  const observed = value.role === "BASELINE" || ["PASS", "FAIL"].includes(value.status);
  const sourceFingerprint = value.bindings?.sourceMaterialFingerprint;
  if (observed) {
    if (typeof sourceFingerprint !== "string" || !/^[a-f0-9]{64}$/u.test(sourceFingerprint)) {
      throw qualityArtifactError(E_STRUCTURAL_QUALITY_EVIDENCE_STALE, `${label} observed evidence requires sourceMaterialFingerprint`);
    }
    if (!value.sourceObservation || value.sourceObservation.stable !== true) {
      throw qualityArtifactError(E_STRUCTURAL_QUALITY_EVIDENCE_STALE, `${label} observed evidence requires a stable sourceObservation`);
    }
  }
  if (!value.detection || typeof value.detection !== "object" || Array.isArray(value.detection)) {
    throw qualityArtifactError(E_STRUCTURAL_QUALITY_EVIDENCE_STALE, `${label} detection metadata is required`);
  }
  if (value.provider?.id !== value.detection?.providerId) {
    throw qualityArtifactError(E_STRUCTURAL_QUALITY_BASELINE_BINDING_MISMATCH, `${label} provider and detection IDs differ`);
  }
  if (value.sourceObservation !== undefined && value.sourceObservation !== null) {
    if (typeof value.sourceObservation !== "object" || Array.isArray(value.sourceObservation)) {
      throw qualityArtifactError(E_STRUCTURAL_QUALITY_EVIDENCE_STALE, `${label} sourceObservation must be an object`);
    }
    if (typeof value.sourceObservation.beforeFingerprint !== "string"
      || typeof value.sourceObservation.afterFingerprint !== "string"
      || typeof value.sourceObservation.stable !== "boolean") {
      throw qualityArtifactError(E_STRUCTURAL_QUALITY_EVIDENCE_STALE, `${label} sourceObservation requires beforeFingerprint, afterFingerprint, and stable`);
    }
    if (value.sourceObservation.stable === true
      && (value.sourceObservation.beforeFingerprint !== value.sourceObservation.afterFingerprint
        || (typeof sourceFingerprint === "string" && value.sourceObservation.beforeFingerprint !== sourceFingerprint))) {
      throw qualityArtifactError(E_STRUCTURAL_QUALITY_EVIDENCE_STALE, `${label} stable sourceObservation does not match its source binding`);
    }
    if (!value.sourceObservation.stable && ["PASS", "FAIL"].includes(value.status)) {
      throw qualityArtifactError(E_STRUCTURAL_QUALITY_EVIDENCE_STALE, `${label} unstable sourceObservation cannot produce observed evidence`);
    }
  }
  normalizeStructuralQualityDetection(value.detection, {
    providerId: value.provider?.id,
    version: value.provider?.version,
    transport: value.provider?.transport,
    measurementModel: value.provider?.measurementModel,
    compatibilityKey: value.provider?.compatibilityKey,
  });
  if (value.snapshot !== undefined) normalizeStructuralQualitySnapshot(value.snapshot);
  if (["PASS", "FAIL"].includes(value.status) && value.snapshot === undefined) {
    throw qualityArtifactError(E_STRUCTURAL_QUALITY_EVIDENCE_STALE, `${label} observed status requires a normalized snapshot`);
  }
  return value;
}

export function structuralQualityArtifactRef(taskId, relativePath) {
  const expectedRoot = taskStructuralQualityDirectory(taskId).replaceAll("\\", "/");
  const portable = String(relativePath).replaceAll("\\", "/");
  if (portable.startsWith("/")
    || portable.split("/").some((part) => part === "..")
    || (portable !== expectedRoot && !portable.startsWith(`${expectedRoot}/`))) {
    throw qualityArtifactError(E_STRUCTURAL_QUALITY_EVIDENCE_STALE, `Artifact reference escapes the structural-quality directory: ${relativePath}`, [portable]);
  }
  return portable;
}

export async function readStructuralQualityBaseline(target, taskId, packageRoot = getPackageRoot()) {
  const relativePath = taskStructuralQualityBaselinePath(taskId);
  try {
    const artifact = await readJsonArtifact(target, relativePath, "structural-quality", packageRoot);
    validateStructuralQualityArtifact(artifact.value, relativePath);
    return artifact;
  } catch (error) {
    if (error?.code === "ARTIFACT_MISSING") return null;
    throw readFailure(error, relativePath, E_STRUCTURAL_QUALITY_EVIDENCE_STALE);
  }
}

export async function writeStructuralQualityBaseline(
  target,
  taskId,
  value,
  packageRoot = getPackageRoot(),
  { phase = "PLANNED", replace = false, taskId: transactionTaskId = taskId } = {},
) {
  const relativePath = taskStructuralQualityBaselinePath(taskId);
  if (!PRE_EXECUTION_PHASES.has(phase)) {
    throw qualityArtifactError(
      E_STRUCTURAL_QUALITY_BASELINE_PHASE_INVALID,
      `Structural-quality baselines cannot be written or replaced in ${phase}`,
      [relativePath],
    );
  }
  const existing = await readStructuralQualityBaseline(target, taskId, packageRoot);
  const fingerprint = canonicalFingerprint(value);
  if (existing) {
    if (existing.fingerprint === fingerprint) {
      return { ...existing, existing: true, identical: true };
    }
    if (!replace) {
      throw qualityArtifactError(
        E_STRUCTURAL_QUALITY_BASELINE_EXISTS,
        "The structural-quality baseline already exists and is immutable without --replace before EXECUTING",
        [relativePath],
      );
    }
  }
  const written = await writeJsonArtifact(
    target,
    relativePath,
    value,
    "structural-quality",
    packageRoot,
    { taskId: transactionTaskId, operation: "structural-quality-baseline" },
  );
  return { ...written, existing: Boolean(existing), identical: false };
}

export async function listStructuralQualityEvaluations(target, taskId, packageRoot = getPackageRoot()) {
  if (await needsExistingProjectScope(target)) {
    return withExistingProjectScope(target, () => listStructuralQualityEvaluations(target, taskId, packageRoot), { readOnly: true });
  }
  const relativeDirectory = taskStructuralQualityEvaluationsDirectory(taskId);
  let names = listOperationalArtifactNames(target, taskId, "structural-quality/evaluations");
  if (names === null) {
    await assertSafePath(target, relativeDirectory);
    const absoluteDirectory = ensureWithin(target, relativeDirectory);
    if (!(await fileExists(absoluteDirectory))) return [];
    try {
      names = (await readdir(absoluteDirectory, { withFileTypes: true })).filter(entry => entry.isFile()).map(entry => entry.name);
    } catch (error) {
      throw qualityArtifactError(E_STRUCTURAL_QUALITY_EVIDENCE_STALE, `Unable to list structural-quality evaluations: ${error.message}`, [relativeDirectory]);
    }
  }
  const candidates = names
    .map((name) => {
      const match = /^cycle-(\d+)-attempt-(\d+)\.json$/u.exec(name);
      return match ? { name, verificationCycle: Number(match[1]), attempt: Number(match[2]) } : null;
    })
    .filter(Boolean)
    .filter((item) => item.verificationCycle >= 1 && item.attempt >= 1)
    .sort((left, right) => left.verificationCycle - right.verificationCycle || left.attempt - right.attempt);
  const result = [];
  for (const item of candidates) {
    const relativePath = taskStructuralQualityEvaluationPath(taskId, item.verificationCycle, item.attempt);
    try {
      const artifact = await readJsonArtifact(target, relativePath, "structural-quality", packageRoot);
      validateStructuralQualityArtifact(artifact.value, relativePath);
      if (artifact.value.role !== "EVALUATION"
        || artifact.value.verificationCycle !== item.verificationCycle
        || artifact.value.attempt !== item.attempt) {
        throw qualityArtifactError(E_STRUCTURAL_QUALITY_EVIDENCE_STALE, `Evaluation filename does not match its typed cycle/attempt: ${relativePath}`, [relativePath]);
      }
      result.push(artifact);
    } catch (error) {
      throw readFailure(error, relativePath, E_STRUCTURAL_QUALITY_EVIDENCE_STALE);
    }
  }
  return result;
}

export async function readStructuralQualityEvaluation(target, taskId, verificationCycle, attempt, packageRoot = getPackageRoot()) {
  const relativePath = taskStructuralQualityEvaluationPath(taskId, normalizeCycle(verificationCycle, "verificationCycle"), normalizeAttempt(attempt));
  try {
    const artifact = await readJsonArtifact(target, relativePath, "structural-quality", packageRoot);
    validateStructuralQualityArtifact(artifact.value, relativePath);
    if (artifact.value.role !== "EVALUATION"
      || artifact.value.verificationCycle !== verificationCycle
      || artifact.value.attempt !== attempt) {
      throw qualityArtifactError(E_STRUCTURAL_QUALITY_EVIDENCE_STALE, `Evaluation identity does not match ${relativePath}`, [relativePath]);
    }
    return artifact;
  } catch (error) {
    throw readFailure(error, relativePath, E_STRUCTURAL_QUALITY_EVIDENCE_STALE);
  }
}

export async function writeStructuralQualityEvaluation(target, taskId, verificationCycle, attempt, value, packageRoot = getPackageRoot(), { transactionTaskId = taskId } = {}) {
  const cycle = normalizeCycle(verificationCycle, "verificationCycle");
  const normalizedAttempt = normalizeAttempt(attempt);
  const relativePath = taskStructuralQualityEvaluationPath(taskId, cycle, normalizedAttempt);
  if (value.role !== "EVALUATION" || value.verificationCycle !== cycle || value.attempt !== normalizedAttempt) {
    throw qualityArtifactError(E_STRUCTURAL_QUALITY_EVIDENCE_STALE, `Evaluation identity does not match ${relativePath}`, [relativePath]);
  }
  validateStructuralQualityArtifact(value, relativePath);
  const existing = operationalArtifactExists(target, relativePath) ?? await fileExists(ensureWithin(target, relativePath));
  if (existing) {
    const current = await readStructuralQualityEvaluation(target, taskId, cycle, normalizedAttempt, packageRoot);
    if (current.fingerprint === canonicalFingerprint(value)) return { ...current, existing: true, identical: true };
    throw qualityArtifactError(E_STRUCTURAL_QUALITY_EVIDENCE_STALE, `Evaluation attempt is immutable: ${relativePath}`, [relativePath]);
  }
  const written = await writeJsonArtifact(
    target,
    relativePath,
    value,
    "structural-quality",
    packageRoot,
    { taskId: transactionTaskId, operation: "structural-quality-evaluation" },
  );
  return { ...written, existing: false, identical: false };
}

export function validateStructuralQualityBindings(value, expected = {}) {
  const errors = [];
  const bindings = value?.bindings ?? {};
  const fields = ["contractFingerprint", "routeFingerprint", "policyFingerprint", "scopeFingerprint"];
  for (const field of fields) {
    if (expected[field] !== undefined && bindings[field] !== expected[field]) {
      errors.push({
        code: E_STRUCTURAL_QUALITY_BASELINE_BINDING_MISMATCH,
        message: `Structural-quality ${field} does not match the active task binding`,
      });
    }
  }
  if (expected.providerId !== undefined && value.provider?.id !== expected.providerId) {
    errors.push({ code: E_STRUCTURAL_QUALITY_BASELINE_BINDING_MISMATCH, message: "Structural-quality provider ID does not match the active policy" });
  }
  if (expected.providerVersion !== undefined && expected.providerVersion !== null && value.provider?.version !== expected.providerVersion) {
    errors.push({ code: E_STRUCTURAL_QUALITY_BASELINE_BINDING_MISMATCH, message: "Structural-quality provider version does not match the baseline" });
  }
  if (expected.baselineFingerprint !== undefined && bindings.baselineFingerprint !== expected.baselineFingerprint) {
    errors.push({ code: E_STRUCTURAL_QUALITY_BASELINE_BINDING_MISMATCH, message: "Structural-quality evaluation does not bind the active baseline" });
  }
  if (expected.verificationCycle !== undefined && value.verificationCycle !== expected.verificationCycle) {
    errors.push({ code: E_STRUCTURAL_QUALITY_EVIDENCE_STALE, message: "Structural-quality evidence belongs to a different verification cycle" });
  }
  return errors;
}

export function assertStructuralQualityBindings(value, expected = {}) {
  const errors = validateStructuralQualityBindings(value, expected);
  if (errors.length > 0) {
    const artifactRef = expected.artifactRef ?? null;
    throw qualityArtifactError(
      errors[0].code,
      errors[0].message,
      artifactRef ? [structuralQualityArtifactRef(expected.taskId ?? value.taskId, artifactRef)] : [],
    );
  }
  return value;
}

export function structuralQualityRootCauseNames() {
  return [...STRUCTURAL_QUALITY_ROOT_CAUSES];
}
