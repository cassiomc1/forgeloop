/**
 * Repeated equivalent-work benchmark for the `recordDiagnosis` transition.
 *
 * Contract (verification brief, work package D):
 *   - Both backends run the same canonical domain command and guards.
 * This is a warm domain-command comparison, not full CLI/runtime acceptance.
 *   - Every timed sample performs a real mutation; a sample is asserted, not
 *     assumed, so an idempotent no-op can never be measured by accident.
 *   - Fresh equivalent fixtures are built outside every timer, and fixture
 *     construction cost is reported separately as an operational cost.
 *   - Backend order alternates per scenario to reduce systematic bias.
 *   - Every asynchronous filesystem operation is awaited and the returned
 *     result is asserted, never the Promise.
 *   - Warm-up operations are discarded before measurement.
 *
 * Usage:
 *   node scripts/benchmark-diagnosis-parity.mjs --baseline-root=<pinned-checkout>
 *     [--tasks=1,10,50,100] [--measured=30] [--warmup=5] [--ledger=6]
 *     [--resources=true] [--out=<dir>]
 */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { cp, mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

import { TEST_TASK_ID, cleanupDir } from "../tests/helpers/storage-fixtures.js";
import { exportDatabase, openStorageDatabase } from "../src/storage/index.js";
import { withOperationalStore } from "../src/storage/unit-of-work.js";
import { runRecordDiagnosis } from "../src/commands/record-diagnosis.js";
import { buildCanonicalDiagnosisProject } from "../tests/helpers/canonical-diagnosis-fixture.js";
import { runTaskCreate } from "../src/commands/task-create.js";
import { appendProtocolEvent, readEvents, validateEventLedger } from "../src/core/events.js";
import { getPackageRoot } from "../src/core/templates.js";
import { measureStorageResources, resourceMeasurementLimits } from "./lib/storage-benchmark-resources.mjs";

const packageRoot = getPackageRoot();

function arg(name, fallback) {
  const raw = process.argv.find((entry) => entry.startsWith(`--${name}=`))?.slice(name.length + 3);
  return raw === undefined ? fallback : raw;
}

const TASK_COUNTS = String(arg("tasks", "1,10,50,100")).split(",").map((value) => Number(value.trim()));
const MEASURED = Number(arg("measured", "30"));
const WARMUP = Number(arg("warmup", "5"));
const LEDGER_LENGTH = Number(arg("ledger", "6"));
const OUT_DIR = String(arg("out", path.join(os.tmpdir(), "forgeloop-bench-samples")));
const resourceMode = arg("resources", "false");
assert.ok(["true", "false"].includes(resourceMode), "resources must be true or false");
const RESOURCES = resourceMode === "true";

assert.ok(TASK_COUNTS.length > 0 && TASK_COUNTS.every(value => Number.isSafeInteger(value) && value > 0), "tasks must be positive integers");
assert.ok(Number.isSafeInteger(MEASURED) && MEASURED > 0, "measured must be positive");
assert.ok(Number.isSafeInteger(WARMUP) && WARMUP >= 0, "warmup must be nonnegative");
assert.ok(Number.isSafeInteger(LEDGER_LENGTH) && LEDGER_LENGTH >= 0, "ledger must be nonnegative");

const baselineRoot = path.resolve(arg("baseline-root", ""));
assert.ok(arg("baseline-root", null), "--baseline-root must identify a clean pinned pre-migration checkout");
const baselineRevision = "ee9ce11123d4e728d3dbc92f5d62d4bf41bb79c5";
assert.equal(execFileSync("git", ["-C", baselineRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(), baselineRevision);
assert.equal(execFileSync("git", ["-C", baselineRoot, "status", "--porcelain", "--untracked-files=no"], { encoding: "utf8" }).trim(), "");
const legacyDiagnosis = await import(pathToFileURL(path.join(baselineRoot, "src/commands/record-diagnosis.js")).href);
const legacyEvents = await import(pathToFileURL(path.join(baselineRoot, "src/core/events.js")).href);

const REQUEST = {
  taskId: TEST_TASK_ID,
  failureClass: "VERIFICATION_FAILURE",
  evidenceRefs: ["check-auth-boundary"],
  settledBy: "pending-evidence",
  nextSafeAction: "Add the missing boundary case",
};

/** Filesystem backend: the real production transition. */
async function runFilesystem(session, hypothesis) {
  const result = await legacyDiagnosis.runRecordDiagnosis({ target: session.target, packageRoot: baselineRoot, ...REQUEST, hypothesis });
  // A real mutation is required; an idempotent no-op is never a valid sample.
  assert.equal(result.idempotent, false, "filesystem sample must be a real mutation");
  assert.equal(result.state.revision, session.seedRevision + 1, "filesystem sample must advance the revision once");
  return { revision: result.state.revision, seq: result.event.seq };
}

/**
 * SQLite backend: the same canonical domain command on a selected migrated store.
 *
 * The database is opened by the caller before the timer starts. Opening and
 * importing are fixture setup, not part of the measured operation; measuring
 * them here would contaminate the sample with setup cost.
 */
async function runStore(session, hypothesis) {
  const result = await withOperationalStore({ db: session.db, target: session.target }, () => runRecordDiagnosis({ target: session.target, packageRoot, ...REQUEST, hypothesis }));
  assert.equal(result.idempotent, false, "store sample must be a real mutation");
  assert.equal(result.state.revision, session.seedRevision + 1, "store sample must advance the revision once");
  return { revision: result.state.revision, seq: result.event.seq };
}

function percentile(samples, fraction) {
  const sorted = [...samples].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return sorted[index];
}

function summarize(samples) {
  return {
    count: samples.length,
    medianMs: Number(percentile(samples, 0.5).toFixed(3)),
    p95Ms: Number(percentile(samples, 0.95).toFixed(3)),
    minMs: Number(Math.min(...samples).toFixed(3)),
    maxMs: Number(Math.max(...samples).toFixed(3)),
  };
}

/** Build a fresh equivalent fixture outside the timer and return its cost. */
async function prepare(totalTasks) {
  const started = performance.now();
  const { target, state } = await buildCanonicalDiagnosisProject({ taskId: TEST_TASK_ID });
  for (let index = 1; index < totalTasks; index += 1) {
    await runTaskCreate({ target, packageRoot, taskId: `benchmark-unrelated-${index}`, claims: [`bench/${index}`] });
  }
  let actualLedgerLength = (await readEvents(target, packageRoot, { taskId: TEST_TASK_ID })).length;
  while (actualLedgerLength < LEDGER_LENGTH) {
    await appendProtocolEvent(target, { taskId: TEST_TASK_ID, event: "TRANSACTION_COMMITTED", details: { transactionId: `bench-${actualLedgerLength}`, operation: "benchmark-seed" } }, packageRoot, { taskId: TEST_TASK_ID });
    actualLedgerLength += 1;
  }
  return { target, fixtureMs: performance.now() - started, seedRevision: state.revision, actualLedgerLength };
}

/**
 * Measure one backend with warm-up and a fresh fixture per sample.
 *
 * `openSession` runs before the timer for every backend, so connection and
 * import cost are never attributed to the operation under test.
 */
async function measureBackend(totalTasks, run, openSession, label) {
  const samples = [];
  const fixtureCosts = [];
  const sessionCosts = [];
  const ledgerLengths = new Set();
  const resourceSamples = [];
  for (let index = 0; index < WARMUP + MEASURED; index += 1) {
    const fixture = await prepare(totalTasks);
    const { target, fixtureMs } = fixture;
    const sessionStarted = performance.now();
    const session = { ...fixture, ...await openSession(target) };
    const sessionMs = performance.now() - sessionStarted;
    ledgerLengths.add(fixture.actualLedgerLength);
    try {
      const hypothesis = `Hypothesis for ${label} sample ${index}`;
      if (index < WARMUP) {
        // Warm-up iterations run identically but are not recorded.
        await run(session, hypothesis);
        continue;
      }
      if (RESOURCES) {
        const measurement = await measureStorageResources(session.target, () => run(session, hypothesis));
        samples.push(measurement.elapsedMs);
        resourceSamples.push(measurement.resources);
      } else {
        const started = performance.now();
        await run(session, hypothesis);
        samples.push(performance.now() - started);
      }
      const ledger = label === "filesystem"
        ? await legacyEvents.validateEventLedger(session.target, baselineRoot, { taskId: TEST_TASK_ID })
        : await validateEventLedger(session.target, packageRoot, { taskId: TEST_TASK_ID });
      assert.equal(ledger.valid, true, JSON.stringify(ledger.errors));
      fixtureCosts.push(fixtureMs);
      sessionCosts.push(sessionMs);
    } finally {
      session.db?.close();
      await cleanupDir(target);
    }
  }
  return { samples, fixtureCosts, sessionCosts, ledgerLengths: [...ledgerLengths], resourceSamples };
}

let observedSqliteVersion = null;
const results = [];
for (const totalTasks of TASK_COUNTS) {
  // Alternate which backend runs first to reduce systematic ordering bias.
  const backends = [
    { label: "filesystem", run: runFilesystem, open: async target => {
      const destination = path.join(target, "legacy-benchmark");
      const db = openStorageDatabase(path.join(target, ".forgeloop/state.sqlite"), { readOnly: true });
      try { await exportDatabase(db, destination); } finally { db.close(); }
      await mkdir(path.join(destination, ".forgeloop"), { recursive: true });
      try { await cp(path.join(target, ".forgeloop/policy"), path.join(destination, ".forgeloop/policy"), { recursive: true }); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
      const ledger = await legacyEvents.validateEventLedger(destination, baselineRoot, { taskId: TEST_TASK_ID });
      assert.equal(ledger.valid, true, JSON.stringify(ledger.errors));
      return { target: destination };
    } },
    {
      label: "store",
      run: runStore,
      // Open the already canonical native fixture outside the timed transition.
      open: async (target) => {
        const db = openStorageDatabase(path.join(target, ".forgeloop/state.sqlite"));
        observedSqliteVersion = db.prepare("SELECT sqlite_version() AS version").get().version;
        return { target, db };
      },
    },
  ];
  const order = results.length % 2 === 0 ? backends : [...backends].reverse();

  const measured = {};
  const fixtureCost = {};
  const sessionCost = {};
  const actualLedgerLengths = {};
  const resources = {};
  for (const { label, run, open } of order) {
    const { samples, fixtureCosts, sessionCosts, ledgerLengths, resourceSamples } = await measureBackend(totalTasks, run, open, label);
    measured[label] = samples;
    actualLedgerLengths[label] = ledgerLengths;
    fixtureCost[label] = summarize(fixtureCosts);
    sessionCost[label] = summarize(sessionCosts);
    if (RESOURCES) resources[label] = resourceSamples;
  }

  assert.deepEqual(actualLedgerLengths.filesystem, actualLedgerLengths.store, "both backends have the same selected ledger size");
  const filesystem = summarize(measured.filesystem);
  const store = summarize(measured.store);
  results.push({
    totalTasks,
    requestedLedgerLength: LEDGER_LENGTH,
    actualLedgerLengths,
    measuredSamples: MEASURED,
    warmupSamples: WARMUP,
    backendOrder: order.map((entry) => entry.label),
    filesystem,
    store,
    // Reported only for this completed, matched scenario, with its sample count
    // attached. It is not a claim about other sizes or configurations.
    ratioMedian: Number((filesystem.medianMs / Math.max(store.medianMs, 0.0001)).toFixed(2)),
    fixtureConstructionMs: fixtureCost,
    sessionPreparationMs: sessionCost,
    rawSamplesMs: measured,
    ...(RESOURCES ? { rawResourceSamples: resources } : {}),
  });
  process.stderr.write(`completed ${totalTasks} tasks\n`);
}

// Persist machine-readable samples alongside a concise summary.
mkdirSync(OUT_DIR, { recursive: true });
const meta = {
  baselineRevision,
  comparison: "Pinned filesystem command versus current native command; validated canonical export outside timer",
  implementationSha: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  node: process.version,
  sqlite: observedSqliteVersion,
  platform: `${process.platform} ${process.arch}`,
  cpus: os.cpus().length,
  cpuModel: os.cpus()[0]?.model ?? "unknown",
  durability: "synchronous=FULL, journal_mode=WAL, foreign_keys=ON",
  busyTimeoutMs: 5000,
  taskCounts: TASK_COUNTS,
  measuredSamples: MEASURED,
  warmupSamples: WARMUP,
  requestedLedgerLength: LEDGER_LENGTH,
  command: "node scripts/benchmark-diagnosis-parity.mjs",
  scope: "warm canonical domain command; excludes fixture/session preparation; no CLI or runtime acceptance claim",
  resourceMode: RESOURCES,
  ...(RESOURCES ? { resourceMeasurementLimits } : {}),
};
writeFileSync(path.join(OUT_DIR, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`);
writeFileSync(path.join(OUT_DIR, "summary.json"), `${JSON.stringify({ meta, results }, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ meta, results, sampleDir: OUT_DIR }, null, 2)}\n`);
