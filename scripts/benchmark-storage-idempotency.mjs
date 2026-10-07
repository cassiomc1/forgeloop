/** Equal-output public API comparison; synthetic setup is never commit evidence. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { Session } from "node:inspector/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import { measureStorageResources, resourceMeasurementLimits } from "./lib/storage-benchmark-resources.mjs";
import { canonicalActionFingerprint, validateActionArtifact } from "../src/core/action-model.js";
import { findActionByIdempotencyKey, proposeAction } from "../src/core/actions.js";
import { listApprovals, requestApproval, resolveApproval } from "../src/core/approvals.js";
import { validateEventLedger, validateStateLedgerCoherence } from "../src/core/events.js";
import { buildCanonicalDiagnosisProject } from "../tests/helpers/canonical-diagnosis-fixture.js";
import { executeForgeLoopCommand } from "../src/core/command-runtime.js";
import { createForgeLoopContext } from "../src/core/runtime-context.js";
import { withProjectStorage } from "../src/storage/project-boundary.js";
import { createTaskDescriptor } from "../src/core/task-descriptor.js";
import { getPackageRoot } from "../src/core/templates.js";
import { openStorageDatabase, runInTransaction, upsertTask, putAction, exportDatabase } from "../src/storage/index.js";

const revision = "ee9ce11123d4e728d3dbc92f5d62d4bf41bb79c5";
const argument = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const baseline = argument("baseline-root");
assert.ok(baseline, "--baseline-root requires a clean pinned checkout");
const baselineRoot = path.resolve(baseline);
assert.equal(execFileSync("git", ["-C", baselineRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(), revision);
assert.equal(execFileSync("git", ["-C", baselineRoot, "status", "--porcelain", "--untracked-files=no"], { encoding: "utf8" }).trim(), "");
const legacy = await import(pathToFileURL(path.join(baselineRoot, "src/core/actions.js")).href);
const sizes = (argument("sizes") ?? "10,1000,5000").split(",").map(Number);
const repeats = Number(argument("repeats") ?? 20);
const warmup = Number(argument("warmup") ?? 0);
assert.ok(Number.isInteger(warmup) && warmup >= 0 && warmup <= 100);
const resourceMode = argument("resources") ?? "false";
assert.ok(["true", "false"].includes(resourceMode), "resources must be true or false");
const resourcesEnabled = resourceMode === "true";
const linuxPeakMode = argument("linux-peak-rss") ?? "false";
assert.ok(["true", "false"].includes(linuxPeakMode), "linux-peak-rss must be true or false");
const linuxPeakRss = linuxPeakMode === "true";
assert.ok(!linuxPeakRss || (resourcesEnabled && process.platform === "linux"), "Linux operation RSS requires --resources=true on Linux");
const fixtureMode = argument("fixture") ?? "synthetic";
assert.ok(["synthetic", "public-approvals"].includes(fixtureMode), "fixture must be synthetic or public-approvals");
const operation = argument("operation") ?? "idempotency";
const persistentMode = argument("persistent") ?? "false";
assert.ok(["true", "false"].includes(persistentMode), "persistent must be true or false");
const persistent = persistentMode === "true";
const nativeComparisonRoot = argument("native-comparison-root") ? path.resolve(argument("native-comparison-root")) : null;
assert.ok(!nativeComparisonRoot || (operation === "protocol" && !persistent), "Native variant comparison requires per-call protocol mode");
assert.ok(!persistent || operation === "protocol", "persistent measurement requires the canonical protocol runtime");
const profileDirectory = argument("profile-dir");
if (profileDirectory) await mkdir(path.resolve(profileDirectory), { recursive: true });
assert.ok(["idempotency", "approvals", "protocol"].includes(operation), "operation must be idempotency, approvals or protocol");
assert.ok(operation === "idempotency" || fixtureMode === "public-approvals", "approval/protocol operations require the public-approvals fixture");
assert.ok(sizes.every(size => Number.isInteger(size) && size >= 1 && size <= 5000));
assert.ok(Number.isInteger(repeats) && repeats >= 2 && repeats <= 100);
const timestamp = "2026-09-11T00:00:00.000Z";
const percentile = samples => [...samples].sort((a, b) => a - b)[Math.ceil(samples.length * 0.95) - 1];
const results = [];
for (const size of sizes) {
  const fixtureStarted = performance.now();
  const taskId = "idempotency-benchmark";
  const canonical = fixtureMode === "public-approvals" ? await buildCanonicalDiagnosisProject({ taskId }) : null;
  const target = canonical?.target ?? await mkdtemp(path.join(os.tmpdir(), "forgeloop-idempotency-native-"));
  const portable = await mkdtemp(path.join(os.tmpdir(), "forgeloop-idempotency-portable-"));
  const holding = operation === "protocol" ? await mkdtemp(path.join(os.tmpdir(), "forgeloop-benchmark-holding-")) : null;
  let filesystemActive = false;
  async function selectFilesystem(selected) {
    if (nativeComparisonRoot || !holding || selected === filesystemActive) return;
    const parked = selected ? path.join(holding, "native") : portable;
    const incoming = selected ? portable : path.join(holding, "native");
    await rename(target, parked);
    try { await rename(incoming, target); }
    catch (error) { await rename(parked, target); throw error; }
    filesystemActive = selected;
  }
  let db;
  let runtimeContext = null;
  try {
    await mkdir(path.join(target, ".forgeloop"), { recursive: true });
    db = openStorageDatabase(path.join(target, ".forgeloop/state.sqlite"));
    if (canonical) {
      // Supported domain mutations create their own state-bound audit events;
      // setup remains outside every measured lookup and external effects never run.
      db.close(); db = null;
      for (let index = 0; index < size; index += 1) {
        const { action } = await proposeAction(target, { packageRoot: getPackageRoot(), taskId, input: {
          actionId: `action-${String(index).padStart(5, "0")}`, effectClass: "EXTERNAL_PUBLICATION",
          capability: "repository.push", operation: "push branch", target: `origin/benchmark-${index}`,
          idempotencyKey: `benchmark-key-${index}`, requiredForCompletion: false, provenance: "HOST_REPORTED",
        } });
        const approvalId = `approval-${String(index).padStart(5, "0")}`;
        await requestApproval(target, { packageRoot: getPackageRoot(), taskId, input: {
          approvalId, actionId: action.actionId, actionFingerprint: action.actionFingerprint,
          contractFingerprint: canonical.state.contractFingerprint, taskRevision: canonical.state.revision,
          capability: action.capability, reason: "Disposable benchmark fixture; no external execution",
        } });
        await resolveApproval(target, { packageRoot: getPackageRoot(), taskId, approvalId,
          decision: index % 2 ? "REJECTED" : "APPROVED", authorityKind: "CALLER_ACKNOWLEDGED" });
      }
      db = openStorageDatabase(path.join(target, ".forgeloop/state.sqlite"), { readOnly: true });
    } else runInTransaction(db, () => {
      upsertTask(db, { taskId, descriptor: createTaskDescriptor({ taskId, writeClaims: [], createdAt: timestamp, updatedAt: timestamp }) });
      for (let index = 0; index < size; index += 1) {
        const action = {
          schemaVersion: 1, taskId, actionId: `action-${String(index).padStart(5, "0")}`,
          effectClass: "EXTERNAL_PUBLICATION", capability: "repository.push", operation: "push branch",
          target: `origin/benchmark-${index}`, idempotencyKey: `benchmark-key-${index}`,
          requiredForCompletion: false, requirement: null, provenance: "HOST_REPORTED",
          state: "PROPOSED", revision: 0, createdAt: timestamp, updatedAt: timestamp,
        };
        action.actionFingerprint = canonicalActionFingerprint(action);
        validateActionArtifact(action);
        putAction(db, { taskId, action });
      }
    });
    await exportDatabase(db, portable);
    db.close(); db = null;
    let ledgerEvents = 0;
    if (canonical) {
      const ledger = await validateEventLedger(target, getPackageRoot(), { taskId });
      assert.equal(ledger.valid, true, JSON.stringify(ledger.errors));
      assert.deepEqual(validateStateLedgerCoherence(canonical.state, ledger.events), []);
      ledgerEvents = ledger.events.length;
      const baselineEvents = await import(pathToFileURL(path.join(baselineRoot, "src/core/events.js")).href);
      const portableLedger = await baselineEvents.validateEventLedger(portable, baselineRoot, { taskId });
      assert.equal(portableLedger.valid, true, JSON.stringify(portableLedger.errors));
      assert.deepEqual(portableLedger.events, ledger.events);
      const baselineApprovals = await import(pathToFileURL(path.join(baselineRoot, "src/core/approvals.js")).href);
      assert.deepEqual(await listApprovals(target, { packageRoot: getPackageRoot(), taskId }),
        await baselineApprovals.listApprovals(portable, { packageRoot: baselineRoot, taskId }));
      assert.equal((await listApprovals(target, { packageRoot: getPackageRoot(), taskId })).length, size);
    }
    const fixtureMs = performance.now() - fixtureStarted;
    const options = { taskId, idempotencyKey: `benchmark-key-${size - 1}` };
    const baselineApprovalApi = operation === "approvals" ? await import(pathToFileURL(path.join(baselineRoot, "src/core/approvals.js")).href) : null;
    const baselineProtocol = operation === "protocol" ? await import(pathToFileURL(path.join(nativeComparisonRoot ?? baselineRoot, "src/core/command-runtime.js")).href) : null;
    async function validateThroughRuntime(runtime) {
      const envelope = await runtime({ command: "validate-protocol", projectPath: target, input: { task: taskId },
        ...(runtime === executeForgeLoopCommand && runtimeContext ? { runtimeContext } : {}) });
      assert.equal(envelope.ok, true, JSON.stringify(envelope.error));
      assert.equal(envelope.exitCode, 0, JSON.stringify(envelope.result));
      return envelope.result;
    }
    const nativeCall = operation === "protocol"
      ? () => validateThroughRuntime(executeForgeLoopCommand)
      : operation === "approvals"
      ? () => listApprovals(target, { taskId, packageRoot: getPackageRoot() })
      : () => findActionByIdempotencyKey(target, { ...options, packageRoot: getPackageRoot() });
    const legacyCall = operation === "protocol"
      ? () => validateThroughRuntime(baselineProtocol.executeForgeLoopCommand)
      : operation === "approvals"
      ? () => baselineApprovalApi.listApprovals(portable, { taskId, packageRoot: baselineRoot })
      : () => legacy.findActionByIdempotencyKey(portable, { ...options, packageRoot: baselineRoot });
    // Execution provenance is bound to this exact project path. Swap only
    // disposable closed fixtures, outside measurement; never rewrite receipts.
    await selectFilesystem(true);
    let expected;
    try { expected = await legacyCall(); }
    finally { await selectFilesystem(false); }
    assert.ok(expected);
    if (operation === "approvals") assert.equal(expected.length, size);
    if (operation === "protocol") {
      assert.equal(expected.status, "VALID", JSON.stringify(expected));
      assert.deepEqual(expected.errors, []);
    }
    assert.deepEqual(await nativeCall(), expected);
    assert.equal(await findActionByIdempotencyKey(target, { ...options, idempotencyKey: "missing", packageRoot: getPackageRoot() }), null);
    assert.equal(await legacy.findActionByIdempotencyKey(portable, { ...options, idempotencyKey: "missing", packageRoot: baselineRoot }), null);
    const nativeSamples = []; const legacySamples = [];
    const nativeResources = []; const legacyResources = [];
    const native = [nativeCall, nativeSamples, target, nativeResources];
    const filesystem = [legacyCall, legacySamples, holding ? target : portable, legacyResources];
    const samplesToRun = [];
    if (persistent) {
      // Keep a native connection only while its fixture occupies its bound path.
      // Grouped backend batches avoid swapping an open SQLite handle on Windows.
      const groups = results.length % 2 ? [filesystem, native] : [native, filesystem];
      for (const pair of groups) {
        for (let index = 0; index < repeats + warmup; index++) samplesToRun.push({ pair, index });
      }
    } else {
      for (let index = 0; index < repeats + warmup; index++) {
        for (const pair of index % 2 ? [filesystem, native] : [native, filesystem]) samplesToRun.push({ pair, index });
      }
    }
    let persistentConnection;
    for (const { pair: [call, samples, resourceTarget, resourceSamples], index } of samplesToRun) {
      if (persistent && call === legacyCall && runtimeContext) {
        await runtimeContext.close(); runtimeContext = null;
        assert.throws(() => persistentConnection.prepare("SELECT 1"));
      }
      await selectFilesystem(call === legacyCall);
      if (persistent && call === nativeCall && !runtimeContext) {
        runtimeContext = createForgeLoopContext({ persistentStorage: true });
        persistentConnection = await withProjectStorage(target, store => store.db, { runtimeContext, readOnly: true });
      }
      if (persistent && call === nativeCall) {
        assert.equal(await withProjectStorage(target, store => store.db, { runtimeContext, readOnly: true }), persistentConnection);
      }
      const profiler = profileDirectory ? new Session() : null;
      if (profiler) {
        profiler.connect();
        await profiler.post("Profiler.enable");
        await profiler.post("Profiler.start");
      }
      let result;
      try {
        if (resourcesEnabled) {
          const measured = await measureStorageResources(resourceTarget, call, { linuxPeakRss });
          result = measured.value;
          if (index >= warmup) {
            samples.push(measured.elapsedMs);
            resourceSamples.push(measured.resources);
          }
        } else {
          const start = performance.now(); result = await call();
          if (index >= warmup) samples.push(performance.now() - start);
        }
      } finally {
        if (profiler) {
          try {
            const { profile } = await profiler.post("Profiler.stop");
            await writeFile(path.join(path.resolve(profileDirectory), `${operation}-${size}-${call === legacyCall ? "baseline" : "native"}-${index}.cpuprofile`), JSON.stringify(profile));
          } finally { profiler.disconnect(); }
        }
      }
      assert.deepEqual(result, expected);
      if (persistent && call === nativeCall) {
        assert.equal(await withProjectStorage(target, store => store.db, { runtimeContext, readOnly: true }), persistentConnection);
      }
    }
    if (runtimeContext) {
      await runtimeContext.close(); runtimeContext = null;
      assert.throws(() => persistentConnection.prepare("SELECT 1"));
    }
    results.push({ actions: size, approvals: canonical ? size : 0, ledgerEvents, fixtureMs, ...(operation === "protocol" ? { protocolResult: expected } : {}), outputParity: true, missingKeyParity: true, nativeSamplesMs: nativeSamples, baselineSamplesMs: legacySamples,
      nativeP95Ms: percentile(nativeSamples), baselineP95Ms: percentile(legacySamples), speedupP95: percentile(legacySamples) / percentile(nativeSamples),
      ...(resourcesEnabled ? { rawResourceSamples: { native: nativeResources, baseline: legacyResources } } : {}) });
  } finally {
    await runtimeContext?.close();
    db?.close(); await selectFilesystem(false);
    await rm(target, { recursive: true, force: true }); await rm(portable, { recursive: true, force: true });
    if (holding) await rm(holding, { recursive: true, force: true });
  }
}
process.stdout.write(`${JSON.stringify({ schemaVersion: 1, baselineRevision: revision, node: process.version, platform: process.platform, architecture: process.arch,
  cpu: os.cpus()[0]?.model ?? null, repeats, warmup, timestamp,
  runtime: persistent ? "warm canonical integration runtime with one persistent native connection per backend batch" : "warm-cache public API with per-call native connection",
  persistentConnectionReuseVerified: persistent,
  backendOrder: persistent ? "grouped backend batches, reversed between dataset sizes; connection closed before fixture switch" : "alternating each repetition",
  ...(nativeComparisonRoot ? {
    comparisonKind: "DIAGNOSTIC_NATIVE_VARIANTS",
    nativeComparisonRoot,
    baselineRevisionRole: "Portable fixture parity only; measured comparison uses the named native candidate",
  } : {}),
  seedOutsideMeasurement: true,
  resourceMode: resourcesEnabled, linuxOperationPeakRssEnabled: linuxPeakRss,
  ...(resourcesEnabled ? { resourceMeasurementLimits } : {}),
  fixtureMode, operation, profiling: Boolean(profileDirectory),
  fixtureLimits: [fixtureMode === "synthetic" ? "Synthetic schema-valid PROPOSED actions without approvals, execution records or lifecycle history" : "Canonical diagnosis lifecycle plus public action proposals and alternating approved/rejected approvals; no external action execution", operation === "protocol" ? "Supported validate-protocol result must match completely; it is not every task/action audit" : operation === "approvals" ? "Complete approval listing and validation is measured; output arrays remain proportional to volume" : "Found-key lookup is measured; missing-key and approval parity are validated outside measurement", "This is not full action execution, claim reservation, recovery mutation or warm MCP acceptance"],
  releaseThresholdsVerified: false, results }, null, 2)}\n`);
