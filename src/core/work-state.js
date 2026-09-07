import { createHash } from "node:crypto";
import { unlink } from "node:fs/promises";
import path from "node:path";

import {
  assertSafePath,
  ensureWithin,
  fileExists,
  readBytes,
  writeFileAtomic,
} from "./filesystem.js";
import { GUIDE_IDS, PROTOCOL_VERSION, assertFailureClass, assertWorkPhase, isValidTransition } from "./protocol.js";
import { assertSchema, readSchema } from "./schema-validation.js";
import { assertSecretFree } from "./receipt.js";
import { getPackageRoot } from "./templates.js";
import { currentRepositoryFingerprint } from "./repository.js";
import { createEvidence } from "./evidence.js";
import { assertJsonBytes } from "./json-safety.js";
import { assertCoverageList } from "./coverage.js";
import { canonicalFingerprint } from "./artifacts.js";
import { taskArtifactPath } from "./task-paths.js";
import { getTaskTransaction, withTaskTransaction } from "./transaction.js";

export const WORK_STATE_PATH = ".forgeloop/work-state.json";

export class WorkStateError extends Error {
  constructor(message) {
    super(message);
    this.name = "WorkStateError";
    this.code = "STALE_STATE_FAILURE";
  }
}

export function contractFingerprint(contract) {
  return canonicalFingerprint(contract);
}

function assertFingerprint(value, label) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new WorkStateError(`${label} must be a lowercase SHA-256 fingerprint`);
  }
}

function normalizeArtifactPath(value) {
  if (typeof value !== "string" || !value) {
    throw new WorkStateError("requiredArtifacts.path must be a non-empty relative path");
  }
  const portable = value.replaceAll("\\", "/");
  if (portable.startsWith("/") || /^[A-Za-z]:\//.test(portable)) {
    throw new WorkStateError(`requiredArtifacts.path must remain relative: ${value}`);
  }
  const normalized = path.posix.normalize(portable);
  if (normalized === "." || normalized === ".." || normalized.startsWith("../")) {
    throw new WorkStateError(`requiredArtifacts.path escapes the task target: ${value}`);
  }
  return normalized.replace(/^\.\//, "");
}

function normalizeRequiredArtifacts(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new WorkStateError("requiredArtifacts must be an array");
  const artifacts = value.map((artifact) => {
    if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) {
      throw new WorkStateError("requiredArtifacts entries must be objects");
    }
    const normalized = {
      path: normalizeArtifactPath(artifact.path),
      sha256: artifact.sha256,
    };
    assertFingerprint(normalized.sha256, `requiredArtifacts.${normalized.path}.sha256`);
    return normalized;
  });
  if (new Set(artifacts.map((artifact) => artifact.path)).size !== artifacts.length) {
    throw new WorkStateError("requiredArtifacts must not contain duplicate paths");
  }
  return artifacts.sort((left, right) => left.path.localeCompare(right.path));
}

function assertStringArray(value, label) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item)) {
    throw new WorkStateError(`${label} must be an array of non-empty strings`);
  }
}

