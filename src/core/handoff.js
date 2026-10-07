import { needsExistingProjectScope, withExistingProjectScope } from "../storage/existing-project-scope.js";
import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import { listOperationalArtifactNames, operationalArtifactExists } from "../storage/operational-context.js";

import { canonicalFingerprint, readJsonArtifact, writeJsonArtifact } from "./artifacts.js";
import { assertPortableContextSafe, normalizePortableText } from "./portable-context.js";
import { appendProtocolEvent } from "./events.js";
import { currentChangedPaths, currentRepositoryFingerprint } from "./repository.js";
import { readContract } from "./contract.js";
import { readPersistedRoute } from "./route-artifact.js";
import { readWorkState } from "./work-state.js";
import { assertStateIdentity } from "./completion-relationships.js";
import { resolveTaskClaimState } from "./task-claim-state.js";
import { readContinuity } from "./continuity.js";
import { getPackageRoot } from "./templates.js";
import { assertSafePath, ensureWithin, fileExists } from "./filesystem.js";
import { taskArtifactPath, taskHandoffDirectory, taskHandoffPath } from "./task-paths.js";
import { PROTOCOL_VERSION, WORK_PHASES } from "./protocol.js";
import { assertTaskMutationAllowed } from "./task-claim-state.js";
import { assertWorkspaceBinding } from "./workspace-binding.js";
import { withTaskTransaction } from "./transaction.js";

function handoffError(code, message, artifacts = []) {
  const error = new Error(message);
  error.name = "HandoffError";
  error.code = code;
  error.artifacts = artifacts;
  return error;
}

function optionalText(value, label, maxLength = 2000) {
  if (value === undefined || value === null) return null;
  try {
    return normalizePortableText(value, { label, maxLength, optional: true });
  } catch (error) {
    throw handoffError("E_HANDOFF_INVALID", `${label} must be a non-empty string when provided`);
  }
}

function pathList(value) {
  return [...new Set((value ?? []).map((item) => String(item).replaceAll("\\", "/")))].sort();
}

function handoffWithoutDigest(value) {
  const { artifactDigest: _artifactDigest, ...body } = value;
  return body;
}

export function compareRepositoryFingerprint(expected, current) {
  const expectedUnavailable = !expected || (expected.branch === null && expected.head === null);
  const currentUnavailable = !current || (current.branch === null && current.head === null);
  if (expectedUnavailable && currentUnavailable) return "NOT_VERIFIED";
  if (expectedUnavailable !== currentUnavailable) return "MISMATCH";
  return expected.branch === current.branch && expected.head === current.head
    ? "MATCH"
    : "MISMATCH";
}

export function validateHandoffDigest(handoff) {
  try {
    assertPortableContextSafe(handoff);
  } catch (error) {
    throw handoffError("E_HANDOFF_INVALID", error.message);
  }
  if (typeof handoff?.artifactDigest !== "string"
    || handoff.artifactDigest !== canonicalFingerprint(handoffWithoutDigest(handoff))) {
    throw handoffError("E_HANDOFF_TAMPERED", "Handoff artifact digest does not match its canonical content");
  }
  return handoff;
}

async function currentContinuity(target, packageRoot, taskId) {
  try {
    const artifact = await readContinuity(target, { packageRoot, taskId });
    return { ref: artifact.path, fingerprint: artifact.fingerprint };
  } catch (error) {
    if (error.code === "ARTIFACT_MISSING") {
      return { ref: taskArtifactPath(taskId, "continuity"), fingerprint: null };
    }
    throw handoffError("E_HANDOFF_STATE_UNAVAILABLE", `Continuity state cannot be read: ${error.message}`, [taskArtifactPath(taskId, "continuity")]);
  }
}

