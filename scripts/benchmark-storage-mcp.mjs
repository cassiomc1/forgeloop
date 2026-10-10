import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { createBenchmarkProgressJournal } from "./lib/benchmark-progress-journal.mjs";
import { createTaskDescriptor } from "../src/core/task-descriptor.js";
import { createWorkState } from "../src/core/work-state.js";
import { buildProtocolEvent } from "../src/core/events.js";
import { openStorageDatabase, runInTransaction, upsertTask, reserveClaims, appendEvent, exportDatabase } from "../src/storage/index.js";

const argument = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const baselineRoot = path.resolve(argument("baseline-root") ?? "");
const currentRoot = path.resolve(import.meta.dirname, "..");
const revision = "ee9ce11123d4e728d3dbc92f5d62d4bf41bb79c5";
const sourceRevision = execFileSync("git", ["-C", currentRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
assert.equal(execFileSync("git", ["-C", baselineRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(), revision);
assert.equal(execFileSync("git", ["-C", baselineRoot, "status", "--porcelain", "--untracked-files=no"], { encoding: "utf8" }).trim(), "");
const sizes = (argument("sizes") ?? "10,1000").split(",").map(Number);
const repeats = Number(argument("repeats") ?? 20);
const resources = argument("resources") ?? "false";
const taskListLimit = argument("task-list-limit") === undefined ? null : Number(argument("task-list-limit"));
const fixtureMode = argument("fixture") ?? "synthetic";
const eventsPerTask = Number(argument("events") ?? 10);
const selectedEvents = Number(argument("selected-events") ?? eventsPerTask);
const operationArgument = argument("operation");
const knownOperations = ["taskListTool", "projectTasksResource"];
const operations = operationArgument ? operationArgument.split(",").filter(Boolean) : knownOperations;
const sourceManifestPath = argument("source-manifest");
const pairedCasePath = argument("paired-case");
const validationOnly = process.argv.includes("--validate-only");
assert.ok(sizes.every(size => Number.isInteger(size) && size > 0 && size <= 5000));
assert.ok(Number.isInteger(repeats) && repeats >= (validationOnly ? 1 : 20));
assert.ok(["true", "false"].includes(resources));
assert.ok(taskListLimit === null || (Number.isInteger(taskListLimit) && taskListLimit > 0 && taskListLimit <= 5000));
assert.ok(["synthetic", "canonical-basic-all", "canonical-rich-all"].includes(fixtureMode), "Unsupported MCP benchmark fixture mode");
assert.ok(operations.length > 0 && new Set(operations).size === operations.length && operations.every(value => knownOperations.includes(value)), "Unsupported MCP benchmark operation");
if (fixtureMode !== "synthetic") {
  assert.ok(Number.isInteger(eventsPerTask) && eventsPerTask >= 2 && eventsPerTask <= 100000);
  assert.ok(Number.isInteger(selectedEvents) && selectedEvents >= 2 && selectedEvents <= 100000);
}
const sourceManifest = sourceManifestPath ? JSON.parse(await readFile(path.resolve(sourceManifestPath), "utf8")) : null;
const pairedCase = pairedCasePath ? JSON.parse(await readFile(path.resolve(pairedCasePath), "utf8")) : null;
const parentOutputPath = argument("output") ? path.resolve(argument("output")) : null;
let sourceBefore = null;
let sourceAfter = null;
let activeContext = { stage: "ADMISSION" };
const workerEvidenceDirectory = argument("worker-evidence-directory") ? path.resolve(argument("worker-evidence-directory")) : null;
const parentFailurePath = parentOutputPath
  ? `${parentOutputPath}.parent-failure.json`
  : workerEvidenceDirectory ? path.join(workerEvidenceDirectory, "parent-failure.json") : null;

async function actualManifest(root) {
  const revision = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const status = execFileSync("git", ["-C", root, "status", "--porcelain", "--untracked-files=no"], { encoding: "utf8" }).trim();
  const files = execFileSync("git", ["-C", root, "ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean).sort();
  return {
    revision,
    status,
    trackedFiles: files.length,
    files: await Promise.all(files.map(async file => ({
      path: file,
      sha256: createHash("sha256").update(await readFile(path.join(root, file))).digest("hex"),
    }))),
  };
}

async function validateManifestEntry(entry, label, root, expectedRevision, observedEntry = null) {
  assert.ok(entry && typeof entry === "object", `${label} source manifest entry is missing`);
  assert.equal(entry.revision, expectedRevision, `${label} source revision mismatch`);
  assert.equal(entry.status, "", `${label} checkout is dirty`);
  assert.ok(Number.isInteger(entry.trackedFiles) && entry.trackedFiles >= 0, `${label} tracked-file count is invalid`);
  assert.ok(Array.isArray(entry.files), `${label} tracked-file hashes are missing`);
  assert.equal(entry.trackedFiles, entry.files.length, `${label} tracked-file count does not match hashes`);
  const paths = entry.files.map(file => file?.path);
  assert.deepEqual([...paths].sort(), paths, `${label} tracked-file manifest is not sorted`);
  assert.equal(new Set(paths).size, paths.length, `${label} tracked-file manifest contains duplicates`);
  for (const file of entry.files) {
    assert.ok(typeof file?.path === "string" && file.path.length > 0 && !path.isAbsolute(file.path) && !file.path.includes("\0") && !file.path.split("/").includes(".."), `${label} contains an unsafe tracked path`);
    assert.ok(typeof file.sha256 === "string" && /^[0-9a-f]{64}$/i.test(file.sha256), `${label} contains an invalid tracked-file hash`);
  }
  assert.deepEqual(entry, observedEntry ?? await actualManifest(root), `${label} source manifest does not match the checked-out files`);
}

async function validateSourceManifestInput(manifest) {
  assert.equal(manifest?.schemaVersion, 1, "source manifest schema is unsupported");
  await validateManifestEntry(manifest.current, "current", currentRoot, sourceRevision, sourceBefore.current);
  await validateManifestEntry(manifest.baseline, "baseline", baselineRoot, revision, sourceBefore.baseline);
  return {
    status: "VALIDATED",
    currentRevision: manifest.current.revision,
    baselineRevision: manifest.baseline.revision,
    currentTrackedFiles: manifest.current.trackedFiles,
    baselineTrackedFiles: manifest.baseline.trackedFiles,
  };
}

async function captureSourcePair() {
  return { schemaVersion: 1, current: await actualManifest(currentRoot), baseline: await actualManifest(baselineRoot) };
}

function observedCase() {
  return {
    schemaVersion: 1,
    sourceRevision,
    baselineRevision: revision,
    sizes: [...sizes],
    operations: [...operations],
    repeats,
    resources: resources === "true",
    validationOnly,
    taskListLimit,
    fixtureMode,
    eventsPerTask,
    selectedEvents,
  };
}

function validatePairedCaseInput(declared) {
  assert.equal(declared?.schemaVersion, 1, "paired-case manifest schema is unsupported");
  assert.equal(declared.currentRevision, sourceRevision, "paired-case current revision mismatch");
  assert.equal(declared.baselineRevision, revision, "paired-case baseline revision mismatch");
  const declaredSizes = Array.isArray(declared.sizes) ? declared.sizes : [declared.tasks];
  assert.deepEqual(declaredSizes, sizes, "paired-case task dimensions mismatch");
  assert.deepEqual(declared.operations, operations, "paired-case operation dimensions mismatch");
  assert.equal(declared.repeats, repeats, "paired-case repeat count mismatch");
  assert.equal(declared.resources, resources === "true", "paired-case resource mode mismatch");
  assert.equal(declared.validationOnly, validationOnly, "paired-case validation mode mismatch");
  assert.equal(declared.taskListLimit, taskListLimit, "paired-case task-list limit mismatch");
  assert.equal(declared.fixtureMode, fixtureMode, "paired-case fixture mode mismatch");
  assert.equal(declared.eventsPerTask, eventsPerTask, "paired-case ordinary event dimension mismatch");
  assert.equal(declared.selectedEvents, selectedEvents, "paired-case selected event dimension mismatch");
  assert.equal(declared.sampleMode, validationOnly ? "validate-only" : "timed", "paired-case sample mode mismatch");
}

async function writeParentFailure(error, context = {}) {
  if (!parentFailurePath) return;
  const failure = {
    kind: "MCP_BENCHMARK_PARENT_FAILURE",
    schemaVersion: 1,
    status: "FAILED",
    sourceRevision,
    baselineRevision: revision,
    fixtureMode,
    sizes,
    operations,
    repeats,
    resources,
    validationOnly,
    context,
    sourceBefore,
    sourceAfter,
    sourceManifestInput: sourceManifest,
    pairedCaseInput: pairedCase,
    error: {
      name: error?.name ?? "Error",
      code: error?.code ?? null,
      message: error?.message ?? String(error),
      stack: error?.stack ?? null,
    },
  };
  try {
    await mkdir(path.dirname(parentFailurePath), { recursive: true });
    await writeFile(parentFailurePath, JSON.stringify(failure, null, 2) + "\n", { flag: "wx" });
  } catch (writeError) {
    if (writeError?.code !== "EEXIST") return;
  }
}

try {
  sourceBefore = await captureSourcePair();
  assert.equal(sourceBefore.baseline.status, "", "baseline checkout is dirty before measurement");
  if (!validationOnly) assert.equal(sourceBefore.current.status, "", "timed benchmark requires a clean current checkout");
} catch (error) {
  try { sourceAfter = await captureSourcePair(); } catch {}
  await writeParentFailure(error, { stage: "SOURCE_ADMISSION" });
  throw error;
}

let sourceAdmission;
try {
  sourceAdmission = sourceManifest
    ? await validateSourceManifestInput(sourceManifest)
    : {
      status: sourceBefore.current.status === "" ? "CAPTURED_CLEAN" : "DIRTY_VALIDATE_ONLY",
      currentRevision: sourceBefore.current.revision,
      baselineRevision: sourceBefore.baseline.revision,
      currentStatus: sourceBefore.current.status,
      baselineStatus: sourceBefore.baseline.status,
    };
  if (pairedCase) validatePairedCaseInput(pairedCase);
} catch (error) {
  try { sourceAfter = await captureSourcePair(); } catch {}
  await writeParentFailure(error, { stage: "ADMISSION" });
  throw error;
}
if (workerEvidenceDirectory) {
  const relative = path.relative(currentRoot, workerEvidenceDirectory);
  assert.ok(relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative), "Worker evidence must stay outside the checked source tree");
  // Refuse reuse so a retained first-cause journal cannot mask a new run.
  await mkdir(workerEvidenceDirectory);
}
const progressJournal = workerEvidenceDirectory
  ? createBenchmarkProgressJournal(path.join(workerEvidenceDirectory, "parent.progress.ndjson")) : null;
const checkpoint = context => {
  activeContext = { ...activeContext, ...context };
  progressJournal?.record(context);
};
checkpoint({ stage: "STARTED", sizes, repeats, resources, validationOnly, fixtureMode, operations });
const percentile = values => values.length === 0 ? null : [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1];
const timestamp = "2026-09-11T00:00:00.000Z";
const versions = {};
for (const [backend, root] of Object.entries({ native: currentRoot, baseline: baselineRoot })) {
  versions[backend] = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")).version;
}

function comparable(value, backend) {
  const copy = structuredClone(value);
  if (copy.metadata?.packageVersion !== undefined) {
    assert.equal(copy.metadata.packageVersion, versions[backend]);
    copy.metadata.packageVersion = "DECLARED_BACKEND_VERSION";
  }
  return copy;
}

async function seedSynthetic(native, portable, size) {
  await mkdir(path.join(native, ".forgeloop"));
  const db = openStorageDatabase(path.join(native, ".forgeloop/state.sqlite"));
  try {
    runInTransaction(db, () => {
      for (let index = 0; index < size; index++) {
        const taskId = `mcp-populated-${String(index).padStart(5, "0")}`;
        const descriptor = createTaskDescriptor({ taskId, writeClaims: [`src/task-${index}`], createdAt: timestamp, updatedAt: timestamp });
        const state = createWorkState({ taskId, phase: "RECEIVED", contractFingerprint: "0".repeat(64), repositoryFingerprint: { branch: null, head: null }, lastUpdated: timestamp });
        upsertTask(db, { taskId, descriptor, state });
        reserveClaims(db, { taskId, claims: descriptor.writeClaims, createdAt: timestamp });
        let checkpoint = { seq: 0, lastHash: null };
        for (let observation = 0; observation < 10; observation++) {
          const event = buildProtocolEvent({ taskId, event: "OBSERVATION", at: timestamp, details: { observation } }, { checkpoint });
          appendEvent(db, { taskId, event });
          checkpoint = { seq: event.seq, lastHash: event.hash };
        }
      }
    });
    await exportDatabase(db, portable);
  } finally { db.close(); }
  const totalEvents = size * 10;
  return {
    fixtureMode: "synthetic",
    fixtureManifest: {
      status: "DIAGNOSTIC_ONLY",
      tasks: size,
      eventsPerTask: 10,
      selectedEvents: null,
      eventComposition: {
        mode: "synthetic-sql",
        taskCount: size,
        selectedTaskCount: 0,
        ordinaryTaskCount: size,
        ordinary: { totalEvents: 10, eventsPerTask: 10 },
        selected: null,
        totalEvents,
      },
    },
    fixtureAdmission: null,
  };
}

async function seedPublic(native, portable, size) {
  // Public modes must use the maintained lifecycle builders. SQL setup above
  // remains an explicit synthetic diagnostic path and is never selected here.
  const { appendCanonicalObservationEvents, buildPublicTaskDataset, buildRichSelectedTaskFixture, describePublicFixtureEventComposition, validatePublicTaskParity, validateRichFixtureAcrossBackends } =
    await import("./lib/benchmark-domain-fixture.mjs");
  const taskIdAt = index => `mcp-public-${String(index).padStart(5, "0")}`;
  const selectedTaskId = taskIdAt(0);
  const taskIds = [];
  let selectedPreludeEvents = null;
  let selectedLedgerEvents = null;
  if (fixtureMode === "canonical-rich-all") {
    const richFixture = await buildRichSelectedTaskFixture({ target: native, packageRoot: currentRoot, taskId: selectedTaskId, claims: ["src/mcp-public-selected"] });
    selectedPreludeEvents = richFixture.ledger.length;
    if (selectedEvents < selectedPreludeEvents) {
      const error = new Error(`rich selected task requires at least ${selectedPreludeEvents} total events; requested ${selectedEvents}`);
      error.code = "E_BENCHMARK_FIXTURE_EVENT_COUNT_UNSUPPORTED";
      throw error;
    }
    const appended = await appendCanonicalObservationEvents({
      target: native, packageRoot: currentRoot, taskId: selectedTaskId, eventCount: selectedEvents,
      expectedInitialEventCount: selectedPreludeEvents, pathPrefix: "src/mcp-public-selected/input.js",
    });
    selectedLedgerEvents = appended.ledger.length;
    assert.equal(selectedLedgerEvents, selectedEvents);
    taskIds.push(selectedTaskId);
  }
  const publicTaskIds = await buildPublicTaskDataset({
    target: native, packageRoot: currentRoot, size, startIndex: fixtureMode === "canonical-rich-all" ? 1 : 0, taskIdAt,
    claimsForIndex: index => [`src/mcp-public-task-${index}`],
    pathForIndex: index => `src/mcp-public-task-${index}/input.js`,
    eventCountForIndex: fixtureMode === "canonical-rich-all"
      ? () => eventsPerTask
      : index => index === 0 ? selectedEvents : eventsPerTask,
  });
  taskIds.push(...publicTaskIds);
  const db = openStorageDatabase(path.join(native, ".forgeloop/state.sqlite"));
  try { await exportDatabase(db, portable); } finally { db.close(); }
  const fixtureAdmission = fixtureMode === "canonical-rich-all"
    ? await validateRichFixtureAcrossBackends({ nativeRoot: native, portableRoot: portable, currentRoot, baselineRoot, taskId: selectedTaskId, taskIds: publicTaskIds })
    : await validatePublicTaskParity({ nativeRoot: native, portableRoot: portable, currentRoot, baselineRoot, taskIds });
  const publicTaskParity = fixtureAdmission.publicTaskParity?.taskParity ?? fixtureAdmission.taskParity ?? [];
  const publicCounts = new Map(publicTaskParity.map(entry => [entry.taskId, entry.eventCount]));
  if (fixtureMode === "canonical-rich-all") {
    assert.equal(fixtureAdmission.eventCount, selectedEvents);
  } else {
    selectedLedgerEvents = publicCounts.get(selectedTaskId);
    assert.equal(selectedLedgerEvents, selectedEvents);
  }
  for (const taskId of taskIds) {
    const actual = taskId === selectedTaskId && fixtureMode === "canonical-rich-all" ? fixtureAdmission.eventCount : publicCounts.get(taskId);
    assert.equal(actual, taskId === selectedTaskId ? selectedEvents : eventsPerTask, `public fixture event count mismatch for ${taskId}`);
  }
  const ordinaryComposition = describePublicFixtureEventComposition(eventsPerTask);
  const selectedComposition = fixtureMode === "canonical-rich-all"
    ? { mode: "canonical-rich-selected", totalEvents: selectedEvents, preludeEvents: selectedPreludeEvents, observedEvents: selectedLedgerEvents }
    : { mode: "canonical-basic-selected", ...describePublicFixtureEventComposition(selectedEvents), observedEvents: selectedLedgerEvents };
  const totalEvents = selectedEvents + ((size - 1) * eventsPerTask);
  return {
    fixtureMode,
    fixtureManifest: {
      status: "VALIDATED",
      tasks: size,
      taskIds,
      selectedTaskId,
      eventsPerTask,
      selectedEvents,
      publicTaskParity,
      eventComposition: {
        mode: fixtureMode,
        taskCount: size,
        selectedTaskCount: 1,
        ordinaryTaskCount: size - 1,
        selected: selectedComposition,
        ordinary: { ...ordinaryComposition, taskCount: size - 1, totalEvents: (size - 1) * eventsPerTask },
        totalEvents,
      },
    },
    fixtureAdmission,
  };
}

async function seed(native, portable, size) {
  return fixtureMode === "synthetic" ? seedSynthetic(native, portable, size) : seedPublic(native, portable, size);
}

function assertWorkerSampleCounts(worker, backend, operation) {
  const expectedSamples = validationOnly ? 0 : repeats;
  const expectedResourceSamples = validationOnly || resources !== "true" ? 0 : repeats;
  assert.equal(worker.validationOnly, validationOnly, `${backend}/${operation} validation mode mismatch`);
  assert.equal(worker.sampleCount, expectedSamples, `${backend}/${operation} declared sample count mismatch`);
  assert.equal(worker.samplesMs.length, expectedSamples, `${backend}/${operation} sample array mismatch`);
  assert.equal(worker.resourceSampleCount, expectedResourceSamples, `${backend}/${operation} declared resource sample count mismatch`);
  assert.equal(worker.resourceSamples.length, expectedResourceSamples, `${backend}/${operation} resource sample array mismatch`);
  if (validationOnly) assert.equal(worker.resourceTiming, "SKIPPED_VALIDATE_ONLY");
}

const results = [];
let benchmarkError = null;
let failureContext = null;
try {
  try {
    for (const [sizeIndex, size] of sizes.entries()) {
      const directory = await mkdtemp(path.join(os.tmpdir(), "forgeloop-mcp-benchmark-"));
      try {
        const native = path.join(directory, "native"), portable = path.join(directory, "portable");
        await mkdir(native);
        checkpoint({ stage: "SEEDING", tasks: size });
        const fixture = await seed(native, portable, size);
        checkpoint({ stage: "SEEDED", tasks: size, fixture: fixture.fixtureManifest });
        const backends = {};
        const order = sizeIndex % 2 ? ["baseline", "native"] : ["native", "baseline"];
        for (const backend of order) {
          const output = workerEvidenceDirectory
            ? path.join(workerEvidenceDirectory, `${backend}-${size}${operationArgument ? `-${operations.join("+")}` : ""}.json`)
            : path.join(directory, `${backend}.json`);
          checkpoint({ stage: "WORKER_STARTED", backend, tasks: size, operations, validationOnly, output });
          const workerStartedAt = new Date().toISOString();
          const workerStarted = performance.now();
          const run = spawnSync(process.execPath, [path.join(currentRoot, "scripts/lib/storage-mcp-benchmark-worker.mjs"),
            backend === "native" ? currentRoot : baselineRoot, path.join(currentRoot, "integrations/mcp"),
            backend === "native" ? native : portable, output, String(repeats), resources, taskListLimit === null ? "" : String(taskListLimit), workerEvidenceDirectory ? "true" : "false", operations.join(","), validationOnly ? "true" : "false"], { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
          const workerElapsedMs = performance.now() - workerStarted;
          const workerEndedAt = new Date().toISOString();
          checkpoint({ stage: "WORKER_EXITED", backend, tasks: size, operations, validationOnly, workerStartedAt, workerEndedAt, workerElapsedMs, status: run.status, signal: run.signal });
          if (run.status !== 0 && argument("output")) {
            let workerDiagnostics = null;
            let diagnosticReadError = null;
            try { workerDiagnostics = JSON.parse(await readFile(`${output}.failure.json`, "utf8")); }
            catch (error) { diagnosticReadError = { code: error.code ?? error.name, message: error.message }; }
            await writeFile(`${argument("output")}.failure.json`, JSON.stringify({
              status: "FAILED", backend, tasks: size, baselineRevision: revision, validationOnly,
              workerStatus: run.status, workerSignal: run.signal, workerDiagnostics, diagnosticReadError, stderr: run.stderr,
            }, null, 2) + "\n");
          }
          assert.equal(run.status, 0, run.stderr);
          const workerResult = JSON.parse(await readFile(output, "utf8"));
          for (const name of operations) assertWorkerSampleCounts(workerResult.results[name], backend, name);
          backends[backend] = { ...workerResult, workerWall: { workerStartedAt, workerEndedAt, workerElapsedMs, status: run.status, signal: run.signal } };
        }
        assert.deepEqual(Object.keys(backends.native.results).sort(), [...operations].sort());
        assert.deepEqual(Object.keys(backends.baseline.results).sort(), [...operations].sort());
        for (const name of operations) {
          const n = backends.native.results[name], b = backends.baseline.results[name];
          if (name === "taskListTool") {
            assert.equal(n.expected.result.total, size);
            assert.equal(n.expected.result.tasks.length, taskListLimit === null ? size : Math.min(size, taskListLimit));
          } else {
            assert.equal(n.expected.count, size);
            assert.equal(n.expected.tasks.length, size);
          }
          assert.deepEqual(comparable(n.expected, "native"), comparable(b.expected, "baseline"));
          results.push({
            tasks: size,
            events: fixture.fixtureManifest.eventComposition.totalEvents,
            eventComposition: fixture.fixtureManifest.eventComposition,
            operation: name,
            outputParity: true,
            fixtureMode: fixture.fixtureMode,
            fixtureManifest: fixture.fixtureManifest,
            fixtureAdmission: fixture.fixtureAdmission,
            native: n,
            baseline: b,
            nativeWorkerWall: backends.native.workerWall,
            baselineWorkerWall: backends.baseline.workerWall,
            sampleCounts: { native: n.sampleCount, baseline: b.sampleCount },
            resourceSampleCounts: { native: n.resourceSampleCount, baseline: b.resourceSampleCount },
            nativeP95Ms: validationOnly ? null : percentile(n.samplesMs),
            baselineP95Ms: validationOnly ? null : percentile(b.samplesMs),
          });
        }
        checkpoint({ stage: "PARITY_VERIFIED", tasks: size, operations, validationOnly, fixture: fixture.fixtureManifest });
      } catch (error) {
        failureContext ??= structuredClone(activeContext);
        throw error;
      } finally {
        checkpoint({ stage: "CLEANUP_STARTED", tasks: size, operations, validationOnly });
        await rm(directory, { recursive: true, force: true });
        checkpoint({ stage: "CLEANUP_COMPLETED", tasks: size, operations, validationOnly });
      }
    }
  } catch (error) {
    benchmarkError = error;
  }
  try {
    sourceAfter = await captureSourcePair();
    assert.deepEqual(sourceAfter, sourceBefore, "Current or baseline tracked source changed during benchmark");
  } catch (error) {
    if (!benchmarkError) benchmarkError = error;
  }
  if (benchmarkError) {
    await writeParentFailure(benchmarkError, failureContext ?? activeContext);
    throw benchmarkError;
  }
  checkpoint({ stage: "COMPLETED", operations, validationOnly, fixtureMode });
} finally {
  progressJournal?.close();
}
const output = {
  sourceRevision,
  baselineRevision: revision,
  sourceManifest: sourceManifest ?? sourceBefore,
  sourceAdmission,
  workingSource: {
    status: sourceBefore.current.status === "" ? "CLEAN" : "DIRTY_VALIDATE_ONLY",
    acceptanceEligible: sourceBefore.current.status === "" && !validationOnly,
    before: sourceBefore,
    after: sourceAfter,
  },
  runtime: { node: process.version, platform: process.platform, architecture: process.arch, cpu: os.cpus()[0]?.model ?? null, logicalCpus: os.cpus().length, runnerName: process.env.RUNNER_NAME ?? null, workflowRun: process.env.GITHUB_RUN_ID ?? null, workflowAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null },
  pairedCase: pairedCase ? { declared: pairedCase, observed: observedCase() } : null,
  workerEvidenceDirectory,
  parentFailurePath,
  progressRetention: workerEvidenceDirectory ? { sampleInterval: 10, durability: "fsync outside measured operations", limitation: "Between-request journal writes can affect subsequent process/cache behavior" } : null,
  repeats,
  resources,
  validationOnly,
  fixtureMode,
  eventsPerTask,
  selectedEvents,
  taskListRequest: taskListLimit === null ? {} : { limit: taskListLimit },
  declaredBackendVersions: versions,
  parityException: "Only metadata.packageVersion; each raw value must equal its backend package manifest",
  adapter: "same current MCP adapter with current or pinned core selected by module resolution hook",
  transport: "in-memory MCP client/server",
  limits: ["Transport serialization/stdio/HTTP not measured", "Synthetic fixture mode is diagnostic-only; canonical modes use maintained public builders and validators", "Resource samples are separately instrumented; RSS endpoints are not operation peak", "Validation-only mode performs parity calls with zero measured or resource samples", "A dirty current checkout is allowed only for validation-only mode and is never acceptance evidence", "Not complete MCP throughput/contention/resource acceptance", "Original 100000-event/action/concurrency matrix remains separate evidence"],
  releaseThresholdsVerified: false,
  results,
};
if (argument("output")) await writeFile(argument("output"), JSON.stringify(output, null, 2) + "\n");
else process.stdout.write(JSON.stringify(output, null, 2) + "\n");
