import { canonicalFingerprint, readJsonArtifact, writeJsonArtifact } from "../artifacts.js";
import { taskDecisionPath } from "../task-paths.js";
import { assertSecretFree } from "../receipt.js";
import { DECISION_AUTHORITY, DECISION_EVIDENCE_AUTHORITY, DECISION_POLICY_VERSION, PINNED_JEV_MODEL } from "./constants.js";
import { DECISION_ERROR_CODES, decisionError } from "./errors.js";

export function buildDecisionArtifact(input = {}) {
  const artifact = {
    schemaVersion: 1,
    protocolVersion: 1,
    taskId: input.taskId,
    decisionKind: input.decisionKind,
    engine: "typesafe-jev",
    model: input.model ?? PINNED_JEV_MODEL,
    questionSetId: input.questionSetId,
    questionSetVersion: input.questionSetVersion ?? 1,
    questionSetFingerprint: input.questionSetFingerprint,
    policyVersion: input.policyVersion ?? DECISION_POLICY_VERSION,
    stateFingerprint: input.stateFingerprint,
    policyFingerprint: input.policyFingerprint,
    repositoryFingerprint: input.repositoryFingerprint ?? null,
    contractFingerprint: input.contractFingerprint ?? null,
    routeFingerprint: input.routeFingerprint ?? null,
    verificationCycle: input.verificationCycle ?? null,
    candidateSetFingerprint: input.candidateSetFingerprint ?? null,
    answers: input.answers ?? {},
    confidence: input.confidence ?? {},
    decision: input.decision ?? {},
    usage: input.usage ?? { inputTokens: null, outputTokens: null, reportedBy: "UNKNOWN" },
    latencyMs: input.latencyMs ?? null,
    authority: DECISION_AUTHORITY,
    evidenceAuthority: DECISION_EVIDENCE_AUTHORITY,
    lifecycleAuthority: false,
    completionAuthority: false,
    ownershipAuthority: false,
    installationAuthority: false,
    recordedAt: input.recordedAt ?? new Date().toISOString(),
  };
  assertSecretFree(artifact);
  if (artifact.model !== PINNED_JEV_MODEL || artifact.policyVersion === 0) throw decisionError(DECISION_ERROR_CODES.RESULT_INVALID, "Semantic decision artifact is not pinned.");
  return artifact;
}

export async function readDecisionArtifact(target, taskId, decisionId, packageRoot) {
  return readJsonArtifact(target, taskDecisionPath(taskId, decisionId), "semantic-decision", packageRoot);
}

export async function writeDecisionArtifact(target, taskId, decisionId, artifact, packageRoot, options = {}) {
  return writeJsonArtifact(target, taskDecisionPath(taskId, decisionId), artifact, "semantic-decision", packageRoot, { ...options, taskId, operation: "semantic-decision" });
}

export function decisionArtifactFingerprint(artifact) {
  return canonicalFingerprint(artifact);
}
