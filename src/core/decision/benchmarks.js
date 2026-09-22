import { canonicalFingerprint } from "../artifacts.js";
import { projectModelRoute } from "../model-router/router.js";

const SCENARIOS = Object.freeze([
  { id: "docs-only", input: { workType: "documentation" } },
  { id: "ordinary-code", input: { workType: "code", executableChange: true } },
  { id: "security-code", input: { workType: "code", risks: ["secrets"], executableChange: true } },
]);

export function runJevBenchmark() {
  const scenarios = SCENARIOS.map((scenario) => {
    const route = projectModelRoute({ input: scenario.input });
    return {
      id: scenario.id,
      floor: route.floor,
      resolved: route.resolved,
      jevCalls: 0,
      jevInputTokens: null,
      jevLatencyMs: null,
      jevCacheHits: 0,
      jevLowConfidenceEscalations: 0,
      mainModelCalls: null,
      mainModelInputTokens: null,
      mainModelOutputTokens: null,
      candidateContextItems: null,
      selectedContextItems: null,
      candidateChars: null,
      selectedChars: null,
      guideSectionsConsidered: null,
      guideSectionsLoaded: null,
      filesRead: null,
      repositorySearches: null,
      contextRefreshes: null,
      modelTurns: null,
      toolCalls: null,
      wallClockMs: null,
      verification: "NOT_MEASURED",
      quality: "NOT_MEASURED",
      fallback: true,
    };
  });
  const summary = {
    schemaVersion: 1,
    engine: "typesafe-jev",
    model: "jev-1.13.0",
    status: "OFFLINE_DETERMINISTIC_BASELINE",
    scenarios,
    metrics: {
      scenarioCount: scenarios.length,
      jevCalls: 0,
      jevInputTokens: null,
      jevLatencyMs: null,
      jevCacheHits: 0,
      jevLowConfidenceEscalations: 0,
      mainModelCalls: null,
      mainModelInputTokens: null,
      mainModelOutputTokens: null,
      candidateContextItems: null,
      selectedContextItems: null,
      candidateChars: null,
      selectedChars: null,
      guideSectionsConsidered: null,
      guideSectionsLoaded: null,
      filesRead: null,
      repositorySearches: null,
      contextRefreshes: null,
      modelTurns: null,
      toolCalls: null,
      wallClockMs: null,
      verification: "NOT_MEASURED",
      quality: "NOT_MEASURED",
      inputTokens: null,
      outputTokens: null,
      tokenReduction: null,
    },
  };
  return { ...summary, fingerprint: canonicalFingerprint(summary) };
}
