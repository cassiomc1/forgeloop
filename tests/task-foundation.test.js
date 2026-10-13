import { removeTempTree } from "./helpers/rm-safe.js";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { taskStorageKey, assertTaskId, assertTaskKey } from "../src/core/task-identity.js";
import {
  taskDirectory,
  taskArtifactPath,
  taskGatePath,
  taskExecutionPath,
  taskLockPath,
  sessionArtifactPath,
} from "../src/core/task-paths.js";
import {
  createTaskDescriptor,
  readTaskDescriptor,
  writeTaskDescriptor,
} from "../src/core/task-descriptor.js";
import { getPackageRoot } from "../src/core/templates.js";

const packageRoot = getPackageRoot();

async function withTarget(fn) {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-task-foundation-"));
  try {
    await fn(target);
  } finally {
    await removeTempTree(target);
  }
}

test("taskStorageKey produces deterministic 64-char lowercase hex digest", () => {
  const key1 = taskStorageKey("task-auth-001");
  const key2 = taskStorageKey("task-auth-001");
  assert.equal(key1, key2);
  assert.match(key1, /^[a-f0-9]{64}$/);

  const keyOther = taskStorageKey("task-auth-002");
  assert.notEqual(key1, keyOther);
});

test("assertTaskId validates non-empty strings and bounds", () => {
  assert.equal(assertTaskId("valid-task-id"), "valid-task-id");
  assert.equal(assertTaskId("TASK_123"), "TASK_123");
  assert.throws(() => assertTaskId(""), (err) => err.code === "E_TASK_REQUIRED");
  assert.throws(() => assertTaskId("   "), (err) => err.code === "E_TASK_REQUIRED");
  assert.throws(() => assertTaskId(123), (err) => err.code === "E_TASK_REQUIRED");
  assert.throws(() => assertTaskId(null), (err) => err.code === "E_TASK_REQUIRED");
  assert.throws(() => assertTaskId("a".repeat(257)), (err) => err.code === "E_TASK_DESCRIPTOR_INVALID");
});

test("assertTaskKey validates 64-character lowercase hex strings", () => {
  const validKey = "a".repeat(64);
  assert.equal(assertTaskKey(validKey), validKey);
  assert.throws(() => assertTaskKey("a".repeat(63)), (err) => err.code === "E_TASK_KEY_MISMATCH");
  assert.throws(() => assertTaskKey("A".repeat(64)), (err) => err.code === "E_TASK_KEY_MISMATCH");
  assert.throws(() => assertTaskKey("invalid-key"), (err) => err.code === "E_TASK_KEY_MISMATCH");
});

test("task paths derivation", () => {
  const taskId = "auth-task";
  const key = taskStorageKey(taskId);

  assert.equal(taskDirectory(taskId), `.forgeloop/task-state/${key}`);
  assert.equal(taskArtifactPath(taskId, "contract"), `.forgeloop/task-state/${key}/contract.json`);
  assert.equal(taskArtifactPath(taskId, "route"), `.forgeloop/task-state/${key}/routing-result.json`);
  assert.equal(taskArtifactPath(taskId, "state"), `.forgeloop/task-state/${key}/work-state.json`);
  assert.equal(taskArtifactPath(taskId, "preflight"), `.forgeloop/task-state/${key}/preflight.json`);
  assert.equal(taskArtifactPath(taskId, "events"), `.forgeloop/task-state/${key}/events.ndjson`);
  assert.equal(taskArtifactPath(taskId, "receipt"), `.forgeloop/task-state/${key}/execution-receipt.json`);
  assert.equal(taskArtifactPath(taskId, "continuity"), `.forgeloop/task-state/${key}/continuity.json`);
  assert.equal(taskArtifactPath(taskId, "descriptor"), `.forgeloop/task-state/${key}/task.json`);
  assert.equal(taskGatePath(taskId, "design"), `.forgeloop/task-state/${key}/gates/design.json`);
  assert.equal(taskExecutionPath(taskId, "exec-123"), `.forgeloop/task-state/${key}/executions/exec-123.json`);
  assert.equal(taskLockPath(taskId), `.forgeloop/locks/${key}.lock`);
  assert.equal(sessionArtifactPath("sess-abc"), `.forgeloop/sessions/sess-abc.json`);
});

test("task-descriptor schema validates schema and read/write descriptor", async () => {
  await withTarget(async (target) => {
    const descriptor = createTaskDescriptor({
      taskId: "task-checkout",
      writeClaims: ["src/checkout", "tests/checkout"],
    });

    assert.equal(descriptor.schemaVersion, 1);
    assert.equal(descriptor.protocolVersion, 1);
    assert.equal(descriptor.taskId, "task-checkout");
    assert.equal(descriptor.taskKey, taskStorageKey("task-checkout"));
    assert.deepEqual(descriptor.writeClaims, ["src/checkout", "tests/checkout"]);

    await writeTaskDescriptor(target, descriptor, packageRoot);

    const loaded = await readTaskDescriptor(target, "task-checkout", packageRoot);
    assert.equal(loaded.taskId, "task-checkout");
    assert.equal(loaded.taskKey, descriptor.taskKey);
    assert.deepEqual(loaded.writeClaims, ["src/checkout", "tests/checkout"]);
  });
});
