/**
 * Equal-output discovery comparison against an explicit portable export.
 * Both paths run discoverTasks and its ownership/integrity rules. The retained
 * legacy read path is the default compatibility comparator. --baseline-root
 * selects a clean checkout of the plan-pinned pre-migration release instead.
 * Samples include native connection open/close; they are warm-cache
 * API calls, not fresh CLI or filesystem-cold measurements. Indexed row lookup
 * is reported separately and cannot satisfy the plan's end-to-end thresholds.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

import { discoverTasks } from "../src/core/task-discovery.js";
import { createTaskDescriptor } from "../src/core/task-descriptor.js";
import { createWorkState } from "../src/core/work-state.js";
import { getPackageRoot } from "../src/core/templates.js";
import { findTaskById as findTaskInStore, openStorageDatabase, exportDatabase, runInTransaction, upsertTask, reserveClaims } from "../src/storage/index.js";

const packageRoot = getPackageRoot();
const TIMESTAMP = "2026-09-11T00:00:00.000Z";

function numericArg(name, fallback, { min, max } = {}) {
  const raw = process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || (min !== undefined && value < min) || (max !== undefined && value > max)) {
    throw new Error(`--${name} must be an integer within the accepted range`);
  }
  return value;
}

function percentile(samples, fraction) {
  const sorted = [...samples].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return sorted[index];
}

async function createFixture(target, size) {
  // Synthetic setup is outside all measured samples. A single seed transaction
  // avoids O(n²) descriptor admission work and cannot serve as commit evidence.
  await mkdir(path.join(target, ".forgeloop"));
  const db = openStorageDatabase(path.join(target, ".forgeloop", "state.sqlite"));
  try {
    runInTransaction(db, () => {
      for (let index = 0; index < size; index += 1) {
        const taskId = `storage-benchmark-${String(index).padStart(5, "0")}`;
        const descriptor = createTaskDescriptor({
          taskId, writeClaims: [`src/task-${index}`], createdAt: TIMESTAMP, updatedAt: TIMESTAMP,
        });
        const state = createWorkState({
          taskId, contractFingerprint: "0".repeat(64), repositoryFingerprint: { branch: null, head: null },
          phase: "RECEIVED", lastUpdated: TIMESTAMP, selectedGuides: [], completedSteps: [],
          pendingSteps: ["benchmark"], requiredGates: [], satisfiedGates: [], checks: [], failures: [], blockers: [],
        });
        upsertTask(db, { taskId, descriptor, state });
        reserveClaims(db, { taskId, claims: descriptor.writeClaims, createdAt: TIMESTAMP });
      }
    });
  } finally { db.close(); }
}

async function measure(run, repeats) {
  const samples = [];
  for (let index = 0; index < repeats; index += 1) {
    const started = performance.now();
    // `run` may be async (filesystem discovery); it must be awaited so the
    // measurement covers the real work rather than promise construction.
    await run();
    samples.push(performance.now() - started);
  }
  return { p50: percentile(samples, 0.5), p95: percentile(samples, 0.95) };
}

const sizes = (process.argv.find((arg) => arg.startsWith("--sizes="))?.slice(8) ?? "10,100,250,1000")
  .split(",")
  .map((value) => Number(value.trim()));
const repeats = numericArg("repeats", 5, { min: 1, max: 100 });

if (sizes.some(size => !Number.isInteger(size) || size < 1 || size > 5000)) throw new Error("--sizes must contain integers between 1 and 5000");

const baselineRootArg = process.argv.find(arg => arg.startsWith("--baseline-root="))?.slice("--baseline-root=".length);
const baselineRoot = baselineRootArg ? path.resolve(baselineRootArg) : null;
const baselineRevision = "ee9ce11123d4e728d3dbc92f5d62d4bf41bb79c5";
let filesystemDiscover = discoverTasks;
if (baselineRoot) {
  assert.equal(execFileSync("git", ["-C", baselineRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(), baselineRevision);
  assert.equal(execFileSync("git", ["-C", baselineRoot, "status", "--porcelain", "--untracked-files=no"], { encoding: "utf8" }).trim(), "", "Pinned baseline sources must be clean");
  ({ discoverTasks: filesystemDiscover } = await import(pathToFileURL(path.join(baselineRoot, "src", "core", "task-discovery.js")).href));
}
const filesystemPackageRoot = baselineRoot ?? packageRoot;
const results = [];
for (const size of sizes) {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-storage-bench-"));
  const portable = await mkdtemp(path.join(os.tmpdir(), "forgeloop-storage-portable-bench-"));
  let db;
  try {
    await createFixture(target, size);
    db = openStorageDatabase(path.join(target, ".forgeloop", "state.sqlite"), { readOnly: true });
    await exportDatabase(db, portable);
    const nativeResult = await discoverTasks(target, packageRoot);
    const portableResult = await filesystemDiscover(portable, filesystemPackageRoot);
    assert.deepEqual(nativeResult, portableResult, "Discovery outputs and validation guarantees must agree");
    assert.equal(nativeResult.length, size);
    assert.ok(nativeResult.every(task => task.healthy && task.ownershipValid), "Benchmark discovery fixtures must retain valid ownership");
    const filesystemLookup = await measure(() => filesystemDiscover(portable, filesystemPackageRoot), repeats);
    const nativeDiscovery = await measure(() => discoverTasks(target, packageRoot), repeats);
    const storeLookup = await measure(() => {
      for (let index = 0; index < size; index += 1) {
        findTaskInStore(db, `storage-benchmark-${String(index).padStart(5, "0")}`);
      }
    }, repeats);

    results.push({
      size,
      outputParity: true,
      nativeDiscoveryP50Ms: Number(nativeDiscovery.p50.toFixed(3)),
      nativeDiscoveryP95Ms: Number(nativeDiscovery.p95.toFixed(3)),
      discoverySpeedupP95: Number((filesystemLookup.p95 / Math.max(nativeDiscovery.p95, 0.001)).toFixed(3)),
      filesystemDiscoveryP50Ms: Number(filesystemLookup.p50.toFixed(3)),
      filesystemDiscoveryP95Ms: Number(filesystemLookup.p95.toFixed(3)),
      storeLookupP50Ms: Number(storeLookup.p50.toFixed(3)),
      storeLookupP95Ms: Number(storeLookup.p95.toFixed(3)),
      sqliteVersion: db.prepare("SELECT sqlite_version() AS version").get().version,
      durability: { journalMode: db.prepare("PRAGMA journal_mode").get().journal_mode, synchronous: db.prepare("PRAGMA synchronous").get().synchronous },
    });
  } finally {
    db?.close();
    await rm(portable, { recursive: true, force: true });
    await rm(target, { recursive: true, force: true });
  }
}

process.stdout.write(`${JSON.stringify({ schemaVersion: 2, node: process.version, fixtureTimestamp: TIMESTAMP, fixturePhase: "RECEIVED", platform: process.platform, architecture: process.arch, cpu: os.cpus()[0]?.model ?? null, comparator: baselineRoot ? "pinned-pre-migration-release" : "retained-legacy-read-compatibility", baselineRevision: baselineRoot ? baselineRevision : null, runtime: "warm-cache API with per-call native connection", releaseThresholdsVerified: false, repeats, results }, null, 2)}\n`);
