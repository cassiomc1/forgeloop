#!/usr/bin/env node

import assert from "node:assert/strict";
import { classifyPaths } from "./ci-classify.mjs";

const scenarios = [
  {
    id: "README-only",
    paths: ["README.md"],
    expected: { docs: true, docs_only: true, repository_index: false, package: false, audit: false },
  },
  {
    id: "ordinary-JavaScript",
    paths: ["src/core/command-resolution.js"],
    expected: { docs: false, docs_only: false, repository_index: false, package: true, audit: true },
  },
  {
    id: "repository-index",
    paths: ["src/repository-index/search.js", "tests/repository-index-search.test.js"],
    expected: { docs: false, docs_only: false, repository_index: true, package: true, audit: false },
  },
  {
    id: "package-export",
    paths: ["package.json", "src/integration.d.ts"],
    expected: { docs: false, docs_only: false, repository_index: false, package: true, audit: false },
  },
  {
    id: "release-candidate",
    forceAll: true,
    paths: [],
    expected: { docs: true, docs_only: false, repository_index: true, package: true, audit: true, release: true },
  },
];

const results = scenarios.map((scenario) => {
  const actual = classifyPaths(scenario.paths, { forceAll: scenario.forceAll === true });
  for (const [key, value] of Object.entries(scenario.expected)) {
    assert.equal(actual[key], value, `${scenario.id}: ${key}`);
  }
  return {
    id: scenario.id,
    selected: Object.fromEntries(Object.keys(scenario.expected).map((key) => [key, actual[key]])),
  };
});

console.log(JSON.stringify({ status: "PASS", scenarios: results }, null, 2));
