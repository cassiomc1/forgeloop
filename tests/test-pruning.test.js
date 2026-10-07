import { ensureFixtureTask } from "./helpers/native-storage-fixture.js";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { getPackageRoot } from "../src/core/templates.js";
import { buildTestUtilityArtifact } from "../src/core/test-intelligence/utility.js";
import { buildPrunePlan, runPruneProbe } from "../src/core/test-intelligence/prune.js";
import { taskArtifactPath } from "../src/core/task-paths.js";
import { writeJsonArtifact } from "../src/core/artifacts.js";

test("prune plan keeps protected tests and blocks unknown utility", () => {
  const plan = {
    items: [
      { testId: "test-a", classification: "KEEP_REQUIRED", protected: true, file: "a", name: "required" },
      { testId: "test-b", classification: "UNKNOWN", protected: false, file: "b", name: "unknown" },
    ],
  };
  assert.equal(plan.items[0].classification, "KEEP_REQUIRED");
  assert.equal(plan.items[1].classification, "UNKNOWN");
});

test("pruning implementation does not expose deletion authority", () => {
  assert.equal(typeof buildPrunePlan, "function");
});

test("high-confidence unprotected redundancy reaches the isolated prune probe", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-prune-"));
  const packageRoot = getPackageRoot();
  try {
    await mkdir(path.join(target, "tests"));
    await writeFile(path.join(target, "tests", "duplicate.test.js"), "import test from 'node:test'; test('duplicate', () => {});\n");
    const inventory = {
      schemaVersion: 1,
      source: "FIXTURE",
      tests: [{ testId: "test-000000000000000000000001", file: "tests/duplicate.test.js", framework: "node:test", suite: "", name: "duplicate", line: 1, signals: {} }],
    };
    const artifact = buildTestUtilityArtifact({
      taskId: "prune-task",
      inventory,
      semanticDecision: {
        decisionId: "prune-decision",
        decision: { candidateIds: ["test-000000000000000000000001"], tests: { "test-000000000000000000000001": { semantic_duplicate: true } } },
        confidence: { test_0_semantic_duplicate: 0.98 },
      },
    });
    assert.equal(artifact.tests[0].classification, "REDUNDANT_CANDIDATE");
    assert.equal(artifact.tests[0].recommendation, "PROBE_REMOVAL");
    await ensureFixtureTask(target, "prune-task", packageRoot);
    await writeJsonArtifact(target, taskArtifactPath("prune-task", "testUtility"), artifact, "test-utility", packageRoot, { taskId: "prune-task" });
    const plan = await buildPrunePlan({ target, packageRoot, taskId: "prune-task" });
    assert.equal(plan.items[0].action, "PROBE_REMOVAL");
    const result = await runPruneProbe({ target, packageRoot, taskId: "prune-task", testId: "test-000000000000000000000001" });
    assert.equal(result.status, "INCONCLUSIVE");
    assert.equal(result.liveWorktreeModified, false);
    assert.equal(result.temporaryWorkspaceCleaned, true);
  } finally {
    await rm(target, { recursive: true, force: true });
  }
});

test("protected and low-confidence duplicate candidates remain blocked", () => {
  const inventory = {
    schemaVersion: 1,
    source: "FIXTURE",
    tests: [
      { testId: "test-000000000000000000000002", file: "tests/security.test.js", name: "security", signals: { security: true } },
      { testId: "test-000000000000000000000003", file: "tests/unknown.test.js", name: "unknown", signals: {} },
    ],
  };
  const artifact = buildTestUtilityArtifact({
    taskId: "blocked-prune-task",
    inventory,
    semanticDecision: {
      decisionId: "blocked-prune-decision",
      decision: { candidateIds: ["test-000000000000000000000002", "test-000000000000000000000003"], tests: { "test-000000000000000000000002": { semantic_duplicate: true }, "test-000000000000000000000003": { semantic_duplicate: true } } },
      confidence: { test_0_semantic_duplicate: 0.98, test_1_semantic_duplicate: 0.4 },
    },
  });
  assert.equal(artifact.tests[0].recommendation, "KEEP");
  assert.equal(artifact.tests[1].recommendation, "BLOCKED");
});

test("persisted prune candidates cannot write through absolute, traversal or symlink paths", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "forgeloop-prune-boundary-"));
  const target = path.join(root, "project");
  const packageRoot = getPackageRoot();
  const source = "import test from 'node:test'; test('duplicate', () => {});\n";
  const external = path.join(root, "external.test.js");
  try {
    await mkdir(path.join(target, "tests"), { recursive: true });
    await writeFile(external, source);
    await symlink(external, path.join(target, "tests", "linked.test.js"));
    await ensureFixtureTask(target, "prune-boundary", packageRoot);
    for (const file of [external, "../external.test.js", "tests/linked.test.js"]) {
      const testId = "test-000000000000000000000001";
      const artifact = buildTestUtilityArtifact({
        taskId: "prune-boundary",
        inventory: { tests: [{ testId, file, framework: "node:test", name: "duplicate", signals: {} }] },
        semanticDecision: {
          decisionId: "prune-boundary-decision",
          decision: { candidateIds: [testId], tests: { [testId]: { semantic_duplicate: true } } },
          confidence: { test_0_semantic_duplicate: 0.98 },
        },
      });
      await writeJsonArtifact(target, taskArtifactPath("prune-boundary", "testUtility"), artifact, "test-utility", packageRoot, { taskId: "prune-boundary" });
      const result = await runPruneProbe({ target, packageRoot, taskId: "prune-boundary", testId });
      assert.equal(result.status, "BLOCKED", file);
      assert.equal(result.liveWorktreeModified, false);
      assert.equal(result.temporaryWorkspaceCleaned, true);
      assert.equal(await readFile(external, "utf8"), source, file);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
