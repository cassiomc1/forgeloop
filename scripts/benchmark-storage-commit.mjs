/** Matched public state-plus-event transaction measurement; setup is excluded. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import { BENCHMARK_SOURCE_MANIFEST_SCHEMA_VERSION, captureBenchmarkSourceManifest } from "./lib/benchmark-source-manifest.mjs";
import { buildPublicStateEventLane } from "./lib/benchmark-domain-fixture.mjs";
import { taskArtifactPath } from "../src/core/task-paths.js";
import { createTaskDescriptor } from "../src/core/task-descriptor.js";
import { createWorkState, contractFingerprint } from "../src/core/work-state.js";
import { buildProtocolEvent } from "../src/core/events.js";
import { openStorageDatabase, runInTransaction, upsertTask, appendEvent, exportDatabase, reserveClaims } from "../src/storage/index.js";

const argument = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const revision = "ee9ce11123d4e728d3dbc92f5d62d4bf41bb79c5";
const baseline = argument("baseline-root");
assert.ok(baseline, "--baseline-root requires a clean pinned checkout");
const baselineRoot = path.resolve(baseline);
assert.equal(execFileSync("git", ["-C", baselineRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(), revision);
assert.equal(execFileSync("git", ["-C", baselineRoot, "status", "--porcelain", "--untracked-files=no"], { encoding: "utf8" }).trim(), "");
const currentRoot = path.resolve(import.meta.dirname, "..");
const validationOnly = process.argv.includes("--validate-only");
async function sourceManifest(root) {
  const manifest = await captureBenchmarkSourceManifest(root);
  assert.ok(validationOnly || manifest.status === "", "Timed benchmark sources must be committed and unchanged");
  assert.deepEqual(manifest.untrackedEvidence.unexpectedPaths, [], "Unexpected untracked source cannot qualify a frozen comparison");
  return manifest;
}
const sourceBefore = { current: await sourceManifest(currentRoot), baseline: await sourceManifest(baselineRoot) };
async function api(root) {
  const load = name => import(pathToFileURL(path.join(root, `src/core/${name}.js`)).href);
  return { root, ...(await load("work-state")), ...(await load("events")), ...(await load("transaction")), ...(await load("task-claim-state")) };
}
const native = await api(currentRoot); const legacy = await api(baselineRoot);
const sizes = (argument("events") ?? "10,1000,100000").split(",").map(Number);
const repeats = Number(argument("repeats") ?? 20);
const fixtureMode = argument("fixture") ?? "synthetic";
assert.ok(["synthetic", "public-domain"].includes(fixtureMode));
const claimCount = Number(argument("claims") ?? 0);
assert.ok(Number.isInteger(claimCount) && claimCount >= 0 && claimCount <= 1000);
const claims = Array.from({ length: claimCount }, (_, index) => `src/benchmark-claim-${index}.js`);
assert.ok(sizes.every(size => Number.isInteger(size) && size >= 1 && size <= 100000));
assert.ok(Number.isInteger(repeats) && repeats >= 2 && repeats <= 100);
const timestamp = "2026-09-11T00:00:00.000Z";
const taskId = "commit-benchmark";
const percentile = samples => [...samples].sort((a, b) => a - b)[Math.ceil(samples.length * 0.95) - 1];
function inspectKnownBaselineLedgerRefusal(result) {
  if (result?.valid !== false || !Array.isArray(result.errors) || result.errors.length !== 1) return null;
  const [error] = result.errors;
  const expectedPath = taskArtifactPath(taskId, "events");
  if (error?.code !== "JSON_LIMIT_EXCEEDED" || !Array.isArray(error.artifacts)
    || error.artifacts.length !== 1 || error.artifacts[0] !== expectedPath
    || error.message !== `${expectedPath} exceeds the 2097152-byte limit`) return null;
  return { status: "REFUSED", causeCode: error.code, message: error.message, artifacts: [...error.artifacts], baselineLimitBytes: 2097152 };
}
function serializeBenchmarkError(error) {
  return { name: error?.name ?? "Error", code: error?.code ?? null, message: error?.message ?? String(error),
    stack: error?.stack ?? null, cleanupErrors: error?.cleanupErrors ?? [] };
}
const p50 = samples => [...samples].sort((a, b) => a - b)[Math.ceil(samples.length * 0.5) - 1];
const throughput = samples => samples.length * 1000 / samples.reduce((sum, value) => sum + value, 0);
const results = [];
let firstFailure = null;
let activeCount = null;
try {
for (const count of sizes) {
  activeCount = count;
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-commit-native-"));
  const portable = await mkdtemp(path.join(os.tmpdir(), "forgeloop-commit-baseline-"));
  let db;
  let rowError = null;
  try {
    await mkdir(path.join(target, ".forgeloop"));
    const publicFixture = fixtureMode === "public-domain"
      ? await buildPublicStateEventLane({ target, packageRoot: currentRoot, taskId, eventCount: count, claims })
      : null;
    db = openStorageDatabase(path.join(target, ".forgeloop/state.sqlite"));
    const durability = { journalMode: db.prepare("PRAGMA journal_mode").get().journal_mode, synchronous: db.prepare("PRAGMA synchronous").get().synchronous };
    assert.deepEqual(durability, { journalMode: "wal", synchronous: 2 });
    let checkpoint = { seq: 0, lastHash: null };
    let initialRevision = 0;
    let publicPreludeEvents = null;
    if (fixtureMode === "public-domain") {
      initialRevision = publicFixture.state.revision;
      publicPreludeEvents = publicFixture.preludeEvents;
      const head = publicFixture.ledger.at(-1);
      checkpoint = { seq: head.seq, lastHash: head.hash };
    } else {
    runInTransaction(db, () => {
      const state = createWorkState({ taskId, contractFingerprint: contractFingerprint({ fixture: "commit" }), phase: "RECEIVED", revision: 0, lastUpdated: timestamp });
      upsertTask(db, { taskId, descriptor: createTaskDescriptor({ taskId, writeClaims: claims, createdAt: timestamp, updatedAt: timestamp }), state });
      reserveClaims(db, { taskId, claims, createdAt: timestamp });
      for (let index = 0; index < count; index += 1) {
        const event = buildProtocolEvent({ taskId, event: "TASK_RECEIVED", at: timestamp, details: { fixture: "state-event-commit", observation: index, payload: "Representative deterministic state and event observation." } }, { checkpoint });
        appendEvent(db, { taskId, event }); checkpoint = { seq: event.seq, lastHash: event.hash };
      }
    });
    }
    await exportDatabase(db, portable); db.close(); db = null;
    // The pinned writer normally persists this cache beside every append. A
    // portable native export has no obsolete index; recreate only benchmark
    // setup metadata so the baseline uses its unchanged normal append path.
    await writeFile(path.join(portable, `${taskArtifactPath(taskId, "events")}.index.json`), `${JSON.stringify({ schemaVersion: 1, ...checkpoint })}\n`);
    // Classify the pinned baseline's existing byte-limit refusal before timing.
    // No storage-level substitute or reduced audit may qualify this workload.
    await native.assertTaskMutationAllowed(target, { taskId, packageRoot: currentRoot });
    const seedBaselineLedger = await legacy.validateEventLedger(portable, baselineRoot, { taskId });
    if (!seedBaselineLedger.valid) {
      const knownRefusal = inspectKnownBaselineLedgerRefusal(seedBaselineLedger);
      assert.ok(knownRefusal, `Unexpected baseline seed refusal: ${JSON.stringify(seedBaselineLedger.errors)}`);
      const refusedOwnership = await legacy.resolveTaskClaimState(portable, { taskId, packageRoot: baselineRoot });
      assert.equal(refusedOwnership.valid, false);
      assert.equal(refusedOwnership.claimState, "INCONSISTENT");
      assert.equal(refusedOwnership.mutationAllowed, false);
      assert.equal(refusedOwnership.errors.length, 1);
      assert.equal(refusedOwnership.errors[0].causeCode, "JSON_LIMIT_EXCEEDED");
      assert.equal(refusedOwnership.errors[0].message, `Task event ledger is invalid: ${knownRefusal.message}`);
      assert.deepEqual(refusedOwnership.effectiveWriteClaims, claims);
      results.push({ fixtureMode, validationOnly, status: "NOT_COMPARABLE", timingStatus: "NOT_MEASURED", timingAcceptanceEligible: false,
        initialEvents: count, initialRevision, publicPreludeEvents, claimCount, commitCount: 0,
        committedResultParity: null, persistedStateAndTailParity: null, ownershipClassificationParity: false, equalValidationAcceptanceEligible: false,
        acceptanceRefusal: "Pinned baseline refused complete ledger/ownership validation at its unchanged JSON byte limit",
        baselineOwnershipAudit: { ...knownRefusal, claimsRetained: true, errors: seedBaselineLedger.errors },
        durability, nativeSamplesMs: null, baselineSamplesMs: null, nativeP50Ms: null, baselineP50Ms: null, nativeThroughputCommitsPerSecond: null, baselineThroughputCommitsPerSecond: null, nativeP95Ms: null, baselineP95Ms: null, reductionP95: null });
      continue;
    }
    await legacy.assertTaskMutationAllowed(portable, { taskId, packageRoot: baselineRoot });
    const transact = (implementation, root, expectedRevision) => implementation.withTaskTransaction({ target: root, taskId, operation: "benchmark-state-event", packageRoot: implementation.root, recordCommitEvent: false }, async () => {
      // Equal public authority validation is included in every timed commit.
      await implementation.assertTaskMutationAllowed(root, { taskId, packageRoot: implementation.root });
      const state = await implementation.mutateWorkState(root, { packageRoot: implementation.root, taskId, expectedRevision }, value => ({ ...value, lastUpdated: timestamp }));
      const event = await implementation.appendProtocolEvent(root, { taskId, event: fixtureMode === "public-domain" ? "OBSERVATION" : "TASK_RECEIVED", at: timestamp, details: { fixture: "state-event-commit", revision: state.revision, stateFingerprint: contractFingerprint(state) } }, implementation.root, { taskId });
      return { state, event };
    });
    const nativeSamples = []; const baselineSamples = [];
    const commitCount = validationOnly ? 1 : repeats;
    for (let index = 0; index < commitCount; index += 1) {
      const observed = {};
      const runs = index % 2 ? [["baseline", legacy, portable, baselineSamples], ["native", native, target, nativeSamples]] : [["native", native, target, nativeSamples], ["baseline", legacy, portable, baselineSamples]];
      for (const [name, implementation, root, samples] of runs) {
        const started = performance.now(); observed[name] = await transact(implementation, root, initialRevision + index); if (!validationOnly) samples.push(performance.now() - started);
      }
      assert.deepEqual(observed.native, observed.baseline, "Committed canonical state/event results must match");
    }
    const expectedSamples = validationOnly ? 0 : commitCount;
    for (const samples of [nativeSamples, baselineSamples]) {
      assert.equal(samples.length, expectedSamples, "Exactly one latency sample is required per measured commit");
      assert.ok(samples.every(value => Number.isFinite(value) && value >= 0), "Latency samples must be finite and non-negative");
    }
    if (!validationOnly) {
      assert.ok(Number.isFinite(percentile(nativeSamples)) && percentile(nativeSamples) >= 0);
      assert.ok(Number.isFinite(percentile(baselineSamples)) && percentile(baselineSamples) > 0);
      assert.ok(Number.isFinite(1 - percentile(nativeSamples) / percentile(baselineSamples)));
      assert.ok(Number.isFinite(throughput(nativeSamples)) && throughput(nativeSamples) > 0);
      assert.ok(Number.isFinite(throughput(baselineSamples)) && throughput(baselineSamples) > 0);
    }
    const options = implementation => ({ taskId, packageRoot: implementation.root });
    const finalState = await native.readWorkState(target, options(native));
    assert.equal(finalState.revision, initialRevision + commitCount);
    assert.deepEqual(finalState, await legacy.readWorkState(portable, options(legacy)));
    const tailNative = await native.readEventTail(target, currentRoot, { taskId, limit: commitCount });
    const tailBaseline = await legacy.readEventTail(portable, baselineRoot, { taskId, limit: commitCount });
    assert.deepEqual(tailNative, tailBaseline);
    assert.equal(tailNative.at(-1).seq, count + commitCount);
    const nativeLedger = await native.validateEventLedger(target, currentRoot, { taskId });
    const baselineLedger = await legacy.validateEventLedger(portable, baselineRoot, { taskId });
    assert.equal(nativeLedger.valid, true, JSON.stringify(nativeLedger.errors));
    assert.deepEqual(native.validateStateLedgerCoherence(await native.readWorkState(target, options(native)), nativeLedger.events), []);
    if (baselineLedger.valid) {
      assert.deepEqual(baselineLedger.events, nativeLedger.events);
      assert.deepEqual(legacy.validateStateLedgerCoherence(await legacy.readWorkState(portable, options(legacy)), baselineLedger.events), []);
    }
    const nativeOwnership = await native.resolveTaskClaimState(target, options(native));
    const baselineOwnership = await legacy.resolveTaskClaimState(portable, options(legacy));
    // A refusal appearing after measured commits is an execution failure,
    // rather than a successful or observational latency result.
    assert.equal(baselineLedger.valid, true, JSON.stringify(baselineLedger.errors));
    assert.deepEqual(nativeOwnership, baselineOwnership, "Full ownership classification must match after all commits");
    const baselineAuditRefused = false;
    assert.equal(nativeOwnership.valid, true);
    assert.deepEqual(nativeOwnership.effectiveWriteClaims, claims);
    db = openStorageDatabase(path.join(target, ".forgeloop/state.sqlite"));
    assert.deepEqual(db.prepare("SELECT claim_norm, reservation_state FROM claims WHERE task_id = ? ORDER BY claim_norm").all(taskId).map(row => ({ ...row })),
      [...claims].sort().map(claim_norm => ({ claim_norm, reservation_state: "ACTIVE" })));
    db.close(); db = null;
    results.push({ fixtureMode, validationOnly, publicPreludeEvents, initialRevision, commitCount, initialEvents: count, claimCount, committedResultParity: true, persistedStateAndTailParity: true,
      ownershipClassificationParity: !baselineAuditRefused,
      equalValidationAcceptanceEligible: !baselineAuditRefused,
      acceptanceRefusal: baselineAuditRefused ? "Baseline ownership validation refused the workload; timing is observational only" : null,
      baselineOwnershipAudit: baselineAuditRefused ? { status: "REFUSED", causeCode: "JSON_LIMIT_EXCEEDED", claimsRetained: true } : { status: "MATCHED" },
      nativeOwnershipValid: true, nativeReservationsVerified: true, durability, nativeSamplesMs: nativeSamples, baselineSamplesMs: baselineSamples,
      nativeP50Ms: validationOnly ? null : p50(nativeSamples), baselineP50Ms: validationOnly ? null : p50(baselineSamples),
      nativeThroughputCommitsPerSecond: validationOnly ? null : throughput(nativeSamples), baselineThroughputCommitsPerSecond: validationOnly ? null : throughput(baselineSamples),
      nativeP95Ms: validationOnly ? null : percentile(nativeSamples), baselineP95Ms: validationOnly ? null : percentile(baselineSamples), reductionP95: validationOnly ? null : 1 - percentile(nativeSamples) / percentile(baselineSamples) });
  } catch (error) {
    rowError = error;
    throw error;
  } finally {
    const cleanupErrors = [];
    try { db?.close(); } catch (error) { cleanupErrors.push(serializeBenchmarkError(error)); }
    for (const directory of [target, portable]) {
      try { await rm(directory, { recursive: true, force: true }); } catch (error) { cleanupErrors.push(serializeBenchmarkError(error)); }
    }
    if (cleanupErrors.length > 0) {
      if (rowError) rowError.cleanupErrors = cleanupErrors;
      else throw Object.assign(new Error("Commit benchmark cleanup failed"), { code: "E_BENCHMARK_CLEANUP", cleanupErrors });
    }
  }
}
} catch (error) {
  firstFailure = { status: "FAILED", firstCause: serializeBenchmarkError(error), initialEvents: activeCount, resultsProduced: results.length };
}
let sourceAfter = null;
try {
  sourceAfter = { current: await captureBenchmarkSourceManifest(currentRoot), baseline: await captureBenchmarkSourceManifest(baselineRoot) };
} catch (error) {
  const sourceFailure = serializeBenchmarkError(error);
  if (firstFailure) firstFailure.sourcePostcheckError = sourceFailure;
  else firstFailure = { status: "FAILED", firstCause: sourceFailure, stage: "SOURCE_POSTCHECK", resultsProduced: results.length };
}
const trackedSourcesUnchanged = sourceAfter !== null && JSON.stringify(sourceAfter) === JSON.stringify(sourceBefore);
if (!trackedSourcesUnchanged) {
  const sourceFailure = { code: "E_SOURCE_CHANGED", message: "Current or baseline source admission changed during measurement" };
  if (firstFailure) firstFailure.sourceIntegrity = sourceFailure;
  else firstFailure = { status: "FAILED", firstCause: sourceFailure, stage: "SOURCE_POSTCHECK", resultsProduced: results.length };
}
if (firstFailure) process.exitCode = 1;
process.stdout.write(`${JSON.stringify({ schemaVersion: 2, baselineRevision: revision, node: process.version, platform: process.platform, architecture: process.arch, cpu: os.cpus()[0]?.model ?? null,
  sourceManifestSchemaVersion: BENCHMARK_SOURCE_MANIFEST_SCHEMA_VERSION, sourceManifests: { before: sourceBefore, after: sourceAfter }, trackedSourcesUnchanged, firstFailure,
  timingAcceptanceEligible: !firstFailure && trackedSourcesUnchanged && !validationOnly && results.every(row => row.equalValidationAcceptanceEligible), sourceAdmission: sourceBefore.current.status === "" ? "CLEAN" : "VALIDATION_ONLY_DIRTY",
  validationOnly, fixtureMode, repeats, claimCount, timestamp, runtime: "warm-cache public transaction API with per-call native connection; every commit includes complete public mutation admission", syntheticSeedOutsideMeasurement: fixtureMode === "synthetic",
  durabilityQualification: "Native WAL/FULL and unchanged pinned filesystem fsync transaction implementation; power-loss equivalence requires separate evidence.", releaseThresholdsVerified: false, results }, null, 2)}\n`);
