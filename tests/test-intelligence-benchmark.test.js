import assert from "node:assert/strict";
import test from "node:test";
import { runTestIntelligenceBenchmark } from "../src/core/test-intelligence/benchmarks.js";

test("test-intelligence benchmark measures protected-test safety without deletion authority", () => {
  const result = runTestIntelligenceBenchmark();
  assert.equal(result.status, "OFFLINE_DETERMINISTIC_FIXTURE");
  assert.equal(result.deletionAuthority, false);
  assert.equal(result.metrics.safeToRemoveFalsePositiveRate, null);
  assert.equal(result.metrics.protectedTestFalsePositiveRate, 0);
  assert.equal(result.cases.find((item) => item.id === "semantic-duplicate").observed, "REDUNDANT_CANDIDATE");
  assert.match(result.fingerprint, /^[a-f0-9]{64}$/);
});
