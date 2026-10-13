import { spawn } from "node:child_process";
import { existsSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { cp, mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { appendProtocolEvent } from "../../src/core/events.js";
import { getPackageRoot } from "../../src/core/templates.js";
import { createTaskDescriptor, writeTaskDescriptor } from "../../src/core/task-descriptor.js";
import { createWorkState, writeWorkState } from "../../src/core/work-state.js";
import { buildDecisionArtifact, writeDecisionArtifact } from "../../src/core/decision/artifact.js";
import { decisionEventDetails } from "../../src/core/decision/events.js";
import { SEMANTIC_DECISION_RECORDED_EVENT } from "../../src/core/decision/constants.js";
import { exportDatabase, importProjectState, openStorageDatabase } from "../../src/storage/index.js";
import { createContract, writeContract, contractFingerprint as contractHashOf } from "../../src/core/contract.js";
import { evaluateRoute } from "../../src/core/router.js";
import { persistRoute } from "../../src/core/route-artifact.js";
import { runPreflight } from "../../src/core/preflight.js";

/**
 * Shared fixtures for the multi-process and interruption tests.
 *
 * Kept small and dependency-free on purpose: these helpers exist to build
 * disposable projects quickly, because a large matrix of process-level tests is
 * only practical when fixture construction is cheap.
 */

export const FIXED_AT = "2026-09-11T00:00:00.000Z";
export const TEST_TASK_ID = "phase2a-closure-task";

/** Milestone events that put a task into DIAGNOSING with a failed check. */
const BASE_EVENTS = Object.freeze([
  ["TASK_RECEIVED", undefined],
  ["CONTRACT_VALIDATED", undefined],
  ["ROUTE_VALIDATED", undefined],
  ["PREFLIGHT_READY", undefined],
  ["EXECUTION_STARTED", undefined],
  ["VERIFICATION_STARTED", { verificationCycle: 1 }],
]);

export function diagnosisState(taskId, { contractFingerprint = "0".repeat(64), routeFingerprint = "0".repeat(64), selectedGuides = [] } = {}) {
  return createWorkState({
    taskId,
    contractFingerprint,
    routeFingerprint,
    repositoryFingerprint: { branch: null, head: null },
    phase: "DIAGNOSING",
    selectedGuides,
    // Gate sets must be present and must match the preflight evaluation;
    // `createWorkState` drops them entirely if omitted.
    requiredGates: [],
    satisfiedGates: [],
    completedSteps: ["contract", "route", "implementation"],
    pendingSteps: ["verification"],
    verificationCycle: 1,
    checks: [
      {
        id: "check-auth-boundary",
        requirement: "auth",
        status: "failed",
        evidenceKind: "OBSERVED",
        result: "expected 401 but got 200",
        details: { verificationCycle: 1 },
      },
    ],
  });
}

/**
 * Build a disposable project containing one DIAGNOSING task plus `unrelated`
 * other tasks, all with fixed timestamps so hashes are reproducible.
 */
export async function buildDiagnosisProject({ unrelated = 0, taskId = TEST_TASK_ID, packageRoot = getPackageRoot(), legacy = false } = {}) {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-closure-"));
  for (let index = 0; index <= unrelated; index += 1) {
    const id = index === 0 ? taskId : `closure-unrelated-${String(index).padStart(4, "0")}`;
    let routeFingerprint = "0".repeat(64);
    let contractFingerprint = "0".repeat(64);
    let selectedGuides = [];
    await writeTaskDescriptor(
      target,
      // A real task carries write claims; ownership evidence is required for a
      // store-routed mutation to be permitted.
      createTaskDescriptor({ taskId: id, writeClaims: [`src/${id}.js`], createdAt: FIXED_AT, updatedAt: FIXED_AT }),
      packageRoot,
    );

    // Identity artifacts. A LATE phase such as DIAGNOSING requires a current
    // contract and route on both backends, so the fixture establishes them.
    const contract = createContract({
      taskId: id,
      objective: "Exercise canonical diagnosis continuity",
      deliverables: ["src"],
      constraints: ["offline"],
      risks: [],
      verification: [`src/${id}.js`],
      successCriteria: [`src/${id}.js`],
      stopConditions: ["stop"],
      unresolvedDecisions: [],
      sourceRefs: [],
    });
    const contractHash = contractHashOf(contract);
    await writeContract(target, contract, packageRoot, { taskId: id });
    const route = evaluateRoute({ workType: "code", surfaces: ["config"], platforms: [] });
    const persistedRoute = await persistRoute(target, route, packageRoot, {
      taskId: id,
      contractFingerprint: contractHash,
    });
    routeFingerprint = persistedRoute.fingerprint;
    contractFingerprint = contractHash;
    selectedGuides = [...(persistedRoute.value.guides ?? [])];
    for (const [event, details] of BASE_EVENTS) {
      await appendProtocolEvent(
        target,
        { taskId: id, event, details, at: FIXED_AT },
        packageRoot,
        { taskId: id },
      );
    }
    await writeWorkState(target, diagnosisState(id, { contractFingerprint, routeFingerprint, selectedGuides }), { packageRoot, taskId: id });

    // The real preflight evaluation is the authority for required/satisfied
    // gates and the persisted preflight artifact. A DIAGNOSING task is a LATE
    // phase, so the filesystem advance requires them to match the work state.
    try {
      const preflight = await runPreflight({ target, packageRoot, taskId: id });
      if (preflight) {
        await writeWorkState(target, createWorkState({
          ...diagnosisState(id, { contractFingerprint, routeFingerprint, selectedGuides }),
          requiredGates: [...(preflight.requiredGates ?? [])],
          satisfiedGates: [...(preflight.satisfiedGates ?? [])],
        }), { packageRoot, taskId: id });
      }
    } catch {
      // A preflight that cannot run on this minimal fixture leaves the state
      // without gate evidence; the advance then legitimately rejects.
    }
  }
  if (legacy) await exportLegacyFixture(target);
  return target;
}

/** Explicit portable legacy fixture; production writers remain SQLite-only. */
export async function exportLegacyFixture(target) {
  const destination = await mkdtemp(path.join(os.tmpdir(), "forgeloop-legacy-fixture-"));
  try {
    const db = openStorageDatabase(path.join(target, ".forgeloop/state.sqlite"), { readOnly: true });
    try { await exportDatabase(db, destination, { attachmentRoot: target }); }
    finally { db.close(); }
    for (const name of ["state.sqlite", "state.sqlite-wal", "state.sqlite-shm", "storage-version.json"]) {
      await rm(path.join(target, ".forgeloop", name), { force: true });
    }
    await cp(destination, target, { recursive: true });
    // This fixture represents mutable pre-cutover source, not a frozen export.
    // Export-only manifests would become stale when a test adds legacy records.
    await rm(path.join(target, "export-index.json"), { force: true });
    for (const entry of await readdir(path.join(target, ".forgeloop/task-state"))) {
      await rm(path.join(target, ".forgeloop/task-state", entry, "export-manifest.json"), { force: true });
    }
  } finally { await rm(destination, { recursive: true, force: true }); }
}

/** A valid semantic decision artifact payload, built by the domain builder. */
export function semanticDecisionArtifact(taskId, decisionId) {
  return buildDecisionArtifact({
    taskId,
    decisionId,
    decisionKind: "ROUTE",
    questionSetId: "closure-question-set",
    questionSetVersion: 1,
    questionSetFingerprint: "1".repeat(64),
    stateFingerprint: "2".repeat(64),
    policyFingerprint: "4".repeat(64),
    answers: { question: "answer" },
    confidence: { score: 1 },
    decision: { selected: "option-a" },
    recordedAt: FIXED_AT,
  });
}

/**
 * Write a semantic decision artifact and record its canonical event, which makes
 * `SEMANTIC_DECISION_ARTIFACT_BINDINGS` an applicable rule.
 */
export async function addSemanticDecision(target, { taskId = TEST_TASK_ID, decisionId = "decision-1", artifact, packageRoot = getPackageRoot() } = {}) {
  const payload = artifact ?? semanticDecisionArtifact(taskId, decisionId);
  await writeDecisionArtifact(target, taskId, decisionId, payload, packageRoot);
  await appendProtocolEvent(
    target,
    {
      taskId,
      event: SEMANTIC_DECISION_RECORDED_EVENT,
      at: FIXED_AT,
      details: decisionEventDetails(payload),
    },
    packageRoot,
    { taskId },
  );
  // A recorded decision must be closed by the semantic-decision transaction
  // boundary event; the domain validator rejects an unclosed decision.
  await appendProtocolEvent(
    target,
    {
      taskId,
      event: "TRANSACTION_COMMITTED",
      at: FIXED_AT,
      details: { transactionId: `txn-${decisionId}`, operation: "semantic-decision" },
    },
    packageRoot,
    { taskId },
  );
  return payload;
}

/** Build a project and import it into a disposable database. */
export async function buildImportedProject(options = {}) {
  const target = await buildDiagnosisProject({ ...options, legacy: true });
  const { db } = await importProjectState(target, path.join(target, "state.sqlite"));
  return { target, db, databasePath: path.join(target, "state.sqlite") };
}

/** A complete logical snapshot: state, revision, ledger, and head. */
export function logicalSnapshot(db, taskId) {
  const task = db.prepare("SELECT revision, phase, state_json FROM tasks WHERE task_id = ?").get(taskId);
  const events = db.prepare("SELECT seq, hash, event_type FROM events WHERE task_id = ? ORDER BY seq").all(taskId);
  const head = events.at(-1) ?? null;
  return {
    revision: task?.revision ?? null,
    phase: task?.phase ?? null,
    state: task?.state_json ?? null,
    eventCount: events.length,
    events,
    head: head ? { seq: head.seq, hash: head.hash } : null,
  };
}

export { cleanupDir };

async function cleanupDir(target) {
  await rm(target, { recursive: true, force: true });
}


const WORKER = fileURLToPath(new URL("./storage-worker.mjs", import.meta.url));

/**
 * Parent-side driver for the multi-process tests.
 *
 * Every worker is a genuinely separate OS process with its own SQLite
 * connection. Synchronization uses marker files that workers block on, so the
 * ordering is observed rather than assumed; no fixed sleep decides a race.
 * Each driver has a bounded timeout and always cleans up, so a blocked worker
 * cannot hang the suite.
 */

const DEFAULT_TIMEOUT_MS = 30_000;

/** Create a barrier directory plus helpers to signal and wait on markers. */
export function createBarrier(label) {
  const dir = mkdtempSync(path.join(os.tmpdir(), `forgeloop-barrier-${label}-`));
  return {
    dir,
    signal(name) {
      writeFileSync(path.join(dir, name), String(process.pid));
    },
    async waitFor(name, timeoutMs = DEFAULT_TIMEOUT_MS, worker = null) {
      const deadline = Date.now() + timeoutMs;
      while (!existsSync(path.join(dir, name))) {
        if (worker && (worker.child.exitCode !== null || worker.child.signalCode !== null)) {
          throw new Error(`worker exited before barrier ${name}: ${worker.stdout} ${worker.stderr}`);
        }
        if (Date.now() > deadline) {
          throw new Error(`timeout waiting for barrier marker ${name}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 2));
      }
    },
    cleanup() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Spawn one child process running the storage worker. */
export function spawnWorker(config) {
  const child = spawn(process.execPath, [WORKER, JSON.stringify(config)], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout = [];
  const stderr = [];
  child.stdout.on("data", (chunk) => stdout.push(chunk));
  child.stderr.on("data", (chunk) => stderr.push(chunk));
  const exited = new Promise((resolve) => {
    child.on("exit", (code, signalName) => resolve({ code, signalName }));
  });
  return {
    child,
    exited,
    get stdout() {
      return Buffer.concat(stdout).toString("utf8");
    },
    get stderr() {
      return Buffer.concat(stderr).toString("utf8");
    },
    /**
     * Wait for completion and parse the worker's JSON result line.
     *
     * The worker's payload is nested under `result` so its own `code` field
     * cannot collide with the process exit code.
     */
    async result(timeoutMs = DEFAULT_TIMEOUT_MS) {
      const timer = new Promise((_, reject) => {
        const id = setTimeout(() => reject(new Error(`worker timed out: ${this.stderr}`)), timeoutMs);
        if (typeof id.unref === "function") id.unref();
      });
      const exit = await Promise.race([exited, timer]);
      const text = this.stdout.trim();
      const line = text.split("\n").filter(Boolean).at(-1);
      const base = { ...exit, stdout: text, stderr: this.stderr };
      if (!line) return { ...base, result: null };
      try {
        return { ...base, ...JSON.parse(line) };
      } catch {
        return { ...base, result: null };
      }
    },
    /** Terminate the process and wait for the exit to be observed. */
    async kill(signalName = "SIGKILL", timeoutMs = 10_000) {
      if (this.child.exitCode === null && this.child.signalCode === null) {
        this.child.kill(signalName);
      }
      const timer = new Promise((_, reject) => {
        const id = setTimeout(() => reject(new Error("child did not exit after signal")), timeoutMs);
        if (typeof id.unref === "function") id.unref();
      });
      return Promise.race([this.exited, timer]);
    },
  };
}