export function assertWorkStateSemantics(state) {
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    throw new WorkStateError("Work state must be a JSON object");
  }
  if (state.schemaVersion !== 1 || state.protocolVersion !== PROTOCOL_VERSION) {
    throw new WorkStateError("Unsupported work-state protocol version");
  }
  if (typeof state.taskId !== "string" || !state.taskId) {
    throw new WorkStateError("Work state taskId is required");
  }
  assertFingerprint(state.contractFingerprint, "contractFingerprint");
  if (state.routeFingerprint !== undefined) assertFingerprint(state.routeFingerprint, "routeFingerprint");
  if (!state.repositoryFingerprint || typeof state.repositoryFingerprint !== "object" || Array.isArray(state.repositoryFingerprint)) {
    throw new WorkStateError("repositoryFingerprint is required");
  }
  for (const key of ["branch", "head"]) {
    if (state.repositoryFingerprint[key] !== null && typeof state.repositoryFingerprint[key] !== "string") {
      throw new WorkStateError(`repositoryFingerprint.${key} must be a string or null`);
    }
  }
  assertWorkPhase(state.phase);
  assertStringArray(state.selectedGuides, "selectedGuides");
  if (state.selectedGuides.some((guide) => !GUIDE_IDS.includes(guide))) {
    throw new WorkStateError("Work state contains an unknown guide");
  }
  if (new Set(state.selectedGuides).size !== state.selectedGuides.length) {
    throw new WorkStateError("selectedGuides must not contain duplicates");
  }
  for (const key of ["requiredGates", "satisfiedGates"]) {
    if (state[key] !== undefined) {
      assertStringArray(state[key], key);
      if (new Set(state[key]).size !== state[key].length) {
        throw new WorkStateError(`${key} must not contain duplicates`);
      }
    }
  }
  if (state.satisfiedGates?.some((gate) => !state.requiredGates?.includes(gate))) {
    throw new WorkStateError("satisfiedGates must be a subset of requiredGates");
  }
  if (state.complianceMode !== undefined && !["advisory", "standard", "strict"].includes(state.complianceMode)) {
    throw new WorkStateError(`Unknown compliance mode: ${state.complianceMode}`);
  }
  if (state.publicationStatus !== undefined
    && !["not-published", "local-only", "committed", "pushed", "published", "deployed"].includes(state.publicationStatus)) {
    throw new WorkStateError(`Unknown publication status: ${state.publicationStatus}`);
  }
  if (state.evidenceCoverage !== undefined && !Array.isArray(state.evidenceCoverage)) {
    throw new WorkStateError("evidenceCoverage must be an array");
  }
  if (state.evidenceCoverage !== undefined) {
    try {
      assertCoverageList(state.evidenceCoverage);
    } catch (error) {
      throw new WorkStateError(error.message);
    }
  }
  assertStringArray(state.completedSteps, "completedSteps");
  assertStringArray(state.pendingSteps, "pendingSteps");
  normalizeRequiredArtifacts(state.requiredArtifacts);
  for (const key of ["checks", "failures", "blockers", "verificationEvidence"]) {
    if (!Array.isArray(state[key])) throw new WorkStateError(`${key} must be an array`);
  }
  if (state.phase === "COMPLETE" && state.verificationEvidence.length === 0) {
    throw new WorkStateError("COMPLETE requires verification evidence");
  }
  if (state.phase === "COMPLETE" && state.evidenceCoverage?.some((item) => item.status !== "COVERED")) {
    throw new WorkStateError("COMPLETE requires covered evidence for every recorded criterion");
  }
  if (state.phase === "BLOCKED" && state.blockers.length === 0) {
    throw new WorkStateError("BLOCKED requires a blocker");
  }
  if (state.phase === "CORRECTING" && (typeof state.diagnosedHypothesis !== "string" || !state.diagnosedHypothesis)) {
    throw new WorkStateError("CORRECTING requires a diagnosed hypothesis");
  }
  if (state.previousPhase !== undefined) {
    if (!isValidTransition(state.previousPhase, state.phase)) {
      throw new WorkStateError(`Invalid work-state transition: ${state.previousPhase} -> ${state.phase}`);
    }
  }
  if (state.verificationCycle !== undefined && (!Number.isInteger(state.verificationCycle) || state.verificationCycle < 1)) {
    throw new WorkStateError("verificationCycle must be a positive integer");
  }
  if (state.revision !== undefined && (!Number.isInteger(state.revision) || state.revision < 0)) {
    throw new WorkStateError("revision must be a non-negative integer");
  }
  if (state.lastCompletionAttempt !== undefined) {
    if (!state.lastCompletionAttempt || typeof state.lastCompletionAttempt !== "object" || Array.isArray(state.lastCompletionAttempt)) {
      throw new WorkStateError("lastCompletionAttempt must be an object");
    }
    if (state.lastCompletionAttempt.status !== "REJECTED") {
      throw new WorkStateError("lastCompletionAttempt.status must be REJECTED");
    }
    if (!Array.isArray(state.lastCompletionAttempt.reasonCodes)
      || state.lastCompletionAttempt.reasonCodes.some((code) => typeof code !== "string" || !code.trim())) {
      throw new WorkStateError("lastCompletionAttempt.reasonCodes must be an array of non-empty strings");
    }
    if (!Array.isArray(state.lastCompletionAttempt.missingRequirementIds)
      || state.lastCompletionAttempt.missingRequirementIds.some((id) => typeof id !== "string" || !id.trim())) {
      throw new WorkStateError("lastCompletionAttempt.missingRequirementIds must be an array of non-empty strings");
    }
    if (!Number.isInteger(state.lastCompletionAttempt.verificationCycle) || state.lastCompletionAttempt.verificationCycle < 1) {
      throw new WorkStateError("lastCompletionAttempt.verificationCycle must be a positive integer");
    }
    if (typeof state.lastCompletionAttempt.timestamp !== "string" || !state.lastCompletionAttempt.timestamp.trim()) {
      throw new WorkStateError("lastCompletionAttempt.timestamp must be a non-empty string");
    }
  }
  for (const failure of state.failures) {
    if (failure?.failureClass !== undefined) assertFailureClass(failure.failureClass);
  }
  assertSecretFree(state);
  return state;
}

