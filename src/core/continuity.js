import { withExistingProjectScope } from "../storage/existing-project-scope.js";
import path from "node:path";

import {
  ARTIFACT_PATHS,
  canonicalFingerprint,
  readJsonArtifact,
  writeJsonArtifact,
} from "./artifacts.js";
import { PROTOCOL_VERSION, WORK_PHASES } from "./protocol.js";
import { normalizePortableText, assertPortableContextSafe } from "./portable-context.js";
import { getPackageRoot } from "./templates.js";
import { taskArtifactPath } from "./task-paths.js";
import { getOperationalStore, readOperationalText } from "../storage/operational-context.js";
import { withTaskTransaction } from "./transaction.js";

export const CONTINUITY_PATH = ARTIFACT_PATHS.continuity;
export const CONTINUITY_SCHEMA_VERSION = 1;

const LIMITS = Object.freeze({
  taskId: 128,
  id: 128,
  summary: 1000,
  path: 1024,
  resumeNote: 2000,
  remainingWork: 40,
  knownIssues: 40,
  changedAreas: 80,
  inspectFirst: 40,
});

function continuityError(code, message, artifacts = [CONTINUITY_PATH]) {
  const error = new Error(message);
  error.name = "ContinuityError";
  error.code = code;
  error.artifacts = artifacts;
  return error;
}

function nonEmptyString(value, label, maxLength) {
  try {
    return normalizePortableText(value, { label, maxLength });
  } catch (error) {
    throw continuityError("E_CONTINUITY_INVALID", error.message);
  }
}

function fingerprint(value, label) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw continuityError("E_CONTINUITY_INVALID", `${label} must be a lowercase SHA-256 fingerprint`);
  }
  return value;
}

function normalizeProjectPath(value, label) {
  nonEmptyString(value, label, LIMITS.path);
  const portable = value.replaceAll("\\", "/");
  if (portable.startsWith("/") || /^[A-Za-z]:\//.test(portable)) {
    throw continuityError("E_CONTINUITY_INVALID", `${label} must remain a relative project path`);
  }
  const normalized = path.posix.normalize(portable);
  if (normalized === "." || normalized === ".." || normalized.startsWith("../")) {
    throw continuityError("E_CONTINUITY_INVALID", `${label} must not escape the task target`);
  }
  return normalized.replace(/^\.\//, "");
}

function normalizeWorkItem(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw continuityError("E_CONTINUITY_INVALID", `${label} must be an object`);
  }
  const keys = Object.keys(value).sort();
  if (keys.some((key) => !["id", "summary"].includes(key))) {
    throw continuityError("E_CONTINUITY_INVALID", `${label} contains an unsupported field`);
  }
  return {
    id: nonEmptyString(value.id, `${label}.id`, LIMITS.id),
    summary: nonEmptyString(value.summary, `${label}.summary`, LIMITS.summary),
  };
}

function normalizeWorkItems(value, label, maxItems) {
  if (!Array.isArray(value)) throw continuityError("E_CONTINUITY_INVALID", `${label} must be an array`);
  if (value.length > maxItems) throw continuityError("E_CONTINUITY_INVALID", `${label} exceeds the ${maxItems}-item limit`);
  const items = value.map((item, index) => normalizeWorkItem(item, `${label}[${index}]`));
  if (new Set(items.map((item) => item.id)).size !== items.length) {
    throw continuityError("E_CONTINUITY_INVALID", `${label} must not contain duplicate ids`);
  }
  return items;
}

function normalizePaths(value, label, maxItems) {
  if (!Array.isArray(value)) throw continuityError("E_CONTINUITY_INVALID", `${label} must be an array`);
  if (value.length > maxItems) throw continuityError("E_CONTINUITY_INVALID", `${label} exceeds the ${maxItems}-item limit`);
  const paths = value.map((item, index) => normalizeProjectPath(item, `${label}[${index}]`));
  if (new Set(paths).size !== paths.length) throw continuityError("E_CONTINUITY_INVALID", `${label} must not contain duplicate paths`);
  return paths;
}

