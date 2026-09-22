import { canonicalFingerprint } from "../artifacts.js";
import { readContract } from "../contract.js";
import { readPersistedRoute } from "../route-artifact.js";
import { readWorkState } from "../work-state.js";

async function readOptionalArtifact(reader) {
  try {
    return await reader();
  } catch (error) {
    if (error.code === "ARTIFACT_MISSING") return null;
    throw error;
  }
}

export async function readCurrentDecisionBindings(target, packageRoot, taskId, { candidateSetFingerprint, policyFingerprint } = {}) {
  const state = await readWorkState(target, { packageRoot, taskId });
  const contract = await readOptionalArtifact(() => readContract(target, packageRoot, { taskId }));
  const route = await readOptionalArtifact(() => readPersistedRoute(target, packageRoot, { taskId }));
  return {
    state,
    ...(state ? { stateFingerprint: canonicalFingerprint(state) } : {}),
    ...(state ? { taskStateFingerprint: canonicalFingerprint(state) } : {}),
    ...(state?.repositoryFingerprint ? { repositoryFingerprint: state.repositoryFingerprint } : {}),
    ...((contract?.fingerprint ?? state?.contractFingerprint) ? { contractFingerprint: contract?.fingerprint ?? state.contractFingerprint } : {}),
    ...((route?.fingerprint ?? state?.routeFingerprint) ? { routeFingerprint: route?.fingerprint ?? state.routeFingerprint } : {}),
    ...(state?.verificationCycle !== undefined ? { verificationCycle: state.verificationCycle } : {}),
    ...(candidateSetFingerprint !== undefined ? { candidateSetFingerprint } : {}),
    ...(policyFingerprint !== undefined ? { policyFingerprint } : {}),
  };
}
