/**
 * Evidence checks for the Phase 2B closure: attempted legacy operational I/O,
 * transaction-context observation, module-loading isolation, and guard parity.
 *
 * The point of this file is to *observe attempts*, not completed operations. A
 * legacy read whose error is swallowed still shows up here, which a before/after
 * manifest cannot reveal.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const DRIVER = path.join(HERE, "helpers", "check-a-driver.mjs");
const OBSERVER = path.join(HERE, "helpers", "fs-observer.cjs");

/**
 * Classify one observed filesystem attempt.
 *
 * Prohibited: legacy task descriptors, state, ledger, recovery, task artifact
 * evidence, singleton operational fallback, filesystem mutation locks, `.txn`
 * staging, and event-index sidecars.
 *
 * Allowed: the selected SQLite database and its own sidecars, static inputs,
 * policy/configuration sources, and module loading inside the repository.
 */
export function classifyAttempt(attempt, fixtureRoot) {
  const target = String(attempt.path);
  if (target.startsWith("file://")) return { kind: "module-load", reason: "ESM module load" };
  if (/^1[0-9]{0,2}$/.test(target) && /closeSync|openSync/.test(attempt.api)) {
    return { kind: "file-handle", reason: "file descriptor number" };
  }

  const resolved = path.isAbsolute(target) ? target : path.resolve(fixtureRoot, target);
  const inFixture = resolved === fixtureRoot || resolved.startsWith(`${fixtureRoot}${path.sep}`);
  if (!inFixture) return { kind: "outside-fixture", reason: "not under the project state root" };

  const relative = path.relative(fixtureRoot, resolved);
  if (["task-state", ".txn", "locks", ".claims.lock", "work-state.json", "events.ndjson"].some(name => relative === path.join(".forgeloop", name))
    && /:(?:lstat|stat|lstatSync|statSync|access|accessSync|existsSync|realpath|realpathSync)$/.test(attempt.api)) {
    return { kind: "allowed", reason: "exact-root admission and containment metadata" };
  }
  const stateRelative = path.join(".forgeloop", "task-state");
  if (relative.startsWith(stateRelative)) {
    return { kind: "prohibited", reason: "legacy task namespace (descriptor/state/ledger/recovery/artifacts)" };
  }
  if (relative.startsWith(path.join(".forgeloop", ".txn"))) {
    return { kind: "prohibited", reason: "filesystem transaction staging" };
  }
  if (relative === path.join(".forgeloop", ".claims.lock") || relative.startsWith(path.join(".forgeloop", "locks"))) {
    return { kind: "prohibited", reason: "filesystem mutation lock" };
  }
  if (relative.endsWith("events.ndjson.index.json")) {
    return { kind: "prohibited", reason: "event-index sidecar" };
  }
  if (relative === path.join(".forgeloop", "work-state.json")
    || relative === path.join(".forgeloop", "current-contract.json")
    || relative === path.join(".forgeloop", "events.ndjson")) {
    return { kind: "prohibited", reason: "singleton operational fallback" };
  }
  if (relative === path.join(".forgeloop", "state.sqlite") || relative.startsWith(path.join(".forgeloop", "state.sqlite-"))) {
    return { kind: "allowed", reason: "selected SQLite store or its WAL sidecar" };
  }
  if (relative.startsWith(path.join(".forgeloop", "policy")) || relative === path.join(".forgeloop", "config.json")) {
    return { kind: "allowed", reason: "policy or configuration source" };
  }
  return { kind: "allowed", reason: "other project state" };
}

test("legacy lock admission metadata never permits payload access or mutation", () => {
  const root = path.resolve(os.tmpdir(), "observer-lock-classification");
  for (const relative of [".forgeloop/locks", ".forgeloop/.claims.lock"]) {
    const filename = path.join(root, relative);
    assert.equal(classifyAttempt({ api: "fsp:lstat", path: filename }, root).kind, "allowed");
    for (const api of ["fsp:readFile", "fsp:open", "fsp:writeFile", "fsp:unlink", "fsp:readdir"]) {
      assert.equal(classifyAttempt({ api, path: filename }, root).kind, "prohibited");
    }
  }
  assert.equal(classifyAttempt({ api: "fsp:lstat", path: path.join(root, ".forgeloop/locks/task.lock") }, root).kind, "prohibited");
});

