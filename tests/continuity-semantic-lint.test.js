import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createContinuity, writeContinuity } from "../src/core/continuity.js";
import { lintContinuity } from "../src/core/continuity-lint.js";
import { reconcileContinuity } from "../src/core/continuity-reconciliation.js";
import { canonicalFingerprint } from "../src/core/artifacts.js";
import { setupVerifyingTask } from "./helpers/durable-lifecycle.js";
import { createGitRepository } from "./helpers/git-fixture.js";
import { removeTempTree } from "./helpers/rm-safe.js";
import { getPackageRoot } from "../src/core/templates.js";
import { ensureFixtureTask } from "./helpers/native-storage-fixture.js";
import { taskArtifactPath } from "../src/core/task-paths.js";

const packageRoot = getPackageRoot();

test("continuity inspect hints recognize canonical SQLite artifacts without file mirrors", async (t) => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-continuity-native-lint-"));
  t.after(() => removeTempTree(target));
  const taskId = "task-lint-1";
  await ensureFixtureTask(target, taskId, packageRoot);
  const present = taskArtifactPath(taskId, "descriptor");
  const missing = taskArtifactPath(taskId, "state");
  const result = await lintContinuity({ target, continuity: continuity({ inspectFirst: [present, missing] }) });
  assert.deepEqual(result.findings.map(item => [item.code, item.field]), [["CONTINUITY_INSPECT_PATH_MISSING", "inspectFirst[1]"]]);
});

function continuity(overrides = {}) {
  return createContinuity({
    taskId: "task-lint-1",
    workStateFingerprint: "a".repeat(64),
    contractFingerprint: "b".repeat(64),
    phase: "EXECUTING",
    repositoryFingerprint: { branch: null, head: null },
    updatedAt: "2026-09-02T12:00:00.000Z",
    remainingWork: [],
    knownIssues: [],
    changedAreas: [],
    inspectFirst: [],
    ...overrides,
  });
}

test("clean schema-valid continuity passes lint without legacy text heuristics", async () => {
  const value = continuity({
    resumeNote: "TODO is part of the historical note; all tests pass is not evidence here.",
  });
  const result = await lintContinuity({ continuity: value, state: { completedSteps: [] } });

  assert.equal(result.status, "PASS");
  assert.deepEqual(result.findings, []);
});

test("lint warns when remaining work or focus is already completed", async () => {
  const value = continuity({
    currentFocus: { id: "implementation", summary: "Revisit implementation" },
    remainingWork: [{ id: "implementation", summary: "Revisit implementation" }],
  });
  const result = await lintContinuity({
    continuity: value,
    state: { completedSteps: ["implementation"] },
  });

  assert.equal(result.status, "WARN");
  assert.deepEqual(result.findings, [
    {
      code: "CONTINUITY_REMAINING_ALREADY_COMPLETED",
      severity: "WARN",
      field: "remainingWork[0]",
      itemId: "implementation",
    },
    {
      code: "CONTINUITY_FOCUS_ALREADY_COMPLETED",
      severity: "WARN",
      field: "currentFocus",
      itemId: "implementation",
    },
  ]);
});

test("lint warns when an item is assigned both remaining-work and known-issue roles", async () => {
  const value = continuity({
    remainingWork: [{ id: "provider-boundary", summary: "Finish provider boundary" }],
    knownIssues: [{ id: "provider-boundary", summary: "Provider boundary is incomplete" }],
  });
  const result = await lintContinuity({ continuity: value, state: { completedSteps: [] } });

  assert.equal(result.status, "WARN");
  assert.deepEqual(result.findings, [{
    code: "CONTINUITY_ITEM_ROLE_CONFLICT",
    severity: "WARN",
    field: "remainingWork[0]",
    itemId: "provider-boundary",
  }]);
});

test("lint warns for missing inspectFirst paths using target-contained checks", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-continuity-lint-"));
  try {
    await writeFile(path.join(target, "present.txt"), "present", "utf8");
    const result = await lintContinuity({
      target,
      continuity: continuity({ inspectFirst: ["present.txt", "missing.txt"] }),
      state: { completedSteps: [] },
    });

    assert.equal(result.status, "WARN");
    assert.deepEqual(result.findings, [{
      code: "CONTINUITY_INSPECT_PATH_MISSING",
      severity: "WARN",
      field: "inspectFirst[1]",
      itemId: null,
    }]);
  } finally {
    await rm(target, { recursive: true, force: true });
  }
});

test("empty operational hints produce informational lint without changing PASS status", async () => {
  const result = await lintContinuity({ continuity: continuity(), state: { completedSteps: [] } });

  assert.equal(result.status, "PASS");
  assert.deepEqual(result.findings, [{
    code: "CONTINUITY_EMPTY_HINT_SET",
    severity: "INFO",
    field: "continuity",
    itemId: null,
  }]);
});

test("lint does not mutate continuity and reconciliation classification ignores lint warnings", async () => {
  const value = continuity({
    remainingWork: [{ id: "implementation", summary: "Already completed" }],
  });
  const before = structuredClone(value);
  const result = await lintContinuity({ continuity: value, state: { completedSteps: ["implementation"] } });
  assert.deepEqual(value, before);
  assert.equal(result.status, "WARN");

  const target = await createGitRepository("forgeloop-lint-reconcile-");
  const taskId = "task-lint-reconcile";
  try {
    await setupVerifyingTask(target, packageRoot, { taskId });
    const { readWorkState } = await import("../src/core/work-state.js");
    const state = await readWorkState(target, { packageRoot, taskId });
    await writeContinuity(target, {
      remainingWork: [{ id: "implementation", summary: "Already completed" }],
      inspectFirst: ["src/index.js"],
    }, { taskId, packageRoot });

    const reconciled = await reconcileContinuity({ target, packageRoot, taskId });
    assert.equal(reconciled.classification, "FRESH");
    assert.equal(reconciled.lint.status, "WARN");
    assert.ok(reconciled.lint.findings.some((finding) => finding.code === "CONTINUITY_REMAINING_ALREADY_COMPLETED"));
    assert.equal(canonicalFingerprint(state), reconciled.continuity.workStateFingerprint);
  } finally {
    await removeTempTree(target);
  }
});
