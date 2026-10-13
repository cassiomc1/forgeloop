import { removeTempTree } from "./helpers/rm-safe.js";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { activateSession } from "../src/core/activation.js";
import { appendProtocolEvent, validateEventLedger } from "../src/core/events.js";
import { advanceWorkState } from "../src/core/phase.js";
import { runPreflight } from "../src/commands/preflight.js";
import { ARTIFACT_PATHS as LEGACY_ARTIFACT_PATHS } from "../src/core/artifacts.js";
import { buildTaskArtifactPaths } from "../src/core/task-paths.js";
import { withExistingProjectScope } from "../src/storage/existing-project-scope.js";
import { ensureFixtureTask, readRawFixtureText, overwriteFixtureText, deleteFixtureArtifact } from "./helpers/native-storage-fixture.js";
const ARTIFACT_PATHS = buildTaskArtifactPaths("task-lifecycle");
import { contractFingerprint, createContract, writeContract } from "../src/core/contract.js";
import { evaluateRoute } from "../src/core/router.js";
import { persistRoute } from "../src/core/route-artifact.js";
import { createWorkState, writeWorkState } from "../src/core/work-state.js";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function withTarget(run) {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-lifecycle-"));
  try {
    await ensureFixtureTask(target, "task-lifecycle", repositoryRoot);
    await run(target);
  } finally {
    await removeTempTree(target);
  }
}

function state(overrides = {}) {
  return createWorkState({
    taskId: "task-lifecycle",
    contractFingerprint: contractFingerprint({ objective: "lifecycle" }),
    repositoryFingerprint: { branch: null, head: null },
    phase: "RECEIVED",
    selectedGuides: ["clean", "test"],
    requiredGates: [],
    satisfiedGates: [],
    completedSteps: [],
    pendingSteps: ["contract", "route", "implementation"],
    checks: [],
    failures: [],
    blockers: [],
    verificationEvidence: [],
    ...overrides,
  });
}

async function prepareIdentity(target, taskId = "task-lifecycle") {
  const contract = createContract({
    taskId,
    objective: "Validate lifecycle identity",
    deliverables: [],
    constraints: [],
    risks: [],
    verification: [],
    successCriteria: [],
    stopConditions: [],
    unresolvedDecisions: [],
    sourceRefs: [],
  });
  const fingerprint = contractFingerprint(contract);
  await ensureFixtureTask(target, taskId, repositoryRoot);
  await writeContract(target, contract, repositoryRoot, { taskId });
  const route = evaluateRoute({ workType: "bug", surfaces: [], platforms: [] });
  const persistedRoute = await persistRoute(target, route, repositoryRoot, { contractFingerprint: fingerprint, taskId });
  return { contract, fingerprint, route, persistedRoute };
}

async function artifactHashes(target, taskId = "task-lifecycle") {
  const ARTIFACT_PATHS = buildTaskArtifactPaths(taskId);
  const hashes = {};
  for (const relativePath of [
    ARTIFACT_PATHS.contract,
    ARTIFACT_PATHS.route,
    ARTIFACT_PATHS.state,
    ARTIFACT_PATHS.receipt,
    ARTIFACT_PATHS.events,
  ]) {
    try {
      const bytes = await readRawFixtureText(target, relativePath);
      hashes[relativePath] = createHash("sha256").update(bytes ?? "").digest("hex");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      hashes[relativePath] = null;
    }
  }
  return hashes;
}

test("protocol events are append-only, sequenced, and hash chained", async () => {
  await withTarget(async (target) => {
    await appendProtocolEvent(target, { taskId: "task-lifecycle", event: "TASK_RECEIVED" }, repositoryRoot, { taskId: "task-lifecycle" });
    await appendProtocolEvent(target, { taskId: "task-lifecycle", event: "CONTRACT_VALIDATED" }, repositoryRoot, { taskId: "task-lifecycle" });
    const result = await validateEventLedger(target, repositoryRoot, { taskId: "task-lifecycle" });

    assert.equal(result.valid, true);
    assert.equal(result.events.length, 2);
    assert.equal(result.events[1].previousHash, result.events[0].hash);
    assert.match(await readRawFixtureText(target, ARTIFACT_PATHS.events), /TASK_RECEIVED/);
  });
});

