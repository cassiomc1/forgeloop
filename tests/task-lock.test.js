import { removeTempTree } from "./helpers/rm-safe.js";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  acquireTaskLock as acquireNativeTaskLock,
  readLockInfo,
  releaseStaleTaskLockIfUnchanged,
  forceUnlockTask,
  classifyLockStaleness,
  currentProcessStartToken,
  withTaskLock,
} from "../src/core/task-lock.js";
import { taskLockPath } from "../src/core/task-paths.js";
import { fileExists } from "../src/core/filesystem.js";
import { runTaskCreate } from "../src/commands/task-create.js";
import { getPackageRoot } from "../src/core/templates.js";
import { openStorageDatabase, putArtifact } from "../src/storage/index.js";

const handles = new Map();
const seeded = new Map();
async function seedTask(target, taskId) {
  const ids = seeded.get(target);
  if (!ids.has(taskId)) {
    await runTaskCreate({ target, packageRoot: getPackageRoot(), taskId, claims: [] });
    ids.add(taskId);
  }
}
async function acquireTaskLock(target, taskId, operation) {
  await seedTask(target, taskId);
  const handle = await acquireNativeTaskLock(target, taskId, operation);
  handles.get(target).push(handle);
  return handle;
}
function writeLease(target, taskId, payload) {
  const db = openStorageDatabase(path.join(target, ".forgeloop/state.sqlite"));
  try { putArtifact(db, { taskId, kind: "operationLease", payload }); }
  finally { db.close(); }
}

async function withTarget(fn) {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-task-lock-"));
  handles.set(target, []);
  seeded.set(target, new Set());
  try {
    await fn(target);
  } finally {
    await Promise.all(handles.get(target).map(handle => handle.release()));
    handles.delete(target);
    seeded.delete(target);
    await removeTempTree(target);
  }
}

test("acquireTaskLock acquires exclusive lock and release removes it", async () => {
  await withTarget(async (target) => {
    const taskId = "task-lock-test";
    const lockHandle = await acquireTaskLock(target, taskId, "test-cmd");
    assert.ok(lockHandle);
    assert.equal(lockHandle.lockData.taskId, taskId);
    assert.equal(lockHandle.lockData.operation, "test-cmd");
    assert.equal(typeof lockHandle.lockData.hostname, "string");
    assert.equal(typeof lockHandle.lockData.ownerInstanceId, "string");
    assert.equal(lockHandle.lockData.leaseMs, 300000);
    assert.match(lockHandle.lockData.processStartToken, new RegExp(`^${process.pid}:\\d+$`));
    assert.equal(lockHandle.lockData.heartbeatAt, lockHandle.lockData.acquiredAt);
    assert.equal(typeof lockHandle.release, "function");

    const fullLockPath = path.join(target, taskLockPath(taskId));
    assert.equal(await fileExists(fullLockPath), false, "native reservation creates no filesystem lock");

    const info = await readLockInfo(target, taskId);
    assert.ok(info);
    assert.equal(info.operation, "test-cmd");
    assert.equal(info.taskId, taskId);

    // Re-acquiring same task while locked must fail with E_TASK_LOCKED
    await assert.rejects(
      () => acquireTaskLock(target, taskId, "second-cmd"),
      (err) => err.code === "E_TASK_LOCKED",
    );

    // Release lock
    await lockHandle.release();
    assert.equal(await fileExists(fullLockPath), false);

    const infoAfter = await readLockInfo(target, taskId);
    assert.equal(infoAfter, null);
  });
});

test("process start token pairs the active PID with a stable start epoch", () => {
  const value = currentProcessStartToken(10_000, 2.5).split(":");
  assert.equal(Number(value[0]), process.pid);
  assert.equal(value[1], "7500");
});

function validTaskLock(overrides = {}) {
  return {
    taskId: "task-fixture",
    lockId: "lock-fixture",
    operation: "fixture-op",
    ownerInstanceId: "owner-fixture",
    acquiredAt: "2020-01-01T00:00:00.000Z",
    heartbeatAt: "2020-01-01T00:00:00.000Z",
    leaseMs: 1,
    ...overrides,
  };
}

test("classifyLockStaleness distinguishes an expired lease", () => {
  assert.equal(classifyLockStaleness(validTaskLock(), Date.parse("2020-01-01T00:00:00.002Z")).status, "STALE");
  assert.equal(
    classifyLockStaleness(validTaskLock({
      heartbeatAt: new Date().toISOString(),
      acquiredAt: new Date().toISOString(),
      leaseMs: 300000,
    })).status,
    "LIVE",
  );
});

test("incomplete owner identity classifies UNKNOWN even with valid timestamps", () => {
  const now = Date.parse("2020-01-01T00:00:00.002Z");
  assert.equal(classifyLockStaleness(validTaskLock({ lockId: undefined }), now).status, "UNKNOWN");
  assert.equal(classifyLockStaleness(validTaskLock({ ownerInstanceId: "" }), now).status, "UNKNOWN");
  assert.equal(classifyLockStaleness(validTaskLock({ operation: undefined }), now).status, "UNKNOWN");
  assert.equal(classifyLockStaleness(validTaskLock({ taskId: undefined }), now).status, "UNKNOWN");
  assert.equal(classifyLockStaleness(validTaskLock({ leaseMs: 0 }), now).status, "UNKNOWN");
  assert.equal(classifyLockStaleness(validTaskLock({ leaseMs: "soon" }), now).status, "UNKNOWN");
  assert.equal(classifyLockStaleness(validTaskLock({ heartbeatAt: "not-a-date" }), now).status, "UNKNOWN");
});

