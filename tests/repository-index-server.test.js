import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { inspectRepositoryIndexServer } from "../src/repository-index/status.js";
import { withRepositoryIndexLock } from "../src/repository-index/lock.js";

test("server ownership requires state, serve metadata, liveness, and command-line identity", async () => {
  const state = {
    startedByForgeLoop: true,
    observedPid: 42,
    repositoryRoot: "/repo",
    indexPath: "/repo/.forgeloop/repository-index/tgrep",
    binaryPath: "/engine/tgrep",
  };
  const serve = { pid: 42, port: 4321 };
  const owned = await inspectRepositoryIndexServer({
    state,
    serve,
    repositoryRoot: state.repositoryRoot,
    indexPath: state.indexPath,
    processInspector: {
      isAlive: () => true,
      commandLine: async () => "/engine/tgrep serve --index-path /repo/.forgeloop/repository-index/tgrep /repo",
    },
  });
  assert.equal(owned.owned, true);
  assert.equal(owned.running, true);
  const mismatch = await inspectRepositoryIndexServer({
    state,
    serve,
    repositoryRoot: "/other-repo",
    indexPath: state.indexPath,
    processInspector: { isAlive: () => true, commandLine: async () => "anything" },
  });
  assert.equal(mismatch.owned, false);
  assert.equal(mismatch.reason, "STATE_PATH_MISMATCH");
  const wrongCommand = await inspectRepositoryIndexServer({
    state,
    serve,
    repositoryRoot: state.repositoryRoot,
    indexPath: state.indexPath,
    processInspector: { isAlive: () => true, commandLine: async () => "/engine/tgrep search /repo" },
  });
  assert.equal(wrongCommand.reason, "PROCESS_IDENTITY_UNVERIFIED");
});

test("repository-index startup lock serializes concurrent operations", async () => {
  const target = await mkdtemp(path.join(tmpdir(), "forgeloop-repository-index-lock-"));
  const order = [];
  let active = 0;
  let maxActive = 0;
  try {
    await Promise.all([
      withRepositoryIndexLock(target, "first", async () => {
        order.push("first:start");
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 30));
        active -= 1;
        order.push("first:end");
      }),
      withRepositoryIndexLock(target, "second", async () => {
        order.push("second:start");
        active += 1;
        maxActive = Math.max(maxActive, active);
        active -= 1;
        order.push("second:end");
      }),
    ]);
    assert.equal(maxActive, 1);
    assert.deepEqual(order.slice().sort(), ["first:end", "first:start", "second:end", "second:start"]);
  } finally {
    await import("node:fs/promises").then(({ rm }) => rm(target, { recursive: true, force: true }));
  }
});
