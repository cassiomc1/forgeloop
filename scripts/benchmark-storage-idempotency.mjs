/** Equal-output public API comparison; synthetic setup is never commit evidence. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { Session } from "node:inspector/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import { measureStorageResources, resourceMeasurementLimits } from "./lib/storage-benchmark-resources.mjs";
import { canonicalActionFingerprint, validateActionArtifact } from "../src/core/action-model.js";
import { findActionByIdempotencyKey, listActions, proposeAction, validateActionLedgerConsistency } from "../src/core/actions.js";
import { listApprovals, requestApproval, resolveApproval } from "../src/core/approvals.js";
import { validateEventLedger, validateStateLedgerCoherence } from "../src/core/events.js";
import { buildCanonicalDiagnosisProject } from "../tests/helpers/canonical-diagnosis-fixture.js";
import { executeForgeLoopCommand } from "../src/core/command-runtime.js";
import { createForgeLoopContext } from "../src/core/runtime-context.js";
import { withProjectStorage } from "../src/storage/project-boundary.js";
import { getOperationalStore } from "../src/storage/operational-context.js";
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
const validationOnly = process.argv.includes("--validate-only");
const currentRoot = path.resolve(import.meta.dirname, "..");
const baselineJsonLimitBytes = 2 * 1024 * 1024;
function sourceManifest(root, { enforceAdmission = true } = {}) {
  const dirty = execFileSync("git", ["-C", root, "status", "--porcelain", "--untracked-files=no"], { encoding: "utf8" }).trim();
  if (enforceAdmission) assert.ok(validationOnly || dirty === "", "Timed benchmark sources must be committed and unchanged");
  const untracked = execFileSync("git", ["-C", root, "ls-files", "--others", "--exclude-standard", "--", "src", "integrations/mcp/src", "scripts"], { encoding: "utf8" }).trim();
  if (enforceAdmission) assert.equal(untracked, "", "Untracked runtime or benchmark source cannot qualify a frozen comparison");
  const files = execFileSync("git", ["-C", root, "ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean).sort();
  return {
    trackedWorkingChanges: dirty,
    untrackedRuntimeSource: untracked,
    revision: execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    files: files.map(file => ({ path: file, sha256: createHash("sha256").update(readFileSync(path.join(root, file))).digest("hex") })),
  };
}
function inspectKnownBaselineLedgerRefusal(result) {
  if (result?.valid !== false || !Array.isArray(result.errors) || result.errors.length !== 1) return null;
  const [error] = result.errors;
  const artifacts = error?.artifacts;
  if (error?.code !== "JSON_LIMIT_EXCEEDED"
    || !Array.isArray(artifacts) || artifacts.length !== 1
    || typeof artifacts[0] !== "string"
    || !/^\.forgeloop\/task-state\/[a-f0-9]{64}\/events\.ndjson$/.test(artifacts[0])
    || error.message !== `${artifacts[0]} exceeds the ${baselineJsonLimitBytes}-byte limit`) return null;
  return {
    status: "REFUSED",
    stage: "BASELINE_LEDGER_VALIDATION",
    code: error.code,
    message: error.message,
    artifacts: [...artifacts],
    baselineLimitBytes: baselineJsonLimitBytes,
  };
}
const sourceBefore = { current: sourceManifest(currentRoot), baseline: sourceManifest(baselineRoot) };
const sourceAdmissionEligible = sourceBefore.current.trackedWorkingChanges === ""
  && sourceBefore.baseline.trackedWorkingChanges === ""
  && sourceBefore.current.untrackedRuntimeSource === ""
  && sourceBefore.baseline.untrackedRuntimeSource === "";
function validationAcceptanceIneligibilityReasons({ baselineRefused = false, equalValidationParityEligible, nativeComparisonRoot, sourceAdmissionEligible, validationOnly }) {
  return [
    ...(sourceAdmissionEligible ? [] : ["SOURCE_NOT_CLEAN_COMMITTED"]),
    ...(validationOnly ? ["VALIDATION_ONLY"] : []),
    ...(nativeComparisonRoot ? ["DIAGNOSTIC_NATIVE_VARIANT"] : []),
    ...(equalValidationParityEligible ? [] : ["FULL_PUBLIC_PARITY_NOT_ESTABLISHED"]),
    ...(baselineRefused ? ["BASELINE_LEDGER_REFUSAL"] : []),
  ];
}
function serializeBenchmarkError(error) {
  const serialized = {
    name: error?.name ?? "Error",
    code: error?.code ?? null,
    message: error?.message ?? String(error),
    stack: error?.stack ?? null,
  };
  if (Array.isArray(error?.artifacts)) serialized.artifacts = [...error.artifacts];
  else if (typeof error?.artifacts === "string") serialized.artifacts = error.artifacts;
  return serialized;
}
function createUnexpectedFailure(error, context, nativeProofStatus, resultsProduced) {
  return {
    status: "UNEXPECTED_ERROR",
    firstCause: serializeBenchmarkError(error),
    context: { ...context },
    nativeProofStatus,
    resultsProduced,
  };
}
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
assert.ok(!persistent || operation === "protocol" || (operation === "idempotency" && fixtureMode === "public-approvals"), "persistent measurement requires protocol or public-approvals idempotency");
const profileDirectory = argument("profile-dir");
if (profileDirectory) await mkdir(path.resolve(profileDirectory), { recursive: true });
assert.ok(["idempotency", "approvals", "protocol"].includes(operation), "operation must be idempotency, approvals or protocol");
assert.ok(operation === "idempotency" || fixtureMode === "public-approvals", "approval/protocol operations require the public-approvals fixture");
assert.ok(sizes.every(size => Number.isInteger(size) && size >= 1 && size <= 5000));
assert.ok(Number.isInteger(repeats) && repeats >= 2 && repeats <= 100);
const timestamp = "2026-09-11T00:00:00.000Z";
const percentile = samples => [...samples].sort((a, b) => a - b)[Math.ceil(samples.length * 0.95) - 1];
const results = [];
let sourceAfter = null;
let sourceAfterCaptureError = null;
let benchmarkFailure = null;
let activeFailureContext = { stage: "PRE_MEASUREMENT", size: null };
let activeNativeProofStatus = "NOT_STARTED";
const markFailureContext = (stage, size, extra = {}) => {
  activeFailureContext = { stage, size, ...extra };
};
try {
for (const size of sizes) {
  activeNativeProofStatus = fixtureMode === "public-approvals" ? "NOT_STARTED" : "NOT_APPLICABLE";
  markFailureContext("FIXTURE_SETUP", size);

  const fixtureStarted = performance.now();
  const taskId = "idempotency-benchmark";
  let canonical = null;
  let target = null;
  let portable = null;
  let holding = null;
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
  let primaryError = null;
  try {
    canonical = fixtureMode === "public-approvals" ? await buildCanonicalDiagnosisProject({ taskId }) : null;
    target = canonical?.target ?? await mkdtemp(path.join(os.tmpdir(), "forgeloop-idempotency-native-"));
    portable = await mkdtemp(path.join(os.tmpdir(), "forgeloop-idempotency-portable-"));
    holding = operation === "protocol" ? await mkdtemp(path.join(os.tmpdir(), "forgeloop-benchmark-holding-")) : null;
    markFailureContext("NATIVE_FIXTURE_SEED", size);
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
    markFailureContext("PORTABLE_EXPORT", size);
    await exportDatabase(db, portable);
    db.close(); db = null;
    let ledgerEvents = 0;
    let nativeActionCount = 0;
    let nativeApprovalCount = 0;
    let nativeActionLedgerValid = null;
    let nativeLookupChecks = 0;
    let baselineRefusal = null;
    let completeActionApprovalParity = false;
    activeNativeProofStatus = canonical ? "IN_PROGRESS" : "NOT_APPLICABLE";
    markFailureContext("NATIVE_PROOF", size);
    if (canonical) {
      const ledger = await validateEventLedger(target, getPackageRoot(), { taskId });
      assert.equal(ledger.valid, true, JSON.stringify(ledger.errors));
      assert.deepEqual(validateStateLedgerCoherence(canonical.state, ledger.events), []);
      ledgerEvents = ledger.events.length;

      // Complete the native proof before admitting the portable baseline. A
      // baseline ledger refusal must not prevent counting and validating every
      // native action and approval in the requested workload.
      const nativeApprovals = await listApprovals(target, { packageRoot: getPackageRoot(), taskId });
      nativeApprovalCount = nativeApprovals.length;
      assert.equal(nativeApprovalCount, size, "Native public approval count must match the requested workload");
      const nativeActions = await listActions(target, { packageRoot: getPackageRoot(), taskId });
      nativeActionCount = nativeActions.length;
      assert.equal(nativeActionCount, size, "Native public action count must match the requested workload");
      assert.deepEqual(await validateActionLedgerConsistency(target, { packageRoot: getPackageRoot(), taskId }), []);
      nativeActionLedgerValid = true;
      for (const idempotencyKey of ["benchmark-key-0", `benchmark-key-${Math.floor(size / 2)}`, `benchmark-key-${size - 1}`, "benchmark-key-missing"]) {
        const found = await findActionByIdempotencyKey(target, { packageRoot: getPackageRoot(), taskId, idempotencyKey });
        if (idempotencyKey === "benchmark-key-missing") assert.equal(found, null);
        else {
          assert.ok(found, `Native action must exist for ${idempotencyKey}`);
          assert.equal(found.idempotencyKey, idempotencyKey);
        }
        nativeLookupChecks += 1;
      }
      activeNativeProofStatus = "COMPLETE";
      markFailureContext("BASELINE_VALIDATION", size);

      const baselineEvents = await import(pathToFileURL(path.join(baselineRoot, "src/core/events.js")).href);
      const portableLedger = await baselineEvents.validateEventLedger(portable, baselineRoot, { taskId });
      baselineRefusal = inspectKnownBaselineLedgerRefusal(portableLedger);
      if (!portableLedger.valid && !baselineRefusal) {
        assert.equal(portableLedger.valid, true, JSON.stringify(portableLedger.errors));
      }
      if (!baselineRefusal) {
        assert.equal(portableLedger.valid, true, JSON.stringify(portableLedger.errors));
        assert.deepEqual(portableLedger.events, ledger.events);
        const baselineApprovals = await import(pathToFileURL(path.join(baselineRoot, "src/core/approvals.js")).href);
        assert.deepEqual(nativeApprovals,
          await baselineApprovals.listApprovals(portable, { packageRoot: baselineRoot, taskId }));
        const portableActions = await legacy.listActions(portable, { packageRoot: baselineRoot, taskId });
        assert.deepEqual(portableActions, nativeActions, "Complete public action histories must match");
        assert.deepEqual(await legacy.validateActionLedgerConsistency(portable, { packageRoot: baselineRoot, taskId }), []);
        for (const idempotencyKey of ["benchmark-key-0", `benchmark-key-${Math.floor(size / 2)}`, `benchmark-key-${size - 1}`, "benchmark-key-missing"]) {
          assert.deepEqual(
            await findActionByIdempotencyKey(target, { packageRoot: getPackageRoot(), taskId, idempotencyKey }),
            await legacy.findActionByIdempotencyKey(portable, { packageRoot: baselineRoot, taskId, idempotencyKey }),
            "First, middle, tail and missing public idempotency lookups must match",
          );
        }
        completeActionApprovalParity = true;
      } else {
        baselineRefusal = {
          ...baselineRefusal,
          requestedActions: size,
          requestedApprovals: size,
          nativeProof: {
            ledgerValid: true,
            stateCoherenceValid: true,
            actionCount: nativeActionCount,
            approvalCount: nativeApprovalCount,
            actionLedgerValid: nativeActionLedgerValid,
            idempotencyChecks: nativeLookupChecks,
          },
        };
      }
    }
    const fixtureMs = performance.now() - fixtureStarted;
    if (baselineRefusal) {
      const equalValidationParityEligible = false;
      const equalValidationAcceptanceIneligibilityReasons = validationAcceptanceIneligibilityReasons({
        baselineRefused: true, equalValidationParityEligible, nativeComparisonRoot,
        sourceAdmissionEligible, validationOnly,
      });
      results.push({
        actions: size,
        approvals: canonical ? size : 0,
        ledgerEvents,
        fixtureMs,
        nativeActionCount,
        nativeApprovalCount,
        nativeActionLedgerValid,
        nativeLookupChecks,
        completeActionApprovalParity: "NOT_REACHED_BASELINE_REFUSAL",
        parityScope: "BASELINE_REFUSAL_BEFORE_EQUAL_VALIDATION",
        baselineValidation: baselineRefusal,
        outputParity: null,
        outputParityVerified: false,
        missingKeyParity: null,
        equalValidationParityEligible,
        equalValidationAcceptanceEligible: false,
        equalValidationAcceptanceIneligibilityReasons,
        sourceAdmissionEligible,
        timingAcceptanceEligible: false,
        timingAcceptanceIneligibilityReasons: [
          ...equalValidationAcceptanceIneligibilityReasons,
          "NO_TIMED_SAMPLES",
        ],
        acceptanceRefusal: "Pinned baseline event-ledger validation refused the requested public workload; timing is observationally unavailable",
        timedSamplesProduced: false,
        unmeasuredReason: "BASELINE_LEDGER_REFUSAL",
        persistentConnectionReuseApplicable: persistent,
        persistentConnectionReuseChecks: 0,
        persistentConnectionReuseVerified: false,
        persistentConnectionReuseStatus: persistent ? "NOT_MEASURED_BASELINE_REFUSAL" : "NOT_APPLICABLE",
        nativeSamplesMs: [],
        baselineSamplesMs: [],
        nativeP95Ms: null,
        baselineP95Ms: null,
        speedupP95: null,
      });
      continue;
    }
    markFailureContext("PUBLIC_PARITY_PRECHECK", size);
    const lookupCases = [
      { position: "first", key: "benchmark-key-0" },
      { position: "middle", key: `benchmark-key-${Math.floor(size / 2)}` },
      { position: "tail", key: `benchmark-key-${size - 1}` },
      { position: "missing", key: "benchmark-key-missing" },
    ];
    let persistentConnection;
    let directLookupIdentityChecks = 0;
    async function directLookupBatch(nativeBackend) {
      const outputs = [];
      for (const { position, key } of lookupCases) {
        const lookup = () => (nativeBackend ? findActionByIdempotencyKey : legacy.findActionByIdempotencyKey)(
          nativeBackend ? target : portable, { taskId, idempotencyKey: key, packageRoot: nativeBackend ? getPackageRoot() : baselineRoot });
        const value = nativeBackend && runtimeContext
          ? await withProjectStorage(target, async () => {
            assert.equal(getOperationalStore(target)?.db, persistentConnection);
            const found = await lookup();
            // Check the connection actually in scope immediately after every successful public call.
            assert.equal(getOperationalStore(target)?.db, persistentConnection);
            directLookupIdentityChecks += 1;
            return found;
          }, { runtimeContext, readOnly: true })
          : await lookup();
        if (position === "missing") assert.equal(value, null);
        else { assert.ok(value); assert.equal(value.idempotencyKey, key); }
        outputs.push({ position, value });
      }
      return outputs;
    }
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
      : () => persistent ? directLookupBatch(true) : findActionByIdempotencyKey(target, { ...options, packageRoot: getPackageRoot() });
    const legacyCall = operation === "protocol"
      ? () => validateThroughRuntime(baselineProtocol.executeForgeLoopCommand)
      : operation === "approvals"
      ? () => baselineApprovalApi.listApprovals(portable, { taskId, packageRoot: baselineRoot })
      : () => persistent ? directLookupBatch(false) : legacy.findActionByIdempotencyKey(portable, { ...options, packageRoot: baselineRoot });
    // Execution provenance is bound to this exact project path. Swap only
    // disposable closed fixtures, outside measurement; never rewrite receipts.
    markFailureContext("MEASUREMENT_PRECHECK", size);
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
    let persistentConnectionReuseChecks = 0;
    const native = [nativeCall, nativeSamples, target, nativeResources];
    const filesystem = [legacyCall, legacySamples, holding ? target : portable, legacyResources];
    const samplesToRun = [];
    if (!validationOnly && persistent) {
      // Keep a native connection only while its fixture occupies its bound path.
      // Grouped backend batches avoid swapping an open SQLite handle on Windows.
      const groups = results.length % 2 ? [filesystem, native] : [native, filesystem];
      for (const pair of groups) {
        for (let index = 0; index < repeats + warmup; index++) samplesToRun.push({ pair, index });
      }
    } else if (!validationOnly) {
      for (let index = 0; index < repeats + warmup; index++) {
        for (const pair of index % 2 ? [filesystem, native] : [native, filesystem]) samplesToRun.push({ pair, index });
      }
    }
    for (const { pair: [call, samples, resourceTarget, resourceSamples], index } of samplesToRun) {
      markFailureContext("MEASUREMENT_SAMPLE", size, { backend: call === legacyCall ? "baseline" : "native", sample: index });
      if (persistent && call === legacyCall && runtimeContext) {
        await runtimeContext.close(); runtimeContext = null;
        assert.throws(() => persistentConnection.prepare("SELECT 1"));
      }
      await selectFilesystem(call === legacyCall);
      if (persistent && call === nativeCall && !runtimeContext) {
        runtimeContext = createForgeLoopContext({ persistentStorage: true });
        persistentConnection = await withProjectStorage(target, () => getOperationalStore(target).db, { runtimeContext, readOnly: true });
      }
      if (persistent && call === nativeCall) {
        assert.equal(await withProjectStorage(target, () => getOperationalStore(target).db, { runtimeContext, readOnly: true }), persistentConnection);
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
        assert.equal(await withProjectStorage(target, () => getOperationalStore(target).db, { runtimeContext, readOnly: true }), persistentConnection);
        persistentConnectionReuseChecks += 1;
      }
    }
    if (runtimeContext) {
      await runtimeContext.close(); runtimeContext = null;
      assert.throws(() => persistentConnection.prepare("SELECT 1"));
    }
    const expectedSamples = validationOnly ? 0 : repeats;
    assert.equal(nativeSamples.length, expectedSamples, "Exact native sample count required");
    assert.equal(legacySamples.length, expectedSamples, "Exact baseline sample count required");
    assert.equal(nativeResources.length, resourcesEnabled ? expectedSamples : 0);
    assert.equal(legacyResources.length, resourcesEnabled ? expectedSamples : 0);
    if (persistent && operation === "idempotency") {
      assert.equal(directLookupIdentityChecks, validationOnly ? 0 : (repeats + warmup) * lookupCases.length);
    }
    if (persistent) assert.equal(persistentConnectionReuseChecks, validationOnly ? 0 : repeats + warmup);
    const timedSamplesProduced = nativeSamples.length === repeats && legacySamples.length === repeats;
    const persistentConnectionReuseVerified = persistent && !validationOnly && persistentConnectionReuseChecks > 0;
    const persistentConnectionReuseStatus = !persistent
      ? "NOT_APPLICABLE"
      : persistentConnectionReuseVerified
      ? "VERIFIED"
      : validationOnly
      ? "NOT_MEASURED_VALIDATION_ONLY"
      : "NOT_MEASURED";
    const equalValidationParityEligible = Boolean(canonical && completeActionApprovalParity);
    const outputParityVerified = true;
    const equalValidationAcceptanceIneligibilityReasons = validationAcceptanceIneligibilityReasons({
      equalValidationParityEligible, nativeComparisonRoot, sourceAdmissionEligible, validationOnly,
    });
    const equalValidationAcceptanceEligible = equalValidationAcceptanceIneligibilityReasons.length === 0;
    const timingAcceptanceIneligibilityReasons = [
      ...equalValidationAcceptanceIneligibilityReasons,
      ...(timedSamplesProduced ? [] : ["NO_TIMED_SAMPLES"]),
      ...(persistent && !persistentConnectionReuseVerified ? ["PERSISTENT_REUSE_NOT_VERIFIED"] : []),
    ];
    const timingAcceptanceEligible = timingAcceptanceIneligibilityReasons.length === 0;
    results.push({ actions: size, approvals: canonical ? size : 0, ledgerEvents, fixtureMs, nativeActionCount, nativeApprovalCount, nativeActionLedgerValid, nativeLookupChecks,
      completeActionApprovalParity: canonical ? completeActionApprovalParity : null,
      parityScope: canonical ? "FULL_PUBLIC_ACTION_APPROVAL_LEDGER" : "MEASURED_OPERATION_OUTPUT_ONLY",
      outputParityVerified, equalValidationParityEligible, equalValidationAcceptanceEligible,
      equalValidationAcceptanceIneligibilityReasons,
      sourceAdmissionEligible, timingAcceptanceEligible,
      timingAcceptanceIneligibilityReasons,
      baselineValidation: canonical ? { status: "VALID" } : null,
      timedSamplesProduced,
      unmeasuredReason: timedSamplesProduced ? null : validationOnly ? "VALIDATION_ONLY" : "NO_TIMED_SAMPLES",
      persistentConnectionReuseApplicable: persistent,
      persistentConnectionReuseChecks,
      persistentConnectionReuseVerified,
      persistentConnectionReuseStatus,
      ...(operation === "idempotency" && persistent ? {
        lookupBatchOutputs: expected,
        lookupPositions: lookupCases.map(item => item.position),
        publicLookupsPerSample: lookupCases.length,
        timingUnit: "one sequential first/middle/tail/missing public lookup batch",
        nativePublicLookupCallsMeasured: nativeSamples.length * lookupCases.length,
        baselinePublicLookupCallsMeasured: legacySamples.length * lookupCases.length,
        persistentPublicLookupConnectionIdentityChecks: directLookupIdentityChecks,
        identityChecksIncludeWarmup: true,
      } : {}),
      ...(operation === "protocol" ? { protocolResult: expected } : {}), outputParity: true, missingKeyParity: true, nativeSamplesMs: nativeSamples, baselineSamplesMs: legacySamples,
      nativeP95Ms: validationOnly ? null : percentile(nativeSamples), baselineP95Ms: validationOnly ? null : percentile(legacySamples), speedupP95: validationOnly ? null : percentile(legacySamples) / percentile(nativeSamples),
      ...(resourcesEnabled ? { rawResourceSamples: { native: nativeResources, baseline: legacyResources } } : {}) });
  } catch (error) {
    primaryError = error;
    if (!benchmarkFailure) benchmarkFailure = createUnexpectedFailure(error, activeFailureContext, activeNativeProofStatus, results.length);
    throw error;
  } finally {
    const cleanupErrors = [];
    try { await runtimeContext?.close(); } catch (error) { cleanupErrors.push(error); }
    try { db?.close(); } catch (error) { cleanupErrors.push(error); }
    try { await selectFilesystem(false); } catch (error) { cleanupErrors.push(error); }
    for (const cleanupPath of [target, portable, holding]) {
      if (!cleanupPath) continue;
      try { await rm(cleanupPath, { recursive: true, force: true }); } catch (error) { cleanupErrors.push(error); }
    }
    if (cleanupErrors.length > 0) {
      if (primaryError) {
        if (benchmarkFailure) benchmarkFailure.cleanupErrors = cleanupErrors.map(serializeBenchmarkError);
      } else {
        const cleanupError = cleanupErrors[0];
        if (!benchmarkFailure) benchmarkFailure = createUnexpectedFailure(cleanupError, { ...activeFailureContext, stage: "CLEANUP" }, activeNativeProofStatus, results.length);
        benchmarkFailure.cleanupErrors = cleanupErrors.map(serializeBenchmarkError);
        throw cleanupError;
      }
    }
  }
}
} catch (error) {
  if (!benchmarkFailure) benchmarkFailure = createUnexpectedFailure(error, activeFailureContext, activeNativeProofStatus, results.length);
}
try {
  sourceAfter = { current: sourceManifest(currentRoot, { enforceAdmission: false }), baseline: sourceManifest(baselineRoot, { enforceAdmission: false }) };
} catch (error) {
  sourceAfterCaptureError = serializeBenchmarkError(error);
  if (!benchmarkFailure) benchmarkFailure = createUnexpectedFailure(error, { stage: "SOURCE_POSTCHECK", size: null }, activeNativeProofStatus, results.length);
}
const trackedSourcesUnchanged = sourceAfter !== null
  && JSON.stringify(sourceAfter) === JSON.stringify(sourceBefore);
if (!benchmarkFailure && !trackedSourcesUnchanged) {
  benchmarkFailure = {
    status: "SOURCE_CHANGED",
    firstCause: {
      name: "SourceIntegrityError",
      code: "E_SOURCE_CHANGED",
      message: "Current or baseline tracked source changed during validation or measurement",
      stack: null,
    },
    context: { stage: "SOURCE_POSTCHECK", size: null },
    nativeProofStatus: activeNativeProofStatus,
    resultsProduced: results.length,
  };
}
if (benchmarkFailure) {
  benchmarkFailure.sourceAfter = sourceAfter;
  benchmarkFailure.sourceAfterCaptureError = sourceAfterCaptureError;
  benchmarkFailure.trackedSourcesUnchanged = trackedSourcesUnchanged;
}
const baselineRefusals = results.filter(result => result.baselineValidation?.status === "REFUSED");
const benchmarkComplete = benchmarkFailure === null && trackedSourcesUnchanged;
const outputParityVerified = benchmarkComplete && results.length > 0
  && results.every(result => result.outputParityVerified === true);
const equalValidationParityEligible = benchmarkComplete && results.length > 0
  && results.every(result => result.equalValidationParityEligible === true);
const persistentReuseMeasuredCases = results.filter(result => result.persistentConnectionReuseChecks > 0);
const persistentConnectionReuseVerified = benchmarkComplete && persistent
  && results.length > 0
  && results.every(result => result.persistentConnectionReuseVerified === true);
const persistentConnectionReuseStatus = !persistent
  ? "NOT_APPLICABLE"
  : persistentConnectionReuseVerified
  ? "VERIFIED"
  : validationOnly
  ? "NOT_MEASURED_VALIDATION_ONLY"
  : persistentReuseMeasuredCases.length === 0 && baselineRefusals.length === results.length
  ? "NOT_MEASURED_BASELINE_REFUSAL"
  : persistentReuseMeasuredCases.length === 0
  ? "NOT_MEASURED"
  : "PARTIAL";
const persistentConnectionReuseEvidence = {
  applicable: persistent,
  status: persistentConnectionReuseStatus,
  totalCases: results.length,
  measuredCases: persistentReuseMeasuredCases.length,
  verifiedCases: results.filter(result => result.persistentConnectionReuseVerified === true).length,
  unmeasuredCases: results.filter(result => result.persistentConnectionReuseChecks === 0).length,
  baselineRefusalCases: baselineRefusals.length,
  validationOnly,
};
const timedSamplesProduced = results.some(result => result.timedSamplesProduced === true);
const failureIneligibilityReasons = [
  ...(benchmarkFailure?.status === "UNEXPECTED_ERROR" ? ["UNEXPECTED_BENCHMARK_FAILURE"] : []),
  ...(sourceAfter !== null && !trackedSourcesUnchanged ? ["SOURCE_CHANGED_DURING_BENCHMARK"] : []),
  ...(sourceAfterCaptureError ? ["SOURCE_AFTER_UNAVAILABLE"] : []),
];
const equalValidationAcceptanceIneligibilityReasons = [
  ...validationAcceptanceIneligibilityReasons({
    baselineRefused: baselineRefusals.length > 0, equalValidationParityEligible, nativeComparisonRoot,
    sourceAdmissionEligible, validationOnly,
  }),
  ...failureIneligibilityReasons,
];
const equalValidationAcceptanceEligible = benchmarkComplete && equalValidationAcceptanceIneligibilityReasons.length === 0;
const timingAcceptanceIneligibilityReasons = [
  ...equalValidationAcceptanceIneligibilityReasons,
  ...(timedSamplesProduced ? [] : ["NO_TIMED_SAMPLES"]),
  ...(persistent && !persistentConnectionReuseVerified ? ["PERSISTENT_REUSE_NOT_VERIFIED"] : []),
];
const timingAcceptanceEligible = benchmarkComplete && timingAcceptanceIneligibilityReasons.length === 0;
const failureManifest = benchmarkFailure ?? (baselineRefusals.length === 0 ? null : {
  status: "EXPLICIT_BASELINE_REFUSAL",
  firstCause: baselineRefusals[0].baselineValidation,
  stages: baselineRefusals.map(result => ({
    stage: result.baselineValidation.stage,
    actions: result.actions,
    approvals: result.approvals,
    code: result.baselineValidation.code,
    artifacts: result.baselineValidation.artifacts,
  })),
});
process.stdout.write(`${JSON.stringify({ schemaVersion: 1, baselineRevision: revision, node: process.version, platform: process.platform, architecture: process.arch,
  cpu: os.cpus()[0]?.model ?? null, validationOnly, repeats, warmup, timestamp,
  sourceRevision: sourceBefore.current.revision, sourceManifests: sourceBefore, sourceManifestsAfter: sourceAfter,
  trackedSourcesUnchanged, benchmarkComplete,
  runtime: persistent ? operation === "idempotency" ? "warm direct public lookup batches through persistent project storage context" : "warm canonical integration runtime with one persistent native connection per backend batch" : "warm-cache public API with per-call native connection",
  persistentConnectionReuseVerified,
  persistentConnectionReuseEvidence,
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
  fixtureLimits: [fixtureMode === "synthetic" ? "Synthetic schema-valid PROPOSED actions without approvals, execution records or lifecycle history" : "Canonical diagnosis lifecycle plus public action proposals and alternating approved/rejected approvals; no external action execution", operation === "protocol" ? "Supported validate-protocol result must match completely; it is not every task/action audit" : operation === "approvals" ? "Complete approval listing and validation is measured; output arrays remain proportional to volume" : (persistent ? "Each sample measures a sequential first/middle/tail/missing public lookup batch; complete action/approval/ledger parity is prechecked outside measurement" : "Found-key lookup is measured; missing-key and approval parity are validated outside measurement"), "This is not full action execution, claim reservation, recovery mutation or warm MCP acceptance"],
  outputParityVerified, equalValidationParityEligible, equalValidationAcceptanceEligible,
  equalValidationAcceptanceIneligibilityReasons,
  sourceAdmissionEligible, timingAcceptanceEligible,
  timingAcceptanceIneligibilityReasons,
  sourceAdmissionReason: sourceAdmissionEligible ? "CLEAN_COMMITTED_SOURCE" : validationOnly ? "VALIDATION_ONLY_SOURCE_MAY_BE_DIRTY" : "SOURCE_NOT_ELIGIBLE",
  timedSamplesProduced,
  failureManifest, releaseThresholdsVerified: false, results }, null, 2)}\n`);
if (benchmarkFailure) process.exitCode = 1;
