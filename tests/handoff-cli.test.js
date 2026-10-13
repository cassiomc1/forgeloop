import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

import { parseArgs } from "../src/cli.js";
import { executeForgeLoopCommand } from "../src/core/command-runtime.js";
import { runHandoffCreate } from "../src/commands/handoff-create.js";
import { runHandoffList } from "../src/commands/handoff-list.js";
import { runHandoffShow } from "../src/commands/handoff-show.js";
import { formatHandoffAcceptResult } from "../src/commands/handoff-accept.js";
import { validateLedgerEvents } from "../src/core/events.js";
import { getPackageRoot } from "../src/core/templates.js";
import { checkStorageIntegrity, listEvents, openStorageDatabase } from "../src/storage/index.js";
import { setupVerifyingTask } from "./helpers/durable-lifecycle.js";
import { createGitRepository } from "./helpers/git-fixture.js";
import { removeTempTree } from "./helpers/rm-safe.js";

const packageRoot = getPackageRoot();

test("handoff CLI parser and commands expose immutable protocol snapshots", async () => {
  const parsed = parseArgs(["handoff-create", "--task", "handoff-cli-001", "--recipient", "reviewer", "--note", "Inspect source", "--json"]);
  assert.equal(parsed.options.recipientHint, "reviewer");
  assert.equal(parsed.options.handoffNote, "Inspect source");

  const target = await createGitRepository("forgeloop-handoff-cli-");
  try {
    await setupVerifyingTask(target, packageRoot, { taskId: "handoff-cli-001" });
    const created = await runHandoffCreate({
      target,
      packageRoot,
      taskId: "handoff-cli-001",
      recipientHint: "reviewer",
      handoffNote: "Inspect source",
    });
    const list = await runHandoffList({ target, packageRoot, taskId: "handoff-cli-001" });
    const shown = await runHandoffShow({ target, packageRoot, taskId: "handoff-cli-001", handoffId: created.handoff.handoffId });
    assert.equal(list.count, 1);
    assert.equal(shown.fingerprint, created.fingerprint);
    assert.equal(shown.handoff.intent.recipientHint, "reviewer");
    assert.equal(shown.acceptance.status, "OPEN");
    assert.equal(list.handoffs[0].acceptance.status, "OPEN");
  } finally {
    await removeTempTree(target);
  }
});

test("handoff-accept CLI parser and executor accept handoff and update inspection state", async () => {
  const parsed = parseArgs([
    "handoff-accept",
    "--task", "handoff-cli-002",
    "--handoff", "handoff-002",
    "--consumer-id", "agent-codex",
    "--harness", "codex",
    "--json",
  ]);
  assert.equal(parsed.options.taskId, "handoff-cli-002");
  assert.equal(parsed.options.handoffId, "handoff-002");
  assert.equal(parsed.options.consumerId, "agent-codex");
  assert.equal(parsed.options.harness, "codex");
  assert.equal(parsed.options.json, true);

  const target = await createGitRepository("forgeloop-handoff-accept-cli-");
  try {
    await setupVerifyingTask(target, packageRoot, { taskId: "handoff-cli-002" });
    const { runHandoffAccept } = await import("../src/commands/handoff-accept.js");
    const created = await runHandoffCreate({
      target,
      packageRoot,
      taskId: "handoff-cli-002",
      handoffId: "handoff-002",
      recipientHint: "agent-codex",
      handoffNote: "Resume work",
    });

    const acceptRes = await runHandoffAccept({
      target,
      packageRoot,
      taskId: "handoff-cli-002",
      handoffId: created.handoff.handoffId,
      consumerId: "agent-codex",
      harness: "codex",
    });

    assert.equal(acceptRes.accepted, true);
    assert.equal(acceptRes.consumerId, "agent-codex");
    assert.equal(acceptRes.harness, "codex");
    assert.equal(formatHandoffAcceptResult(acceptRes), [
      `FORGELOOP HANDOFF ACCEPTED: ${created.handoff.handoffId}`,
      "consumer: agent-codex",
      "harness: codex",
      `at: ${acceptRes.acceptedAt}`,
      "idempotent: no",
      "authority: OPERATIONAL_RECEIPT_ONLY",
      "evidence: NONE",
      "claims transferred: NO",
      "",
    ].join("\n"));

    const shown = await runHandoffShow({
      target,
      packageRoot,
      taskId: "handoff-cli-002",
      handoffId: created.handoff.handoffId,
    });
    assert.equal(shown.acceptance.status, "ACCEPTED");
    assert.equal(shown.acceptance.consumerId, "agent-codex");
    assert.equal(shown.acceptance.harness, "codex");

    const list = await runHandoffList({
      target,
      packageRoot,
      taskId: "handoff-cli-002",
    });
    assert.equal(list.handoffs[0].acceptance.status, "ACCEPTED");

    const { appendProtocolEvent } = await import("../src/core/events.js");
    await appendProtocolEvent(target, {
      taskId: "handoff-cli-002",
      event: "HANDOFF_ACCEPTED",
      details: {
        handoffId: created.handoff.handoffId,
        handoffDigest: created.handoff.artifactDigest,
        consumerId: "second-consumer",
      },
    }, packageRoot, { taskId: "handoff-cli-002" });

    const inconsistentList = await runHandoffList({ target, packageRoot, taskId: "handoff-cli-002" });
    const inconsistentShow = await runHandoffShow({
      target,
      packageRoot,
      taskId: "handoff-cli-002",
      handoffId: created.handoff.handoffId,
    });
    assert.equal(inconsistentList.handoffs[0].acceptance.status, "INCONSISTENT");
    assert.equal(inconsistentShow.acceptance.status, "INCONSISTENT");
    assert.ok(inconsistentShow.acceptance.reasonCodes.includes("E_HANDOFF_ALREADY_ACCEPTED"));
  } finally {
    await removeTempTree(target);
  }
});