export function createWorkState(input) {
  assertSecretFree(input);
  const state = {
    schemaVersion: 1,
    protocolVersion: PROTOCOL_VERSION,
    taskId: input.taskId,
    contractFingerprint: input.contractFingerprint,
    ...(input.routeFingerprint !== undefined ? { routeFingerprint: input.routeFingerprint } : {}),
    repositoryFingerprint: input.repositoryFingerprint ?? { branch: null, head: null },
    phase: input.phase,
    selectedGuides: [...(input.selectedGuides ?? [])],
    ...(input.requiredGates !== undefined ? { requiredGates: [...input.requiredGates] } : {}),
    ...(input.satisfiedGates !== undefined ? { satisfiedGates: [...input.satisfiedGates] } : {}),
    ...(input.complianceMode !== undefined ? { complianceMode: input.complianceMode } : {}),
    ...(input.evidenceCoverage !== undefined ? { evidenceCoverage: [...input.evidenceCoverage] } : {}),
    ...(input.publicationStatus !== undefined ? { publicationStatus: input.publicationStatus } : {}),
    completedSteps: [...(input.completedSteps ?? [])],
    pendingSteps: [...(input.pendingSteps ?? [])],
    requiredArtifacts: normalizeRequiredArtifacts(input.requiredArtifacts),
    checks: [...(input.checks ?? [])],
    failures: [...(input.failures ?? [])],
    blockers: [...(input.blockers ?? [])],
    verificationEvidence: [...(input.verificationEvidence ?? [])],
    lastUpdated: input.lastUpdated ?? new Date().toISOString(),
    revision: input.revision ?? 0,
  };
  if (input.verificationCycle !== undefined) state.verificationCycle = input.verificationCycle;
  if (input.lastCompletionAttempt !== undefined) state.lastCompletionAttempt = structuredClone(input.lastCompletionAttempt);
  if (input.previousPhase !== undefined) state.previousPhase = input.previousPhase;
  if (input.diagnosedHypothesis !== undefined) state.diagnosedHypothesis = input.diagnosedHypothesis;
  return assertWorkStateSemantics(state);
}

async function validateStoredState(state, packageRoot = getPackageRoot()) {
  const schema = await readSchema("work-state", packageRoot);
  assertSchema(state, schema, "work state");
  return assertWorkStateSemantics(state);
}

export async function readWorkState(target, options = {}) {
  const packageRoot = typeof options === "string" ? options : (options?.packageRoot ?? getPackageRoot());
  const relPath = typeof options === "object" && options !== null
    ? (options.statePath ?? options.relativePath ?? (options.taskId ? taskArtifactPath(options.taskId, "state") : (options.taskContext ? options.taskContext.paths.state : WORK_STATE_PATH)))
    : WORK_STATE_PATH;

  await assertSafePath(target, relPath);
  const statePath = ensureWithin(target, relPath);
  let state;
  try {
    const transaction = (await getTaskTransaction(target));
    const staged = transaction ? await transaction.readText(relPath) : null;
    if (staged === null) {
      if (!(await fileExists(statePath))) return null;
      const bytes = await readBytes(statePath);
      assertJsonBytes(bytes, relPath);
      state = JSON.parse(bytes.toString("utf8"));
    } else {
      const bytes = Buffer.from(staged, "utf8");
      assertJsonBytes(bytes, relPath);
      state = JSON.parse(staged);
    }
  } catch (error) {
    throw new WorkStateError(`Unable to parse ${relPath}: ${error.message}`);
  }
  try {
    return await validateStoredState(state, packageRoot);
  } catch (error) {
    if (error instanceof WorkStateError) throw error;
    throw new WorkStateError(error.message);
  }
}

export async function readContractFingerprint(target, contractFile) {
  await assertSafePath(target, contractFile);
  const contractPath = ensureWithin(target, contractFile);
  let contract;
  try {
    const bytes = await readBytes(contractPath);
    assertJsonBytes(bytes, contractFile);
    contract = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new WorkStateError(`Unable to parse contract ${contractFile}: ${error.message}`);
  }
  return { path: contractFile, fingerprint: contractFingerprint(contract) };
}

