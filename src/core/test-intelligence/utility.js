import { canonicalFingerprint } from "../artifacts.js";

function classify(test, judgment = null, confidence = 1) {
  const signal = test.signals ?? {};
  if (signal.requiredBehavior) return { classification: "KEEP_REQUIRED", recommendation: "KEEP", protected: true };
  if (signal.security) return { classification: "KEEP_RISK_GUARD", recommendation: "KEEP", protected: true };
  if (signal.criticalPath) return { classification: "KEEP_RECOVERY_INVARIANT", recommendation: "KEEP", protected: true };
  if (signal.migration) return { classification: "KEEP_MIGRATION_COMPATIBILITY", recommendation: "KEEP", protected: true };
  if (signal.publicApi) return { classification: "KEEP_UNIQUE", recommendation: "KEEP", protected: true };
  if (signal.release) return { classification: "KEEP_RELEASE_SMOKE", recommendation: "KEEP", protected: true };
  if (signal.platformSpecific) return { classification: "KEEP_PLATFORM_BEHAVIOR", recommendation: "KEEP", protected: true };
  if (signal.integration) return { classification: "KEEP_INTEGRATION_GUARD", recommendation: "KEEP", protected: true };
  if (!judgment || confidence < 0.75) return { classification: "UNKNOWN", recommendation: "BLOCKED", protected: false };
  if (judgment.semantic_duplicate) return { classification: "REDUNDANT_CANDIDATE", recommendation: "BLOCKED", protected: false };
  if (judgment.likely_obsolete) return { classification: "OBSOLETE_CANDIDATE", recommendation: "BLOCKED", protected: false };
  if (judgment.likely_flaky_low_signal) return { classification: "FLAKY_LOW_SIGNAL", recommendation: "BLOCKED", protected: false };
  if (judgment.expensive_relative_to_signal) return { classification: "EXPENSIVE_LOW_SIGNAL", recommendation: "BLOCKED", protected: false };
  if (judgment.documentation_value) return { classification: "KEEP_DOCUMENTATION_VALUE", recommendation: "KEEP", protected: false };
  if (judgment.integration_value) return { classification: "KEEP_INTEGRATION_GUARD", recommendation: "KEEP", protected: true };
  if (judgment.has_unique_semantic_intent) return { classification: "KEEP_UNIQUE", recommendation: "KEEP", protected: false };
  return { classification: "UNKNOWN", recommendation: "BLOCKED", protected: false };
}

export function buildTestUtilityArtifact({ taskId, inventory, semanticStatus = "NOT_REQUESTED", semanticDecision = null, semanticDecisions = [] } = {}) {
  const decisions = semanticDecisions.length > 0 ? semanticDecisions : (semanticDecision ? [semanticDecision] : []);
  const byTest = new Map(decisions.flatMap((decision) => Object.entries(decision.decision?.tests ?? {}).map(([testId, judgment]) => [testId, {
    judgment, confidence: Math.min(...Object.keys(judgment).map((key) => decision.confidence?.[`test_${(decision.decision.candidateIds ?? []).indexOf(testId)}_${key}`] ?? 1)),
  }])));
  return {
    schemaVersion: 1,
    protocolVersion: 1,
    taskId,
    generatedAt: new Date().toISOString(),
    inventoryFingerprint: canonicalFingerprint(inventory),
    semanticStatus: decisions.length > 0 ? "PROVIDER_REPORTED" : semanticStatus,
    ...(decisions.length > 0 ? {
      ...(decisions.length === 1 ? { decisionId: decisions[0].decisionId, semanticDecisionFingerprint: canonicalFingerprint(decisions[0]) } : {}),
      decisionIds: decisions.map((decision) => decision.decisionId),
      semanticDecisionFingerprints: decisions.map((decision) => canonicalFingerprint(decision)),
    } : {}),
    tests: (inventory?.tests ?? []).map((test) => ({ ...test, ...classify(test, byTest.get(test.testId)?.judgment, byTest.get(test.testId)?.confidence ?? 0) })),
  };
}