test("public handoff lifecycle persists canonical SQLite evidence without legacy operational files", async () => {
  const taskId = "handoff-public-native-001";
  const target = await createGitRepository("forgeloop-handoff-public-native-");
  try {
    await setupVerifyingTask(target, packageRoot, { taskId });

    const created = await executeForgeLoopCommand({
      command: "handoff-create",
      projectPath: target,
      input: {
        taskId,
        recipientHint: "reviewer",
        handoffNote: "Inspect the canonical evidence",
      },
    });
    assert.equal(created.ok, true, JSON.stringify(created));
    const handoffId = created.result.handoff.handoffId;

    const accepted = await executeForgeLoopCommand({
      command: "handoff-accept",
      projectPath: target,
      input: {
        taskId,
        handoffId,
        consumerId: "agent-codex",
        harness: "codex",
      },
    });
    assert.equal(accepted.ok, true, JSON.stringify(accepted));
    assert.equal(accepted.result.accepted, true);
    assert.equal(accepted.result.idempotent, false);

    const db = openStorageDatabase(path.join(target, ".forgeloop/state.sqlite"), { readOnly: true });
    try {
      const artifact = db.prepare(
        "SELECT payload_json FROM task_artifacts WHERE task_id = ? AND kind = 'handoff' AND artifact_id = ?",
      ).get(taskId, handoffId);
      assert.ok(artifact, "public handoff creation must retain its canonical artifact");
      assert.equal(JSON.parse(artifact.payload_json).artifactDigest, created.result.handoff.artifactDigest);

      const events = listEvents(db, taskId);
      const createdEvents = events.filter((event) => event.event === "HANDOFF_CREATED");
      const acceptedEvents = events.filter((event) => event.event === "HANDOFF_ACCEPTED");
      assert.equal(createdEvents.length, 1);
      assert.equal(createdEvents[0].details.handoffId, handoffId);
      assert.equal(acceptedEvents.length, 1);
      assert.deepEqual(acceptedEvents[0].details, {
        handoffId,
        handoffDigest: created.result.handoff.artifactDigest,
        consumerId: "agent-codex",
        harness: "codex",
      });
      assert.equal(validateLedgerEvents(events).valid, true);
      assert.equal(checkStorageIntegrity(db).ok, true);
    } finally {
      db.close();
    }

    for (const relative of [
      ".forgeloop/task-state",
      ".forgeloop/events.ndjson",
      ".forgeloop/sessions",
      ".forgeloop/session.json",
      ".forgeloop/.txn",
    ]) {
      await assert.rejects(access(path.join(target, relative)), { code: "ENOENT" });
    }
  } finally {
    await removeTempTree(target);
  }
});
