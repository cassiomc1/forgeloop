import { removeTempTree } from "./helpers/rm-safe.js";
import assert from "node:assert/strict";
import { mkdtemp, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { createTaskDescriptor } from "../src/core/task-descriptor.js";
import { discoverTasks } from "../src/core/task-discovery.js";
import { getPackageRoot } from "../src/core/templates.js";
import { withProjectStorage } from "../src/storage/project-boundary.js";
import { upsertTask } from "../src/storage/repository.js";
import { runInTransaction } from "../src/storage/transaction.js";
import { TASK_STATE_ROOT } from "../src/core/task-paths.js";

test("task discovery retains 1,000 independent task namespaces", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-scale-tasks-"));
  try {
    const root = path.join(target, TASK_STATE_ROOT);
    const descriptors = Array.from({ length: 1_000 }, (_, index) => createTaskDescriptor({
      taskId: `scale-task-${String(index).padStart(4, "0")}`,
      createdAt: "2026-01-01T00:00:00.000Z",
    }));
    await withProjectStorage(target, store=>runInTransaction(store.db,()=>{
      for(const descriptor of descriptors)upsertTask(store.db,{taskId:descriptor.taskId,taskKey:descriptor.taskKey,descriptor});
    }));
    const tasks = await discoverTasks(target, getPackageRoot());
    assert.equal(tasks.length, 1_000);
    await assert.rejects(readdir(root), {code:"ENOENT"});
    assert.equal(tasks.filter((task) => task.healthy).length, 1_000);
    assert.equal(new Set(tasks.map((task) => task.taskId)).size, 1_000);
  } finally {
    await removeTempTree(target);
  }
});
