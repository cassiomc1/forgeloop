/** Independent-process public transaction contention; synthetic setup is excluded. */
import assert from "node:assert/strict";
import { execFileSync, fork } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { performance, monitorEventLoopDelay } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { createTaskDescriptor } from "../src/core/task-descriptor.js";
import { createWorkState, contractFingerprint } from "../src/core/work-state.js";
import { buildProtocolEvent, validateLedgerEvents } from "../src/core/events.js";
import { taskArtifactPath } from "../src/core/task-paths.js";
import { openStorageDatabase, runInTransaction, upsertTask, appendEvent, reserveClaims, exportDatabase } from "../src/storage/index.js";

const argument = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const baselineRevision = "ee9ce11123d4e728d3dbc92f5d62d4bf41bb79c5";
const taskId = "contention-benchmark";
const timestamp = "2026-09-11T00:00:00.000Z";
const claims = ["src/contention.js"];
const percentile = values => [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1];
async function api(root) {
  const load = name => import(pathToFileURL(path.join(root, `src/core/${name}.js`)).href);
  return { ...(await load("work-state")), ...(await load("events")), ...(await load("transaction")), ...(await load("task-claim-state")) };
}

async function worker() {
  const root = argument("implementation-root");
  const target = argument("target");
  const operations = Number(argument("operations"));
  const implementation = await api(root);
  const resources = argument("resources") === "true";
  const beginImmediate = [];
  let restoreExec;
  if (resources) {
    const { DatabaseSync } = await import("node:sqlite");
    const originalExec = DatabaseSync.prototype.exec;
    DatabaseSync.prototype.exec = function(sql) {
      if (sql !== "BEGIN IMMEDIATE") return originalExec.call(this, sql);
      const started = performance.now();
      let succeeded = false;
      try { const result = originalExec.call(this, sql); succeeded = true; return result; }
      finally { beginImmediate.push({ elapsedMs: performance.now() - started, succeeded }); }
    };
    restoreExec = () => { DatabaseSync.prototype.exec = originalExec; };
  }
  const histogram = monitorEventLoopDelay({ resolution: 10 });
  process.send({ ready: true });
  await new Promise(resolve => process.once("message", resolve));
  histogram.enable();
  const samples = []; const retries = {};
  const cpuBefore = process.cpuUsage();
  for (let index = 0; index < operations; index += 1) {
    const started = performance.now();
    for (let attempt = 0; ; attempt += 1) {
      try {
        await implementation.withTaskTransaction({ target, taskId, operation: "benchmark-contention", packageRoot: root }, async () => {
          const previous = await implementation.readWorkState(target, { taskId, packageRoot: root });
          const state = await implementation.mutateWorkState(target, { taskId, packageRoot: root, expectedRevision: previous.revision }, value => ({ ...value, lastUpdated: timestamp }));
          await implementation.appendProtocolEvent(target, { taskId, event: "TASK_RECEIVED", at: timestamp,
            details: { fixture: "contention", revision: state.revision, stateFingerprint: contractFingerprint(state) } }, root, { taskId });
        });
        break;
      } catch (error) {
        // Benchmark callbacks contain only rolled-back deterministic storage
        // mutations. Never retry arbitrary external side effects or corruption.
        if (attempt >= 99 || !["E_STATE_REVISION_CONFLICT", "E_TASK_LOCKED", "SQLITE_BUSY"].includes(error.code)) throw error;
        retries[error.code] = (retries[error.code] ?? 0) + 1;
        await delay(5 + attempt % 7);
      }
    }
    samples.push(performance.now() - started);
  }
  await delay(15);
  histogram.disable();
  restoreExec?.();
  process.send({ result: { operations, samplesMs: samples, retries, ...(resources ? { cpuMicros: process.cpuUsage(cpuBefore), beginImmediate } : {}), peakProcessRssKiB: process.resourceUsage().maxRSS,
    eventLoopDelayMaxMs: histogram.max / 1e6, eventLoopDelayP95Ms: histogram.percentile(95) / 1e6 } });
  process.disconnect();
}

