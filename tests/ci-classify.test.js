import assert from "node:assert/strict";
import { test } from "node:test";

import { classifyPaths } from "../scripts/ci-classify.mjs";

test("README-only changes select only documentation validation", () => {
  const result = classifyPaths(["README.md"]);
  assert.equal(result.docs, true);
  assert.equal(result.docs_only, true);
  assert.equal(result.repository_index, false);
  assert.equal(result.package, false);
  assert.equal(result.audit, false);
  assert.equal(result.node_compat, false);
});

test("source changes conservatively select package and audit validation", () => {
  const result = classifyPaths(["src/core/command-resolution.js"]);
  assert.equal(result.source, true);
  assert.equal(result.package, true);
  assert.equal(result.audit, true);
  assert.equal(result.docs_only, false);
});

test("Repository Index changes select the native matrix", () => {
  const result = classifyPaths(["src/repository-index/search.js"]);
  assert.equal(result.repository_index, true);
  assert.equal(result.package, true);
  assert.equal(result.node_compat, true);
});

test("package export changes do not select the native Repository Index matrix", () => {
  const result = classifyPaths(["package.json", "src/integration.d.ts"]);
  assert.equal(result.package, true);
  assert.equal(result.repository_index, false);
});

test("forced release classification selects every expensive gate", () => {
  const result = classifyPaths([], { forceAll: true });
  for (const key of ["docs", "repository_index", "package", "audit", "node_compat", "release"]) {
    assert.equal(result[key], true, key);
  }
  assert.equal(result.docs_only, false);
});
