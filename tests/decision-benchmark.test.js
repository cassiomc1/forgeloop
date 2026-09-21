import assert from "node:assert/strict";
import test from "node:test";
import { runJevBenchmark } from "../src/core/decision/benchmarks.js";

test("Jev benchmark baseline is deterministic and does not invent telemetry", () => {
  const first = runJevBenchmark();
  const second = runJevBenchmark();
  assert.deepEqual(first, second);
  assert.equal(first.status, "OFFLINE_DETERMINISTIC_BASELINE");
  assert.equal(first.metrics.inputTokens, null);
  assert.equal(first.metrics.outputTokens, null);
  assert.equal(first.scenarios.length, 3);
});

