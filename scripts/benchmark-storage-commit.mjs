/** Matched public state-plus-event transaction measurement; setup is excluded. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
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
function sourceManifest(root) {
  const dirty = execFileSync("git", ["-C", root, "status", "--porcelain", "--untracked-files=no"], { encoding: "utf8" }).trim();
  assert.ok(validationOnly || dirty === "", "Timed benchmark sources must be committed and unchanged");
  const untracked = execFileSync("git", ["-C", root, "ls-files", "--others", "--exclude-standard", "--", "src", "integrations/mcp/src", "scripts"], { encoding: "utf8" }).trim();
  assert.equal(untracked, "", "Untracked runtime or benchmark source cannot qualify a frozen comparison");
  const files = execFileSync("git", ["-C", root, "ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean).sort();
  return {
    trackedWorkingChanges: dirty,
    revision: execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    files: files.map(file => ({ path: file, sha256: createHash("sha256").update(readFileSync(path.join(root, file))).digest("hex") })),
  };
}
const sourceBefore = { current: sourceManifest(currentRoot), baseline: sourceManifest(baselineRoot) };
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
const results = [];
for (const count of sizes) {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-commit-native-"));
  const portable = await mkdtemp(path.join(os.tmpdir(), "forgeloop-commit-baseline-"));
  let db;
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
    const transact = (implementation, root, expectedRevision) => implementation.withTaskTransaction({ target: root, taskId, operation: "benchmark-state-event", packageRoot: implementation.root, recordCommitEvent: false }, async () => {
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
    if (!baselineLedger.valid) {
      assert.ok(baselineLedger.errors.length > 0 && baselineLedger.errors.every(error => error.causeCode === "JSON_LIMIT_EXCEEDED" || error.code === "JSON_LIMIT_EXCEEDED"),
        `Unexpected baseline ledger refusal: ${JSON.stringify(baselineLedger.errors)}`);
    }
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
    results.push({ fixtureMode, validationOnly, publicPreludeEvents, initialRevision, commitCount, initialEvents: count, claimCount, committedResultParity: true, persistedStateAndTailParity: true,
      ownershipClassificationParity: !baselineAuditRefused,
      equalValidationAcceptanceEligible: !baselineAuditRefused,
      acceptanceRefusal: baselineAuditRefused ? "Baseline ownership validation refused the workload; timing is observational only" : null,
      baselineOwnershipAudit: baselineAuditRefused ? { status: "REFUSED", causeCode: "JSON_LIMIT_EXCEEDED", claimsRetained: true } : { status: "MATCHED" },
      nativeOwnershipValid: true, nativeReservationsVerified: true, durability, nativeSamplesMs: nativeSamples, baselineSamplesMs: baselineSamples,
      nativeP95Ms: validationOnly ? null : percentile(nativeSamples), baselineP95Ms: validationOnly ? null : percentile(baselineSamples), reductionP95: validationOnly ? null : 1 - percentile(nativeSamples) / percentile(baselineSamples) });
  } finally { db?.close(); await rm(target, { recursive: true, force: true }); await rm(portable, { recursive: true, force: true }); }
}
const sourceAfter = { current: sourceManifest(currentRoot), baseline: sourceManifest(baselineRoot) };
assert.deepEqual(sourceAfter, sourceBefore, "Current or baseline tracked source changed during measurement");
process.stdout.write(`${JSON.stringify({ schemaVersion: 1, baselineRevision: revision, node: process.version, platform: process.platform, architecture: process.arch, cpu: os.cpus()[0]?.model ?? null,
  sourceManifests: sourceBefore, trackedSourcesUnchanged: true,
  validationOnly, fixtureMode, repeats, claimCount, timestamp, runtime: "warm-cache public transaction API with per-call native connection", syntheticSeedOutsideMeasurement: fixtureMode === "synthetic",
  durabilityQualification: "Native WAL/FULL and unchanged pinned filesystem fsync transaction implementation; power-loss equivalence requires separate evidence.", releaseThresholdsVerified: false, results }, null, 2)}\n`);
