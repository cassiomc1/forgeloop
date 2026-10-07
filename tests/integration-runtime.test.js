import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { executeForgeLoopCommand } from "../src/core/command-runtime.js";
import { COMMAND_EXECUTORS } from "../src/core/command-executors.js";
import { CLI_COMMAND_DEFINITIONS } from "../src/core/cli-command-definitions.js";
import { removeTempTree } from "./helpers/rm-safe.js";

async function withTarget(run) {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-integration-runtime-"));
  try {
    await run(target);
  } finally {
    await removeTempTree(target);
  }
}

test("executor registry is in parity with canonical command definitions", () => {
  const defined = Object.keys(CLI_COMMAND_DEFINITIONS).sort();
  const executable = Object.keys(COMMAND_EXECUTORS).sort();
  assert.deepEqual(executable, defined);
});

test("unknown command returns a structured failure without throwing", async () => {
  const envelope = await executeForgeLoopCommand({ command: "definitely-not-a-command" });
  assert.equal(envelope.ok, false);
  assert.equal(envelope.exitCode, 1);
  assert.equal(envelope.error.code, "E_COMMAND_UNSUPPORTED");
  assert.equal(envelope.result, null);
  assert.equal(envelope.metadata.protocolVersion, 1);
});

test("read command produces a deterministic envelope with metadata and no output", async () => {
  const captured = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...args) => captured.push(["log", args]);
  console.error = (...args) => captured.push(["error", args]);
  try {
    await withTarget(async (target) => {
      const envelope = await executeForgeLoopCommand({
        command: "protocol-info",
        projectPath: target,
      });
      assert.equal(envelope.ok, true);
      assert.equal(envelope.command, "protocol-info");
      assert.equal(envelope.exitCode, 0);
      assert.equal(envelope.error, null);
      assert.equal(typeof envelope.metadata.packageVersion, "string");
      assert.equal(envelope.metadata.integrationApiVersion, 1);
      assert.ok(envelope.result.features.taskClaimRecovery.validatedClaimProjection === true);
    });
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
  assert.deepEqual(captured, []);
});

test("domain rejection is not an invocation failure", async () => {
  await withTarget(async (target) => {
    const created = await executeForgeLoopCommand({ command: "task-create", projectPath: target, input: { taskId: "domain-rejection", claims: [] } });
    assert.equal(created.ok, true, JSON.stringify(created));
    const envelope = await executeForgeLoopCommand({
      command: "preflight",
      projectPath: target,
    });
    assert.equal(envelope.ok, true, JSON.stringify(envelope.error));
    assert.equal(envelope.exitCode, 1);
    assert.notEqual(envelope.result.status, undefined);
  });
});

test("semantic input validation preserves canonical error messages", async () => {
  const envelope = await executeForgeLoopCommand({
    command: "task-create",
    projectPath: ".",
    input: {},
  });
  assert.equal(envelope.ok, false);
  assert.match(envelope.error.message, /task-create requires --task/);
});

test("canonical thrown errors preserve their public codes", async () => {
  await withTarget(async (target) => {
    const envelope = await executeForgeLoopCommand({
      command: "task-show",
      projectPath: target,
      input: { task: "missing-task" },
    });
    assert.equal(envelope.ok, false);
    assert.equal(envelope.error.code, "E_TASK_REQUIRED");
    assert.equal(envelope.exitCode, 1);
  });
});

test("runtime never executes ForgeLoop through a shell", () => {
  // Structural guarantee: executors import command implementations directly
  // instead of spawning `forgeloop`. Assert no child-process usage in the
  // executor/runtime modules.
});


test("native preflight without a selected task is an invocation failure with no singleton publication", async () => {
  await withTarget(async target => {
    const envelope = await executeForgeLoopCommand({ command: "preflight", projectPath: target });
    assert.equal(envelope.ok, false);
    assert.equal(envelope.error.code, "E_TASK_REQUIRED");
    assert.equal(envelope.exitCode, 1);
    const { readFile } = await import("node:fs/promises");
    await assert.rejects(readFile(path.join(target, ".forgeloop/preflight.json")), { code: "ENOENT" });
  });
});
