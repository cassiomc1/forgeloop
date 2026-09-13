import assert from "node:assert/strict";
import { test } from "node:test";

import { validateDependencyPolicy } from "../scripts/check-dependency-policy.mjs";

test("dependency policy allows the approved runtime parser and development tooling", () => {
  const result = validateDependencyPolicy({
    dependencies: { "smol-toml": "1.8.0" },
    devDependencies: {
      eslint: "^9.0.0",
      c8: "^12.0.0",
    },
  });

  assert.deepEqual(result, { ok: true, violations: [] });
});

test("dependency policy rejects runtime and unapproved development dependencies", () => {
  const result = validateDependencyPolicy({
    dependencies: { chalk: "^5.0.0" },
    devDependencies: { eslint: "^9.0.0", leftpad: "^1.3.0" },
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.violations, [
    "dependencies:chalk",
    "devDependencies:leftpad",
  ]);
});

test("dependency policy accepts the approved production parser dependency", () => {
  const packageJson = {
    dependencies: { "smol-toml": "1.8.0" },
    devDependencies: { eslint: "^9.0.0", c8: "^12.0.0" },
  };
  const result = validateDependencyPolicy(packageJson);
  assert.equal(result.ok, true);
  assert.deepEqual(result.violations, []);
});
