import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { assertStorageResourceSample, assertTimingSamples } from "../scripts/lib/benchmark-mcp-sample-validation.mjs";
import { captureBenchmarkSourceManifest } from "../scripts/lib/benchmark-source-manifest.mjs";
import { measureStorageResources } from "../scripts/lib/storage-benchmark-resources.mjs";

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
