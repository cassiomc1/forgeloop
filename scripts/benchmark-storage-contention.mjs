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
import { buildPublicStateEventLane } from "./lib/benchmark-domain-fixture.mjs";
import { BENCHMARK_SOURCE_MANIFEST_SCHEMA_VERSION, captureBenchmarkSourceManifest } from "./lib/benchmark-source-manifest.mjs";

const argument = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const baselineRevision = "ee9ce11123d4e728d3dbc92f5d62d4bf41bb79c5";
const taskId = "contention-benchmark";
const timestamp = "2026-09-11T00:00:00.000Z";
const claims = ["src/contention.js"];
const percentile = (values, fraction = 0.95) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * fraction) - 1];

function serializeError(error) {
  const result = {
    name: error?.name ?? "Error",
    code: error?.code ?? null,
    message: error?.message ?? String(error),
    stack: error?.stack ?? null,
  };
  if (Array.isArray(error?.cleanupErrors)) result.cleanupErrors = error.cleanupErrors;
  if (error?.details) result.details = error.details;
  return result;
}

function assertLatencySamples(samples, label) {
  assert.ok(Array.isArray(samples) && samples.length > 0, `${label} must contain at least one sample`);
  assert.ok(samples.every(value => Number.isFinite(value) && value >= 0), `${label} must contain finite non-negative values`);
}

function isBaselineRefusal(error) {
  return error?.code === "E_BENCHMARK_BASELINE_JSON_LIMIT_REFUSAL";
}

async function admittedSourceManifest(root) {
  const manifest = await captureBenchmarkSourceManifest(root);
  assert.equal(manifest.status, "", `Timed contention sources must be committed and unchanged: ${manifest.status}`);
  assert.deepEqual(manifest.untrackedEvidence.unexpectedPaths, [], `Untracked runtime or benchmark source cannot qualify a frozen comparison: ${JSON.stringify(manifest.untrackedEvidence.unexpectedPaths)}`);
  return manifest;
}

async function api(root) {
  const load = name => import(pathToFileURL(path.join(root, `src/core/${name}.js`)).href);
  return { ...(await load("work-state")), ...(await load("events")), ...(await load("transaction")), ...(await load("task-claim-state")) };
}

