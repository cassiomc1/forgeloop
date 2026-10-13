import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";

import { createGitRepository } from "./helpers/git-fixture.js";
import { removeTempTree } from "./helpers/rm-safe.js";
import { runTaskCreate } from "../src/commands/task-create.js";
import { runTaskList } from "../src/commands/task-list.js";
import {
  discoverTaskListEntries,
  discoverTaskSummaries,
  discoverTasks,
} from "../src/core/task-discovery.js";
import { createTaskDescriptor } from "../src/core/task-descriptor.js";
import { getPackageRoot } from "../src/core/templates.js";
import { openStorageDatabase, upsertTask } from "../src/storage/index.js";
import { withOperationalStore } from "../src/storage/unit-of-work.js";

const packageRoot = getPackageRoot();

function taskListProjection(task) {
  if (task.healthy === false) {
    return {
      taskId: task.taskId ?? null,
      taskKey: task.taskKey,
      directory: task.directory,
      healthy: false,
      error: task.error,
    };
  }
  return {
    taskId: task.taskId,
    taskKey: task.taskKey,
    directory: task.directory,
    healthy: true,
    phase: task.phase,
    writeClaims: task.writeClaims ?? [],
    historicalWriteClaims: task.historicalWriteClaims ?? [],
    effectiveWriteClaims: task.effectiveWriteClaims ?? [],
    claimState: task.claimState,
    recovery: task.recovery,
    mutationAllowed: task.mutationAllowed,
    ownershipValid: task.ownershipValid,
    ownershipErrors: task.ownershipErrors ?? task.errors ?? [],
    reasonCodes: task.reasonCodes ?? [],
    locked: task.locked,
    hasContinuity: task.hasContinuity,
    hasReceipt: task.hasReceipt,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

test("task-list projection preserves canonical fields, ordering, filters, and pagination", async () => {
  const target = await createGitRepository("forgeloop-task-list-projection-");
  try {
    for (const taskId of ["projection-c", "projection-a", "projection-b"]) {
      await runTaskCreate({ target, packageRoot, taskId, claims: [] });
    }

    const full = await discoverTasks(target, packageRoot);
    const expected = full.map(taskListProjection);
    const projected = await discoverTaskListEntries(target, packageRoot);
    assert.deepEqual(projected, expected);

    const listed = await runTaskList({ target, packageRoot, limit: 2, offset: 1 });
    assert.deepEqual(listed.tasks, expected.slice(1, 3));
    assert.equal(listed.total, expected.length);
    assert.equal(listed.offset, 1);
    assert.equal(listed.limit, 2);
    assert.equal(listed.hasMore, false);
    for (const limit of [0, 1, 2, null]) {
      for (const offset of [0, 1, 4]) {
        for (const phase of [null, expected[0].phase]) {
          const page = await runTaskList({ target, packageRoot, limit, offset, phase });
          const filtered = phase ? expected.filter(task => task.phase === phase) : expected;
          assert.deepEqual(page.tasks, filtered.slice(offset, limit === null ? undefined : offset + limit));
          assert.equal(page.total, filtered.length);
          assert.equal(page.hasMore, limit !== null && offset + limit < filtered.length);
        }
      }
    }

  } finally {
    await removeTempTree(target);
  }
});

test("summary and task-list projections preserve corrupt entries and one-snapshot CAS", async () => {
  const target = await createGitRepository("forgeloop-task-projection-cas-");
  const filename = path.join(target, ".forgeloop/state.sqlite");
  let db;
  let writer;
  let prototype;
  let originalRead;
  let changed = false;
  try {
    await runTaskCreate({ target, packageRoot, taskId: "projection-valid", claims: [] });
    await runTaskCreate({ target, packageRoot, taskId: "projection-corrupt", claims: [] });
    db = openStorageDatabase(filename);
    writer = openStorageDatabase(filename);
    db.prepare("UPDATE tasks SET descriptor_json = ? WHERE task_id = ?").run("{}", "projection-corrupt");

    const full = await discoverTasks(target, packageRoot);
    const expectedSummaries = full.map((task) => ({
      taskId: task.taskId,
      healthy: task.healthy !== false,
      phase: task.phase ?? null,
      mutationAllowed: task.mutationAllowed !== false,
    }));
    assert.deepEqual(await discoverTaskSummaries(target, packageRoot), expectedSummaries);

    await withOperationalStore({ db, target }, async source => {
      prototype = Object.getPrototypeOf(source);
      originalRead = prototype.readText;
      prototype.readText = function(relativePath) {
        if (!changed && this.target === target && this.db !== db && relativePath.endsWith("/task.json")) {
          changed = true;
          upsertTask(writer, {
            taskId: "projection-cas-added",
            descriptor: createTaskDescriptor({ taskId: "projection-cas-added", writeClaims: [] }),
          });
        }
        return originalRead.call(this, relativePath);
      };
      try {
        const expectedList = full.map(taskListProjection);
        const page = await runTaskList({ target, packageRoot, limit: 1 });
        assert.deepEqual(page.tasks, expectedList.slice(0, 1));
        assert.equal(page.total, expectedList.length);
        assert.equal(changed, true);
        assert.throws(() => source.commit(), { code: "E_STATE_REVISION_CONFLICT" });
      } finally {
        prototype.readText = originalRead;
      }
    });
  } finally {
    if (prototype) prototype.readText = originalRead;
    writer?.close();
    db?.close();
    await removeTempTree(target);
  }
});
