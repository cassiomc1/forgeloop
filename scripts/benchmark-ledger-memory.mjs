/**
 * Reproducible valid-chain ledger memory experiment. Fresh worker processes
 * isolate peak RSS from fixture construction; timed samples are warm domain
 * operations, not cold CLI or filesystem-cold measurements. No provider calls.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, open, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { eventHash, iterateEvents, validateEventLedger, withEventLedgerAudit } from "../src/core/events.js";
import { createTaskDescriptor } from "../src/core/task-descriptor.js";
import { createWorkState } from "../src/core/work-state.js";
import { taskStorageKey } from "../src/core/task-identity.js";
import { getPackageRoot } from "../src/core/templates.js";
import { withOperationalStore } from "../src/storage/unit-of-work.js";
import { openStorageDatabase, appendEvent, upsertTask, exportTask, runInTransaction } from "../src/storage/index.js";

const BASELINE = "ee9ce11123d4e728d3dbc92f5d62d4bf41bb79c5";
const TASK = "ledger-memory-benchmark";
const AT = "2026-09-30T00:00:00.000Z";
const packageRoot = getPackageRoot();
const arg = (name, fallback) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const readScope = arg("read-scope", "read-only");
assert.ok(["read-only", "mutation-observation"].includes(readScope), "Invalid --read-scope");
function integer(name, fallback, min, max) {
  const value = Number(arg(name, fallback));
  assert.ok(Number.isSafeInteger(value) && value >= min && value <= max, `Invalid --${name}`);
  return value;
}
const rounded = value => Number.isFinite(value) ? Number(value.toFixed(3)) : null;
const percentile = (samples, fraction) => [...samples].sort((a, b) => a - b)[Math.max(0, Math.ceil(samples.length * fraction) - 1)];

async function consume(events) {
  const digest = createHash("sha256");
  let count = 0;
  let previousHash = null;
  for await (const event of events) {
    assert.equal(event.taskId, TASK);
    assert.equal(event.seq, ++count);
    assert.equal(event.previousHash, previousHash);
    assert.equal(event.hash, eventHash(event));
    previousHash = event.hash;
    digest.update(`${JSON.stringify(event)}\n`);
  }
  return { count, lastHash: previousHash, sha256: digest.digest("hex") };
}

async function* fileEvents(filename) {
  const input = createReadStream(filename);
  const lines = createInterface({ input, crlfDelay: Infinity });
  try { for await (const line of lines) if (line) yield JSON.parse(line); }
  finally { lines.close(); input.destroy(); }
}

async function measureWorker() {
  const target = arg("target");
  const backend = arg("worker");
  const operation = arg("operation");
  assert.ok(["filesystem", "sqlite"].includes(backend));
  assert.ok(["iterator", "audit", "audit-array", "export"].includes(operation));
  assert.ok(operation !== "export" || backend === "sqlite", "No equivalent filesystem export timing is claimed");
  const repeats = integer("repeats", 3, 1, 30);
  const warmup = integer("warmup", 1, 0, 10);
  const expected = JSON.parse(arg("expected"));
  const baselineRoot = arg("baseline-root", null);
  const legacy = backend === "filesystem" ? await import(pathToFileURL(path.join(baselineRoot, "src/core/events.js")).href) : null;
  const db = backend === "sqlite" ? openStorageDatabase(path.join(target, ".forgeloop/state.sqlite"), { readOnly: true }) : null;
  const histogram = monitorEventLoopDelay({ resolution: 10 });
  histogram.enable();
  let exportIndex = 0;
  const samples = [];
  async function operationSample() {
    if (operation === "iterator") return { result: await consume(legacy ? await legacy.readEvents(target, baselineRoot, { taskId: TASK }) : iterateEvents(target, packageRoot, { taskId: TASK })) };
    if (operation === "audit" && !legacy) {
      return withEventLedgerAudit(target, packageRoot, { taskId: TASK }, async audit => {
        assert.equal(audit.valid, true, JSON.stringify(audit.errors));
        return { result: await consume(audit.events) };
      });
    }
    if (operation === "audit" || operation === "audit-array") {
      const audit = legacy ? await legacy.validateEventLedger(target, baselineRoot, { taskId: TASK }) : await validateEventLedger(target, packageRoot, { taskId: TASK });
      if (!audit.valid && legacy && audit.errors?.length && audit.errors.every(error => error.code === "JSON_LIMIT_EXCEEDED")) {
        throw Object.assign(new Error("Pinned ledger validation reports its existing size refusal"), { code: "JSON_LIMIT_EXCEEDED" });
      }
      assert.equal(audit.valid, true, JSON.stringify(audit.errors));
      return { result: await consume(audit.events) };
    }
    const destination = path.join(target, `export-${++exportIndex}`);
    const exported = await exportTask(db, TASK, destination);
    return { filename: path.join(destination, taskStorageKey(TASK), "events.ndjson"), exportedCount: exported.events };
  }
  async function run() {
    for (let index = -warmup; index < repeats; index += 1) {
      await delay(20);
      const start = performance.now();
      const outcome = await operationSample();
      const elapsedMs = performance.now() - start;
      const observed = outcome.result ?? await consume(fileEvents(outcome.filename));
      assert.deepEqual(observed, expected, "Every sample preserves full payloads, ordering and chain identity");
      if (outcome.filename) {
        assert.equal(outcome.exportedCount, expected.count);
        await rm(path.dirname(outcome.filename), { recursive: true });
      }
      if (index >= 0) samples.push(elapsedMs);
      await delay(20);
    }
  }
  try {
    if (db) await withOperationalStore({ db, target, readOnly: readScope === "read-only" }, run); else await run();
    const p50 = percentile(samples, 0.5);
    const p95 = percentile(samples, 0.95);
    return { status: "MEASURED", backend, operation, readScope, auditImplementation: operation === "audit" && !legacy ? "callback-detached-snapshot" : operation.startsWith("audit") ? "public-array" : null, warmup, repeats, samplesMs: samples.map(rounded), p50Ms: rounded(p50), p95Ms: rounded(p95), eventsPerSecondAtP50: rounded(expected.count * 1000 / p50), peakProcessRssKiB: process.resourceUsage().maxRSS, finalRssBytes: process.memoryUsage().rss, eventLoopDelayMaxMs: rounded(histogram.max / 1e6), eventLoopDelayP95Ms: rounded(histogram.percentile(95) / 1e6), observed: expected, sqliteVersion: db?.prepare("SELECT sqlite_version() AS version").get().version ?? null };
  } catch (error) {
    if (backend !== "filesystem" || error.code !== "JSON_LIMIT_EXCEEDED") throw error;
    return { status: "REFUSED", backend, operation, readScope, warmup, repeats, samplesMs: [], p50Ms: null, p95Ms: null, peakProcessRssKiB: process.resourceUsage().maxRSS, observed: null, error: { code: error.code, message: "Pinned filesystem reader refuses the whole ledger at its existing JSON byte limit" } };
  } finally { histogram.disable(); db?.close(); }
}

async function seed(root, count, seed, payloadBytes) {
  const filesystem = path.join(root, "filesystem");
  const sqlite = path.join(root, "sqlite");
  const directory = path.join(filesystem, ".forgeloop/task-state", taskStorageKey(TASK));
  await mkdir(directory, { recursive: true });
  await mkdir(path.join(sqlite, ".forgeloop"), { recursive: true });
  const descriptor = createTaskDescriptor({ taskId: TASK, writeClaims: [], createdAt: AT, updatedAt: AT });
  const state = createWorkState({ taskId: TASK, phase: "RECEIVED", contractFingerprint: "0".repeat(64), createdAt: AT, updatedAt: AT });
  await writeFile(path.join(directory, "task.json"), JSON.stringify(descriptor));
  await writeFile(path.join(directory, "work-state.json"), JSON.stringify(state));
  const db = openStorageDatabase(path.join(sqlite, ".forgeloop/state.sqlite"));
  const output = await open(path.join(directory, "events.ndjson"), "wx");
  const digest = createHash("sha256");
  let previousHash = null;
  try {
    upsertTask(db, { taskId: TASK, descriptor, state });
    // Generate and commit bounded chunks without holding the whole ledger in memory.
    for (let offset = 0; offset < count; offset += 1000) {
      const events = [];
      for (let index = offset + 1; index <= Math.min(count, offset + 1000); index += 1) {
        const event = { seq: index, schemaVersion: 1, protocolVersion: 1, taskId: TASK, event: index === 1 ? "TASK_RECEIVED" : "OBSERVATION", at: AT, previousHash, details: { seed, observation: index, message: `observation:${seed}:${index}:`.padEnd(payloadBytes, ".") } };
        event.hash = eventHash(event);
        previousHash = event.hash;
        events.push(event);
      }
      runInTransaction(db, () => { for (const event of events) appendEvent(db, { taskId: TASK, event }); });
      const bytes = events.map(event => `${JSON.stringify(event)}\n`).join("");
      digest.update(bytes);
      await output.writeFile(bytes);
    }
    await output.sync();
  } finally { await output.close(); db.close(); }
  return { filesystem, sqlite, expected: { count, lastHash: previousHash, sha256: digest.digest("hex") }, ledgerBytes: (await stat(path.join(directory, "events.ndjson"))).size, databaseBytes: (await stat(path.join(sqlite, ".forgeloop/state.sqlite"))).size };
}

async function child(args) {
  const start = performance.now();
  const worker = spawn(process.execPath, [fileURLToPath(import.meta.url), ...args], { stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  worker.stdout.on("data", bytes => { stdout += bytes; });
  worker.stderr.on("data", bytes => { stderr += bytes; });
  const completion = await new Promise((resolve, reject) => {
    worker.once("error", reject);
    worker.once("close", (code, signal) => code === 0 && signal === null
      ? resolve({ pid: worker.pid, exitCode: code, signal, stdioClosed: true })
      : reject(new Error(`Ledger worker failed (${code}, ${signal}): ${stderr}`)));
  });
  return { ...JSON.parse(stdout), workerCompletion: completion, freshWorkerWallMs: rounded(performance.now() - start) };
}

async function main() {
  const sizes = String(arg("events", "10,1000,100000")).split(",").map(Number);
  assert.ok(sizes.length && sizes.every(value => Number.isSafeInteger(value) && value > 0 && value <= 1000000), "Invalid --events");
  const repeats = integer("repeats", 3, 1, 30);
  const warmup = integer("warmup", 1, 0, 10);
  const seedValue = integer("seed", 42, 0, 1000000);
  const payloadBytes = integer("payload-bytes", 1024, 64, 16384);
  const rows = [];
  const baselineTemporary = await mkdtemp(path.join(os.tmpdir(), "forgeloop-ledger-baseline-"));
  const baselineRoot = path.join(baselineTemporary, "source");
  try {
    await mkdir(baselineRoot);
    const archive = path.join(baselineTemporary, "source.tar");
    execFileSync("git", ["archive", "--format=tar", "--output", archive, BASELINE], { cwd: packageRoot });
    execFileSync("tar", ["-xf", archive, "-C", baselineRoot]);
    await symlink(path.join(packageRoot, "node_modules"), path.join(baselineRoot, "node_modules"), process.platform === "win32" ? "junction" : "dir");
    const baselineVersion = JSON.parse(await readFile(path.join(baselineRoot, "package.json"))).version;
    for (const size of sizes) {
      const temporary = await mkdtemp(path.join(os.tmpdir(), "forgeloop-ledger-memory-"));
      try {
        const fixture = await seed(temporary, size, seedValue, payloadBytes);
        for (const [backend, operation] of [["filesystem", "iterator"], ["sqlite", "iterator"], ["sqlite", "audit"], ["sqlite", "audit-array"], ["filesystem", "audit"], ["sqlite", "export"]]) {
          const result = await child([`--baseline-root=${baselineRoot}`, `--read-scope=${readScope}`, `--worker=${backend}`, `--operation=${operation}`, `--target=${fixture[backend]}`, `--expected=${JSON.stringify(fixture.expected)}`, `--repeats=${repeats}`, `--warmup=${warmup}`]);
          rows.push({ events: size, ledgerBytes: fixture.ledgerBytes, databaseBytes: fixture.databaseBytes, ...result });
          process.stderr.write(`${size} ${backend} ${operation}: status=${result.status} p95=${result.p95Ms}ms RSS=${result.peakProcessRssKiB}KiB\n`);
        }
      } finally { await rm(temporary, { recursive: true, force: true }); }
    }
    const result = { schemaVersion: 1, baseline: { commit: BASELINE, packageVersion: baselineVersion, source: "Pinned pre-migration filesystem readers" }, generatedAt: new Date().toISOString(), readScope, seed: seedValue, payloadBytes, runtime: process.version, platform: process.platform, arch: process.arch, cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, totalMemoryBytes: os.totalmem(), loadAverage: os.loadavg(), sqliteDurability: { journalMode: "WAL", synchronous: "FULL" }, method: "Fresh worker per operation/size; common benchmark harness plus pinned reader imports for filesystem rows; warm domain timings; read-only operational scope by default, explicit mutation-observation mode retains CAS read-set hashing; peak process RSS includes startup, warmup, measured samples and export validation; setup excluded; no forced GC or controlled filesystem cache eviction; no baseline-equivalent export timing; no CLI/platform/concurrency or full acceptance claim.", rows };
    const filename = arg("out", null);
    if (filename) await writeFile(filename, `${JSON.stringify(result, null, 2)}\n`);
    else process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally { await rm(baselineTemporary, { recursive: true, force: true }); }
}

if (arg("worker", null)) process.stdout.write(`${JSON.stringify(await measureWorker())}\n`);
else await main();
