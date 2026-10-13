import { removeTempTree } from "./helpers/rm-safe.js";
import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";

import { createGitRepository } from "./helpers/git-fixture.js";
import { createBarrier } from "./helpers/storage-fixtures.js";
import { runTaskCreate } from "../src/commands/task-create.js";
import { runTaskScope } from "../src/commands/task-scope.js";
import { acquireTaskLock, readLockInfo } from "../src/core/task-lock.js";
import { readTaskDescriptor } from "../src/core/task-descriptor.js";
import { getPackageRoot } from "../src/core/templates.js";
import { listClaims, listEvents, openStorageDatabase, runInTransaction, upsertTask } from "../src/storage/index.js";
import { withOperationalStore } from "../src/storage/unit-of-work.js";

async function fixture() {
  const target = await createGitRepository("forgeloop-storage-scope-");
  const context = { target, packageRoot: getPackageRoot(), taskId: "native-scope" };
  await runTaskCreate({ ...context, claims: [] });
  return context;
}

function updateDescriptor(writer, taskId, change) {
  const row = writer.prepare("SELECT descriptor_json, state_json FROM tasks WHERE task_id = ?").get(taskId);
  const descriptor = { ...JSON.parse(row.descriptor_json), ...change };
  runInTransaction(writer, () => upsertTask(writer, { taskId, descriptor, state: row.state_json ? JSON.parse(row.state_json) : null }));
}

function taskScopeSnapshot(db, taskId) {
  return {
    task: db.prepare(
      "SELECT phase, revision, created_at, updated_at, descriptor_json, state_json FROM tasks WHERE task_id = ?",
    ).get(taskId),
    claims: listClaims(db, taskId),
    events: listEvents(db, taskId),
    artifacts: db.prepare(
      "SELECT kind, artifact_id, payload_json, fingerprint, source_json, byte_digest FROM task_artifacts WHERE task_id = ? ORDER BY kind, artifact_id",
    ).all(taskId),
  };
}

function holdExternalTaskLease({ target, db, taskId, barrier, marker }) {
  let releaseWait;
  const released = new Promise(resolve => { releaseWait = resolve; });
  const holder = withOperationalStore({ db, target }, async () => {
    const lease = await acquireTaskLock(target, taskId, "external-fixture");
    assert.equal(db.isTransaction, false);
    barrier.signal(marker);
    try {
      await released;
    } finally {
      assert.equal(await lease.release(), true);
    }
  });
  return { holder, release: releaseWait };
}

test("read-only task-scope projects claims from one immutable descriptor snapshot", async () => {
  const f = await fixture();
  const filename = path.join(f.target, ".forgeloop/state.sqlite");
  const db = openStorageDatabase(filename);
  const writer = openStorageDatabase(filename);
  try {
    const expected = await runTaskScope(f);
    await withOperationalStore({ db, target: f.target }, async source => {
      const prototype = Object.getPrototypeOf(source);
      const originalRead = prototype.readText;
      let changed = false;
      prototype.readText = function(relativePath) {
        if (!changed && this.target === f.target && this.db !== db && relativePath.endsWith("/task.json")) {
          changed = true;
          updateDescriptor(writer, f.taskId, { writeClaims: ["src"] });
        }
        return originalRead.call(this, relativePath);
      };
      try {
        assert.deepEqual(await runTaskScope(f), expected);
        assert.equal(changed, true);
        assert.throws(() => source.commit(), { code: "E_STATE_REVISION_CONFLICT" });
      } finally { prototype.readText = originalRead; }
    });
    assert.deepEqual((await runTaskScope(f)).writeClaims, ["src"]);
  } finally { writer.close(); db.close(); await removeTempTree(f.target); }
});

test("task-scope update rereads its descriptor after entering the claims mutation scope", async () => {
  const f = await fixture();
  const writer = openStorageDatabase(path.join(f.target, ".forgeloop/state.sqlite"));
  // The direct API's early read scope closes before the mutation scope begins.
  // Each descriptor reader checks presence and reads JSON. Change it after
  // the second early reader has obtained its JSON, before mutation admission.
  let prototype;
  let originalRead;
  let reads = 0;
  try {
    await withOperationalStore({ db: writer, target: f.target }, source => {
      prototype = Object.getPrototypeOf(source);
      originalRead = prototype.readText;
    });
    prototype.readText = function(relativePath) {
      const result = originalRead.call(this, relativePath);
      if (this.target === f.target && relativePath.endsWith("/task.json")) {
        reads++;
        if (reads === 4) updateDescriptor(writer, f.taskId, { createdAt: "2030-01-01T00:00:00.000Z" });
      }
      return result;
    };
    const result = await runTaskScope({ ...f, claims: [] });
    assert.equal(result.updated, true);
    assert.ok(reads >= 5);
    assert.equal((await readTaskDescriptor(f.target, f.taskId, f.packageRoot)).value.createdAt, "2030-01-01T00:00:00.000Z");
  } finally {
    if (prototype) prototype.readText = originalRead;
    writer.close();
    await removeTempTree(f.target);
  }
});

