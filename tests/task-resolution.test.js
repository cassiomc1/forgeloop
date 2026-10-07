import { removeTempTree } from "./helpers/rm-safe.js";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { resolveTaskContext } from "../src/core/task-context.js";
import { withResolvedTask, withTaskMutation } from "../src/core/task-command.js";
import { createTaskDescriptor, writeTaskDescriptor } from "../src/core/task-descriptor.js";
import { getPackageRoot } from "../src/core/templates.js";
import { createTaskContext } from "../src/core/task-context.js";
import { taskLockPath } from "../src/core/task-paths.js";

const packageRoot = getPackageRoot();

async function withTarget(fn) {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-task-resolution-"));
  try {
    await fn(target);
  } finally {
    await removeTempTree(target);
  }
}

test("resolveTaskContext resolves explicit CLI --task by ID or key", async () => {
  await withTarget(async (target) => {
    const desc = createTaskDescriptor({ taskId: "task-alpha", writeClaims: ["src/alpha"] });
    await writeTaskDescriptor(target, desc, packageRoot);

    // By ID
    const ctxId = await resolveTaskContext(target, { taskId: "task-alpha" }, packageRoot);
    assert.equal(ctxId.taskId, "task-alpha");
    assert.equal(ctxId.taskKey, desc.taskKey);

    // By Key
    const ctxKey = await resolveTaskContext(target, { taskId: desc.taskKey }, packageRoot);
    assert.equal(ctxKey.taskId, "task-alpha");
    assert.equal(ctxKey.taskKey, desc.taskKey);

    // Unknown task -> E_TASK_NOT_FOUND
    await assert.rejects(
      () => resolveTaskContext(target, { taskId: "task-nonexistent" }, packageRoot),
      (err) => err.code === "E_TASK_NOT_FOUND",
    );
  });
});

test("resolveTaskContext resolves FORGELOOP_TASK environment variable", async () => {
  await withTarget(async (target) => {
    const desc = createTaskDescriptor({ taskId: "task-beta", writeClaims: ["src/beta"] });
    await writeTaskDescriptor(target, desc, packageRoot);

    const prevEnv = process.env.FORGELOOP_TASK;
    try {
      process.env.FORGELOOP_TASK = "task-beta";
      const ctx = await resolveTaskContext(target, {}, packageRoot);
      assert.equal(ctx.taskId, "task-beta");
      assert.equal(ctx.taskKey, desc.taskKey);
    } finally {
      if (prevEnv !== undefined) {
        process.env.FORGELOOP_TASK = prevEnv;
      } else {
        delete process.env.FORGELOOP_TASK;
      }
    }
  });
});

test("resolveTaskContext rejects selector conflict between CLI and ENV", async () => {
  await withTarget(async (target) => {
    const desc1 = createTaskDescriptor({ taskId: "task-1", writeClaims: ["src/1"] });
    const desc2 = createTaskDescriptor({ taskId: "task-2", writeClaims: ["src/2"] });
    await writeTaskDescriptor(target, desc1, packageRoot);
    await writeTaskDescriptor(target, desc2, packageRoot);

    const prevEnv = process.env.FORGELOOP_TASK;
    try {
      process.env.FORGELOOP_TASK = "task-1";
      await assert.rejects(
        () => resolveTaskContext(target, { taskId: "task-2" }, packageRoot),
        (err) => err.code === "E_TASK_SELECTOR_CONFLICT",
      );
    } finally {
      if (prevEnv !== undefined) {
        process.env.FORGELOOP_TASK = prevEnv;
      } else {
        delete process.env.FORGELOOP_TASK;
      }
    }
  });
});

test("resolveTaskContext falls back to single task when only one exists", async () => {
  await withTarget(async (target) => {
    const desc = createTaskDescriptor({ taskId: "only-task", writeClaims: ["src"] });
    await writeTaskDescriptor(target, desc, packageRoot);

    const ctx = await resolveTaskContext(target, {}, packageRoot);
    assert.equal(ctx.taskId, "only-task");
    assert.equal(ctx.taskKey, desc.taskKey);
  });
});

