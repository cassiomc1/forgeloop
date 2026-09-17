import { assertRouteInvariants } from "./router.js";
import { ARTIFACT_PATHS, readJsonArtifact, writeJsonArtifact } from "./artifacts.js";
import { readContract } from "./contract.js";
import { ensureResumableState, synchronizePersistedRouteState } from "./resumability.js";
import { readWorkState } from "./work-state.js";
import { taskArtifactPath } from "./task-paths.js";

const REROUTE_SUPPORTED_PHASES = new Set(["CONTRACT_READY", "ROUTED"]);

function routeArtifactError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export async function persistRoute(target, route, packageRoot, options = {}) {
  assertRouteInvariants(route);
  const { contractFingerprint, ...writeOptions } = options;
  let contractArtifact = null;
  if (contractFingerprint === undefined) {
    try {
      contractArtifact = await readContract(target, packageRoot, options);
      contractFingerprint = contractArtifact.fingerprint;
    } catch (error) {
      if (error.code !== "ARTIFACT_MISSING") throw error;
    }
  }
  const value = contractFingerprint === undefined
    ? route
    : { ...route, contractFingerprint };
  assertRouteInvariants(value);
  const taskId = options.taskId ?? contractArtifact?.value?.taskId ?? null;
  let existingState = null;
  if (taskId) {
    try {
      existingState = await readWorkState(target, { packageRoot, taskId });
    } catch {
      existingState = null;
    }
  }
  if (existingState && !REROUTE_SUPPORTED_PHASES.has(existingState.phase)) {
    throw routeArtifactError(
      "E_ROUTE_PHASE_UNSUPPORTED",
      `Route replacement is not supported in phase ${existingState.phase}; checkpoint identity is preserved`,
    );
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
