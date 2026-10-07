/** Matched public state-plus-event transaction measurement; setup is excluded. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
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
async function api(root) {
  const load = name => import(pathToFileURL(path.join(root, `src/core/${name}.js`)).href);
  return { root, ...(await load("work-state")), ...(await load("events")), ...(await load("transaction")), ...(await load("task-claim-state")) };
}
const native = await api(currentRoot); const legacy = await api(baselineRoot);
const sizes = (argument("events") ?? "10,1000,100000").split(",").map(Number);
const repeats = Number(argument("repeats") ?? 20);
const claimCount = Number(argument("claims") ?? 0);
assert.ok(Number.isInteger(claimCount) && claimCount >= 0 && claimCount <= 1000);
const claims = Array.from({ length: claimCount }, (_, index) => `src/benchmark-claim-${index}.js`);
assert.ok(sizes.every(size => Number.isInteger(size) && size >= 1 && size <= 100000));
assert.ok(Number.isInteger(repeats) && repeats >= 2 && repeats <= 100);
const timestamp = "2026-09-11T00:00:00.000Z";
const taskId = "commit-benchmark";
const percentile = samples => [...samples].sort((a, b) => a - b)[Math.ceil(samples.length * 0.95) - 1];
const results = [];
for (const count of sizes) {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-commit-native-"));
  const portable = await mkdtemp(path.join(os.tmpdir(), "forgeloop-commit-baseline-"));
  let db;
  try {
    await mkdir(path.join(target, ".forgeloop"));
    db = openStorageDatabase(path.join(target, ".forgeloop/state.sqlite"));
    const durability = { journalMode: db.prepare("PRAGMA journal_mode").get().journal_mode, synchronous: db.prepare("PRAGMA synchronous").get().synchronous };
    assert.deepEqual(durability, { journalMode: "wal", synchronous: 2 });
    let checkpoint = { seq: 0, lastHash: null };
    runInTransaction(db, () => {
      const state = createWorkState({ taskId, contractFingerprint: contractFingerprint({ fixture: "commit" }), phase: "RECEIVED", revision: 0, lastUpdated: timestamp });
      upsertTask(db, { taskId, descriptor: createTaskDescriptor({ taskId, writeClaims: claims, createdAt: timestamp, updatedAt: timestamp }), state });
      reserveClaims(db, { taskId, claims, createdAt: timestamp });
      for (let index = 0; index < count; index += 1) {
        const event = buildProtocolEvent({ taskId, event: "TASK_RECEIVED", at: timestamp, details: { fixture: "state-event-commit", observation: index, payload: "Representative deterministic state and event observation." } }, { checkpoint });
        appendEvent(db, { taskId, event }); checkpoint = { seq: event.seq, lastHash: event.hash };
      }
    });
    await exportDatabase(db, portable); db.close(); db = null;
    // The pinned writer normally persists this cache beside every append. A
    // portable native export has no obsolete index; recreate only benchmark
    // setup metadata so the baseline uses its unchanged normal append path.
    await writeFile(path.join(portable, `${taskArtifactPath(taskId, "events")}.index.json`), `${JSON.stringify({ schemaVersion: 1, ...checkpoint })}\n`);
    const transact = (implementation, root, expectedRevision) => implementation.withTaskTransaction({ target: root, taskId, operation: "benchmark-state-event", packageRoot: implementation.root }, async () => {
      const state = await implementation.mutateWorkState(root, { packageRoot: implementation.root, taskId, expectedRevision }, value => ({ ...value, lastUpdated: timestamp }));
      const event = await implementation.appendProtocolEvent(root, { taskId, event: "TASK_RECEIVED", at: timestamp, details: { fixture: "state-event-commit", revision: state.revision, stateFingerprint: contractFingerprint(state) } }, implementation.root, { taskId });
      return { state, event };
    });
    const nativeSamples = []; const baselineSamples = [];
    for (let index = 0; index < repeats; index += 1) {
      const observed = {};
      const runs = index % 2 ? [["baseline", legacy, portable, baselineSamples], ["native", native, target, nativeSamples]] : [["native", native, target, nativeSamples], ["baseline", legacy, portable, baselineSamples]];
      for (const [name, implementation, root, samples] of runs) {
        const started = performance.now(); observed[name] = await transact(implementation, root, index); samples.push(performance.now() - started);
      }
      assert.deepEqual(observed.native, observed.baseline, "Committed canonical state/event results must match");
    }
    const options = implementation => ({ taskId, packageRoot: implementation.root });
    assert.deepEqual(await native.readWorkState(target, options(native)), await legacy.readWorkState(portable, options(legacy)));
    const tailNative = await native.readEventTail(target, currentRoot, { taskId, limit: repeats });
    const tailBaseline = await legacy.readEventTail(portable, baselineRoot, { taskId, limit: repeats });
    assert.deepEqual(tailNative, tailBaseline);
    assert.equal(tailNative.at(-1).seq, count + repeats);
    const nativeOwnership = await native.resolveTaskClaimState(target, options(native));
    const baselineOwnership = await legacy.resolveTaskClaimState(portable, options(legacy));
    const baselineAuditRefused = baselineOwnership.valid === false
      && baselineOwnership.claimState === "INCONSISTENT"
      && baselineOwnership.mutationAllowed === false
      && baselineOwnership.errors.length === 1
      && baselineOwnership.errors[0].causeCode === "JSON_LIMIT_EXCEEDED";
    if (baselineAuditRefused) {
      assert.deepEqual(baselineOwnership.effectiveWriteClaims, claims, "Baseline byte-limit refusal must retain every claim");
    } else {
      assert.deepEqual(nativeOwnership, baselineOwnership, "Full ownership classification must match after all commits");
    }
    assert.equal(nativeOwnership.valid, true);
    assert.deepEqual(nativeOwnership.effectiveWriteClaims, claims);
    db = openStorageDatabase(path.join(target, ".forgeloop/state.sqlite"));
    assert.deepEqual(db.prepare("SELECT claim_norm, reservation_state FROM claims WHERE task_id = ? ORDER BY claim_norm").all(taskId).map(row => ({ ...row })),
      [...claims].sort().map(claim_norm => ({ claim_norm, reservation_state: "ACTIVE" })));
    db.close(); db = null;
    results.push({ initialEvents: count, claimCount, committedResultParity: true, persistedStateAndTailParity: true,
      ownershipClassificationParity: !baselineAuditRefused,
      baselineOwnershipAudit: baselineAuditRefused ? { status: "REFUSED", causeCode: "JSON_LIMIT_EXCEEDED", claimsRetained: true } : { status: "MATCHED" },
      nativeOwnershipValid: true, nativeReservationsVerified: true, durability, nativeSamplesMs: nativeSamples, baselineSamplesMs: baselineSamples,
      nativeP95Ms: percentile(nativeSamples), baselineP95Ms: percentile(baselineSamples), reductionP95: 1 - percentile(nativeSamples) / percentile(baselineSamples) });
  } finally { db?.close(); await rm(target, { recursive: true, force: true }); await rm(portable, { recursive: true, force: true }); }
}
process.stdout.write(`${JSON.stringify({ schemaVersion: 1, baselineRevision: revision, node: process.version, platform: process.platform, architecture: process.arch, cpu: os.cpus()[0]?.model ?? null,
  repeats, claimCount, timestamp, runtime: "warm-cache public transaction API with per-call native connection", syntheticSeedOutsideMeasurement: true,
  durabilityQualification: "Native WAL/FULL and unchanged pinned filesystem fsync transaction implementation; power-loss equivalence requires separate evidence.", releaseThresholdsVerified: false, results }, null, 2)}\n`);
