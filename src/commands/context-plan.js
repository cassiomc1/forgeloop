import { compileContext } from "../core/context-compiler/compiler.js";
import { normalizeContextCandidates } from "../core/context-compiler/candidates.js";
import { canonicalFingerprint } from "../core/artifacts.js";
import { buildContextQuestionSet } from "../core/decision/question-registry.js";
import { ensureSemanticDecision } from "../core/decision/service.js";

export async function runContextPlan({ target, packageRoot, taskId, decisionId, profile = "balanced", candidates = [], mandatoryIds = [], provider = null, readOnly = false } = {}) {
  if (readOnly) return compileContext({ profile, candidates, mandatoryIds });
  if (target && taskId) {
    const normalized = normalizeContextCandidates(candidates);
    const candidateSetFingerprint = canonicalFingerprint(normalized.map((candidate) => ({
      id: candidate.id, sourceRef: candidate.sourceRef, summary: candidate.summary,
      required: candidate.required, mandatory: candidate.mandatory,
    })));
    const questionSet = buildContextQuestionSet(normalized);
    const decision = await ensureSemanticDecision({
      target, packageRoot, taskId, decisionId, provider, allowNetwork: !readOnly,
      request: {
        decisionKind: "CONTEXT_PLAN", questionSetId: questionSet.id, questionSet,
        state: { candidates: normalized.map(({ id, sourceRef, kind, summary, required, mandatory, risk, trust }) => ({ id, sourceRef, kind, summary, required, mandatory, risk, trust })) },
        candidateIds: normalized.map((candidate) => candidate.id), candidateSetFingerprint,
      },
    });
    return compileContext({ profile, candidates, mandatoryIds, semanticRanker: () => ({ rankedIds: decision.artifact.decision?.rankedIds ?? [], excludedIds: decision.artifact.decision?.excludedIds ?? [] }) });
  }
  return compileContext({ profile, candidates, mandatoryIds });
}

export function formatContextPlanResult(result) {
  return [
    `Context plan: ${result.selectedItems}/${result.candidateItems} items`,
    `Profile: ${result.profile}`,
    `Selected chars: ${result.selectedChars}/${result.budget.maxChars}`,
    `Prompt-injection candidates: ${result.promptInjectionIds.length}`,
    `Fingerprint: ${result.decisionFingerprint}`,
    "",
  ].join("\n");
}
