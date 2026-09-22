import { canonicalFingerprint } from "../artifacts.js";

function classify(test) {
  const signal = test.signals ?? {};
  if (signal.requiredBehavior) return { classification: "KEEP_REQUIRED", recommendation: "KEEP", protected: true };
  if (signal.security) return { classification: "KEEP_RISK_GUARD", recommendation: "KEEP", protected: true };
  if (signal.criticalPath) return { classification: "KEEP_RECOVERY_INVARIANT", recommendation: "KEEP", protected: true };
  if (signal.migration) return { classification: "KEEP_MIGRATION_COMPATIBILITY", recommendation: "KEEP", protected: true };
  if (signal.publicApi) return { classification: "KEEP_UNIQUE", recommendation: "KEEP", protected: true };
  if (signal.release) return { classification: "KEEP_RELEASE_SMOKE", recommendation: "KEEP", protected: true };
  if (signal.platformSpecific) return { classification: "KEEP_PLATFORM_BEHAVIOR", recommendation: "KEEP", protected: true };
  if (signal.integration) return { classification: "KEEP_DOCUMENTATION_VALUE", recommendation: "KEEP", protected: false };
  return { classification: "UNKNOWN", recommendation: "BLOCKED", protected: false };
}

export function buildTestUtilityArtifact({ taskId, inventory, semanticStatus = "NOT_REQUESTED", semanticDecision = null } = {}) {
  return {
    schemaVersion: 1,
    protocolVersion: 1,
    taskId,
    generatedAt: new Date().toISOString(),
    inventoryFingerprint: canonicalFingerprint(inventory),
    semanticStatus: semanticDecision ? "PROVIDER_REPORTED" : semanticStatus,
    ...(semanticDecision ? {
      decisionId: semanticDecision.decisionId,
      semanticDecisionFingerprint: canonicalFingerprint(semanticDecision),
    } : {}),
    tests: (inventory?.tests ?? []).map((test) => ({ ...test, ...classify(test) })),
  };
}
