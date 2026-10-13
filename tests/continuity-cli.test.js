import { removeTempTree } from "./helpers/rm-safe.js";
import { ensureFixtureTask, readFixtureText, overwriteFixtureText } from "./helpers/native-storage-fixture.js";
import { taskArtifactPath } from "../src/core/task-paths.js";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { canonicalFingerprint } from "../src/core/artifacts.js";

test("continuity commands are flat CLI commands", async () => {
  const { COMMANDS, parseArgs } = await import("../src/cli.js");
  for (const command of ["continuity", "record-continuity", "reconcile-continuity", "clear-continuity"]) {
    assert.equal(COMMANDS.includes(command), true, command);
  }

  const parsed = parseArgs([
    "record-continuity",
    "--focus-id", "mobile-nav",
    "--focus-summary", "Finish mobile navigation",
    "--remaining", "contact:Finish contact form",
    "--known-issue", "overflow:Fix mobile overflow",
    "--changed-area", "src/components",
    "--inspect-first", "src/components/Header.jsx",
    "--resume-note", "Inspect the current diff before continuing",
    "--json",
  ]);
  assert.equal(parsed.command, "record-continuity");
  assert.equal(parsed.options.continuityFocusId, "mobile-nav");
  assert.equal(parsed.options.continuityRemaining.length, 1);
  assert.equal(parsed.options.continuityKnownIssues.length, 1);
  assert.deepEqual(parsed.options.continuityChangedAreas, ["src/components"]);
  assert.deepEqual(parsed.options.continuityInspectFirst, ["src/components/Header.jsx"]);
  assert.equal(parsed.options.json, true);
});

test("record-continuity rejects actor attempts to provide canonical identity fields", async () => {
  const { parseArgs } = await import("../src/cli.js");
  assert.throws(() => parseArgs(["record-continuity", "--task-id", "evil"]), /Unknown option|not valid/i);
  assert.throws(() => parseArgs(["record-continuity", "--phase", "COMPLETE"]), /Unknown option|not valid/i);
  assert.throws(() => parseArgs(["record-continuity", "--work-state-fingerprint", "f".repeat(64)]), /Unknown option|not valid/i);
});

test("record-continuity parses work-item flags and writes only operational context", async () => {
  const { runRecordContinuity } = await import("../src/commands/record-continuity.js");
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-continuity-cli-"));
  try {
    const contract = { schemaVersion: 1, protocolVersion: 1, taskId: "task-1", objective: "test" };
    const contractFingerprint = canonicalFingerprint(contract);
    const state = {
      schemaVersion: 1,
      protocolVersion: 1,
      taskId: "task-1",
      contractFingerprint,
      repositoryFingerprint: { branch: "main", head: "old" },
      phase: "EXECUTING",
      selectedGuides: [],
      completedSteps: ["planning"],
      pendingSteps: ["implementation"],
      requiredArtifacts: [],
      checks: [], failures: [], blockers: [], verificationEvidence: [],
      lastUpdated: "2026-08-16T16:00:00.000Z",
    };
    await ensureFixtureTask(target, "task-1", path.resolve("."));
    const result = await runRecordContinuity({
      target,
      packageRoot: path.resolve("."),
      taskId: "task-1",
      focusId: "mobile-nav",
      focusSummary: "Finish mobile navigation",
      remaining: ["contact:Finish contact form"],
      knownIssues: ["overflow:Fix mobile overflow"],
      changedAreas: ["src/components"],
      inspectFirst: ["src/components/Header.jsx"],
      resumeNote: "Inspect current diff",
      state,
      contract: { value: contract, fingerprint: contractFingerprint },
      repositoryFingerprint: { branch: "main", head: "new" },
      now: "2026-08-16T17:00:00.000Z",
    });
    assert.equal(result.value.currentFocus.id, "mobile-nav");
    assert.equal(result.value.remainingWork[0].id, "contact");
    assert.equal(result.value.knownIssues[0].id, "overflow");
    const stored = JSON.parse(await readFixtureText(target, taskArtifactPath("task-1", "continuity")));
    assert.equal(stored.taskId, "task-1");
    assert.equal(stored.phase, "EXECUTING");
  } finally {
    await removeTempTree(target);
  }
});

test("clear-continuity removes only the continuity artifact", async () => {
  const { createContinuity } = await import("../src/core/continuity.js");
  const { createWorkState, writeWorkState } = await import("../src/core/work-state.js");
  const { runClearContinuity } = await import("../src/commands/clear-continuity.js");
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-clear-continuity-"));
  const taskId = "clear-continuity-task";
  try {
    await ensureFixtureTask(target, taskId, path.resolve("."));
    const state = createWorkState({ taskId, phase: "PLANNED", contractFingerprint: "a".repeat(64) });
    await writeWorkState(target, state, { taskId });
    const continuity = createContinuity({ taskId, phase: state.phase, updatedAt: "2026-08-16T17:00:00.000Z",
      workStateFingerprint: canonicalFingerprint(state), contractFingerprint: state.contractFingerprint,
      repositoryFingerprint: { branch: null, head: null }, remainingWork: [], knownIssues: [], changedAreas: [], inspectFirst: [] });
    await overwriteFixtureText(target, taskArtifactPath(taskId, "continuity"), JSON.stringify(continuity));
    const stateBefore = await readFixtureText(target, taskArtifactPath(taskId, "state"));
    const result = await runClearContinuity({ target, taskId });
    assert.equal(result.removed, true);
    assert.equal(await readFixtureText(target, taskArtifactPath(taskId, "continuity")), null);
    assert.equal(await readFixtureText(target, taskArtifactPath(taskId, "state")), stateBefore);
  } finally {
    await removeTempTree(target);
  }
});