test("ledger rejects execution chronology before route and hash tampering", async () => {
  await withTarget(async (target) => {
    await appendProtocolEvent(target, { taskId: "task-lifecycle", event: "EXECUTION_STARTED" }, repositoryRoot, { taskId: "task-lifecycle" });
    const first = await validateEventLedger(target, repositoryRoot, { taskId: "task-lifecycle" });
    assert.equal(first.valid, false);
    assert.ok(first.errors.some((item) => item.code === "E_PHASE_CHRONOLOGY_INVALID"));

    const eventsPath = path.join(target, ARTIFACT_PATHS.events);
    const lines = (await readRawFixtureText(target, eventsPath)).trim().split("\n");
    const event = JSON.parse(lines[0]);
    event.previousHash = "a".repeat(64);
    await overwriteFixtureText(target, eventsPath, `${JSON.stringify(event)}\n`);
    const tampered = await validateEventLedger(target, repositoryRoot, { taskId: "task-lifecycle" });
    assert.equal(tampered.valid, false);
    assert.ok(tampered.errors.some((item) => item.code === "E_LEDGER_HASH_INVALID"));
  });
});

test("activation creates a protocol marker without hidden prompt data", async () => {
  await withTarget(async (target) => {
    const session = await activateSession(target, repositoryRoot);
    assert.match(session.sessionId, /^[0-9a-f-]{36}$/);
    assert.match(session.activationMarker, /^forgeloop-/);
    assert.equal(Object.hasOwn(session, "prompt"), false);
    assert.match(await withExistingProjectScope(target, store => store.readText(LEGACY_ARTIFACT_PATHS.session), { readOnly: true }), /activationMarker/);
  });
});

test("advance rejects illegal transitions without changing work state", async () => {
  await withTarget(async (target) => {
    await writeWorkState(target, state());
    await assert.rejects(
      () => advanceWorkState(target, "EXECUTING", { packageRoot: repositoryRoot, taskId: "task-lifecycle" }),
      (error) => error.code === "E_PHASE_PREREQUISITE_MISSING",
    );
    const stored = JSON.parse(await readRawFixtureText(target, ARTIFACT_PATHS.state));
    assert.equal(stored.phase, "RECEIVED");
  });
});

test("entering verification reconciles only the implementation step", async () => {
  await withTarget(async (target) => {
    const identity = await prepareIdentity(target);
    await writeWorkState(target, state({
      contractFingerprint: identity.fingerprint,
      routeFingerprint: identity.persistedRoute.fingerprint,
      phase: "EXECUTING",
      previousPhase: "PLANNED",
      completedSteps: ["contract", "route"],
      pendingSteps: ["implementation", "verification"],
    }));
    for (const event of ["CONTRACT_VALIDATED", "ROUTE_VALIDATED"]) {
      await appendProtocolEvent(target, { taskId: "task-lifecycle", event }, repositoryRoot, { taskId: "task-lifecycle" });
    }
    assert.equal((await runPreflight({ target, packageRoot: repositoryRoot })).status, "READY");
    await appendProtocolEvent(target, { taskId: "task-lifecycle", event: "EXECUTION_STARTED" }, repositoryRoot, { taskId: "task-lifecycle" });

    const next = await advanceWorkState(target, "VERIFYING", { packageRoot: repositoryRoot, taskId: "task-lifecycle" });

    assert.deepEqual(next.completedSteps, ["contract", "route", "implementation"]);
    assert.deepEqual(next.pendingSteps, ["verification"]);
    assert.deepEqual(next.verificationEvidence, []);
  });
});

