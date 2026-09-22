import { canonicalFingerprint } from "../artifacts.js";
import { projectModelRoute } from "../model-router/router.js";
import { createTypesafeEngine } from "../../adapters/typesafe/engine.js";
import { getQuestionSet } from "./question-registry.js";
import { DECISION_DEFAULT_POLICY } from "./constants.js";

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

export async function runJevBenchmarkLive({ engine = null, policy = DECISION_DEFAULT_POLICY } = {}) {
  const resolvedEngine = engine ?? createTypesafeEngine({ policy });
  const started = Date.now();
  const scenarios = [];
  for (const scenario of SCENARIOS) {
    const questionSet = getQuestionSet(scenario.id === "docs-only" ? "intake-v1" : scenario.id === "security-code" ? "route-v1" : "context-v1");
    const result = await resolvedEngine.evaluate({
      taskId: `benchmark-${scenario.id}`,
      decisionKind: questionSet.decisionKind,
      questionSetId: questionSet.id,
      questionSet,
      state: { benchmark: true, input: scenario.input },
    });
    scenarios.push({ id: scenario.id, decisionKind: questionSet.decisionKind, jevCalls: 1, usage: result.usage ?? null, latencyMs: result.latencyMs ?? null, status: "PROVIDER_REPORTED" });
  }
  const summary = {
    schemaVersion: 1, engine: "typesafe-jev", model: "jev-1.13.0", status: "LIVE_PROVIDER_REPORTED", scenarios,
    metrics: { scenarioCount: scenarios.length, jevCalls: scenarios.length, inputTokens: scenarios.reduce((sum, item) => sum + (item.usage?.inputTokens ?? 0), 0), outputTokens: scenarios.reduce((sum, item) => sum + (item.usage?.outputTokens ?? 0), 0), wallClockMs: Date.now() - started, verification: "NOT_MEASURED", quality: "NOT_MEASURED" },
  };
  return { ...summary, fingerprint: canonicalFingerprint(summary) };
}
