/** Actual MCP trace reads racing independent canonical task transactions. */
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire, registerHooks } from "node:module";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { createTaskDescriptor } from "../src/core/task-descriptor.js";
import { createWorkState, readWorkState, mutateWorkState, contractFingerprint } from "../src/core/work-state.js";
import { buildProtocolEvent, appendProtocolEvent, readEvents, validateLedgerEvents } from "../src/core/events.js";
import { withTaskTransaction } from "../src/core/transaction.js";
import { loadStorageDriver } from "../src/storage/runtime.js";
import { openStorageDatabase, runInTransaction, upsertTask, appendEvent, reserveClaims } from "../src/storage/index.js";

const argument = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const root = path.resolve(import.meta.dirname, "..");
const taskId = "mcp-mixed";
const initialEvents = 10;
const timestamp = "2026-09-11T00:00:00.000Z";

async function writer() {
  const target = argument("target");
  let stop = false;
  process.on("message", value => { if (value === "stop") stop = true; });
  process.send({ ready: true });
  await new Promise(resolve => process.once("message", resolve));
  let commits = 0;
  const started = performance.now();
  while (!stop && commits < 1000) {
    await withTaskTransaction({ target, taskId, packageRoot: root, operation: "mixed-mcp-benchmark" }, async () => {
      const previous = await readWorkState(target, { taskId, packageRoot: root });
      const state = await mutateWorkState(target, { taskId, packageRoot: root, expectedRevision: previous.revision }, value => ({ ...value, lastUpdated: timestamp }));
      await appendProtocolEvent(target, { taskId, event: "TASK_RECEIVED", at: timestamp,
        details: { revision: state.revision, stateFingerprint: contractFingerprint(state) } }, root, { taskId });
    });
    commits++;
    await delay(5);
  }
  process.send({ commits, elapsedMs: performance.now() - started, memory: process.memoryUsage(), peakRssKiB: process.resourceUsage().maxRSS });
  process.disconnect();
}

function unchangedTaskDigest(db) {
  const digest = createHash("sha256");
  for (const table of ["tasks", "events", "claims"]) {
    digest.update(table);
    for (const row of db.prepare(`SELECT * FROM ${table} WHERE task_id != ? ORDER BY task_id${table === "events" ? ",seq" : ""}`).iterate(taskId)) digest.update(JSON.stringify(row));
  }
  return digest.digest("hex");
}

