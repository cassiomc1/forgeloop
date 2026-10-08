/**
 * Check A driver: runs the canonical `record-diagnosis` dispatch under the
 * filesystem attempt observer and reports every recorded access.
 *
 * The observer is installed with `--require` before this module is imported, so
 * attempts are recorded even when the calling code swallows the error.
 *
 * Usage: node --require ../helpers/fs-observer.cjs check-a-driver.mjs <outJson> <mode>
 *   mode = "control" | "absent-legacy" | "contradictory-legacy"
 */
import { writeFileSync, realpathSync } from "node:fs";
import path from "node:path";

import { executeForgeLoopCommand } from "../../src/core/command-runtime.js";
import { openStorageDatabase, listEvents, listClaims, findArtifact, findTaskById } from "../../src/storage/index.js";
import { TEST_TASK_ID, cleanupDir } from "./storage-fixtures.js";
import { buildCanonicalDiagnosisProject } from "./canonical-diagnosis-fixture.js";
import { writeFile, mkdir } from "node:fs/promises";

const [outPath, mode] = process.argv.slice(2);
const attempts = () => globalThis.__FORGELOOP_FS_ATTEMPTS__ ?? [];

const report = { mode, checks: {}, attempts: [] };

/**
 * Positive control: deliberately attempt a prohibited read whose error is
 * caught, and a transient prohibited write that is created and removed.
 * Both must be recorded, otherwise the isolation claim is unsupported.
 */
async function runControls() {
  const before = attempts().length;
  const probeDir = path.join(path.dirname(outPath), "control-probe");
  await mkdir(probeDir, { recursive: true });
  // 1. A caught prohibited read.
  try {
    await readFileProhibited(probeDir);
  } catch {
    // intentionally swallowed
  }
  const afterRead = attempts().length;
  // 2. A transient prohibited write: create then remove.
  const transient = path.join(probeDir, "transient.ndjson");
  await writeFile(transient, "{}\n");
  const afterWrite = attempts().length;
  const nativeStart = attempts().length;
  realpathSync.native(probeDir);
  report.checks.controlNativeRealpathRecorded = attempts().slice(nativeStart).some(entry => entry.api === "fs:realpathSync" && entry.path === probeDir);
  await cleanupDir(probeDir);
  const afterRemove = attempts().length;

  report.checks.controlCaughtReadRecorded = afterRead > before;
  report.checks.controlTransientWriteRecorded = afterWrite > afterRead;
  report.checks.controlRemovalRecorded = afterRemove > afterWrite;
}

async function readFileProhibited(dir) {
  const { readFile } = await import("node:fs/promises");
  return readFile(path.join(dir, "events.ndjson"), "utf8");
}

async function main() {
  // Controls run before the real command and their records are then dropped.
  await runControls();
  const afterControlIndex = attempts().length;

  const { target } = await buildCanonicalDiagnosisProject({ taskId: TEST_TASK_ID });
  const db = openStorageDatabase(path.join(target, ".forgeloop/state.sqlite"), { readOnly: true });
  const snapshot = () => ({ state: findTaskById(db, TEST_TASK_ID).state, events: listEvents(db, TEST_TASK_ID), claims: listClaims(db, TEST_TASK_ID), receipt: findArtifact(db, TEST_TASK_ID, "receipt") });
  report.before = snapshot();

  if (mode === "contradictory-legacy") {
    // Present contradictory legacy operational records.
    const taskKey = db.prepare("SELECT task_key FROM tasks WHERE task_id = ?").get(TEST_TASK_ID).task_key;
    const stateDir = path.join(target, ".forgeloop", "task-state", taskKey);
    await mkdir(stateDir, { recursive: true });
    await writeFile(path.join(stateDir, "work-state.json"), "{\"phase\":\"CORRUPTED\"}\n");
    await writeFile(path.join(stateDir, "events.ndjson"), "{\"seq\":1,\"event\":\"TAMPERED\"}\n");
    await writeFile(path.join(stateDir, "recovery.json"), "{\"status\":\"ACTIVE\"}\n");
  }

  const indexBeforeDispatch = attempts().length;
  const envelope = await executeForgeLoopCommand({
    command: "record-diagnosis",
    projectPath: target,
    input: {
      hypothesis: "Instrumented canonical diagnosis",
      failureClass: "VERIFICATION_FAILURE",
      evidenceRefs: ["check-auth-boundary"],
      settledBy: "pending-evidence",
      nextSafeAction: "Add the missing boundary case",
      taskId: TEST_TASK_ID,
    },

  });

  // Only attempts inside the dispatch window are classified.
  report.attempts = attempts().slice(indexBeforeDispatch);
  report.checks.dispatchOk = envelope.ok === true;
  report.checks.dispatchErrorCode = envelope.error?.code ?? null;
  report.checks.observedAttemptCount = report.attempts.length;
  report.checks.attemptIndexes = { afterControlIndex, indexBeforeDispatch };
  report.fixtureRoot = target;

  report.after = snapshot();
  db.close();
  await cleanupDir(target);
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
}

await main();