export async function buildCanonicalHandoff(target, {
  taskId,
  recipientHint,
  note,
  packageRoot = getPackageRoot(),
  handoffId = `handoff-${randomUUID()}`,
  createdAt = new Date().toISOString(),
} = {}) {
  if (!taskId) throw handoffError("E_HANDOFF_STATE_UNAVAILABLE", "taskId is required to build a handoff");
  const [state, contract, route, claims, changedPaths, continuity, repositoryFingerprint] = await Promise.all([
    readWorkState(target, { packageRoot, taskId }),
    readContract(target, packageRoot, { taskId }),
    readPersistedRoute(target, packageRoot, { taskId }),
    resolveTaskClaimState(target, { packageRoot, taskId }),
    currentChangedPaths(target),
    currentContinuity(target, packageRoot, taskId),
    currentRepositoryFingerprint(target),
  ]);
  if (!state || !contract || !route || changedPaths === null || !claims.valid) {
    throw handoffError("E_HANDOFF_STATE_UNAVAILABLE", "Canonical task state, route, claims, and changed paths are required for a handoff");
  }
  try {
    assertStateIdentity({ contract, route, state });
  } catch (error) {
    throw handoffError(
      "E_HANDOFF_STATE_UNAVAILABLE",
      `Canonical task artifacts are not coherent for handoff creation: ${error.message}`,
      error.artifacts ?? [],
    );
  }
  if (compareRepositoryFingerprint(state.repositoryFingerprint, repositoryFingerprint) === "MISMATCH") {
    throw handoffError(
      "E_HANDOFF_STATE_UNAVAILABLE",
      "Canonical repository fingerprint has drifted from current repository state",
    );
  }
  const checkItems = [...(state.checks ?? [])];
  const executionRefs = pathList(checkItems.map((check) => check.executionRef).filter(Boolean));
  const checkIds = pathList(checkItems.map((check) => check.id).filter(Boolean));
  const body = {
    schemaVersion: 1,
    protocolVersion: PROTOCOL_VERSION,
    handoffId,
    taskId: state.taskId,
    createdAt,
    intent: {
      ...(optionalText(recipientHint, "recipientHint") ? { recipientHint } : {}),
      ...(optionalText(note, "note") ? { note } : {}),
    },
    state: {
      phase: WORK_PHASES.includes(state.phase) ? state.phase : "UNKNOWN",
      revision: state.revision ?? 0,
      verificationCycle: state.verificationCycle ?? 1,
      workStateFingerprint: canonicalFingerprint(state),
      contractFingerprint: contract.fingerprint,
      routeFingerprint: route.fingerprint ?? null,
      repositoryFingerprint,
      writeClaims: pathList(claims.effectiveWriteClaims ?? []),
      changedPaths: pathList(changedPaths),
    },
    evidence: { executionRefs, checkIds },
    continuity,
  };
  return {
    ...body,
    artifactDigest: canonicalFingerprint(body),
  };
}

export async function validateCanonicalHandoff(target, handoff, {
  taskId,
  packageRoot = getPackageRoot(),
} = {}) {
  const { readSchema, assertSchema } = await import("./schema-validation.js");
  try {
    assertSchema(handoff, await readSchema("handoff-envelope", packageRoot), "handoff envelope");
  } catch (error) {
    throw handoffError("E_HANDOFF_INVALID", error.message);
  }
  if (taskId && handoff.taskId !== taskId) {
    throw handoffError("E_HANDOFF_INVALID", "Handoff taskId does not match the selected task");
  }
  return validateHandoffDigest(handoff);
}

export async function writeCanonicalHandoff(target, handoff, options = {}) {
  return withTaskTransaction({ target, taskId: options.taskId ?? handoff?.taskId, packageRoot: options.packageRoot, operation: "handoff-create" }, () => writeCanonicalHandoffInTransaction(target, handoff, options));
}

