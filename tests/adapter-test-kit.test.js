import assert from "node:assert/strict";
import test from "node:test";

import { runAdapterTestKit } from "../conformance/adapter-test-kit.mjs";

test("adapter test kit reports supported outcomes and explicit unavailable capabilities", async () => {
  const result = await runAdapterTestKit();
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.summary.failed, 0);
  assert.equal(result.results.find((item) => item.scenario === "cross-harness-resume").status, "PASS");
  assert.equal(result.results.find((item) => item.scenario === "policy-drift").status, "UNAVAILABLE");
});

test("adapter test kit rejects a nonconforming executor instead of fabricating success", async () => {
  const result = await runAdapterTestKit({ executor: async () => ({ ok: true, result: {} }) });
  assert.ok(result.summary.failed > 0);
  assert.ok(result.results.some((item) => item.status === "FAIL"));
});