export async function writeWorkState(target, state, options = {}) {
  const packageRoot = options?.packageRoot ?? getPackageRoot();
  const dryRun = options?.dryRun ?? false;
  const relPath = options?.statePath ?? options?.relativePath ?? (options?.taskId ? taskArtifactPath(options.taskId, "state") : WORK_STATE_PATH);

  await validateStoredState(state, packageRoot);
  await assertSafePath(target, relPath);
  const serialized = `${JSON.stringify(state, null, 2)}\n`;
  const transaction = (await getTaskTransaction(target));
  if (!dryRun && transaction) {
    await transaction.stageText(relPath, serialized);
  } else {
    const statePath = ensureWithin(target, relPath);
    await writeFileAtomic(statePath, serialized, { dryRun });
  }
  return state;
}

export async function mutateWorkState(target, { expectedRevision, packageRoot = getPackageRoot(), taskId, statePath } = {}, updater) {
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
    const error = new WorkStateError("expectedRevision must be a non-negative integer");
    error.code = "E_STATE_REVISION_CONFLICT";
    throw error;
  }
  if (!(await getTaskTransaction(target))) {
    try {
      return await withTaskTransaction({
        target,
        taskId: taskId ?? "legacy-work-state",
        lockTaskId: taskId ?? "legacy-work-state",
        operation: "mutate-work-state",
      }, async () => mutateWorkState(target, { expectedRevision, packageRoot, taskId, statePath }, updater));
    } catch (error) {
      if (error?.code === "E_TASK_LOCKED") {
        const revisionError = new WorkStateError("Work state revision is being mutated concurrently");
        revisionError.code = "E_STATE_REVISION_CONFLICT";
        throw revisionError;
      }
      throw error;
    }
  }
  const current = await readWorkState(target, { packageRoot, taskId, statePath });
  if (!current || (current.revision ?? 0) !== expectedRevision) {
    const error = new WorkStateError("Work state revision does not match expected revision");
    error.code = "E_STATE_REVISION_CONFLICT";
    throw error;
  }
  const updated = await updater(structuredClone(current));
  const next = createWorkState({
    ...updated,
    revision: expectedRevision + 1,
    lastUpdated: updated.lastUpdated ?? new Date().toISOString(),
  });
  await writeWorkState(target, next, { packageRoot, taskId, statePath });
  return next;
}

export async function initializeWorkState(target, state, { packageRoot = getPackageRoot(), taskId, statePath } = {}) {
  if ((await getTaskTransaction(target))) {
    const current = await readWorkState(target, { packageRoot, taskId, statePath });
    if (current) return current;
    await writeWorkState(target, state, { packageRoot, taskId, statePath });
    return state;
  }
  return withTaskTransaction({
    target,
    taskId: taskId ?? "legacy-work-state",
    lockTaskId: taskId ?? "legacy-work-state",
    operation: "initialize-work-state",
  }, async () => initializeWorkState(target, state, { packageRoot, taskId, statePath }));
}

export async function clearWorkState(target, options = {}) {
  const relPath = options?.statePath ?? options?.relativePath ?? (options?.taskId ? taskArtifactPath(options.taskId, "state") : WORK_STATE_PATH);
  await assertSafePath(target, relPath);
  const statePath = ensureWithin(target, relPath);
  if (!(await fileExists(statePath))) return { removed: false, path: relPath };
  await unlink(statePath);
  return { removed: true, path: relPath };
}

export async function readRequiredArtifactFingerprints(target, artifacts) {
  const normalized = normalizeRequiredArtifacts(artifacts);
  const current = [];
  for (const artifact of normalized) {
    await assertSafePath(target, artifact.path);
    const artifactPath = ensureWithin(target, artifact.path);
    if (!(await fileExists(artifactPath))) {
      current.push({ path: artifact.path, sha256: null, status: "missing" });
      continue;
    }
    current.push({
      path: artifact.path,
      sha256: createHash("sha256").update(await readBytes(artifactPath)).digest("hex"),
      status: "present",
    });
  }
  return current;
}