function spawnWorker(root, target, operations, resources) {
  let resolveReady; let resolveDone; let rejectDone;
  const ready = new Promise(resolve => { resolveReady = resolve; });
  const done = new Promise((resolve, reject) => { resolveDone = resolve; rejectDone = reject; });
  const started = performance.now(); let startupMs; let result; let stderr = "";
  const child = fork(import.meta.filename, ["--worker=1", `--implementation-root=${root}`, `--target=${target}`, `--operations=${operations}`, `--resources=${resources}`], { silent: true });
  child.stdout.resume();
  child.stderr.on("data", chunk => { stderr += chunk; });
  child.on("message", message => {
    if (message.ready) { startupMs = performance.now() - started; resolveReady(); }
    if (message.result) result = message.result;
  });
  child.on("error", error => { resolveReady(); rejectDone(error); });
  child.on("close", (code, signal) => {
    resolveReady();
    if (code === 0 && signal === null && result) resolveDone({ ...result, harnessProcessStartupMs: startupMs,
      workerCompletion: { pid: child.pid, exitCode: code, signal, stdioClosed: true } });
    else rejectDone(new Error(`Contention worker failed (${code}/${signal}): ${stderr.slice(-2000)}`));
  });
  // Attach a handler before admission so an early failure cannot become an
  // unhandled rejection while other workers are still starting.
  done.catch(() => {});
  return { child, ready, done };
}

async function runWorkers(root, target, processes, operations, resources) {
  const workers = Array.from({ length: processes }, () => spawnWorker(root, target, operations, resources));
  let sampling = false; let sampler; let walSamples = 0; let maximumObservedWalBytes = 0;
  try {
    await Promise.all(workers.map(value => value.ready));
    const unavailable = workers.find(value => !value.child.connected);
    if (unavailable) {
      await unavailable.done;
      throw new Error("Contention worker disconnected before barrier release");
    }
    if (resources) {
      sampling = true;
      sampler = (async () => {
        while (sampling) {
          maximumObservedWalBytes = Math.max(maximumObservedWalBytes, await byteSize(path.join(target, ".forgeloop/state.sqlite-wal")));
          walSamples++;
          await delay(2);
        }
      })();
      sampler.catch(() => {});
    }
    const started = performance.now();
    for (const value of workers) value.child.send("go");
    const results = await Promise.all(workers.map(value => value.done));
    const elapsedMs = performance.now() - started;
    sampling = false; await sampler;
    const samples = results.flatMap(value => value.samplesMs);
    return { elapsedMs, throughputCommitsPerSecond: processes * operations * 1000 / elapsedMs,
      commitP95Ms: percentile(samples), ...(resources ? { walSamples, maximumObservedWalBytes, walSamplingIntervalMs: 2 } : {}), workers: results };
  } finally {
    sampling = false;
    try { await sampler; }
    finally {
      for (const value of workers) if (value.child.exitCode === null && value.child.signalCode === null) value.child.kill();
      await Promise.allSettled(workers.map(value => value.done));
    }
  }
}

async function byteSize(filename) {
  try { return (await stat(filename)).size; }
  catch (error) { if (error.code === "ENOENT") return 0; throw error; }
}

