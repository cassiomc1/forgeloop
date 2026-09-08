import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { withRepositoryIndexLock } from "../src/repository-index/lock.js";
import { searchRepository } from "../src/repository-index/search.js";
import { setupRepositoryIndex, stopRepositoryIndexServer } from "../src/repository-index/server.js";
import {
  createFixtureRepository,
  nativeOptions,
  requireNativeBinary,
  removeFixtureRepository,
} from "./helpers/repository-index.js";

test("the lock API is project-scoped and does not become a search-duration global lock", async () => {
  const calls = [];
  const lockRoot = await mkdtemp(path.join(tmpdir(), "forgeloop-index-concurrency-test-"));
  try {
    const result = await withRepositoryIndexLock(lockRoot, "test", async () => {
      calls.push("inside");
      return "done";
    });
    assert.equal(result, "done");
    assert.deepEqual(calls, ["inside"]);
  } finally {
    await rm(lockRoot, { recursive: true, force: true });
  }
});

test("concurrent native setup and search clients converge on one owned server", async (t) => {
  const binary = await requireNativeBinary(t);
  if (!binary) return;
  const target = await createFixtureRepository();
  const options = nativeOptions(binary);
  try {
    const request = { ...options, pattern: "sharedNeedle", fixedStrings: true, globs: ["src/**"] };
    const results = await Promise.all([
      setupRepositoryIndex(target, options),
      setupRepositoryIndex(target, options),
      searchRepository(target, request),
      searchRepository(target, { ...request, pattern: "alphaNeedle" }),
    ]);
    assert.equal(results[0].status.health, "READY");
    assert.equal(results[1].status.health, "READY");
    assert.equal(results[2].matches.length, 2);
    assert.deepEqual(results[3].matches.map((match) => match.path), ["src/alpha.js"]);
    const finalStatus = await setupRepositoryIndex(target, options);
    assert.equal(finalStatus.status.server.running, true);
    assert.equal(finalStatus.status.server.owned, true);
  } finally {
    await stopRepositoryIndexServer(target, options).catch(() => {});
    await removeFixtureRepository(target);
  }
});