function normalizeRepositoryFingerprint(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw continuityError("E_CONTINUITY_INVALID", "repositoryFingerprint must be an object");
  }
  if (Object.keys(value).some((key) => !["branch", "head"].includes(key))) {
    throw continuityError("E_CONTINUITY_INVALID", "repositoryFingerprint contains an unsupported field");
  }
  for (const key of ["branch", "head"]) {
    if (value[key] !== null && typeof value[key] !== "string") {
      throw continuityError("E_CONTINUITY_INVALID", `repositoryFingerprint.${key} must be a string or null`);
    }
  }
  return { branch: value.branch ?? null, head: value.head ?? null };
}

const CONTINUITY_FIELDS = new Set([
  "schemaVersion",
  "protocolVersion",
  "taskId",
  "workStateFingerprint",
  "contractFingerprint",
  "phase",
  "verificationCycle",
  "repositoryFingerprint",
  "updatedAt",
  "currentFocus",
  "remainingWork",
  "knownIssues",
  "changedAreas",
  "inspectFirst",
  "resumeNote",
]);

export function assertContinuitySemantics(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw continuityError("E_CONTINUITY_INVALID", "Continuity must be a JSON object");
  }
  const unknownField = Object.keys(input).find((key) => !CONTINUITY_FIELDS.has(key));
  if (unknownField) {
    throw continuityError("E_CONTINUITY_INVALID", `Continuity contains unsupported field: ${unknownField}`);
  }
  if (input.schemaVersion !== CONTINUITY_SCHEMA_VERSION || input.protocolVersion !== PROTOCOL_VERSION) {
    throw continuityError("E_CONTINUITY_SCHEMA_UNSUPPORTED", "Unsupported continuity schema or protocol version");
  }
  if (!WORK_PHASES.includes(input.phase)) {
    throw continuityError("E_CONTINUITY_INVALID", `Unknown continuity phase: ${input.phase}`);
  }
  if (input.verificationCycle !== undefined
    && (!Number.isInteger(input.verificationCycle) || input.verificationCycle < 1)) {
    throw continuityError("E_CONTINUITY_INVALID", "verificationCycle must be a positive integer");
  }
  const normalized = {
    schemaVersion: CONTINUITY_SCHEMA_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    taskId: nonEmptyString(input.taskId, "taskId", LIMITS.taskId),
    workStateFingerprint: fingerprint(input.workStateFingerprint, "workStateFingerprint"),
    contractFingerprint: fingerprint(input.contractFingerprint, "contractFingerprint"),
    phase: input.phase,
    ...(input.verificationCycle !== undefined ? { verificationCycle: input.verificationCycle } : {}),
    repositoryFingerprint: normalizeRepositoryFingerprint(input.repositoryFingerprint),
    updatedAt: nonEmptyString(input.updatedAt, "updatedAt", 128),
    ...(input.currentFocus !== undefined ? { currentFocus: normalizeWorkItem(input.currentFocus, "currentFocus") } : {}),
    remainingWork: normalizeWorkItems(input.remainingWork, "remainingWork", LIMITS.remainingWork),
    knownIssues: normalizeWorkItems(input.knownIssues, "knownIssues", LIMITS.knownIssues),
    changedAreas: normalizePaths(input.changedAreas, "changedAreas", LIMITS.changedAreas),
    inspectFirst: normalizePaths(input.inspectFirst, "inspectFirst", LIMITS.inspectFirst),
    ...(input.resumeNote !== undefined
      ? { resumeNote: nonEmptyString(input.resumeNote, "resumeNote", LIMITS.resumeNote) }
      : {}),
  };
  try {
    assertPortableContextSafe(normalized);
  } catch (error) {
    throw continuityError("E_CONTINUITY_INVALID", error.message);
  }
  return normalized;
}

export function createContinuity(input) {
  return assertContinuitySemantics({
    schemaVersion: input.schemaVersion ?? CONTINUITY_SCHEMA_VERSION,
    protocolVersion: input.protocolVersion ?? PROTOCOL_VERSION,
    ...structuredClone(input),
  });
}

export async function readContinuity(target, options = {}) {
  const packageRoot = typeof options === "string" ? options : (options?.packageRoot ?? getPackageRoot());
  const relPath = typeof options === "object" && options !== null
    ? (options.continuityPath ?? options.relativePath ?? (options.taskId ? taskArtifactPath(options.taskId, "continuity") : CONTINUITY_PATH))
    : CONTINUITY_PATH;
  const artifact = await readJsonArtifact(target, relPath, "continuity", packageRoot);
  return { ...artifact, value: assertContinuitySemantics(artifact.value) };
}

