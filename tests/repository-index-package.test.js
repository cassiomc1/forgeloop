import assert from "node:assert/strict";
import { test } from "node:test";

import { runNpm } from "../scripts/npm-command.mjs";

test("package metadata includes Repository Index runtime, manifest, docs, and verifier", () => {
  const listing = JSON.parse(runNpm(["pack", "--dry-run", "--json"], { encoding: "utf8" }))[0].files.map((entry) => entry.path);
  for (const required of [
    "src/repository-index/tgrep-manifest.json",
    "src/repository-index/search.js",
    "src/repository-index/readiness.js",
    "src/repository-index/server.js",
    "docs/REPOSITORY_INDEX.md",
    "benchmarks/repository-index/run-hot-path.mjs",
    "scripts/verify-tgrep-manifest.mjs",
  ]) assert.ok(listing.includes(required), required);
  assert.equal(listing.some((entry) => entry.startsWith(".forgeloop/repository-index/")), false);
});
