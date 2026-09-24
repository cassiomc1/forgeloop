import assert from "node:assert/strict";
import { test } from "node:test";

import {
  BENCHMARK_RUN_SETS,
  IGNORE_SENTINELS,
  REPOSITORY_ONLY_VISUALS,
  validateRepositoryHygiene,
} from "../scripts/check-repository-hygiene.mjs";

const manifest = {
  diagrams: [
    { html: "docs/assets/diagrams/example.html", svg: "docs/assets/diagrams/example.svg" },
  ],
};

function validInput(overrides = {}) {
  return {
    trackedPaths: [
      ".forgeloop/forgeloop.gitignore",
      "README.md",
      "docs/assets/diagrams/example.html",
      "docs/assets/diagrams/example.svg",
      "benchmarks/execution-profiles/results/raw/codex-repeat5-20260831/run.json",
    ],
    manifest,
    ignoredSentinels: IGNORE_SENTINELS,
    ...overrides,
  };
}

test("repository hygiene accepts the explicit repository policy", () => {
  const result = validateRepositoryHygiene(validInput());
  assert.deepEqual(result.errors, []);
});

test("repository hygiene rejects tracked ForgeLoop state", () => {
  const result = validateRepositoryHygiene(validInput({ trackedPaths: [".forgeloop/task-state/task/work-state.json"] }));
  assert.ok(result.errors.includes("REPOSITORY_HYGIENE_TRACKED_FORGELOOP_STATE: .forgeloop/task-state/task/work-state.json"));
});

test("repository hygiene rejects unexpected root documents", () => {
  const result = validateRepositoryHygiene(validInput({ trackedPaths: ["NEW_VALIDATION_REPORT.md"] }));
  assert.ok(result.errors.includes("REPOSITORY_HYGIENE_UNEXPECTED_ROOT_DOCUMENT: NEW_VALIDATION_REPORT.md"));
});

test("repository hygiene limits benchmark evidence to approved run sets", () => {
  const result = validateRepositoryHygiene(validInput({ trackedPaths: ["benchmarks/execution-profiles/results/raw/new-run/run.json"] }));
  assert.ok(result.errors.includes("REPOSITORY_HYGIENE_UNAPPROVED_BENCHMARK_RUN: new-run"));
  assert.equal(BENCHMARK_RUN_SETS.has("codex-repeat5-20260831"), true);
});

test("repository hygiene requires explicit visual ownership", () => {
  const result = validateRepositoryHygiene(validInput({ trackedPaths: ["docs/assets/unowned.svg"] }));
  assert.ok(result.errors.includes("REPOSITORY_HYGIENE_UNOWNED_VISUAL_ASSET: docs/assets/unowned.svg"));
  assert.deepEqual([...REPOSITORY_ONLY_VISUALS], [
    "docs/assets/forgeloop-architecture.svg",
    "docs/assets/forgeloop-lifecycle-animated.svg",
  ]);
});

test("repository hygiene rejects tracked scratch outputs and missing ignore coverage", () => {
  const result = validateRepositoryHygiene(validInput({
    trackedPaths: ["package-dry-run.json", "docs/assets/diagrams/.archify-render-example/file"],
    ignoredSentinels: [],
  }));
  assert.ok(result.errors.includes("REPOSITORY_HYGIENE_TRACKED_SCRATCH_PATH: package-dry-run.json"));
  assert.ok(result.errors.includes("REPOSITORY_HYGIENE_IGNORE_RULE_MISSING: coverage-data/example.json"));
});