test("direct late-phase advance rejects a foreign ledger before writing", async () => {
  await withTarget(async (target) => {
    const identity = await prepareIdentity(target);
    await writeWorkState(target, state({
      contractFingerprint: identity.fingerprint,
      routeFingerprint: identity.persistedRoute.fingerprint,
      phase: "EXECUTING",
      previousPhase: "PLANNED",
      completedSteps: ["contract", "route"],
      pendingSteps: ["implementation", "verification"],
    }));
    await appendProtocolEvent(target, { taskId: "task-lifecycle", event: "CONTRACT_VALIDATED" }, repositoryRoot, { taskId: "task-lifecycle" });
    await appendProtocolEvent(target, { taskId: "task-lifecycle", event: "ROUTE_VALIDATED" }, repositoryRoot, { taskId: "task-lifecycle" });
    assert.equal((await runPreflight({ target, packageRoot: repositoryRoot })).status, "READY");
    const ledger = (await readRawFixtureText(target, ARTIFACT_PATHS.events)).trim().split("\n").map(JSON.parse);
    await overwriteFixtureText(target, ARTIFACT_PATHS.events, ledger.map(event => JSON.stringify({ ...event, taskId: "task-foreign" })).join("\n") + "\n");
    const before = await artifactHashes(target);

    await assert.rejects(
      () => advanceWorkState(target, "VERIFYING", { packageRoot: repositoryRoot, taskId: "task-lifecycle" }),
      (error) => error.code === "E_STORAGE_PAYLOAD_MISMATCH",
    );

    assert.deepEqual(await artifactHashes(target), before);
  });
});

test("late-phase advance rejects a foreign state without a receipt before writing", async () => {
  await withTarget(async (target) => {
    const identity = await prepareIdentity(target, "task-current");
    await overwriteFixtureText(target, buildTaskArtifactPaths("task-current").state, JSON.stringify(state({
      taskId: "task-foreign",
      contractFingerprint: identity.fingerprint,
      routeFingerprint: identity.persistedRoute.fingerprint,
      phase: "EXECUTING",
      previousPhase: "PLANNED",
      completedSteps: ["contract", "route"],
      pendingSteps: ["implementation", "verification"],
    })));
    const before = await artifactHashes(target, "task-current");

    await assert.rejects(
      () => advanceWorkState(target, "VERIFYING", { packageRoot: repositoryRoot, taskId: "task-current" }),
      (error) => error.code === "E_STORAGE_PAYLOAD_MISMATCH",
    );

    assert.deepEqual(await artifactHashes(target, "task-current"), before);
  });
});

test("early lifecycle advance rejects a foreign state before writing", async () => {
  await withTarget(async (target) => {
    const identity = await prepareIdentity(target, "task-current");
    await overwriteFixtureText(target, buildTaskArtifactPaths("task-current").state, JSON.stringify(state({
      taskId: "task-foreign",
      contractFingerprint: identity.fingerprint,
      routeFingerprint: identity.persistedRoute.fingerprint,
      phase: "CONTRACT_READY",
      previousPhase: "DISCOVERING",
      completedSteps: ["contract"],
      pendingSteps: ["route", "implementation"],
    })));
    const before = await artifactHashes(target, "task-current");

    await assert.rejects(
      () => advanceWorkState(target, "ROUTED", { packageRoot: repositoryRoot, taskId: "task-current" }),
      (error) => error.code === "E_STORAGE_PAYLOAD_MISMATCH",
    );

    assert.deepEqual(await artifactHashes(target, "task-current"), before);
  });
});

test("early lifecycle advance rejects a foreign route when the contract is absent", async () => {
  await withTarget(async (target) => {
    const identity = await prepareIdentity(target);
    const foreignRoute = await persistRoute(target, identity.route, repositoryRoot, {
      contractFingerprint: "b".repeat(64),
      taskId: "task-lifecycle",
    });
    await writeWorkState(target, state({
      contractFingerprint: identity.fingerprint,
      routeFingerprint: foreignRoute.fingerprint,
      phase: "ROUTED",
      previousPhase: "CONTRACT_READY",
      completedSteps: ["contract", "route"],
      pendingSteps: ["implementation"],
    }));
    await deleteFixtureArtifact(target, ARTIFACT_PATHS.contract);
    for (const event of ["CONTRACT_VALIDATED", "ROUTE_VALIDATED"]) {
      await appendProtocolEvent(target, { taskId: "task-lifecycle", event }, repositoryRoot, { taskId: "task-lifecycle" });
    }
    const before = await artifactHashes(target);

    await assert.rejects(
      () => advanceWorkState(target, "PLANNED", { packageRoot: repositoryRoot, taskId: "task-lifecycle" }),
      (error) => error.code === "E_ROUTE_STALE",
    );

    assert.deepEqual(await artifactHashes(target), before);
  });
});
