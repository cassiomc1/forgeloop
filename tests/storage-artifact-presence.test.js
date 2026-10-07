import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { openStorageDatabase } from "../src/storage/connection.js";
import { upsertTask } from "../src/storage/repository.js";
import { createTaskDescriptor } from "../src/core/task-descriptor.js";
import { taskArtifactPath } from "../src/core/task-paths.js";
import { withOperationalStore } from "../src/storage/unit-of-work.js";
import { operationalArtifactExists, readOperationalText } from "../src/storage/operational-context.js";

test("logical ledger presence avoids event materialization while evidence reads remain explicit", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-presence-"));
  const db = openStorageDatabase(path.join(target, "fixture.sqlite"));
  try {
    const taskId = "presence-task";
    upsertTask(db, { taskId, descriptor: createTaskDescriptor({ taskId, writeClaims: [] }), state: null });
    await withOperationalStore({ db, target }, store => {
      store.readEvents = () => { throw new Error("LEDGER_MATERIALIZED"); };
      const ledger = taskArtifactPath(taskId, "events");
      assert.equal(operationalArtifactExists(target, ledger), true);
      assert.equal(operationalArtifactExists(target, taskArtifactPath("missing", "events")), false);
      assert.equal(operationalArtifactExists(target, taskArtifactPath(taskId, "state")), false);
      assert.throws(() => readOperationalText(target, ledger), /LEDGER_MATERIALIZED/);
    });
  } finally { db.close(); await rm(target, { recursive: true, force: true }); }
});