function normalizeClassificationInput(currentInput = {}) {
  if (!currentInput || typeof currentInput !== "object" || Array.isArray(currentInput)) {
    return { repositoryFingerprint: { branch: null, head: null } };
  }
  const isOptions = Object.prototype.hasOwnProperty.call(currentInput, "repositoryFingerprint")
    || Object.prototype.hasOwnProperty.call(currentInput, "contractFingerprint")
    || Object.prototype.hasOwnProperty.call(currentInput, "requiredArtifacts")
    || Object.prototype.hasOwnProperty.call(currentInput, "maxAgeMs")
    || Object.prototype.hasOwnProperty.call(currentInput, "now");
  if (isOptions) {
    return {
      repositoryFingerprint: currentInput.repositoryFingerprint ?? { branch: null, head: null },
      contractFingerprint: currentInput.contractFingerprint,
      requiredArtifacts: currentInput.requiredArtifacts,
      maxAgeMs: currentInput.maxAgeMs,
      now: currentInput.now,
    };
  }
  return { repositoryFingerprint: currentInput };
}

export function classifyWorkState(state, currentInput = {}) {
  if (!state) return { status: "ABSENT", reasons: ["NO_CHECKPOINT"] };
  const current = normalizeClassificationInput(currentInput);
  const reasons = [];
  const warnings = [];
  const saved = state.repositoryFingerprint;
  const repositoryFingerprint = current.repositoryFingerprint ?? { branch: null, head: null };
  const repositoryUnavailable = saved.branch === null
    && saved.head === null
    && repositoryFingerprint.branch === null
    && repositoryFingerprint.head === null;
  const repositoryComparison = repositoryUnavailable
    ? "NOT_VERIFIED"
    : saved.branch !== repositoryFingerprint.branch || saved.head !== repositoryFingerprint.head
      ? "MISMATCH"
      : "MATCH";
  if (repositoryComparison === "MISMATCH") {
    reasons.push("REPOSITORY_CHANGED");
  }

  let contractComparison = "NOT_VERIFIED";
  if (typeof current.contractFingerprint === "string") {
    contractComparison = state.contractFingerprint === current.contractFingerprint ? "MATCH" : "MISMATCH";
    if (contractComparison === "MISMATCH") reasons.push("CONTRACT_CHANGED");
  } else {
    reasons.push("CONTRACT_NOT_VERIFIED");
  }

  const savedArtifacts = normalizeRequiredArtifacts(state.requiredArtifacts);
  let artifactComparison = "NOT_APPLICABLE";
  if (savedArtifacts.length > 0) {
    if (!Array.isArray(current.requiredArtifacts)) {
      artifactComparison = "NOT_VERIFIED";
      reasons.push("REQUIRED_ARTIFACTS_NOT_VERIFIED");
    } else {
      const currentArtifacts = new Map(current.requiredArtifacts.map((artifact) => [artifact.path, artifact]));
      const missing = savedArtifacts.some((artifact) => !currentArtifacts.has(artifact.path)
        || currentArtifacts.get(artifact.path)?.sha256 === null
        || currentArtifacts.get(artifact.path)?.status === "missing");
      const changed = savedArtifacts.some((artifact) => currentArtifacts.get(artifact.path)?.sha256 !== artifact.sha256);
      if (missing) {
        artifactComparison = "MISSING";
        reasons.push("REQUIRED_ARTIFACT_MISSING");
      } else if (changed) {
        artifactComparison = "MISMATCH";
        reasons.push("REQUIRED_ARTIFACT_CHANGED");
      } else {
        artifactComparison = "MATCH";
      }
    }
  }

  const now = current.now ?? Date.now();
  const updatedAt = Date.parse(state.lastUpdated);
  let stateAgeMs = null;
  if (Number.isFinite(updatedAt) && Number.isFinite(now) && now >= updatedAt) {
    stateAgeMs = now - updatedAt;
    if (Number.isFinite(current.maxAgeMs) && current.maxAgeMs >= 0 && stateAgeMs > current.maxAgeMs) {
      warnings.push("CHECKPOINT_OLD");
    }
  }
  return {
    status: reasons.length > 0 ? "REVALIDATION_REQUIRED" : "FRESH",
    reasons,
    warnings,
    repositoryComparison,
    contractComparison,
    artifactComparison,
    stateAgeMs,
    state,
  };
}

