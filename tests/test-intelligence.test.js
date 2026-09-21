import assert from "node:assert/strict";
import test from "node:test";
import { buildTestUtilityArtifact } from "../src/core/test-intelligence/utility.js";
import { inventoryTests } from "../src/core/test-intelligence/inventory.js";

test("test inventory produces stable IDs and deterministic ordering", async () => {
  const first = await inventoryTests(process.cwd());
  const second = await inventoryTests(process.cwd());
  assert.deepEqual(first, second);
  assert.ok(first.tests.length > 0);
  assert.match(first.tests[0].testId, /^test-[a-f0-9]{24}$/);
});

test("test utility protects protocol and security tests and blocks unknown utility", () => {
  const artifact = buildTestUtilityArtifact({
    taskId: "utility-task",
    inventory: { schemaVersion: 1, source: "DETERMINISTIC", tests: [
      { testId: "test-aaaaaaaaaaaaaaaaaaaaaaaa", file: "tests/security.test.js", framework: "node:test", suite: "", name: "rejects credentials", signals: { security: true } },
      { testId: "test-bbbbbbbbbbbbbbbbbbbbbbbb", file: "tests/other.test.js", framework: "node:test", suite: "", name: "small helper", signals: {} },
    ] },
  });
  assert.equal(artifact.tests[0].classification, "KEEP_RISK_GUARD");
  assert.equal(artifact.tests[0].protected, true);
  assert.equal(artifact.tests[1].classification, "UNKNOWN");
  assert.equal(artifact.tests[1].recommendation, "BLOCKED");
});

