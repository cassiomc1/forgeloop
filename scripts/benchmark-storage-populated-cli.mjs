/** Equal-output populated CLI comparison. Setup/validation are outside samples. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { createTaskDescriptor } from "../src/core/task-descriptor.js";
import { createWorkState } from "../src/core/work-state.js";
import { buildProtocolEvent } from "../src/core/events.js";
import { openStorageDatabase, runInTransaction, upsertTask, reserveClaims, appendEvent, exportDatabase } from "../src/storage/index.js";

const argument = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const baselineRevision = "ee9ce11123d4e728d3dbc92f5d62d4bf41bb79c5";
assert.ok(argument("baseline-root"), "A clean pinned baseline is required");
const baselineRoot = path.resolve(argument("baseline-root"));
const currentRoot = path.resolve(import.meta.dirname, "..");
assert.equal(execFileSync("git", ["-C", baselineRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(), baselineRevision);
assert.equal(execFileSync("git", ["-C", baselineRoot, "status", "--porcelain", "--untracked-files=no"], { encoding: "utf8" }).trim(), "");
const sizes = (argument("sizes") ?? "10,1000").split(",").map(Number);
const eventsPerTask = Number(argument("events") ?? 10);
const selectedEvents = Number(argument("selected-events") ?? 1000);
const repeats = Number(argument("repeats") ?? 20);
const validationOnly = process.argv.includes("--validate-only");
const cpuProfileDirectory = argument("cpu-profile-dir");
assert.ok(!cpuProfileDirectory || validationOnly, "CPU profiling requires --validate-only; instrumented samples are not release latency");
if (cpuProfileDirectory) await mkdir(path.resolve(cpuProfileDirectory), { recursive: true });
assert.ok(sizes.every(size => Number.isInteger(size) && size >= 1 && size <= 5000));
assert.ok([eventsPerTask, selectedEvents].every(count => Number.isInteger(count) && count >= 1 && count <= 100000));
assert.ok(Number.isInteger(repeats) && repeats >= 10 && repeats <= 200);
const timestamp = "2026-09-11T00:00:00.000Z";
const taskIdAt = index => `populated-cli-${String(index).padStart(5, "0")}`;
const percentile = (values, fraction) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * fraction) - 1];
const code = {};
for (const [backend, root] of Object.entries({ baseline: baselineRoot, native: currentRoot })) {
  const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  code[backend] = { packageVersion: packageJson.version, cliSha256: createHash("sha256").update(await readFile(path.join(root, "src/cli.js"))).digest("hex") };
}

async function seed(nativeRoot, portableRoot, size) {
  await mkdir(path.join(nativeRoot, ".forgeloop"));
  const db = openStorageDatabase(path.join(nativeRoot, ".forgeloop/state.sqlite"));
  try {
    assert.equal(db.prepare("PRAGMA synchronous").get().synchronous, 2);
    assert.equal(db.prepare("PRAGMA journal_mode").get().journal_mode, "wal");
    runInTransaction(db, () => {
      for (let index = 0; index < size; index++) {
        const taskId = taskIdAt(index);
        const descriptor = createTaskDescriptor({ taskId, writeClaims: [`src/task-${index}`], createdAt: timestamp, updatedAt: timestamp });
        const state = createWorkState({ taskId, phase: "RECEIVED", contractFingerprint: "0".repeat(64), repositoryFingerprint: { branch: null, head: null }, lastUpdated: timestamp });
        upsertTask(db, { taskId, descriptor, state });
        reserveClaims(db, { taskId, claims: descriptor.writeClaims, createdAt: timestamp });
        let checkpoint = { seq: 0, lastHash: null };
        const count = index === 0 ? selectedEvents : eventsPerTask;
        for (let observation = 0; observation < count; observation++) {
          const event = buildProtocolEvent({ taskId, event: "OBSERVATION", at: timestamp, details: { observation, path: `src/task-${index}/input.js`, message: "Deterministic representative repository observation; no fabricated authority." } }, { checkpoint });
          appendEvent(db, { taskId, event });
          checkpoint = { seq: event.seq, lastHash: event.hash };
        }
      }
    });
    await exportDatabase(db, portableRoot);
    return { events: db.prepare("SELECT count(*) AS count FROM events").get().count, sqliteVersion: db.prepare("SELECT sqlite_version() AS version").get().version };
  } finally { db.close(); }
}

function invoke(backend, target, operation) {
  const root = backend === "native" ? currentRoot : baselineRoot;
  const args = operation === "paginated-task-list" ? ["task-list", "--limit", "5"] : ["history", "--task", taskIdAt(0), "--limit", "5"];
  const profilingArgs = cpuProfileDirectory
    ? ["--cpu-prof", `--cpu-prof-dir=${path.resolve(cpuProfileDirectory)}`, `--cpu-prof-name=${backend}-${path.basename(target)}-${operation}.cpuprofile`]
    : [];
  const result = spawnSync(process.execPath, [...profilingArgs, path.join(root, "src/cli.js"), ...args, "--path", target, "--json"], {
    cwd: target, encoding: "utf8", timeout: 120000, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, FORGELOOP_TASK: "" },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.signal, null);
  const output = JSON.parse(result.stdout);
  if (operation === "history-tail") {
    assert.ok(Number.isFinite(Date.parse(output.snapshot.capturedAt)), "Capture time must remain valid");
    delete output.snapshot.capturedAt;
    assert.equal(output.snapshot.consistent, true);
    assert.equal(output.integrity.valid, true);
    assert.equal(output.summary.totalEventCount, selectedEvents);
  }
  return output;
}

const results = [];
for (const size of sizes) {
  const nativeRoot = await mkdtemp(path.join(os.tmpdir(), "forgeloop-populated-native-"));
  const portableRoot = await mkdtemp(path.join(os.tmpdir(), "forgeloop-populated-baseline-"));
  try {
    const dataset = await seed(nativeRoot, portableRoot, size);
    for (const operation of ["paginated-task-list", "history-tail"]) {
      const expected = invoke("baseline", portableRoot, operation);
      const nativeOutput = invoke("native", nativeRoot, operation);
      assert.deepEqual(nativeOutput, expected, "Both CLIs must preserve all public output except validated wall-clock capture time");
      if (operation === "paginated-task-list") {
        assert.equal(expected.total, size);
        assert.ok(expected.tasks.every(task => task.healthy && task.ownershipValid && task.mutationAllowed));
      }
      const result = { operation, tasks: size, eventsPerOtherTask: eventsPerTask, selectedTaskEvents: selectedEvents, ...dataset, outputContractVerified: true,
        outputSha256: createHash("sha256").update(JSON.stringify(expected)).digest("hex") };
      if (!validationOnly) {
        const samples = { baseline: [], native: [] };
        for (let repetition = 0; repetition < repeats; repetition++) {
          for (const backend of repetition % 2 ? ["baseline", "native"] : ["native", "baseline"]) {
            const started = performance.now();
            const output = invoke(backend, backend === "native" ? nativeRoot : portableRoot, operation);
            const elapsed = performance.now() - started;
            assert.deepEqual(output, expected);
            samples[backend].push(elapsed);
          }
        }
        const baselineP95Ms = percentile(samples.baseline, 0.95), nativeP95Ms = percentile(samples.native, 0.95);
        Object.assign(result, { repeats, samplesMs: samples, baselineP50Ms: percentile(samples.baseline, 0.5), nativeP50Ms: percentile(samples.native, 0.5), baselineP95Ms, nativeP95Ms,
          speedupP95: baselineP95Ms / nativeP95Ms, regressionMs: nativeP95Ms - baselineP95Ms, smallWorkspaceToleranceMs: Math.max(5, baselineP95Ms * 0.1) });
      }
      results.push(result);
    }
  } finally { await rm(nativeRoot, { recursive: true, force: true }); await rm(portableRoot, { recursive: true, force: true }); }
}
process.stdout.write(`${JSON.stringify({ schemaVersion: 1, baselineRevision, node: process.version, platform: process.platform, architecture: process.arch,
  cpu: os.cpus()[0]?.model, totalMemoryBytes: os.totalmem(), code, validationOnly, releaseThresholdsVerified: false,
  normalizedFields: ["history.snapshot.capturedAt: validated timestamp, omitted only from equality"],
  runtime: "Fresh CLI per sample, alternating backend order, warm filesystem caches; synthetic valid RECEIVED tasks with disjoint claims and hash-chained observations",
  durability: "SQLite WAL/FULL; read-only benchmark does not measure commit durability",
  limitations: ["No filesystem-cold, persistent MCP, filesystem operation count, lock-wait, peak RSS, event-loop or WAL-peak claim", "CLI hashes identify entrypoints, not a complete source manifest; bind final measurements to an immutable checkout", "Validation-only mode emits no timing samples or latency acceptance claim"], results }, null, 2)}\n`);
