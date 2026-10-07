import { needsExistingProjectScope, withExistingProjectScope } from "../storage/existing-project-scope.js";
import { ensureWithin, fileExists } from "./filesystem.js";
import {
  ARTIFACT_PATHS,
  executionArtifactPath,
  readJsonArtifact,
} from "./artifacts.js";
import { taskArtifactPath, taskExecutionPath } from "./task-paths.js";
import { getOperationalStore, operationalArtifactExists } from "../storage/operational-context.js";

export { E_COMMAND_RESOLUTION_AMBIGUOUS } from "./verification-capability.js";
import {
  prepareCommandExecution,
  runPreparedCommandExecution,
} from "./prepared-execution.js";
export {
  prepareCommandExecution,
  runPreparedCommandExecution,
  TERMINATION_GRACE_MS_PREPARED as TERMINATION_GRACE_MS,
} from "./prepared-execution.js";

function executionError(code, message, artifacts = []) {
  const error = new Error(message);
  error.code = code;
  error.artifacts = artifacts;
  return error;
}

/** Resolve an execution identity; persistence separately requires canonical SQLite authority. */
export async function resolveExecutionArtifactPath(target, taskId, executionId) {
  if (await needsExistingProjectScope(target)) {
    return withExistingProjectScope(target, () => resolveExecutionArtifactPath(target, taskId, executionId), { readOnly: true });
  }
  if (!taskId) return executionArtifactPath(executionId);
  const descriptorRel = taskArtifactPath(taskId, "descriptor");
  if (operationalArtifactExists(target, descriptorRel) ?? await fileExists(ensureWithin(target, descriptorRel))) {
    return taskExecutionPath(taskId, executionId);
  }
  return executionArtifactPath(executionId);
}

/**
 * Deterministic pre-launch preparation followed by an exact-argv launch.
 * Kept as the canonical single-command entrypoint for non-durable callers
 * (run-check); durable actions use the two phases separately so that
 * ACTION_STARTED lands exactly on the launch boundary (INV-EXEC-01).
 */
export async function runCommandExecution({
  target,
  packageRoot,
  taskId,
  checkId,
  requirement,
  verificationCycle = 1,
  argv,
  details,
  authorityContext,
  runtimeContext,
  executionPath,
  timeoutMs = null,
  executionKind = "VERIFICATION",
} = {}) {
  const prepared = await prepareCommandExecution({
    target,
    argv,
    details,
    authorityContext,
    runtimeContext,
  });
  return runPreparedCommandExecution({
    target,
    packageRoot,
    taskId,
    checkId,
    requirement,
    verificationCycle,
    prepared,
    timeoutMs,
    executionPath,
    executionKind,
    runtimeContext,
  });
}

export async function readExecutionArtifact({ target, executionRef, packageRoot, taskId } = {}) {
  if (await needsExistingProjectScope(target)) {
    return withExistingProjectScope(target, () => readExecutionArtifact({ target, executionRef, packageRoot, taskId }), { readOnly: true });
  }
  let relativePath;
  try {
    const store = getOperationalStore(target);
    if (store && !taskId) {
      // Validate the public reference before using it as a canonical identity.
      executionArtifactPath(executionRef);
      taskId = store.executionTaskId(executionRef);
    }
    relativePath = taskId ? taskExecutionPath(taskId, executionRef) : executionArtifactPath(executionRef);
    const artifact = await readJsonArtifact(target, relativePath, "execution", packageRoot);
    return artifact;
  } catch (error) {
    if (error.code === "E_EXECUTION_REF_INVALID") throw error;
    throw executionError("E_EXECUTION_REF_INVALID", "Execution reference does not resolve to a valid ForgeLoop artifact", [relativePath ?? ARTIFACT_PATHS.executionDirectory]);
  }
}

export function validateExecutionBinding({ execution, taskId, checkId, requirement, verificationCycle = 1 } = {}) {
  if (!execution || execution.kind !== "COMMAND_EXECUTION"
    || execution.taskId !== taskId
    || execution.checkId !== checkId
    || execution.requirement !== requirement
    || execution.verificationCycle !== undefined && execution.verificationCycle !== verificationCycle) {
    throw executionError("E_EXECUTION_REF_INVALID", "Execution artifact does not match the current check binding", [ARTIFACT_PATHS.executionDirectory]);
  }
  return execution;
}
