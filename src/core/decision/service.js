import { canonicalFingerprint } from "../artifacts.js";
import { readConfig } from "../config.js";
import { appendProtocolEvent } from "../events.js";
import { withTaskTransaction } from "../transaction.js";
import { DECISION_DEFAULT_POLICY, PINNED_JEV_MODEL, SEMANTIC_DECISION_RECORDED_EVENT } from "./constants.js";
import { buildDecisionArtifact, decisionArtifactFingerprint, writeDecisionArtifact } from "./artifact.js";
import { decisionEventDetails } from "./events.js";
import { createTypesafeEngine } from "../../adapters/typesafe/engine.js";
import { normalizeDecisionPolicy, decisionPolicyFingerprint } from "./policy.js";
import { validateDecisionRequest } from "./request.js";

async function loadPolicy(target, packageRoot) {
  try { return normalizeDecisionPolicy((await readConfig(target, packageRoot)).decisionEngine); } catch { return normalizeDecisionPolicy(DECISION_DEFAULT_POLICY); }
}

export async function recordSemanticDecision({ target, packageRoot, taskId, decisionId, request, provider = null } = {}) {
  const policy = await loadPolicy(target, packageRoot);
  const validated = validateDecisionRequest({ ...request, taskId });
  const engine = provider ?? createTypesafeEngine({ policy });
  const result = await engine.evaluate(validated);
  const artifact = buildDecisionArtifact({
    taskId,
    decisionKind: validated.decisionKind,
    model: result.model ?? PINNED_JEV_MODEL,
    questionSetId: validated.questionSet.id,
    questionSetVersion: validated.questionSet.version,
    questionSetFingerprint: validated.questionSet.fingerprint,
    stateFingerprint: canonicalFingerprint(validated.state),
    policyVersion: policy.policyVersion,
    policyFingerprint: decisionPolicyFingerprint(policy),
    repositoryFingerprint: request.repositoryFingerprint,
    contractFingerprint: request.contractFingerprint,
    routeFingerprint: request.routeFingerprint,
    verificationCycle: request.verificationCycle,
    candidateSetFingerprint: request.candidateSetFingerprint,
    answers: result.answers,
    confidence: result.confidence ?? {},
    decision: request.decision ?? {},
    usage: result.usage,
    latencyMs: result.latencyMs ?? null,
  });
  return withTaskTransaction({ target, taskId, packageRoot, operation: "semantic-decision", recordCommitEvent: true }, async () => {
    await writeDecisionArtifact(target, taskId, decisionId, artifact, packageRoot, { taskId, operation: "semantic-decision" });
    const event = await appendProtocolEvent(target, { taskId, event: SEMANTIC_DECISION_RECORDED_EVENT, details: decisionEventDetails(artifact) }, packageRoot, { taskId });
    return { artifact, artifactFingerprint: decisionArtifactFingerprint(artifact), event, policy };
  });
}