async function main() {
  const baselineRoot = path.resolve(argument("baseline-root") ?? "");
  assert.ok(argument("baseline-root"), "A clean pinned baseline is required");
  assert.equal(execFileSync("git", ["-C", baselineRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(), baselineRevision);
  assert.equal(execFileSync("git", ["-C", baselineRoot, "status", "--porcelain", "--untracked-files=no"], { encoding: "utf8" }).trim(), "");
  const currentRoot = path.resolve(import.meta.dirname, "..");
  const resources = argument("resources") ?? "false";
  assert.ok(["true", "false"].includes(resources));
  const processCounts = (argument("processes") ?? "1,2,4,8").split(",").map(Number);
  const operations = Number(argument("operations") ?? 20);
  const repeats = Number(argument("repeats") ?? 3);
  const events = Number(argument("events") ?? 1000);
  assert.ok(processCounts.every(value => [1, 2, 4, 8].includes(value)));
  assert.ok(Number.isInteger(operations) && operations >= 1 && operations <= 100);
  assert.ok(Number.isInteger(repeats) && repeats >= 1 && repeats <= 20);
  assert.ok(Number.isInteger(events) && events >= 1 && events <= 1000);
  const native = await api(currentRoot); const baseline = await api(baselineRoot); const results = [];
  for (const processes of processCounts) {
    for (let repetition = 0; repetition < repeats; repetition += 1) {
      const root = await mkdtemp(path.join(os.tmpdir(), "forgeloop-contention-"));
      const target = path.join(root, "native"); const portable = path.join(root, "baseline"); let db;
      try {
        await mkdir(path.join(target, ".forgeloop"), { recursive: true });
        await mkdir(portable);
        db = openStorageDatabase(path.join(target, ".forgeloop/state.sqlite"));
        assert.equal(db.prepare("PRAGMA synchronous").get().synchronous, 2);
        assert.equal(db.prepare("PRAGMA journal_mode").get().journal_mode, "wal");
        let checkpoint = { seq: 0, lastHash: null };
        runInTransaction(db, () => {
          upsertTask(db, { taskId, descriptor: createTaskDescriptor({ taskId, writeClaims: claims, createdAt: timestamp, updatedAt: timestamp }),
            state: createWorkState({ taskId, phase: "RECEIVED", contractFingerprint: "0".repeat(64), revision: 0, lastUpdated: timestamp }) });
          reserveClaims(db, { taskId, claims, createdAt: timestamp });
          for (let index = 0; index < events; index += 1) {
            const event = buildProtocolEvent({ taskId, event: "TASK_RECEIVED", at: timestamp, details: { fixture: "contention-seed", observation: index } }, { checkpoint });
            appendEvent(db, { taskId, event }); checkpoint = { seq: event.seq, lastHash: event.hash };
          }
        });
        await exportDatabase(db, portable); db.close(); db = null;
        await writeFile(path.join(portable, `${taskArtifactPath(taskId, "events")}.index.json`), JSON.stringify({ schemaVersion: 1, ...checkpoint }));
        const observed = {};
        const order = repetition % 2 ? [["baseline", baselineRoot, portable], ["native", currentRoot, target]] : [["native", currentRoot, target], ["baseline", baselineRoot, portable]];
        for (const [backend, implementation, project] of order) observed[backend] = await runWorkers(implementation, project, processes, operations, resources === "true");
        const stateNative = await native.readWorkState(target, { taskId, packageRoot: currentRoot });
        const stateBaseline = await baseline.readWorkState(portable, { taskId, packageRoot: baselineRoot });
        assert.deepEqual(stateNative, stateBaseline);
        assert.equal(stateNative.revision, processes * operations);
        const nativeEvents = await native.readEvents(target, currentRoot, { taskId });
        const baselineEvents = await baseline.readEvents(portable, baselineRoot, { taskId });
        assert.deepEqual(nativeEvents, baselineEvents);
        assert.equal(nativeEvents.length, events + processes * operations);
        assert.equal(validateLedgerEvents(nativeEvents).valid, true);
        const nativeOwnership = await native.resolveTaskClaimState(target, { taskId, packageRoot: currentRoot });
        assert.deepEqual(nativeOwnership, await baseline.resolveTaskClaimState(portable, { taskId, packageRoot: baselineRoot }));
        assert.equal(nativeOwnership.mutationAllowed, true);
        db = openStorageDatabase(path.join(target, ".forgeloop/state.sqlite"));
        assert.deepEqual(db.prepare("SELECT claim_norm, reservation_state FROM claims WHERE task_id = ?").all(taskId).map(row => ({ ...row })), [{ claim_norm: claims[0], reservation_state: "ACTIVE" }]);
        db.close(); db = null;
        results.push({ processes, repetition, operationsPerProcess: operations, initialEvents: events, outputAndOwnershipParity: true,
          nativeDatabaseBytesAfterClose: await byteSize(path.join(target, ".forgeloop/state.sqlite")), nativeWalBytesAfterClose: await byteSize(path.join(target, ".forgeloop/state.sqlite-wal")), ...observed });
      } finally { db?.close(); await rm(root, { recursive: true, force: true }); }
    }
  }
  process.stdout.write(`${JSON.stringify({ schemaVersion: 1, baselineRevision, node: process.version, platform: process.platform, architecture: process.arch,
    cpu: os.cpus()[0]?.model, timestamp, seedOutsideMeasurement: true, releaseThresholdsVerified: false,
    runtime: "Independent persistent Node API worker processes; readiness barrier excludes harness startup from contention timing; not CLI/MCP or filesystem-cold evidence",
    resourceInstrumentation: resources === "true",
    resourceLimits: ["BEGIN IMMEDIATE duration includes SQL entry overhead and lock waiting;it excludes optimistic conflict retries before BEGIN", "WAL maximum is periodically observed,not a guaranteed instantaneous peak", "Instrumented timings are not uninstrumented release latency"],
    durability: "Native WAL/FULL and unchanged pinned filesystem fsync; separate power-loss proof remains required",
    measurementLimits: ["Filesystem operations and SQLite internal I/O are not measured;direct BEGIN entry timing and sampled live WAL require --resources=true", "Worker RSS excludes parent synthetic seed; process startup is harness startup, not CLI startup"], results }, null, 2)}\n`);
}

if (argument("worker")) await worker(); else await main();
