import { canonicalFingerprint } from "../artifacts.js";
import { buildTestUtilityArtifact } from "./utility.js";

const FIXTURE_TESTS = Object.freeze([
  { testId: "protected-security", file: "tests/security.test.js", framework: "node:test", suite: "", name: "security", line: 1, signals: { security: true } },
  { testId: "protected-public-api", file: "tests/api.test.js", framework: "node:test", suite: "", name: "api", line: 1, signals: { publicApi: true } },
  { testId: "semantic-duplicate", file: "tests/duplicate.test.js", framework: "node:test", suite: "", name: "duplicate", line: 1, signals: {} },
  { testId: "unique-branch", file: "tests/required.test.js", framework: "node:test", suite: "", name: "required", line: 1, signals: { requiredBehavior: true } },
  { testId: "obsolete-test", file: "tests/obsolete.test.js", framework: "node:test", suite: "", name: "obsolete", line: 1, signals: {} },
  { testId: "slow-required", file: "tests/critical.test.js", framework: "node:test", suite: "", name: "critical", line: 1, signals: { criticalPath: true } },
  { testId: "flaky-low-signal", file: "tests/flaky.test.js", framework: "node:test", suite: "", name: "flaky", line: 1, signals: {} },
]);

const CASES = Object.freeze([
  { id: "protected-security", expected: "KEEP_RISK_GUARD", protected: true },
  { id: "protected-public-api", expected: "KEEP_UNIQUE", protected: true },
  { id: "semantic-duplicate", expected: "REDUNDANT_CANDIDATE", protected: false },
  { id: "unique-branch", expected: "KEEP_REQUIRED", protected: true },
  { id: "obsolete-test", expected: "OBSOLETE_CANDIDATE", protected: false },
  { id: "slow-required", expected: "KEEP_RECOVERY_INVARIANT", protected: true },
  { id: "flaky-low-signal", expected: "FLAKY_LOW_SIGNAL", protected: false },
]);

function precision(label) {
  const positives = CASES.filter((item) => item.expected === label);
  if (positives.length === 0) return null;
  return positives.filter((item) => item.observed === label).length / positives.length;
}

export function runTestIntelligenceBenchmark() {
  const decisions = { tests: {
    "semantic-duplicate": { semantic_duplicate: true },
    "obsolete-test": { likely_obsolete: true },
    "flaky-low-signal": { likely_flaky_low_signal: true },
  } };
  const observedTests = buildTestUtilityArtifact({ taskId: "benchmark", inventory: { schemaVersion: 1, source: "FIXTURE", tests: FIXTURE_TESTS }, semanticDecision: { decisionId: "benchmark-decision", decision: decisions, confidence: {} } }).tests;
  const cases = CASES.map((item) => ({ ...item, observed: observedTests.find((test) => test.testId === item.id)?.classification ?? "UNKNOWN" }));
  const protectedFalsePositives = cases.filter((item) => item.protected && ["REDUNDANT_CANDIDATE", "OBSOLETE_CANDIDATE", "SAFE_TO_REMOVE"].includes(item.observed)).length;
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
    cases,
  };
  return { ...summary, fingerprint: canonicalFingerprint(summary) };
}