async function main() {
  assert.ok(argument("output"), "Output path required");
  const repeats = Number(argument("repeats") ?? 20);
  assert.ok(Number.isInteger(repeats) && repeats >= 20 && repeats <= 200);
  const warmup = Number(argument("warmup") ?? 0);
  assert.ok(Number.isInteger(warmup) && warmup >= 0 && warmup <= 2);
  const diagnoseBackup = argument("diagnose-backup") === "true";
  const backupMeasurements = [];
  const warmupSamples = [];
  let restoreBackup;
  const tasks = Number(argument("tasks") ?? 1);
  const readers = Number(argument("readers") ?? 1);
  assert.ok(Number.isInteger(tasks) && tasks >= 1 && tasks <= 1000);
  assert.ok([1, 2, 4].includes(readers));
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-mcp-mixed-"));
  let child; let client; let server; let unaffectedDigest;
  try {
    await mkdir(path.join(target, ".forgeloop"));
    const db = openStorageDatabase(path.join(target, ".forgeloop/state.sqlite"));
    try {
      assert.equal(db.prepare("PRAGMA synchronous").get().synchronous, 2);
      assert.equal(db.prepare("PRAGMA journal_mode").get().journal_mode, "wal");
      runInTransaction(db, () => {
        for (let taskIndex = 0; taskIndex < tasks; taskIndex++) {
          const seededTask = taskIndex === 0 ? taskId : `mcp-mixed-${taskIndex}`;
          const claims = [`src/mixed-${taskIndex}.js`];
          upsertTask(db, { taskId: seededTask, descriptor: createTaskDescriptor({ taskId: seededTask, writeClaims: claims, createdAt: timestamp, updatedAt: timestamp }),
            state: createWorkState({ taskId: seededTask, phase: "RECEIVED", revision: 0, contractFingerprint: "0".repeat(64), lastUpdated: timestamp }) });
          reserveClaims(db, { taskId: seededTask, claims, createdAt: timestamp });
          let checkpoint = { seq: 0, lastHash: null };
          for (let index = 0; index < initialEvents; index++) {
            const event = buildProtocolEvent({ taskId: seededTask, event: "TASK_RECEIVED", at: timestamp, details: { seed: index } }, { checkpoint });
            appendEvent(db, { taskId: seededTask, event }); checkpoint = { seq: event.seq, lastHash: event.hash };
          }
        }
      });
      unaffectedDigest = unchangedTaskDigest(db);
    } finally { db.close(); }
    registerHooks({ resolve(specifier, context, next) {
      if (specifier === "@cassiomc1/forgeloop/integration") return { url: pathToFileURL(path.join(root, "src/integration.js")).href, shortCircuit: true };
      return next(specifier, context);
    } });
    const adapter = path.join(root, "integrations/mcp");
    const require = createRequire(path.join(adapter, "package.json"));
    const { Client } = await import(pathToFileURL(require.resolve("@modelcontextprotocol/client")).href);
    const { InMemoryTransport } = await import(pathToFileURL(require.resolve("@modelcontextprotocol/server")).href);
    const { createForgeLoopMcpServer } = await import(pathToFileURL(path.join(adapter, "src/server.js")).href);
    ({ server } = await createForgeLoopMcpServer({ projectPath: target, mode: "readonly" }));
    client = new Client({ name: "mixed-storage-benchmark", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport); await client.connect(clientTransport);
    if (diagnoseBackup) {
      const driver = loadStorageDriver();
      const originalBackup = driver.backup;
      driver.backup = async (source, ...args) => {
        const started = performance.now();
        const revisionBefore = JSON.parse(source.prepare("SELECT state_json FROM tasks WHERE task_id = ?").get(taskId).state_json).revision;
        try { return await originalBackup(source, ...args); }
        finally {
          const revisionAfter = JSON.parse(source.prepare("SELECT state_json FROM tasks WHERE task_id = ?").get(taskId).state_json).revision;
          backupMeasurements.push({ elapsedMs: performance.now() - started, revisionBefore, revisionAfter });
        }
      };
      restoreBackup = () => { driver.backup = originalBackup; };
    }
    for (let index = 0; index < warmup; index++) {
      const started = performance.now();
      const envelope = await client.callTool({ name: "forgeloop_trace", arguments: { taskId } });
      assert.notEqual(envelope.isError, true, JSON.stringify(envelope));
      const trace = JSON.parse(envelope.content[0].text).result;
      assert.equal(trace.task.revision, 0);
      assert.equal(trace.snapshot.ledgerTailSequence, initialEvents);
      warmupSamples.push(performance.now() - started);
    }
    child = fork(import.meta.filename, ["--worker=true", `--target=${target}`], { silent: true });
    child.stdout.resume(); let stderr = ""; let result;
    child.stderr.on("data", chunk => { stderr += chunk; });
    let readyResolve;
    const ready = new Promise(resolve => { readyResolve = resolve; });
    const done = new Promise((resolve, reject) => {
      child.on("message", message => { if (message.ready) readyResolve(); else result = message; });
      child.on("error", error => { readyResolve(); reject(error); });
      child.on("exit", code => { readyResolve(); if (code === 0 && result) resolve(result); else reject(new Error(`Writer failed: ${code}; ${stderr.slice(-2000)}`)); });
    });
    done.catch(() => {});
    await ready;
    assert.ok(child.connected, "Writer must be alive at barrier");
    const samples = [];
    child.send("go");
    const readTrace = async (batch, reader) => {
      const started = performance.now();
      const envelope = await client.callTool({ name: "forgeloop_trace", arguments: { taskId } });
      assert.notEqual(envelope.isError, true, JSON.stringify(envelope));
      const response = JSON.parse(envelope.content[0].text);
      assert.equal(response.ok, true, JSON.stringify(response.error));
      const trace = response.result;
      assert.equal(trace.snapshot.consistent, true);
      assert.equal(trace.snapshot.stateRevision, trace.task.revision);
      assert.equal(trace.snapshot.ledgerTailSequence, initialEvents + trace.task.revision);
      assert.equal(trace.events.length, initialEvents + trace.task.revision);
      for (let eventIndex = 0; eventIndex < trace.events.length; eventIndex++) {
        const event = trace.events[eventIndex];
        assert.equal(event.sequence, eventIndex + 1);
        if (eventIndex >= initialEvents) assert.equal(event.data.revision, eventIndex - initialEvents + 1);
      }
      samples.push({ batch, reader, elapsedMs: performance.now() - started, revision: trace.task.revision, memory: process.memoryUsage(), peakRssKiB: process.resourceUsage().maxRSS });
    };
    for (let batch = 0; batch < repeats; batch++) {
      await Promise.all(Array.from({ length: readers }, (_, reader) => readTrace(batch, reader)));
    }
    child.send("stop");
    const observedWriter = await done;
    await writeFile(`${argument("output")}.diagnostic.json`, JSON.stringify({
      diagnosticOnly: true, snapshotConsistencyAssertionsPassed: samples.length, tasks, readers, warmup, warmupSamples, diagnoseBackup, backupMeasurements,
      writer: observedWriter, samples, progressObserved: new Set(samples.map(value => value.revision)).size > 1,
    }, null, 2) + "\n");
    assert.ok(observedWriter.commits > 0);
    assert.ok(new Set(samples.map(value => value.revision)).size > 1, "Reads must observe writer progress");
    const state = await readWorkState(target, { taskId, packageRoot: root });
    const events = await readEvents(target, root, { taskId });
    assert.equal(state.revision, observedWriter.commits);
    assert.equal(events.length, initialEvents + observedWriter.commits);
    assert.equal(validateLedgerEvents(events).valid, true);
    assert.ok(samples.some(value => value.revision > 0 && value.revision < observedWriter.commits), "Read must capture an intermediate committed snapshot");
    const finalDb = openStorageDatabase(path.join(target, ".forgeloop/state.sqlite"));
    try {
      assert.equal(finalDb.prepare("SELECT COUNT(*) AS count FROM tasks").get().count, tasks);
      assert.equal(finalDb.prepare("SELECT COUNT(*) AS count FROM events").get().count, tasks * initialEvents + observedWriter.commits);
      assert.equal(unchangedTaskDigest(finalDb), unaffectedDigest, "Every other task, event and claim row must remain unchanged");
    } finally { finalDb.close(); }
    const output = { diagnosticOnly: true, releaseThresholdsVerified: false, node: process.version, repeats, initialEvents, tasks, readers, warmup, warmupSamples, diagnoseBackup, backupMeasurements, totalReads: repeats * readers,
      snapshotConsistencyVerified: true, finalLedgerVerified: true, unaffectedTaskRowsVerified: true, writer: observedWriter, samples,
      limits: ["One changing task and one independent writer among a synthetic populated project;one MCP server/client with concurrent calls", "Actual MCP in-memory transport;no stdio/HTTP framing", "Reader RSS includes server startup and fixture seed;not isolated operation peak", "No baseline latency comparison or universal resource bound"] };
    assert.ok(argument("output"), "Output path required");
    await writeFile(argument("output"), JSON.stringify(output, null, 2) + "\n");
  } finally {
    restoreBackup?.();
    if (child && child.exitCode === null) child.kill();
    await client?.close(); await server?.close();
    await rm(target, { recursive: true, force: true });
  }
}
if (argument("worker")) await writer(); else await main();