function runDriver(outDir, mode) {
  const outPath = path.join(outDir, `${mode}.json`);
  execFileSync(process.execPath, ["--require", OBSERVER, DRIVER, outPath, mode], {
    cwd: REPO,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(readFileSync(outPath, "utf8"));
}

async function withOutDir(run) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "forgeloop-checkA-"));
  try {
    return await run(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("A1: the observer records a caught prohibited read and a transient write", async () => {
  await withOutDir(async (outDir) => {
    const report = runDriver(outDir, "absent-legacy");
    // Positive controls run before the real dispatch and must be observed.
    assert.equal(report.checks.controlCaughtReadRecorded, true, "a swallowed prohibited read must be recorded");
    assert.equal(report.checks.controlTransientWriteRecorded, true, "a transient prohibited write must be recorded");
    assert.equal(report.checks.controlRemovalRecorded, true, "removal of the transient file must be recorded");
    assert.equal(report.checks.controlNativeRealpathRecorded, true, "native realpath remains callable and observed");
  });
});

test("A2: no prohibited legacy operational attempt during a canonical SQLite dispatch", async () => {
  await withOutDir(async (outDir) => {
    const report = runDriver(outDir, "absent-legacy");
    assert.equal(report.checks.dispatchOk, true, `dispatch failed: ${report.checks.dispatchErrorCode}`);
    assert.ok(report.checks.observedAttemptCount > 0, "attempts were observed, so the observer is live");

    const prohibited = report.attempts
      .map((attempt) => ({ attempt, verdict: classifyAttempt(attempt, report.fixtureRoot) }))
      .filter((entry) => entry.verdict.kind === "prohibited");

    assert.deepEqual(
      prohibited.map((entry) => `${entry.attempt.api} ${entry.attempt.path} (${entry.verdict.reason})`),
      [],
      "no prohibited legacy operational access may be attempted",
    );
  });
});

test("A3: contradictory legacy records reject canonical dispatch without payload reads", async () => {
  await withOutDir(async (outDir) => {
    const report = runDriver(outDir, "contradictory-legacy");
    assert.equal(report.checks.dispatchOk, false);
    assert.equal(report.checks.dispatchErrorCode, "E_STORAGE_MIGRATION_REQUIRED");
    assert.deepEqual(report.after, report.before);
    const prohibited = report.attempts
      .map((attempt) => ({ attempt, verdict: classifyAttempt(attempt, report.fixtureRoot) }))
      .filter((entry) => entry.verdict.kind === "prohibited");
    assert.deepEqual(
      prohibited.map((entry) => `${entry.attempt.api} ${entry.attempt.path} (${entry.verdict.reason})`),
      [],
      "contradictory legacy payloads must not be read or written",
    );
  });
});

/* ------------------------------------------------------------- Check C */

const CHECK_C_DRIVER = path.join(HERE, "helpers", "check-c-driver.mjs");

function runCheckC(outDir) {
  const outPath = path.join(outDir, "check-c.json");
  execFileSync(process.execPath, [CHECK_C_DRIVER, outPath, REPO], {
    cwd: REPO,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(readFileSync(outPath, "utf8"));
}

test("C1: fresh readonly dispatch resolves only admission modules without allocating SQLite", async () => {
  await withOutDir(async (outDir) => {
    const report = runCheckC(outDir);
    // The tracer must be live: a deliberate import is detected.
    assert.equal(report.controlDetected, true, "the resolution tracer must detect a prohibited import");
    // Importing the default entry points resolves nothing prohibited.
    assert.equal(report.afterEntryPoints, 0, `entry imports resolved: ${JSON.stringify(report.resolved)}`);
    // Executing fresh readonly discovery does not need SQLite.
    assert.equal(report.commandRan, true, "the canonical executor was reached");
    assert.equal(report.commandEnvelope.ok, true, JSON.stringify(report.commandEnvelope));
    assert.equal(report.databaseAllocated, false);
    assert.deepEqual(
      // The bootstrap maintenance exclusion applies before either backend is
      // selected. Its ownership/handoff helpers use filesystem identity, not the
      // SQLite driver. Existing-project-scope only classifies authority here;
      // it does not allocate storage. Lazy command loading now exposes these
      // imports to this trace rather than resolving them before its command.
      report.defaultPathResolved.filter(url => !/\/src\/storage\/(?:project-boundary|project-read-snapshot|operational-context|existing-project-scope|maintenance|maintenance-owner|maintenance-handoff|storage-marker|legacy-maintenance-boundary)\.js$/.test(url)),
      [],
      `default execution path resolved prohibited modules: ${JSON.stringify(report.defaultPathResolved)}`,
    );
  });
});

/* ------------------------------------------------------------- Check B */

const CHECK_B_DRIVER = path.join(HERE, "helpers", "check-b-driver.mjs");

function runCheckB(outDir, mode) {
  const outPath = path.join(outDir, `check-b-${mode}.json`);
  execFileSync(process.execPath, [CHECK_B_DRIVER, outPath, mode], { cwd: REPO, stdio: ["ignore", "pipe", "pipe"] });
  return JSON.parse(readFileSync(outPath, "utf8"));
}

test("B1: native mutation witnesses preserve state and event ordering", async () => {
  await withOutDir(async outDir => {
    const report = runCheckB(outDir, "observe");
    assert.equal(report.ok, true, `dispatch failed: ${report.errorCode}`);
    assert.deepEqual(report.steps, ["state-written", "DIAGNOSIS_RECORDED", "TRANSACTION_COMMITTED"]);
  });
});

for (const boundary of ["state", "event"]) {
  test(`B${boundary === "state" ? 2 : 3}: native failure after ${boundary} write restores the complete snapshot`, async () => {
    await withOutDir(async outDir => {
      const report = runCheckB(outDir, `inject-after-${boundary}-write`);
      assert.equal(report.ok, false);
      assert.match(report.errorMessage, /NATIVE_DIAGNOSIS_FAULT/);
      assert.deepEqual(report.inProcess, report.before);
      assert.deepEqual(report.reopened, report.before);
      assert.deepEqual(report.steps, [], "native witness rows roll back too");
      assert.equal(report.retryOk, true, "removing the native fault permits the same command");
      assert.equal(report.retrySnapshot.revision, report.before.revision + 1);
      assert.equal(report.retrySnapshot.eventCount, report.before.eventCount + 2);
    });
  });
}

test("B4: the success control persists the complete expected mutation", async () => {
  await withOutDir(async (outDir) => {
    const report = runCheckB(outDir, "observe");
    assert.equal(report.ok, true);
    assert.equal(report.reopened.revision, report.before.revision + 1, "revision advanced exactly once");
    assert.equal(report.reopened.eventCount, report.before.eventCount + 2, "diagnosis plus command commit persisted");
  });
});
