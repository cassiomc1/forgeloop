import { canonicalFingerprint } from "../artifacts.js";

function classify(test) {
  const signal = test.signals ?? {};
  if (signal.requiredBehavior) return { classification: "KEEP_REQUIRED", recommendation: "KEEP", protected: true };
  if (signal.security || signal.criticalPath) return { classification: "KEEP_RISK_GUARD", recommendation: "KEEP", protected: true };
  if (signal.publicApi) return { classification: "KEEP_UNIQUE", recommendation: "KEEP", protected: true };
  if (signal.integration) return { classification: "KEEP_DOCUMENTATION_VALUE", recommendation: "KEEP", protected: false };
  return { classification: "UNKNOWN", recommendation: "BLOCKED", protected: false };
}

export function buildTestUtilityArtifact({ taskId, inventory, semanticStatus = "NOT_REQUESTED" } = {}) {
  return {
    schemaVersion: 1,
    protocolVersion: 1,
    taskId,
    generatedAt: new Date().toISOString(),
    inventoryFingerprint: canonicalFingerprint(inventory),
    semanticStatus,
    tests: (inventory?.tests ?? []).map((test) => ({ ...test, ...classify(test) })),
  };
}

