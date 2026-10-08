import { assertRouteInvariants } from "./router.js";
import { ARTIFACT_PATHS, readJsonArtifact, writeJsonArtifact } from "./artifacts.js";
import { readContract } from "./contract.js";
import { ensureResumableState, synchronizePersistedRouteState } from "./resumability.js";
import { readWorkState } from "./work-state.js";
import { taskArtifactPath } from "./task-paths.js";
import { getTaskTransaction, withTaskTransaction } from "./transaction.js";



export async function persistRoute(target, route, packageRoot, options = {}) {
  if (!options.taskId) return persistRouteInTransaction(target, route, packageRoot, options);
  return withTaskTransaction({ target, taskId: options.taskId, packageRoot, operation: "route" }, () => persistRouteInTransaction(target, route, packageRoot, options));
}

async function persistRouteInTransaction(target, route, packageRoot, options) {
  assertRouteInvariants(route);
  const { contractFingerprint: suppliedFingerprint, ...writeOptions } = options;
  let contractFingerprint = suppliedFingerprint;
  let contractArtifact = null;
  if (contractFingerprint === undefined || !options.taskId) {
    try {
      contractArtifact = await readContract(target, packageRoot, options);
      if (contractFingerprint === undefined) contractFingerprint = contractArtifact.fingerprint;
    } catch (error) {
      if (error.code !== "ARTIFACT_MISSING") throw error;
    }
  }
  const value = contractFingerprint === undefined
    ? route
    : { ...route, contractFingerprint };
  assertRouteInvariants(value);
  const taskId = options.taskId ?? contractArtifact?.value?.taskId ?? null;
  if (taskId && !(await getTaskTransaction(target))) {
    return withTaskTransaction({ target, taskId, packageRoot, operation: "route" }, () => persistRouteInTransaction(target, route, packageRoot, { ...options, taskId }));
  }
  let existingState = null;
  if (taskId) {
    try {
      existingState = await readWorkState(target, { packageRoot, taskId });
    } catch {
      existingState = null;
    }
  }
  const relPath = options.routePath ?? options.routeFile ?? options.relativePath ?? (taskId ? taskArtifactPath(taskId, "route") : ARTIFACT_PATHS.route);
  const artifact = await writeJsonArtifact(
    target,
    relPath,
    value,
    "routing-result",
    packageRoot,
    writeOptions,
  );
  if (contractArtifact && contractArtifact.fingerprint === artifact.value.contractFingerprint) {
    await ensureResumableState({ target, packageRoot, contract: contractArtifact, route: artifact, taskId });
  }
  if (existingState?.phase === "ROUTED") {
    await synchronizePersistedRouteState({ target, packageRoot, taskId, route: artifact, contract: contractArtifact });
  }
  return artifact;
}

export async function readPersistedRoute(target, packageRoot, options = {}) {
  const relPath = options?.routePath ?? options?.routeFile ?? options?.relativePath ?? (options?.taskId ? taskArtifactPath(options.taskId, "route") : ARTIFACT_PATHS.route);
  const artifact = await readJsonArtifact(target, relPath, "routing-result", packageRoot);
  assertRouteInvariants(artifact.value);
  return artifact;
}
