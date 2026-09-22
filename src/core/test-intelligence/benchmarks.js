import { canonicalFingerprint } from "../artifacts.js";

const CASES = Object.freeze([
  { id: "protected-security", expected: "KEEP_RISK_GUARD", observed: "KEEP_RISK_GUARD", protected: true },
  { id: "protected-public-api", expected: "KEEP_UNIQUE", observed: "KEEP_UNIQUE", protected: true },
  { id: "semantic-duplicate", expected: "REDUNDANT_CANDIDATE", observed: "REDUNDANT_CANDIDATE", protected: false },
  { id: "unique-branch", expected: "KEEP_REQUIRED", observed: "KEEP_REQUIRED", protected: true },
  { id: "obsolete-test", expected: "OBSOLETE_CANDIDATE", observed: "UNKNOWN", protected: false },
  { id: "slow-required", expected: "KEEP_EXPENSIVE_BUT_REQUIRED", observed: "KEEP_REQUIRED", protected: true },
  { id: "flaky-low-signal", expected: "FLAKY_LOW_SIGNAL", observed: "UNKNOWN", protected: false },
]);

function precision(label) {
  const positives = CASES.filter((item) => item.expected === label);
  if (positives.length === 0) return null;
  return positives.filter((item) => item.observed === label).length / positives.length;
}

export function runTestIntelligenceBenchmark() {
  const protectedFalsePositives = CASES.filter((item) => item.protected && ["REDUNDANT_CANDIDATE", "OBSOLETE_CANDIDATE", "SAFE_TO_REMOVE"].includes(item.observed)).length;
  const summary = {
    schemaVersion: 1,
    status: "OFFLINE_DETERMINISTIC_FIXTURE",
    caseCount: CASES.length,
    metrics: {
      redundantCandidatePrecision: precision("REDUNDANT_CANDIDATE"),
      obsoleteCandidatePrecision: precision("OBSOLETE_CANDIDATE"),
      protectedTestFalsePositiveRate: protectedFalsePositives / CASES.filter((item) => item.protected).length,
      safeToRemoveFalsePositiveRate: 0,
      rewriteRecommendationPrecision: null,
    },
    deletionAuthority: false,
    cases: CASES,
  };
  return { ...summary, fingerprint: canonicalFingerprint(summary) };
}
