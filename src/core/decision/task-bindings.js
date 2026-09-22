import { canonicalFingerprint } from "../artifacts.js";
import { readContract } from "../contract.js";
import { readPersistedRoute } from "../route-artifact.js";
import { readWorkState } from "../work-state.js";

export async function readCurrentDecisionBindings(target, packageRoot, taskId, { candidateSetFingerprint, policyFingerprint } = {}) {
  const state = await readWorkState(target, { packageRoot, taskId });
  let contract = null;
  let route = null;
  try { contract = await readContract(target, packageRoot, { taskId }); } catch (error) { if (error.code !== "ARTIFACT_MISSING") throw error; }
  try { route = await readPersistedRoute(target, packageRoot, { taskId }); } catch (error) { if (error.code !== "ARTIFACT_MISSING") throw error; }
  return {
    state,
    ...(state ? { stateFingerprint: canonicalFingerprint(state) } : {}),
    ...(state?.repositoryFingerprint ? { repositoryFingerprint: state.repositoryFingerprint } : {}),
    ...((contract?.fingerprint ?? state?.contractFingerprint) ? { contractFingerprint: contract?.fingerprint ?? state.contractFingerprint } : {}),
    ...((route?.fingerprint ?? state?.routeFingerprint) ? { routeFingerprint: route?.fingerprint ?? state.routeFingerprint } : {}),
    ...(state?.verificationCycle !== undefined ? { verificationCycle: state.verificationCycle } : {}),
    ...(candidateSetFingerprint !== undefined ? { candidateSetFingerprint } : {}),
    ...(policyFingerprint !== undefined ? { policyFingerprint } : {}),
  };
}
