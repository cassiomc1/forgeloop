import { compileContext } from "../core/context-compiler/compiler.js";

export async function runContextPlan({ profile = "balanced", candidates = [], mandatoryIds = [] } = {}) {
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
