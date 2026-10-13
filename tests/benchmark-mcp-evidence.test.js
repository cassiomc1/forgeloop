import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { assertStorageResourceSample, assertTimingSamples } from "../scripts/lib/benchmark-mcp-sample-validation.mjs";
import { captureBenchmarkSourceManifest } from "../scripts/lib/benchmark-source-manifest.mjs";
import { measureStorageResources } from "../scripts/lib/storage-benchmark-resources.mjs";
import { createBenchmarkProgressJournal } from "../scripts/lib/benchmark-progress-journal.mjs";
import { SEED_STALLED_ERROR_CODE, seedWithProgress } from "../scripts/lib/benchmark-seed-progress.mjs";

async function seedProgressRecords(operations) {
  const root = await mkdtemp(path.join(os.tmpdir(), "forgeloop-seed-progress-"));
  const journalFile = path.join(root, "parent.progress.ndjson");
  try {
    const journal = createBenchmarkProgressJournal(journalFile);
    let error = null;
    let result = null;
    try {
      result = await seedWithProgress(journal, operations);
    } catch (caught) {
      error = caught;
    } finally {
      journal.close();
    }
    const records = readFileSync(journalFile, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
    return { records, result, error };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("parent seeding journal emits heartbeats at the bounded per-task interval", async () => {
  let clock = 1_000;
  const now = () => clock;
  const { records, result, error } = await seedProgressRecords({
    size: 7,
    heartbeatTasks: 2,
    stallGraceMs: 10_000,
    now,
    seed: async onTaskSeeded => {
      for (const taskId of Array.from({ length: 7 }, (_, index) => `seed-${index}`)) {
        clock += 1;
        onTaskSeeded(taskId);
      }
      return { fixtureManifest: { taskCount: 7 } };
    },
  });
  assert.equal(error, null);
  assert.deepEqual(result, { fixtureManifest: { taskCount: 7 } });
  assert.equal(records[0].stage, "SEEDING");
  assert.equal(records[0].tasks, 7);
  const heartbeats = records.filter(record => record.stage === "SEEDING_HEARTBEAT");
  assert.deepEqual(heartbeats.map(record => record.tasksSeeded), [2, 4, 6]);
  for (const heartbeat of heartbeats) {
    assert.ok(Number.isInteger(heartbeat.elapsedMs) && heartbeat.elapsedMs >= 0, "heartbeat must carry elapsed time");
    assert.equal(heartbeat.tasks, 7);
  }
  assert.equal(heartbeats[0].elapsedMs, 2);
});

test("seed stall watchdog aborts with a named diagnosable failure inside the grace window", async () => {
  // Wall-clock based: the harness can hang 400ms real time while the last
  // progress stamp stays old; a 100ms grace window then fires the watchdog
  // well inside that hang, reproducibly and sub-second.
  const { records, error } = await seedProgressRecords({
    size: 1000,
    heartbeatTasks: 100,
    stallGraceMs: 100,
    clockIntervalMs: 10,
    now: () => Date.now(),
    seed: async onTaskSeeded => {
      for (let index = 0; index < 3; index++) onTaskSeeded(`seed-${index}`);
      await new Promise(resolve => setTimeout(resolve, 400));
      return {};
    },
  });
  assert.ok(error, "stalled seed must be rejected");
  assert.equal(error.code, SEED_STALLED_ERROR_CODE);
  assert.match(error.message, /Seed stalled after 3\/1000 tasks/);
  assert.equal(error.artifacts.tasksSeeded, 3);
  const stalledRecords = records.filter(record => record.stage === "SEEDING_STALLED");
  assert.equal(stalledRecords.length, 1);
  assert.equal(stalledRecords[0].tasksSeeded, 3);
});

test("seed failure surfaces, journals SEEDING_FAILED, and propagates for the driver's non-zero exit", async () => {
  const { records, error } = await seedProgressRecords({
    size: 5,
    heartbeatTasks: 2,
    stallGraceMs: 10_000,
    seed: async onTaskSeeded => {
      for (let index = 0; index < 3; index++) onTaskSeeded(`seed-${index}`);
      const boom = new Error("fixture disk refused the seed");
      boom.code = "E_BENCHMARK_SEED_FIXTURE";
      throw boom;
    },
  });
  assert.ok(error, "the seed error must propagate to the caller (driver rethrows => non-zero exit)");
  assert.equal(error.code, "E_BENCHMARK_SEED_FIXTURE");
  const failures = records.filter(record => record.stage === "SEEDING_FAILED");
  assert.equal(failures.length, 1);
  assert.deepEqual(failures[0].error, { code: "E_BENCHMARK_SEED_FIXTURE", message: "fixture disk refused the seed" });
  assert.equal(failures[0].tasksSeeded, 3);
  assert.equal(records.filter(record => record.stage === "SEEDED").length, 0);
});

test("MCP timing evidence refuses malformed and nonfinite JSON samples", () => {
  assert.doesNotThrow(() => assertTimingSamples([0, 0.5, 10], "timings"));
  for (const value of [null, undefined, "1", -1, NaN, Infinity, JSON.parse(JSON.stringify(NaN))]) {
    assert.throws(() => assertTimingSamples([value], "timings"));
  }
  assert.throws(() => assertTimingSamples({}, "timings"));
});

test("MCP resource evidence validates actual observer output and refuses missing accounting", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "forgeloop-resource-evidence-"));
  try {
    const observed = await measureStorageResources(root, async () => ({ observed: true }));
    const sample = JSON.parse(JSON.stringify(observed.resources));
    assert.doesNotThrow(() => assertStorageResourceSample(sample, "resources"));
    for (const key of ["cpuUserMicros", "rssBeforeBytes", "filesBefore", "nodeAsyncFilesystemRequests"]) {
      const missing = structuredClone(sample);
      delete missing[key];
      assert.throws(() => assertStorageResourceSample(missing, "resources"));
    }
    for (const value of [null, "0", -1]) {
      assert.throws(() => assertStorageResourceSample({ ...sample, cpuUserMicros: value }, "resources"));
    }
    const emptyDelay = { ...sample, eventLoopDelaySamples: 0, eventLoopDelayMaxMs: null, eventLoopDelayP95Ms: null };
    assert.doesNotThrow(() => assertStorageResourceSample(emptyDelay, "resources"));
    assert.throws(() => assertStorageResourceSample({ ...emptyDelay, eventLoopDelaySamples: 1 }, "resources"));
    assert.throws(() => assertStorageResourceSample({ ...sample, processLifetimePeakRssKiB: null }, "resources"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("benchmark source manifests retain unexpected paths and dependency admission limitations", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "forgeloop-source-evidence-"));
  const git = args => execFileSync("git", ["-C", root, "-c", "core.excludesFile=", ...args], { stdio: "pipe" });
  try {
    git(["init"]);
    await writeFile(path.join(root, "tracked.txt"), "source\n");
    git(["add", "tracked.txt"]);
    git(["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "Fixture"]);
    await mkdir(path.join(root, "node_modules"));
    await writeFile(path.join(root, "node_modules", "fixture.txt"), "dependency\n");
    await writeFile(path.join(root, "unexpected.mjs"), "export const unexpected = true;\n");
    const manifest = await captureBenchmarkSourceManifest(root);
    assert.equal(manifest.status, "");
    assert.deepEqual(manifest.untrackedEvidence.unexpectedPaths, ["unexpected.mjs"]);
    assert.equal(manifest.files.length, 1);
    assert.match(manifest.untrackedPolicy.ignoredPathLimitation, /ignored files are not enumerated/);
    for (const entry of manifest.untrackedEvidence.admittedEntries) {
      assert.equal(entry.path, "node_modules");
      assert.equal(entry.type, "directory");
      assert.equal(entry.symlinkTarget, null);
      assert.ok(path.isAbsolute(entry.resolvedPath));
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