export async function classifyLoadedWorkState({ target, state, contractFile = null, maxAgeMs } = {}) {
  const repository = await currentRepositoryFingerprint(target);

  let contract = null;
  let contractError = null;
  if (contractFile) {
    try {
      contract = await readContractFingerprint(target, contractFile);
    } catch (error) {
      contractError = error.message;
    }
  }

  let currentArtifacts;
  let artifactError = null;
  if ((state.requiredArtifacts ?? []).length > 0) {
    try {
      currentArtifacts = await readRequiredArtifactFingerprints(target, state.requiredArtifacts);
    } catch (error) {
      artifactError = error.message;
    }
  } else {
    currentArtifacts = [];
  }

  const classification = classifyWorkState(state, {
    repositoryFingerprint: repository,
    contractFingerprint: contract?.fingerprint,
    requiredArtifacts: currentArtifacts,
    maxAgeMs,
  });
  if (contractError) {
    classification.contractComparison = "INVALID";
    classification.reasons = classification.reasons.filter((reason) => reason !== "CONTRACT_NOT_VERIFIED");
    classification.reasons.push("CONTRACT_INVALID");
  }
  if (artifactError) {
    classification.artifactComparison = "NOT_VERIFIED";
    classification.reasons.push("REQUIRED_ARTIFACTS_NOT_VERIFIED");
  }
  classification.reasons = [...new Set(classification.reasons)];
  return {
    ...classification,
    repository,
    error: contractError ?? artifactError,
    contract: {
      path: contractFile,
      status: contractError ? "INVALID" : contract ? "OBSERVED" : "NOT_VERIFIED",
    },
    evidence: [
      createEvidence({
        kind: classification.repositoryComparison === "NOT_VERIFIED" ? "NOT_VERIFIED" : "OBSERVED",
        source: "repository fingerprint",
        result: classification.repositoryComparison,
      }),
      createEvidence({
        kind: classification.contractComparison === "NOT_VERIFIED" ? "NOT_VERIFIED" : "OBSERVED",
        source: contractFile ?? "current contract",
        result: classification.contractComparison,
      }),
      ...(classification.artifactComparison !== "NOT_APPLICABLE"
        ? [createEvidence({
          kind: classification.artifactComparison === "NOT_VERIFIED" ? "NOT_VERIFIED" : "OBSERVED",
          source: "required artifacts",
          result: classification.artifactComparison,
        })]
        : []),
    ],
  };
}

export async function readAndClassifyWorkState({ target, packageRoot = getPackageRoot(), contractFile = null, maxAgeMs, taskId = null, stateFile = null, statePath = null } = {}) {
  const effectiveStateRel = stateFile ?? statePath ?? (taskId ? taskArtifactPath(taskId, "state") : WORK_STATE_PATH);
  let state = null;
  try {
    state = await readWorkState(target, {
      packageRoot,
      ...(taskId ? { taskId } : {}),
      ...(stateFile || statePath ? { statePath: effectiveStateRel } : {}),
    });
  } catch (error) {
    return {
      path: effectiveStateRel,
      present: true,
      status: "INVALID",
      reasons: ["STATE_INVALID"],
      warnings: [],
      error: error.message,
      state: null,
      phase: null,
      completed: [],
      pending: [],
      repository: await currentRepositoryFingerprint(target),
      contractComparison: "NOT_VERIFIED",
      artifactComparison: "NOT_VERIFIED",
      contract: { path: contractFile, status: "NOT_VERIFIED" },
      evidence: [createEvidence({ kind: "BLOCKED", source: WORK_STATE_PATH, result: error.message })],
    };
  }

  if (!state) {
    const repository = await currentRepositoryFingerprint(target);
    return {
      path: effectiveStateRel,
      present: false,
      status: "ABSENT",
      reasons: ["NO_CHECKPOINT"],
      warnings: [],
      error: null,
      state: null,
      phase: null,
      completed: [],
      pending: [],
      repository,
      contractComparison: "NOT_VERIFIED",
      artifactComparison: "NOT_APPLICABLE",
      contract: { path: contractFile, status: contractFile ? "NOT_USED" : "NOT_VERIFIED" },
      evidence: [createEvidence({
        kind: "NOT_VERIFIED",
        source: WORK_STATE_PATH,
        result: "No work-state checkpoint is present",
      })],
    };
  }

  const classification = await classifyLoadedWorkState({ target, state, contractFile, maxAgeMs });
  return {
    path: effectiveStateRel,
    present: true,
    ...classification,
    phase: state.phase,
    completed: state.completedSteps,
    pending: state.pendingSteps,
  };
}

export { currentRepositoryFingerprint };
