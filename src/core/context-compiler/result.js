export function contextPlanResult({ profile, candidates, selected, omitted, mandatoryIds, promptInjectionIds, fingerprint, budget }) {
  return {
    schemaVersion: 1,
    protocolVersion: 1,
    profile,
    budget,
    candidateItems: candidates.length,
    selectedItems: selected.length,
    candidateChars: candidates.reduce((total, item) => total + item.chars, 0),
    selectedChars: selected.reduce((total, item) => total + item.chars, 0),
    selected,
    omitted,
    mandatoryIds,
    promptInjectionIds,
    tokenUsage: { inputTokens: null, outputTokens: null, reportedBy: "UNKNOWN" },
    decisionFingerprint: fingerprint,
    authority: "SEMANTIC_DECISION",
    evidenceAuthority: "NONE",
    lifecycleAuthority: false,
    completionAuthority: false,
  };
}