test("resolveTaskContext throws E_TASK_AMBIGUOUS when multiple tasks exist without selector", async () => {
  await withTarget(async (target) => {
    const desc1 = createTaskDescriptor({ taskId: "task-first", writeClaims: ["src/1"] });
    const desc2 = createTaskDescriptor({ taskId: "task-second", writeClaims: ["src/2"] });
    await writeTaskDescriptor(target, desc1, packageRoot);
    await writeTaskDescriptor(target, desc2, packageRoot);

    const prevEnv = process.env.FORGELOOP_TASK;
    delete process.env.FORGELOOP_TASK;
    try {
      await assert.rejects(
        () => resolveTaskContext(target, {}, packageRoot),
        (err) => err.code === "E_TASK_AMBIGUOUS",
      );
    } finally {
      if (prevEnv !== undefined) {
        process.env.FORGELOOP_TASK = prevEnv;
      }
    }
  });
});

test("withResolvedTask and withTaskMutation wrap operations cleanly", async () => {
  await withTarget(async (target) => {
    const desc = createTaskDescriptor({ taskId: "task-wrapped", writeClaims: ["src"] });
    await writeTaskDescriptor(target, desc, packageRoot);

    // withResolvedTask
    const resRead = await withResolvedTask(target, { task: "task-wrapped", packageRoot }, (ctx) => {
      return `read:${ctx.taskId}`;
    });
    assert.equal(resRead, "read:task-wrapped");

    // withTaskMutation
    const resMut = await withTaskMutation(target, { task: "task-wrapped", packageRoot }, "mutate", (ctx) => {
      return `mutated:${ctx.taskId}`;
    });
    assert.equal(resMut, "mutated:task-wrapped");
  });
});

test("task context exposes only the canonical coordination lock path", () => {
  const context = createTaskContext({ target: "/tmp/forgeloop-context", taskId: "canonical-lock" });
  assert.equal(context.paths.lock, taskLockPath("canonical-lock"));
});

test("READ and MUTATION implicit selection follow the ownership matrices", async () => {
  const { candidateTasksForSelection } = await import("../src/core/task-context.js");

  const active = { taskId: "active", healthy: true, phase: "EXECUTING", mutationAllowed: true };
  const recovered = { taskId: "recovered", healthy: true, phase: "RECOVERED", mutationAllowed: false };
  const complete = { taskId: "complete", healthy: true, phase: "COMPLETE", mutationAllowed: false };
  const unhealthy = { taskId: "unhealthy", healthy: false };

  // READ selection = discoverability
  assert.deepEqual(candidateTasksForSelection([active], "READ").map((t) => t.taskId), ["active"]);
  assert.deepEqual(candidateTasksForSelection([recovered], "READ").map((t) => t.taskId), ["recovered"]);
  assert.deepEqual(candidateTasksForSelection([complete], "READ").map((t) => t.taskId), ["complete"]);

  // MUTATION selection = operational authority
  assert.deepEqual(candidateTasksForSelection([active], "MUTATION").map((t) => t.taskId), ["active"]);
  assert.deepEqual(candidateTasksForSelection([recovered], "MUTATION").map((t) => t.taskId), []);
  assert.deepEqual(candidateTasksForSelection([complete], "MUTATION").map((t) => t.taskId), []);
  assert.deepEqual(
    candidateTasksForSelection([recovered, active], "MUTATION").map((t) => t.taskId),
    ["active"],
  );
  assert.deepEqual(
    candidateTasksForSelection([complete, active], "MUTATION").map((t) => t.taskId),
    ["active"],
  );
  assert.equal(candidateTasksForSelection([active, { ...active, taskId: "b" }], "MUTATION").length, 2);
  assert.deepEqual(candidateTasksForSelection([unhealthy], "READ").map((t) => t.taskId), []);
});
