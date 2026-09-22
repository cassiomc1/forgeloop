import { compileContext } from "../core/context-compiler/compiler.js";
import { normalizeContextCandidates } from "../core/context-compiler/candidates.js";
import { canonicalFingerprint } from "../core/artifacts.js";
import { resolveRequiredSemanticDecision } from "../core/decision/resolver.js";
import { readCurrentDecisionBindings } from "../core/decision/task-bindings.js";

export async function runContextPlan({ target, packageRoot, taskId, decisionId, profile = "balanced", candidates = [], mandatoryIds = [] } = {}) {
  if (target && taskId) {
    const normalized = normalizeContextCandidates(candidates);
    const candidateSetFingerprint = canonicalFingerprint(normalized.map((candidate) => ({
      id: candidate.id, sourceRef: candidate.sourceRef, summary: candidate.summary,
      required: candidate.required, mandatory: candidate.mandatory,
    })));
    const bindings = await readCurrentDecisionBindings(target, packageRoot, taskId, { candidateSetFingerprint });
    const decision = await resolveRequiredSemanticDecision({
      target, packageRoot, taskId, decisionId, decisionKind: "CONTEXT_PLAN", currentBindings: bindings,
    });
    return compileContext({ profile, candidates, mandatoryIds, semanticRanker: () => decision.decision?.rankedIds ?? [] });
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