test("CAS stale release never removes an UNKNOWN malformed expected lock", async () => {
  await withTarget(async (target) => {
    const taskId = "task-cas-unknown-lock";
    const handle = await acquireTaskLock(target, taskId, "crashed-cmd");
    const malformed = { ...handle.lockData };
    delete malformed.lockId;
    writeLease(target, taskId, malformed);

    const released = await releaseStaleTaskLockIfUnchanged(target, taskId, malformed);
    assert.equal(released.released, false);
    assert.equal(released.reason, "EXPECTED_LOCK_NOT_STALE");
    assert.equal(released.classification.status, "UNKNOWN");
    assert.ok(await readLockInfo(target, taskId));
  });
});

test("classifyLockStaleness distinguishes absence, corruption, and incomplete metadata", () => {
  assert.equal(classifyLockStaleness(null).status, "NONE");
  assert.equal(classifyLockStaleness({ corrupted: true }).status, "CORRUPT");
  assert.equal(classifyLockStaleness({ lockId: "missing-timestamps" }).status, "UNKNOWN");
});

test("withTaskLock runs mutation under lock and releases cleanly on complete or error", async () => {
  await withTarget(async (target) => {
    const taskId = "task-with-lock";
    await seedTask(target, taskId);

    let executed = false;
    const res = await withTaskLock(target, taskId, "mutate", async (lockData) => {
      executed = true;
      const info = await readLockInfo(target, taskId);
      assert.ok(info);
      assert.equal(info.taskId, taskId);
      assert.equal(lockData.taskId, taskId);
      return "result-123";
    });

    assert.equal(executed, true);
    assert.equal(res, "result-123");

    // Lock released after function finishes
    const infoAfter = await readLockInfo(target, taskId);
    assert.equal(infoAfter, null);

    // Lock released even when error thrown inside function
    await assert.rejects(
      () => withTaskLock(target, taskId, "failing-op", async () => {
        throw new Error("inner failure");
      }),
      /inner failure/,
    );

    const infoAfterError = await readLockInfo(target, taskId);
    assert.equal(infoAfterError, null);
  });
});

test("forceUnlockTask removes active lock", async () => {
  await withTarget(async (target) => {
    const taskId = "task-force-unlock";
    await acquireTaskLock(target, taskId, "crashed-cmd");

    const before = await readLockInfo(target, taskId);
    assert.ok(before);

    const unlocked = await forceUnlockTask(target, taskId);
    assert.equal(unlocked.unlocked, true);

    const after = await readLockInfo(target, taskId);
    assert.equal(after, null);
  });
});

test("CAS stale release refuses a lock bound to a different taskId", async () => {
  await withTarget(async (target) => {
    const taskId = "task-cas-wrong-id";
    const handle = await acquireTaskLock(target, taskId, "crashed-cmd");
    const stale = {
      ...handle.lockData,
      taskId: "a-different-task",
      acquiredAt: "2020-01-01T00:00:00.000Z",
      heartbeatAt: "2020-01-01T00:00:00.000Z",
      leaseMs: 1,
    };
    writeLease(target, taskId, stale);

    const released = await releaseStaleTaskLockIfUnchanged(target, taskId, stale);
    assert.equal(released.released, false);
    assert.equal(released.reason, "LOCK_CHANGED");
    assert.ok(await readLockInfo(target, taskId));
  });
});

test("stale-lock release removes only the unchanged observed lease", async () => {
  await withTarget(async (target) => {
    const taskId = "task-cas-stale-lock";
    const handle = await acquireTaskLock(target, taskId, "crashed-cmd");
    const stale = {
      ...handle.lockData,
      acquiredAt: "2020-01-01T00:00:00.000Z",
      heartbeatAt: "2020-01-01T00:00:00.000Z",
      leaseMs: 1,
    };
    writeLease(target, taskId, stale);

    const released = await releaseStaleTaskLockIfUnchanged(target, taskId, stale);
    assert.equal(released.released, true);
    assert.equal(await readLockInfo(target, taskId), null);
  });
});

test("stale-lock release preserves a replacement owner", async () => {
  await withTarget(async (target) => {
    const taskId = "task-cas-replaced-lock";
    const handle = await acquireTaskLock(target, taskId, "crashed-cmd");
    const stale = {
      ...handle.lockData,
      acquiredAt: "2020-01-01T00:00:00.000Z",
      heartbeatAt: "2020-01-01T00:00:00.000Z",
      leaseMs: 1,
    };
    writeLease(target, taskId, stale);
    const expected = await readLockInfo(target, taskId);
    const replacement = {
      ...stale,
      lockId: "replacement-lock",
      ownerInstanceId: "replacement-owner",
      acquiredAt: new Date().toISOString(),
      heartbeatAt: new Date().toISOString(),
      leaseMs: 300000,
    };
    writeLease(target, taskId, replacement);

    const released = await releaseStaleTaskLockIfUnchanged(target, taskId, expected);
    assert.equal(released.released, false);
    assert.equal(released.reason, "LOCK_CHANGED");
    assert.deepEqual(await readLockInfo(target, taskId), replacement);
  });
});
