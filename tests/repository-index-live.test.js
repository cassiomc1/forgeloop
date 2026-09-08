import assert from "node:assert/strict";
import { appendFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

import { searchRepository } from "../src/repository-index/search.js";
import { getRepositoryIndexStatus } from "../src/repository-index/status.js";
import { setupRepositoryIndex, stopRepositoryIndexServer } from "../src/repository-index/server.js";
import {
  createFixtureRepository,
  nativeOptions,
  requireNativeBinary,
  removeFixtureRepository,
  execFileAsync,
} from "./helpers/repository-index.js";

async function waitForSearch(target, request, predicate) {
  const deadline = Date.now() + 15_000;
  let result;
  while (Date.now() < deadline) {
    result = await searchRepository(target, request);
    if (predicate(result)) return result;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return result;
}

test("real pinned tgrep setup, live mutation, deletion, and no-match behavior", async (t) => {
  const binary = await requireNativeBinary(t);
  if (!binary) return;
  const target = await createFixtureRepository();
  const options = nativeOptions(binary);
  try {
    const setup = await setupRepositoryIndex(target, options);
    assert.equal(setup.status.health, "READY");
    const request = { ...options, fixedStrings: true, globs: ["src/**"] };
    const initial = await searchRepository(target, { ...request, pattern: "alphaNeedle" });
    assert.deepEqual(initial.matches.map(({ path: matchPath, line }) => [matchPath, line]), [["src/alpha.js", 1]]);

    const alphaPath = path.join(target, "src", "alpha.js");
    await appendFile(alphaPath, "\nexport const liveIndexNeedle = 123;\n");
    const live = await waitForSearch(target, { ...request, pattern: "liveIndexNeedle" }, (result) => result.matches.length === 1);
    assert.equal(live.matches[0].path, "src/alpha.js");

    await rm(alphaPath);
    const gone = await waitForSearch(target, { ...request, pattern: "liveIndexNeedle" }, (result) => result.matches.length === 0);
    assert.deepEqual(gone.matches, []);
    const empty = await searchRepository(target, { ...request, pattern: "definitelyAbsentNeedle" });
    assert.equal(empty.metrics.exitCode, 1);
    assert.deepEqual(empty.matches, []);
  } finally {
    await stopRepositoryIndexServer(target, options).catch(() => {});
    await removeFixtureRepository(target);
  }
});

test("a crashed owned server is restarted by the next search", async (t) => {
  const binary = await requireNativeBinary(t);
  if (!binary) return;
  const target = await createFixtureRepository();
  const options = nativeOptions(binary);
  try {
    await setupRepositoryIndex(target, options);
    const before = await getRepositoryIndexStatus(target, options);
    assert.equal(before.health, "READY");
    process.kill(before.server.pid, "SIGKILL");
    const recovered = await searchRepository(target, { ...options, pattern: "betaNeedle", fixedStrings: true });
    assert.equal(recovered.matches[0].path, "src/beta.js");
  } finally {
    await stopRepositoryIndexServer(target, options).catch(() => {});
    await removeFixtureRepository(target);
  }
});

test("live watcher reconciles a Git branch switch with added and removed files", async (t) => {
  const binary = await requireNativeBinary(t);
  if (!binary) return;
  const target = await createFixtureRepository();
  const options = nativeOptions(binary);
  const commit = (message) => execFileAsync("git", [
    "-C", target,
    "-c", "user.name=ForgeLoop Repository Index Test",
    "-c", "user.email=forgeloop-index@example.invalid",
    "commit", "--quiet", "-m", message,
  ]);
  try {
    await commit("initial fixture");
    await execFileAsync("git", ["-C", target, "switch", "--create", "index-branch-a"]);
    await writeFile(path.join(target, "src", "branch-a.js"), "export const branchANeedle = true;\n");
    await execFileAsync("git", ["-C", target, "add", "."]);
    await commit("branch a");

    await setupRepositoryIndex(target, options);
    const request = { ...options, fixedStrings: true, globs: ["src/**"] };
    const branchA = await waitForSearch(target, { ...request, pattern: "branchANeedle" }, (result) => result.matches.length === 1);
    assert.equal(branchA.matches[0].path, "src/branch-a.js");

    await execFileAsync("git", ["-C", target, "switch", "--create", "index-branch-b"]);
    await rm(path.join(target, "src", "branch-a.js"));
    await writeFile(path.join(target, "src", "branch-b.js"), "export const branchBNeedle = true;\n");
    await execFileAsync("git", ["-C", target, "add", "-A"]);
    await commit("branch b");

    const branchB = await waitForSearch(target, { ...request, pattern: "branchBNeedle" }, (result) => result.matches.length === 1);
    assert.equal(branchB.matches[0].path, "src/branch-b.js");
    const removed = await waitForSearch(target, { ...request, pattern: "branchANeedle" }, (result) => result.matches.length === 0);
    assert.deepEqual(removed.matches, []);
  } finally {
    await stopRepositoryIndexServer(target, options).catch(() => {});
    await removeFixtureRepository(target);
  }
});