async function worker() {
  const root = argument("implementation-root");
  const target = argument("target");
  const operations = Number(argument("operations"));
  const fixtureMode = argument("fixture") ?? "synthetic";
  const workerTaskId = argument("task-id") ?? taskId;
  const operation = argument("operation") ?? "state-event";
  assert.ok(["synthetic", "public-domain"].includes(fixtureMode));
  assert.equal(operation, "state-event", "The public contract has no isolated claim-reservation operation");
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
        await implementation.withTaskTransaction({ target, taskId: workerTaskId, operation: "benchmark-contention-" + fixtureMode, packageRoot: root, recordCommitEvent: false }, async () => {
          // Admission is part of every timed attempt for both implementations.
          // The public guard validates complete ledger/coherence and ownership
          // before ordinary mutation; fixture admission alone is insufficient.
          await implementation.assertTaskMutationAllowed(target, { taskId: workerTaskId, packageRoot: root });
          const previous = await implementation.readWorkState(target, { taskId: workerTaskId, packageRoot: root });
          const state = await implementation.mutateWorkState(target, { taskId: workerTaskId, packageRoot: root, expectedRevision: previous.revision }, value => ({ ...value, lastUpdated: timestamp }));
          await implementation.appendProtocolEvent(target, { taskId: workerTaskId,
            event: fixtureMode === "public-domain" ? "OBSERVATION" : "TASK_RECEIVED", at: timestamp,
            details: { fixture: "contention-" + fixtureMode, revision: state.revision, stateFingerprint: contractFingerprint(state) } }, root, { taskId: workerTaskId });
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
  assert.equal(samples.length, operations, `worker ${process.pid} must return one latency sample per operation`);
  assertLatencySamples(samples, `worker ${process.pid} latency samples`);
  process.send({ result: { operations, sampleCount: samples.length, samplesMs: samples, retries, ...(resources ? { cpuMicros: process.cpuUsage(cpuBefore), beginImmediate } : {}), peakProcessRssKiB: process.resourceUsage().maxRSS,
    eventLoopDelayMaxMs: histogram.max / 1e6, eventLoopDelayP95Ms: histogram.percentile(95) / 1e6 } });
  process.disconnect();
}

function spawnWorker(root, target, operations, resources, fixtureMode, workerTaskId, operation) {
  let resolveReady; let resolveDone; let rejectDone;
  const ready = new Promise(resolve => { resolveReady = resolve; });
  const done = new Promise((resolve, reject) => { resolveDone = resolve; rejectDone = reject; });
  const started = performance.now(); let startupMs; let result; let stderr = "";
  const child = fork(import.meta.filename, [
    "--worker=1",
    "--implementation-root=" + root,
    "--target=" + target,
    "--operations=" + operations,
    "--resources=" + resources,
    "--fixture=" + fixtureMode,
    "--task-id=" + workerTaskId,
    "--operation=" + operation,
  ], { silent: true });
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

async function runWorkers(root, target, processes, operations, resources, fixtureMode, workerTaskId, operation) {
  const workers = Array.from({ length: processes }, () => spawnWorker(root, target, operations, resources, fixtureMode, workerTaskId, operation));
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
    assert.equal(samples.length, processes * operations, "Contention must return one sample per completed operation");
    assertLatencySamples(samples, "Contention latency samples");
    assert.ok(Number.isFinite(elapsedMs) && elapsedMs > 0, "Contention elapsed time must be finite and positive");
    const commitP50Ms = percentile(samples, 0.5);
    const commitP95Ms = percentile(samples, 0.95);
    const throughputCommitsPerSecond = processes * operations * 1000 / elapsedMs;
    assert.ok(Number.isFinite(commitP50Ms) && commitP50Ms >= 0, "Contention p50 must be finite and non-negative");
    assert.ok(Number.isFinite(commitP95Ms) && commitP95Ms >= 0, "Contention p95 must be finite and non-negative");
    assert.ok(Number.isFinite(throughputCommitsPerSecond) && throughputCommitsPerSecond >= 0, "Contention throughput must be finite and non-negative");
    return { elapsedMs, sampleCount: samples.length, throughputCommitsPerSecond,
      commitP50Ms, commitP95Ms, ...(resources ? { walSamples, maximumObservedWalBytes, walSamplingIntervalMs: 2 } : {}), workers: results };
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

async function validateSeedParity({ target, portable, currentRoot, baselineRoot, native, baseline, eventCount, fixtureMode, publicPreludeEvents = null }) {
  const nativeLedger = await native.validateEventLedger(target, currentRoot, { taskId });
  assert.equal(nativeLedger.valid, true, JSON.stringify(nativeLedger.errors));
  assert.equal(nativeLedger.events.length, eventCount);
  let baselineLedger;
  try {
    baselineLedger = await baseline.validateEventLedger(portable, baselineRoot, { taskId });
  } catch (error) {
    if (error.code === "JSON_LIMIT_EXCEEDED") {
      throw Object.assign(new Error("Pinned baseline refused contention ledger at its existing JSON byte limit"), {
        code: "E_BENCHMARK_BASELINE_JSON_LIMIT_REFUSAL",
        details: { eventCount, fixtureMode, nativeLedgerValid: true, nativeEventCount: nativeLedger.events.length, cause: serializeError(error) },
      });
    }
    throw error;
  }
  if (!baselineLedger.valid) {
    const errors = baselineLedger.errors ?? [];
    const knownRefusal = errors.length > 0 && errors.every(error => (error.code ?? error.causeCode) === "JSON_LIMIT_EXCEEDED");
    const failure = Object.assign(new Error(knownRefusal
      ? "Pinned baseline refused contention ledger at its existing JSON byte limit"
      : "Pinned baseline failed contention ledger validation"), {
      code: knownRefusal ? "E_BENCHMARK_BASELINE_JSON_LIMIT_REFUSAL" : "E_BENCHMARK_BASELINE_VALIDATION_FAILURE",
      details: { errors, eventCount, fixtureMode, nativeLedgerValid: true, nativeEventCount: nativeLedger.events.length },
    });
    throw failure;
  }
  assert.deepEqual(baselineLedger.events, nativeLedger.events);
  const nativeState = await native.readWorkState(target, { taskId, packageRoot: currentRoot });
  const baselineState = await baseline.readWorkState(portable, { taskId, packageRoot: baselineRoot });
  assert.deepEqual(native.validateStateLedgerCoherence(nativeState, nativeLedger.events), []);
  assert.deepEqual(baseline.validateStateLedgerCoherence(baselineState, baselineLedger.events), []);
  assert.deepEqual(baselineState, nativeState);
  const nativeOwnership = await native.resolveTaskClaimState(target, { taskId, packageRoot: currentRoot });
  const baselineOwnership = await baseline.resolveTaskClaimState(portable, { taskId, packageRoot: baselineRoot });
  assert.deepEqual(baselineOwnership, nativeOwnership);
  assert.equal(nativeOwnership.claimState, "ACTIVE");
  assert.equal(nativeOwnership.mutationAllowed, true);
  await native.assertTaskMutationAllowed(target, { taskId, packageRoot: currentRoot });
  await baseline.assertTaskMutationAllowed(portable, { taskId, packageRoot: baselineRoot });
  return {
    initialEvents: nativeLedger.events.length,
    initialRevision: nativeState.revision,
    publicPreludeEvents,
    fixtureAdmission: {
      status: fixtureMode === "public-domain" ? "VALIDATED" : "DIAGNOSTIC_ONLY_VALIDATED",
      fixtureMode,
      requestedEvents: eventCount,
      observedEvents: nativeLedger.events.length,
      claims: [...claims],
      stateAndLedgerParity: true,
      ownershipParity: true,
      mutationAdmission: true,
    },
  };
}

async function seedPublicFixture({ target, portable, currentRoot, baselineRoot, native, baseline, eventCount }) {
  const fixture = await buildPublicStateEventLane({
    target,
    packageRoot: currentRoot,
    taskId,
    eventCount,
    claims,
  });
  const db = openStorageDatabase(path.join(target, ".forgeloop/state.sqlite"), { readOnly: true });
  try {
    assert.equal(db.prepare("PRAGMA synchronous").get().synchronous, 2);
    assert.equal(db.prepare("PRAGMA journal_mode").get().journal_mode, "wal");
    await exportDatabase(db, portable);
  } finally {
    db.close();
  }
  const head = fixture.ledger.at(-1);
  await writeFile(
    path.join(portable, taskArtifactPath(taskId, "events") + ".index.json"),
    JSON.stringify({ schemaVersion: 1, seq: head.seq, lastHash: head.hash }),
  );
  return validateSeedParity({
    target, portable, currentRoot, baselineRoot, native, baseline, eventCount,
    fixtureMode: "public-domain", publicPreludeEvents: fixture.preludeEvents,
  });
}

function contentionOptions() {
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
  const fixtureMode = argument("fixture") ?? "synthetic";
  const operation = argument("operation") ?? "state-event";
  assert.ok(["synthetic", "public-domain"].includes(fixtureMode));
  assert.equal(operation, "state-event", "The current public contract has no isolated claim-reservation operation");
  if (fixtureMode === "public-domain") assert.ok(events >= 2, "Public state/event fixtures require at least two requested events");
  assert.ok(processCounts.every(value => [1, 2, 4, 8].includes(value)));
  assert.ok(Number.isInteger(operations) && operations >= 1 && operations <= 100);
  assert.ok(Number.isInteger(repeats) && repeats >= 1 && repeats <= 20);
  assert.ok(Number.isInteger(events) && events >= 1 && events <= 1000);
  const validationOnly = process.argv.includes("--validate-only");
  return { baselineRoot, currentRoot, resources, processCounts, operations, repeats, events, fixtureMode, operation, validationOnly };
}

function contentionOutput({ validationOnly, fixtureMode, operation, sourceBefore, sourceAfter, trackedSourcesUnchanged, resources, firstFailure, results }) {
  return {
    schemaVersion: 2,
    baselineRevision,
    sourceManifestSchemaVersion: BENCHMARK_SOURCE_MANIFEST_SCHEMA_VERSION,
    validationOnly,
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
    cpu: os.cpus()[0]?.model,
    timestamp,
    fixtureMode,
    operation,
    sourceManifests: { before: sourceBefore, after: sourceAfter },
    trackedSourcesUnchanged,
    claimReservationLane: {
      status: "REPRESENTATIVE_PUBLIC_LIFECYCLE",
      measuredInThisLane: false,
      operations: ["task-create", "task-resume"],
      reason: "The public APIs reserve claims as part of task-create and task-resume; a dedicated claim lifecycle lane must measure those full operations and must not infer claim performance from state-event rows.",
      authorityBoundary: "Do not replace these lifecycle calls with storage-level reserveClaims or treat lease ownership as ordinary state mutation.",
    },
    seedOutsideMeasurement: true,
    releaseThresholdsVerified: false,
    runtime: validationOnly
      ? "Validation-only fixture admission and native/baseline parity; no worker timing or contention samples are produced"
      : "Independent persistent Node API worker processes; readiness barrier excludes harness startup from contention timing; not CLI/MCP or filesystem-cold evidence",
    resourceInstrumentationRequested: resources === "true",
    resourceInstrumentation: !validationOnly && resources === "true",
    resourceLimits: [
      "BEGIN IMMEDIATE duration includes SQL entry overhead and lock waiting; it excludes optimistic conflict retries before BEGIN",
      "WAL maximum is periodically observed, not a guaranteed instantaneous peak",
      "Instrumented timings are not uninstrumented release latency",
    ],
    durability: "Native WAL/FULL and unchanged pinned filesystem fsync; separate power-loss proof remains required",
    measurementLimits: [
      "Every timed operation includes public mutation admission with complete ledger/coherence and ownership validation; retries include that admission again",
      "Filesystem operations and SQLite internal I/O are not measured",
      "Worker RSS excludes parent fixture setup",
      "Process startup is harness startup, not CLI startup",
      "Public-domain fixture uses maintained public task/discover/contract/observation APIs; claim reservation is not measured as an isolated operation",
    ],
    firstFailure,
    nonComparableResults: results.filter(row => row.status === "NOT_COMPARABLE").length,
    results,
  };
}

async function verifyContentionSources({ currentRoot, baselineRoot, sourceBefore, firstFailure, activeFailureContext, results }) {
  let sourceAfter = null;
  try {
    sourceAfter = { current: await captureBenchmarkSourceManifest(currentRoot), baseline: await captureBenchmarkSourceManifest(baselineRoot) };
  } catch (error) {
    firstFailure ??= {
      status: "FAILED",
      firstCause: serializeError(error),
      context: { ...activeFailureContext, stage: "SOURCE_POSTCHECK" },
      resultsProduced: results.length,
    };
  }
  const trackedSourcesUnchanged = sourceAfter !== null && JSON.stringify(sourceAfter) === JSON.stringify(sourceBefore);
  if (!trackedSourcesUnchanged) {
    const sourceFailure = { code: "E_SOURCE_CHANGED", message: "Current or baseline source/dependency admission changed during contention measurement" };
    if (firstFailure) firstFailure.sourceIntegrity = sourceFailure;
    else firstFailure = { status: "FAILED", firstCause: sourceFailure, context: { stage: "SOURCE_POSTCHECK" }, resultsProduced: results.length };
  }
  return { sourceAfter, firstFailure, trackedSourcesUnchanged };
}

async function main() {
  const { baselineRoot, currentRoot, resources, processCounts, operations, repeats, events, fixtureMode, operation, validationOnly } = contentionOptions();
  const native = await api(currentRoot); const baseline = await api(baselineRoot); const results = [];
  const sourceBefore = { current: await admittedSourceManifest(currentRoot), baseline: await admittedSourceManifest(baselineRoot) };
  let firstFailure = null;
  let activeFailureContext = { stage: "PRE_MEASUREMENT", processes: null, repetition: null };
  try {
  for (const processes of processCounts) {
    for (let repetition = 0; repetition < repeats; repetition += 1) {
      activeFailureContext = { stage: "FIXTURE_SETUP", processes, repetition, validationOnly };
      const root = await mkdtemp(path.join(os.tmpdir(), "forgeloop-contention-"));
      const target = path.join(root, "native"); const portable = path.join(root, "baseline"); let db;
      let rowError = null;
      let pendingResult = null;
      try {
        await mkdir(path.join(target, ".forgeloop"), { recursive: true });
        await mkdir(portable, { recursive: true });
        let initialEvents = events;
        let initialRevision = 0;
        let publicPreludeEvents = null;
        let fixtureAdmission = { status: "DIAGNOSTIC_ONLY", fixtureMode: "synthetic" };
        let baselineRefusal = null;
        if (fixtureMode === "public-domain") {
          try {
            const publicFixture = await seedPublicFixture({
              target, portable, currentRoot, baselineRoot, native, baseline, eventCount: events,
            });
            initialEvents = publicFixture.initialEvents;
            initialRevision = publicFixture.initialRevision;
            publicPreludeEvents = publicFixture.publicPreludeEvents;
            fixtureAdmission = publicFixture.fixtureAdmission;
          } catch (error) {
            if (!isBaselineRefusal(error)) throw error;
            baselineRefusal = error;
          }
        } else {
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
          await writeFile(path.join(portable, taskArtifactPath(taskId, "events") + ".index.json"), JSON.stringify({ schemaVersion: 1, ...checkpoint }));
        }
        if (fixtureMode === "synthetic") {
          try {
            const syntheticFixture = await validateSeedParity({
              target, portable, currentRoot, baselineRoot, native, baseline,
              eventCount: events, fixtureMode: "synthetic",
            });
            initialEvents = syntheticFixture.initialEvents;
            initialRevision = syntheticFixture.initialRevision;
            fixtureAdmission = syntheticFixture.fixtureAdmission;
          } catch (error) {
            if (!isBaselineRefusal(error)) throw error;
            baselineRefusal = error;
          }
        }
        if (baselineRefusal) {
          const refusal = serializeError(baselineRefusal);
          const details = baselineRefusal.details ?? {};
          pendingResult = {
            status: "NOT_COMPARABLE",
            comparability: "NOT_COMPARABLE",
            fixtureMode,
            operation,
            processes,
            repetition,
            operationsPerProcess: operations,
            requestedEvents: events,
            initialEvents: null,
            initialRevision: null,
            publicPreludeEvents: null,
            fixtureAdmission: {
              status: "BASELINE_REFUSED",
              fixtureMode,
              requestedEvents: events,
              observedEvents: details.nativeEventCount ?? null,
              nativeAdmission: details.nativeLedgerValid === true ? "VALIDATED" : "UNKNOWN",
              stateAndLedgerParity: null,
              ownershipParity: null,
              refusal,
            },
            sampleCount: null,
            nativeSamplesMs: null,
            baselineSamplesMs: null,
            nativeP50Ms: null,
            nativeP95Ms: null,
            baselineP50Ms: null,
            baselineP95Ms: null,
            throughputCommitsPerSecond: null,
            workers: null,
          };
          continue;
        }
        if (validationOnly) {
          pendingResult = {
            status: "VALIDATED",
            timingStatus: "NOT_MEASURED",
            timingAcceptanceEligible: false,
            fixtureMode,
            operation,
            processes,
            repetition,
            operationsPerProcess: operations,
            initialEvents,
            initialRevision,
            publicPreludeEvents,
            fixtureAdmission,
            outputAndOwnershipParity: true,
            sampleCount: 0,
            nativeSamplesMs: [],
            baselineSamplesMs: [],
            nativeP50Ms: null,
            nativeP95Ms: null,
            baselineP50Ms: null,
            baselineP95Ms: null,
            throughputCommitsPerSecond: null,
            workers: [],
          };
          continue;
        }
        const observed = {};
        const order = repetition % 2 ? [["baseline", baselineRoot, portable], ["native", currentRoot, target]] : [["native", currentRoot, target], ["baseline", baselineRoot, portable]];
        activeFailureContext = { stage: "WORKERS", processes, repetition, operations, fixtureMode };
        for (const [backend, implementation, project] of order) {
          observed[backend] = await runWorkers(implementation, project, processes, operations, resources === "true", fixtureMode, taskId, operation);
        }
        activeFailureContext = { stage: "PARITY", processes, repetition, operations, fixtureMode };
        const stateNative = await native.readWorkState(target, { taskId, packageRoot: currentRoot });
        const stateBaseline = await baseline.readWorkState(portable, { taskId, packageRoot: baselineRoot });
        assert.deepEqual(stateNative, stateBaseline);
        assert.equal(stateNative.revision, initialRevision + processes * operations);
        const nativeEvents = await native.readEvents(target, currentRoot, { taskId });
        const baselineEvents = await baseline.readEvents(portable, baselineRoot, { taskId });
        assert.deepEqual(nativeEvents, baselineEvents);
        assert.equal(nativeEvents.length, initialEvents + processes * operations);
        assert.equal(validateLedgerEvents(nativeEvents).valid, true);
        assert.equal(validateLedgerEvents(baselineEvents).valid, true);
        assert.deepEqual(native.validateStateLedgerCoherence(stateNative, nativeEvents), []);
        assert.deepEqual(baseline.validateStateLedgerCoherence(stateBaseline, baselineEvents), []);
        const nativeOwnership = await native.resolveTaskClaimState(target, { taskId, packageRoot: currentRoot });
        assert.deepEqual(nativeOwnership, await baseline.resolveTaskClaimState(portable, { taskId, packageRoot: baselineRoot }));
        assert.equal(nativeOwnership.mutationAllowed, true);
        db = openStorageDatabase(path.join(target, ".forgeloop/state.sqlite"));
        assert.deepEqual(db.prepare("SELECT claim_norm, reservation_state FROM claims WHERE task_id = ?").all(taskId).map(row => ({ ...row })), [{ claim_norm: claims[0], reservation_state: "ACTIVE" }]);
        db.close(); db = null;
        results.push({ fixtureMode, operation, processes, repetition, operationsPerProcess: operations, initialEvents, initialRevision, publicPreludeEvents, fixtureAdmission, outputAndOwnershipParity: true,
          nativeDatabaseBytesAfterClose: await byteSize(path.join(target, ".forgeloop/state.sqlite")), nativeWalBytesAfterClose: await byteSize(path.join(target, ".forgeloop/state.sqlite-wal")), ...observed });
      } catch (error) {
        rowError = error;
        throw error;
      } finally {
        const cleanupErrors = [];
        try { db?.close(); } catch (error) { cleanupErrors.push(serializeError(error)); }
        try { await rm(root, { recursive: true, force: true }); } catch (error) { cleanupErrors.push(serializeError(error)); }
        if (cleanupErrors.length > 0) {
          if (rowError) rowError.cleanupErrors = cleanupErrors;
          else throw Object.assign(new Error("Contention benchmark cleanup failed"), { code: "E_BENCHMARK_CLEANUP", cleanupErrors });
        }
        if (pendingResult) {
          pendingResult.cleanupVerified = cleanupErrors.length === 0;
          results.push(pendingResult);
        }
      }
    }
  }
  } catch (error) {
    firstFailure = {
      status: "FAILED",
      firstCause: serializeError(error),
      context: { ...activeFailureContext },
      resultsProduced: results.length,
    };
  }
  const sourceVerification = await verifyContentionSources({ currentRoot, baselineRoot, sourceBefore, firstFailure, activeFailureContext, results });
  const { sourceAfter, trackedSourcesUnchanged } = sourceVerification;
  firstFailure = sourceVerification.firstFailure;
  const output = contentionOutput({ validationOnly, fixtureMode, operation, sourceBefore, sourceAfter, trackedSourcesUnchanged, resources, firstFailure, results });
  if (firstFailure) process.exitCode = 1;
  process.stdout.write(JSON.stringify(output, null, 2) + "\n");
}

if (argument("worker")) await worker(); else await main();