export async function writeContinuity(target, operationalInput = {}, options = {}) {
  const packageRoot = options.packageRoot ?? getPackageRoot();
  let state = options.state;
  if (!state) {
    const { readWorkState } = await import("./work-state.js");
    state = await readWorkState(target, { packageRoot, taskId: options.taskId, statePath: options.statePath });
  }
  if (!state) throw continuityError("E_CONTINUITY_STATE_MISSING", "Cannot record continuity without work state", [options.statePath ?? (options.taskId ? taskArtifactPath(options.taskId, "state") : ARTIFACT_PATHS.state)]);

  let contract = options.contract;
  if (!contract) {
    const { readContract } = await import("./contract.js");
    contract = await readContract(target, packageRoot, { taskId: options.taskId, contractPath: options.contractPath });
  }
  const currentContractFingerprint = contract?.fingerprint
    ?? (contract ? canonicalFingerprint(contract.value ?? contract) : null);
  if (!currentContractFingerprint) {
    throw continuityError("E_CONTINUITY_CONTRACT_MISMATCH", "Cannot bind continuity to the current contract", [options.contractPath ?? (options.taskId ? taskArtifactPath(options.taskId, "contract") : ARTIFACT_PATHS.contract)]);
  }
  if (state.contractFingerprint !== currentContractFingerprint) {
    throw continuityError(
      "E_CONTINUITY_CONTRACT_MISMATCH",
      "Work state contract fingerprint does not match the current contract",
      [options.statePath ?? (options.taskId ? taskArtifactPath(options.taskId, "state") : ARTIFACT_PATHS.state), options.contractPath ?? (options.taskId ? taskArtifactPath(options.taskId, "contract") : ARTIFACT_PATHS.contract)],
    );
  }
  const value = createContinuity({
    taskId: state.taskId,
    workStateFingerprint: canonicalFingerprint(state),
    contractFingerprint: state.contractFingerprint,
    phase: state.phase,
    ...(state.verificationCycle !== undefined ? { verificationCycle: state.verificationCycle } : {}),
    repositoryFingerprint: options.repositoryFingerprint ?? await (async () => {
      const { currentRepositoryFingerprint } = await import("./repository.js");
      return currentRepositoryFingerprint(target);
    })(),
    updatedAt: options.now ?? new Date().toISOString(),
    ...(operationalInput.currentFocus !== undefined ? { currentFocus: operationalInput.currentFocus } : {}),
    remainingWork: operationalInput.remainingWork ?? [],
    knownIssues: operationalInput.knownIssues ?? [],
    changedAreas: operationalInput.changedAreas ?? [],
    inspectFirst: operationalInput.inspectFirst ?? [],
    ...(operationalInput.resumeNote !== undefined ? { resumeNote: operationalInput.resumeNote } : {}),
  });
  const relPath = options.continuityPath ?? options.relativePath ?? (options.taskId ? taskArtifactPath(options.taskId, "continuity") : CONTINUITY_PATH);
  return writeJsonArtifact(target, relPath, value, "continuity", packageRoot, {
    dryRun: options.dryRun ?? false,
  });
}

export async function clearContinuity(target, options = {}) {
  if (!options.taskId) throw Object.assign(new Error("Canonical artifact clearing requires a task identity"), { code: "E_STORAGE_OPERATION_UNSUPPORTED" });
  const relPath = taskArtifactPath(options.taskId, "continuity");
  const requested = options.continuityPath ?? options.relativePath ?? relPath;
  if (requested !== relPath) throw Object.assign(new Error("Artifact clearing requires the canonical task path; portable exports are independent files"), { code: "E_STORAGE_OPERATION_UNSUPPORTED", artifacts: [requested] });
  if (!getOperationalStore(target)) {
    return withExistingProjectScope(target, () => clearContinuity(target, options));
  }
  const operational = readOperationalText(target, relPath);
  if (operational.text === null) return { removed: false, path: relPath };
  return withTaskTransaction({ target, taskId: options.taskId, operation: "clear-continuity", packageRoot: options.packageRoot }, async transaction => {
    transaction.stageDelete(relPath);
    return { removed: true, path: relPath };
  });
}