async function writeCanonicalHandoffInTransaction(target, handoff, {
  packageRoot = getPackageRoot(),
  taskId = handoff?.taskId,
} = {}) {
  await validateCanonicalHandoff(target, handoff, { taskId, packageRoot });
  const relativePath = taskHandoffPath(taskId, handoff.handoffId);
  const operationalExists = operationalArtifactExists(target, relativePath);
  if (operationalExists === null) await assertSafePath(target, relativePath);
  if (operationalExists ?? await fileExists(ensureWithin(target, relativePath))) {
    throw handoffError("E_HANDOFF_INVALID", "An existing handoff cannot be overwritten", [relativePath]);
  }
  const artifact = await writeJsonArtifact(target, relativePath, handoff, "handoff-envelope", packageRoot, { taskId, operation: "handoff-create" });
  await appendProtocolEvent(target, {
    taskId,
    event: "HANDOFF_CREATED",
    fingerprint: artifact.fingerprint,
    details: { handoffId: handoff.handoffId, artifact: relativePath, digest: handoff.artifactDigest },
  }, packageRoot, { taskId });
  return { path: relativePath, fingerprint: artifact.fingerprint, handoff };
}

export async function createCanonicalHandoff(target, options = {}) {
  return withTaskTransaction({ target, taskId: options.taskId, packageRoot: options.packageRoot, operation: "handoff-create", recordCommitEvent: true }, async () => {
    await assertTaskMutationAllowed(target, { taskId: options.taskId, packageRoot: options.packageRoot }).catch((error) => {
      if (error.code !== "E_TASK_COMPLETE") throw error;
    });
    await assertWorkspaceBinding(target, { taskId: options.taskId, packageRoot: options.packageRoot, operation: "handoff-create" });
    const handoff = await buildCanonicalHandoff(target, options);
    return writeCanonicalHandoff(target, handoff, options);
  });
}

export async function readCanonicalHandoff(target, {
  taskId,
  handoffId,
  packageRoot = getPackageRoot(),
} = {}) {
  const relativePath = taskHandoffPath(taskId, handoffId);
  try {
    const artifact = await readJsonArtifact(target, relativePath, "handoff-envelope", packageRoot);
    await validateCanonicalHandoff(target, artifact.value, { taskId, packageRoot });
    if (artifact.value.handoffId !== handoffId) {
      throw handoffError("E_HANDOFF_INVALID", "Handoff ID does not match its path", [relativePath]);
    }
    return { ...artifact, value: artifact.value };
  } catch (error) {
    if (error.code === "ARTIFACT_MISSING") {
      throw handoffError("E_HANDOFF_NOT_FOUND", `Handoff not found: ${handoffId}`, [relativePath]);
    }
    if (error.code === "E_HANDOFF_TAMPERED" || error.code === "E_HANDOFF_INVALID") throw error;
    throw handoffError("E_HANDOFF_INVALID", error.message, [relativePath]);
  }
}

export async function listCanonicalHandoffs(target, { taskId, packageRoot = getPackageRoot() } = {}) {
  if (await needsExistingProjectScope(target)) {
    return withExistingProjectScope(target, () => listCanonicalHandoffs(target, { taskId, packageRoot }), { readOnly: true });
  }
  const directory = taskHandoffDirectory(taskId);
  let names = listOperationalArtifactNames(target, taskId, "handoffs");
  if (names === null) {
    if (!(await fileExists(ensureWithin(target, directory)))) return [];
    names = (await readdir(ensureWithin(target, directory), { withFileTypes: true })).filter(entry => entry.isFile()).map(entry => entry.name);
  }
  const handoffs = [];
  for (const name of names) {
    if (!/^handoff-[A-Za-z0-9_-]+\.json$/u.test(name)) continue;
    const handoffId = name.slice(0, -5);
    const artifact = await readCanonicalHandoff(target, { taskId, handoffId, packageRoot });
    handoffs.push(artifact.value);
  }
  return handoffs.sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.handoffId.localeCompare(right.handoffId));
}

export async function resolveLatestHandoff(target, { taskId, packageRoot = getPackageRoot() } = {}) {
  const handoffs = await listCanonicalHandoffs(target, { taskId, packageRoot });
  const latest = handoffs.at(-1);
  return latest
    ? { handoffId: latest.handoffId, createdAt: latest.createdAt, digest: latest.artifactDigest }
    : null;
}
