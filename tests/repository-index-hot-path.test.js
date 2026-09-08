import assert from "node:assert/strict";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { getTgrepIndexPath } from "../src/repository-index/paths.js";
import { clearRepositoryIndexReadiness } from "../src/repository-index/readiness.js";
import { searchRepository } from "../src/repository-index/search.js";

function fakeStatus(repositoryRoot) {
  return {
    schemaVersion: 1,
    required: true,
    engine: "tgrep",
    engineVersion: "1.0.3",
    managedBinary: false,
    overridden: true,
    binaryPath: "/tmp/forgeloop-test-tgrep",
    repositoryRoot,
    indexPath: getTgrepIndexPath(repositoryRoot),
    server: { running: true, owned: true, pid: process.pid, port: 43123 },
    health: "READY",
  };
}

function searchRequest(overrides = {}) {
  return {
    pattern: "needle",
    binaryPath: "/tmp/forgeloop-test-tgrep",
    ...overrides,
  };
}

async function withFakeSearch(callback) {
  const root = await mkdtemp(path.join(os.tmpdir(), "forgeloop-repository-index-hot-path-"));
  clearRepositoryIndexReadiness();
  try {
    let setupCalls = 0;
    let runCalls = 0;
    const setupRepositoryIndexImpl = async (repositoryRoot) => {
      setupCalls += 1;
      return { status: fakeStatus(await realpath(repositoryRoot)) };
    };
    const runTgrepImpl = async () => {
      runCalls += 1;
      return { exitCode: 0, stdout: "", stderr: "", durationMs: 1, timedOut: false };
    };
    await callback({ root, setupRepositoryIndexImpl, runTgrepImpl, getCounts: () => ({ setupCalls, runCalls }) });
  } finally {
    clearRepositoryIndexReadiness();
    await rm(root, { recursive: true, force: true });
  }
}

test("warm search reuses process-local readiness without repeating setup", async () => {
  await withFakeSearch(async ({ root, setupRepositoryIndexImpl, runTgrepImpl, getCounts }) => {
    await searchRepository(root, { ...searchRequest(), setupRepositoryIndexImpl, runTgrepImpl });
    const warmResult = await searchRepository(root, { ...searchRequest(), setupRepositoryIndexImpl, runTgrepImpl });
    await searchRepository(root, { ...searchRequest(), setupRepositoryIndexImpl, runTgrepImpl });
    assert.equal(Object.hasOwn(warmResult, "repositoryRoot"), false);
    assert.equal(Object.hasOwn(warmResult, "indexPath"), false);
    assert.deepEqual(getCounts(), { setupCalls: 1, runCalls: 3 });
  });
});

test("exit code 1 remains a successful zero-match result on the warm path", async () => {
  await withFakeSearch(async ({ root, setupRepositoryIndexImpl }) => {
    let runCalls = 0;
    const runTgrepImpl = async () => {
      runCalls += 1;
      return { exitCode: 1, stdout: "", stderr: "", durationMs: 1, timedOut: false };
    };
    const result = await searchRepository(root, { ...searchRequest(), setupRepositoryIndexImpl, runTgrepImpl });
    assert.equal(result.matches.length, 0);
    assert.equal(result.metrics.exitCode, 1);
    assert.equal(runCalls, 1);
  });
});

test("a server/index failure triggers exactly one bounded recovery setup", async () => {
  await withFakeSearch(async ({ root, setupRepositoryIndexImpl, getCounts }) => {
    let runCalls = 0;
    const runTgrepImpl = async () => {
      runCalls += 1;
      return runCalls === 1
        ? { exitCode: 2, stdout: "", stderr: "connection refused: server is not running", durationMs: 1, timedOut: false }
        : { exitCode: 0, stdout: "", stderr: "", durationMs: 1, timedOut: false };
    };
    const result = await searchRepository(root, { ...searchRequest(), setupRepositoryIndexImpl, runTgrepImpl });
    assert.equal(result.metrics.exitCode, 0);
    assert.equal(getCounts().setupCalls, 2);
    assert.equal(runCalls, 2);
  });
});

test("readiness is isolated per repository", async () => {
  const first = await mkdtemp(path.join(os.tmpdir(), "forgeloop-repository-index-hot-path-a-"));
  const second = await mkdtemp(path.join(os.tmpdir(), "forgeloop-repository-index-hot-path-b-"));
  clearRepositoryIndexReadiness();
  try {
    let setupCalls = 0;
    const setupRepositoryIndexImpl = async (repositoryRoot) => {
      setupCalls += 1;
      return { status: fakeStatus(await realpath(repositoryRoot)) };
    };
    const runTgrepImpl = async () => ({ exitCode: 0, stdout: "", stderr: "", durationMs: 1, timedOut: false });
    await searchRepository(first, { ...searchRequest(), setupRepositoryIndexImpl, runTgrepImpl });
    await searchRepository(second, { ...searchRequest(), setupRepositoryIndexImpl, runTgrepImpl });
    assert.equal(setupCalls, 2);
  } finally {
    clearRepositoryIndexReadiness();
    await rm(first, { recursive: true, force: true });
    await rm(second, { recursive: true, force: true });
  }
});
