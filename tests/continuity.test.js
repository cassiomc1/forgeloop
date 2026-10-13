import { removeTempTree } from "./helpers/rm-safe.js";
import { ensureFixtureTask, readFixtureText } from "./helpers/native-storage-fixture.js";
import { taskArtifactPath } from "../src/core/task-paths.js";
import assert from "node:assert/strict";
import { access, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { ARTIFACT_PATHS } from "../src/core/artifacts.js";
import { SHIPPED_SCHEMA_NAMES } from "../src/core/schema-validation.js";

test("continuity is a shipped ForgeLoop artifact and schema", async () => {
  assert.equal(ARTIFACT_PATHS.continuity, ".forgeloop/continuity.json");
  assert.equal(SHIPPED_SCHEMA_NAMES.includes("continuity"), true);
  await access(path.resolve("schemas/continuity.schema.json"));
});

test("continuity model owns granular resume context, not lifecycle progress", async () => {
  const { createContinuity } = await import("../src/core/continuity.js");
  const value = createContinuity({
    taskId: "task-1",
    workStateFingerprint: "a".repeat(64),
    contractFingerprint: "b".repeat(64),
    phase: "EXECUTING",
    repositoryFingerprint: { branch: "main", head: "abc" },
    updatedAt: "2026-08-16T17:00:00.000Z",
    currentFocus: { id: "mobile-nav", summary: "Finish mobile navigation" },
    remainingWork: [{ id: "contact", summary: "Implement contact form" }],
    knownIssues: [],
    changedAreas: ["src/components"],
    inspectFirst: ["src/components/Header.jsx"],
  });

  assert.equal("completedSteps" in value, false);
  assert.equal("pendingSteps" in value, false);
  assert.equal("status" in value, false);
  assert.equal(value.currentFocus.id, "mobile-nav");
  assert.equal(value.remainingWork[0].id, "contact");
});

test("continuity rejects traversal, absolute paths, oversized summaries, and secrets", async () => {
  const { createContinuity } = await import("../src/core/continuity.js");
  const base = {
    taskId: "task-1",
    workStateFingerprint: "a".repeat(64),
    contractFingerprint: "b".repeat(64),
    phase: "EXECUTING",
    repositoryFingerprint: { branch: null, head: null },
    updatedAt: "2026-08-16T17:00:00.000Z",
    remainingWork: [],
    knownIssues: [],
    changedAreas: [],
    inspectFirst: [],
  };

  assert.throws(() => createContinuity({ ...base, inspectFirst: ["../secret"] }), /relative|escape|path/i);
  assert.throws(() => createContinuity({ ...base, inspectFirst: ["C:\\Windows\\secret.txt"] }), /relative|absolute|path/i);
  assert.throws(() => createContinuity({ ...base, resumeNote: "x".repeat(2001) }), /2000|length|resumeNote/i);
  assert.throws(() => createContinuity({ ...base, resumeNote: "token: ghp-abcdefghijk" }), /secret/i);
});


test("recording continuity derives canonical bindings and ignores actor identity fields", async () => {
  const { canonicalFingerprint } = await import("../src/core/artifacts.js");
  const { writeContinuity } = await import("../src/core/continuity.js");
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-continuity-"));
  try {
    const contract = { schemaVersion: 1, protocolVersion: 1, taskId: "task-real", objective: "test" };
    const contractFingerprint = canonicalFingerprint(contract);
    const state = {
      schemaVersion: 1,
      protocolVersion: 1,
      taskId: "task-real",
      contractFingerprint,
      repositoryFingerprint: { branch: "main", head: "old" },
      phase: "EXECUTING",
      selectedGuides: [],
      completedSteps: ["planning"],
      pendingSteps: ["implementation", "verification"],
      requiredArtifacts: [],
      checks: [],
      failures: [],
      blockers: [],
      verificationEvidence: [],
      lastUpdated: "2026-08-16T16:00:00.000Z",
    };

    await ensureFixtureTask(target, "task-real", path.resolve("."));
    await writeContinuity(target, {
      taskId: "actor-cannot-replace-task",
      phase: "COMPLETE",
      workStateFingerprint: "f".repeat(64),
      contractFingerprint: "e".repeat(64),
      currentFocus: { id: "header", summary: "Finish header" },
      remainingWork: [{ id: "contact", summary: "Finish contact form" }],
      knownIssues: [],
      changedAreas: ["src"],
      inspectFirst: ["src/header.js"],
    }, {
      packageRoot: path.resolve("."),
      taskId: "task-real",
      state,
      contract: { value: contract, fingerprint: contractFingerprint },
      repositoryFingerprint: { branch: "main", head: "new" },
      now: "2026-08-16T17:00:00.000Z",
    });

    const stored = JSON.parse(await readFixtureText(target, taskArtifactPath("task-real", "continuity")));
    assert.equal(stored.taskId, "task-real");
    assert.equal(stored.phase, "EXECUTING");
    assert.equal(stored.contractFingerprint, contractFingerprint);
    assert.equal(stored.workStateFingerprint, canonicalFingerprint(state));
    assert.deepEqual(stored.repositoryFingerprint, { branch: "main", head: "new" });
    assert.equal(stored.currentFocus.id, "header");
  } finally {
    await removeTempTree(target);
  }
});

test("continuity schema is installed into target kits", async () => {
  const { TEMPLATE_PATHS } = await import("../src/core/templates.js");
  assert.equal(TEMPLATE_PATHS.includes("schemas/continuity.schema.json"), true);
});

test("continuity reason codes are part of the protocol failure vocabulary", async () => {
  const { FAILURE_CODES } = await import("../src/core/protocol.js");
  for (const code of [
    "E_CONTINUITY_INVALID",
    "E_CONTINUITY_SCHEMA_UNSUPPORTED",
    "E_CONTINUITY_STATE_MISSING",
    "E_CONTINUITY_TASK_MISMATCH",
    "E_CONTINUITY_CONTRACT_MISMATCH",
    "E_CONTINUITY_PHASE_MISMATCH",
    "E_CONTINUITY_RECONCILIATION_REQUIRED",
  ]) assert.equal(FAILURE_CODES.includes(code), true, code);
});