test("public task-scope mutation rejects an independently leased task", async () => {
  const f = await fixture();
  const filename = path.join(f.target, ".forgeloop/state.sqlite");
  const holderDb = openStorageDatabase(filename);
  const contenderDb = openStorageDatabase(filename);
  const barrier = createBarrier("task-scope-lease");
  let holder;
  let release;
  try {
    ({ holder, release } = holdExternalTaskLease({
      target: f.target,
      db: holderDb,
      taskId: f.taskId,
      barrier,
      marker: "lease-held",
    }));
    await Promise.race([
      barrier.waitFor("lease-held"),
      holder.then(() => { throw new Error("External lease holder exited before the contention attempt"); }),
    ]);
    const before = taskScopeSnapshot(contenderDb, f.taskId);

    await withOperationalStore({ db: contenderDb, target: f.target }, async () => {
      const owner = await readLockInfo(f.target, f.taskId);
      assert.equal(owner?.taskId, f.taskId);
      await assert.rejects(
        runTaskScope({ ...f, claims: ["src"] }),
        { code: "E_TASK_LOCKED" },
      );
      assert.equal((await readLockInfo(f.target, f.taskId))?.lockId, owner.lockId);
    });

    assert.deepEqual(taskScopeSnapshot(contenderDb, f.taskId), before);
    release();
    await holder;
    assert.equal(
      await withOperationalStore({ db: contenderDb, target: f.target }, () => readLockInfo(f.target, f.taskId)),
      null,
    );
  } finally {
    if (release) release();
    try {
      if (holder) await holder;
    } finally {
      contenderDb.close();
      holderDb.close();
      barrier.cleanup();
      await removeTempTree(f.target);
    }
  }
});

test("public task-scope mutation rejects claims overlapping a leased task", async () => {
  const target = await createGitRepository("forgeloop-storage-scope-");
  const packageRoot = getPackageRoot();
  const owner = { target, packageRoot, taskId: "scope-lease-owner" };
  const contender = { target, packageRoot, taskId: "scope-lease-contender" };
  await runTaskCreate({ ...owner, claims: ["src"] });
  await runTaskCreate({ ...contender, claims: [] });

  const filename = path.join(target, ".forgeloop/state.sqlite");
  const holderDb = openStorageDatabase(filename);
  const contenderDb = openStorageDatabase(filename);
  const barrier = createBarrier("task-scope-overlap");
  let holder;
  let release;
  try {
    ({ holder, release } = holdExternalTaskLease({
      target,
      db: holderDb,
      taskId: owner.taskId,
      barrier,
      marker: "owner-lease-held",
    }));
    await Promise.race([
      barrier.waitFor("owner-lease-held"),
      holder.then(() => { throw new Error("External lease holder exited before the overlapping claim attempt"); }),
    ]);
    const ownerBefore = taskScopeSnapshot(contenderDb, owner.taskId);
    const contenderBefore = taskScopeSnapshot(contenderDb, contender.taskId);

    await withOperationalStore({ db: contenderDb, target }, async () => {
      const ownerLock = await readLockInfo(target, owner.taskId);
      assert.equal(ownerLock?.taskId, owner.taskId);
      await assert.rejects(
        runTaskScope({ ...contender, claims: ["src/nested"] }),
        error => {
          assert.equal(error.code, "E_TASK_SCOPE_CONFLICT");
          assert.ok(error.conflicts?.some(conflict => (
            conflict.taskId === owner.taskId
            && conflict.conflictingClaim === "src"
            && conflict.requestedClaim === "src/nested"
          )), JSON.stringify(error.conflicts));
          return true;
        },
      );
      assert.equal((await readLockInfo(target, owner.taskId))?.lockId, ownerLock.lockId);
      assert.equal(await readLockInfo(target, contender.taskId), null);
    });

    assert.deepEqual(taskScopeSnapshot(contenderDb, owner.taskId), ownerBefore);
    assert.deepEqual(taskScopeSnapshot(contenderDb, contender.taskId), contenderBefore);
    await withOperationalStore({ db: contenderDb, target }, async () => {
      const ownerLock = await readLockInfo(target, owner.taskId);
      const updated = await runTaskScope({ ...contender, claims: ["docs"] });
      assert.equal(updated.updated, true);
      assert.deepEqual(updated.writeClaims, ["docs"]);
      assert.equal((await readLockInfo(target, owner.taskId))?.lockId, ownerLock.lockId);
      assert.equal(await readLockInfo(target, contender.taskId), null);
    });
    assert.deepEqual(taskScopeSnapshot(contenderDb, owner.taskId), ownerBefore);
    assert.deepEqual(listClaims(contenderDb, contender.taskId).map(claim => claim.claim_norm), ["docs"]);
    release();
    await holder;
    assert.equal(
      await withOperationalStore({ db: contenderDb, target }, () => readLockInfo(target, owner.taskId)),
      null,
    );
  } finally {
    if (release) release();
    try {
      if (holder) await holder;
    } finally {
      contenderDb.close();
      holderDb.close();
      barrier.cleanup();
      await removeTempTree(target);
    }
  }
});
