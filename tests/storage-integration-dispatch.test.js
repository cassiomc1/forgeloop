/**
 * Phase 2B: `record-diagnosis` through the canonical dispatcher.
 *
 * These tests call `executeForgeLoopCommand` with the real command identifier
 * and validated argument shape. They do not call the storage transition
 * directly, so shared input parsing, invocation policy, project/task resolution,
 * result normalization, and error mapping all remain active.
 *
 * Canonical project storage is created by the supported lifecycle.
 * Rejection cases exercise canonical validation and admission boundaries.
 *
 * File manifests cover persistent changes; separate observer regressions
 * cover attempted legacy payload access.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { executeForgeLoopCommand } from "../src/core/command-runtime.js";
import {
  openStorageDatabase,
  listEvents,
  checkStorageIntegrity,
} from "../src/storage/index.js";
import { buildCanonicalDiagnosisProject } from "./helpers/canonical-diagnosis-fixture.js";
import { validateLedgerEvents } from "../src/core/events.js";
import {
  TEST_TASK_ID,
  buildDiagnosisProject,
  cleanupDir,
  logicalSnapshot,
} from "./helpers/storage-fixtures.js";

/**
 * Storage access boundary.
 *
 * These tests record what the dispatcher actually does with the filesystem
 * during a SQLite-routed dispatch, rather than assuming the boundary is clean.
 * A manifest proves persistent changes; it does not prove absence of reads.
 * These manifest assertions do not prove absence of reads.
 */

test("B1: a SQLite dispatch performs no legacy task-OPERATIONAL write", async () => {
  const { target, db } = await buildStoreFixture();
  try {
    const stateRoot = path.join(target, ".forgeloop", "task-state");
    const before = manifest(stateRoot);
    const envelope = await executeForgeLoopCommand({
      command: "record-diagnosis",
      projectPath: target,
      input: { ...DIAGNOSIS_INPUT, taskId: TEST_TASK_ID },
    });
    assert.equal(envelope.ok, true, JSON.stringify(envelope.error));
    const after = manifest(stateRoot);
    // No task.json / work-state.json / events.ndjson is created or replaced.
    const created = after.filter((entry) => !before.includes(entry));
    assert.deepEqual(created, [], `no task operational artifact may be created, saw ${created.join(", ")}`);
  } finally {
    db.close();
    await cleanupDir(target);
  }
});

test("B2: a store-routed dispatch creates no legacy operational filesystem artifact", async () => {
  // Replaces the earlier diagnostic test that asserted the known `.txn` leak.
  // The leak is now closed: the guards and the mutation share one SQLite
  // transaction, and no filesystem transaction staging is produced.
  const { target, db } = await buildStoreFixture();
  try {
    const root = path.join(target, ".forgeloop");
    const before = manifest(root);
    const envelope = await executeForgeLoopCommand({
      command: "record-diagnosis",
      projectPath: target,
      input: { ...DIAGNOSIS_INPUT, taskId: TEST_TASK_ID },
    });
    assert.equal(envelope.ok, true, JSON.stringify(envelope.error));
    const created = manifest(root).filter((entry) => !before.includes(entry));

    // No transaction staging, no ledger sidecar, no task artifact.
    assert.deepEqual(
      created.filter((entry) => entry.startsWith(".txn/")),
      [],
      `no filesystem transaction staging may be created, saw ${created.join(", ")}`,
    );
    assert.deepEqual(
      created.filter((entry) => entry.endsWith("events.ndjson.index.json")),
      [],
      "no event-index sidecar may be created",
    );
    assert.deepEqual(
      created.filter((entry) => entry.includes("work-state.json") || entry.includes("events.ndjson")),
      [],
      "no legacy task operational artifact may be created",
    );
    assert.deepEqual(created, [], `the store-routed dispatch must not touch the filesystem, saw ${created.join(", ")}`);
  } finally {
    db.close();
    await cleanupDir(target);
  }
});

test("B3: contradictory legacy files block canonical dispatch without mutation", async () => {
  // Ordinary dispatch must refuse mixed operational authorities.
  const { target, db, before } = await buildStoreFixture();
  try {
    const taskKey = db.prepare("SELECT task_key FROM tasks WHERE task_id = ?").get(TEST_TASK_ID).task_key;
    const stateDir = path.join(target, ".forgeloop", "task-state", taskKey);
    await mkdir(stateDir, { recursive: true });
    await writeFile(path.join(stateDir, "work-state.json"), "{\"phase\":\"CORRUPTED_FROM_LEGACY\"}\n");
    await writeFile(path.join(stateDir, "events.ndjson"), "{\"seq\":1,\"event\":\"TAMPERED\"}\n");

    const envelope = await executeForgeLoopCommand({
      command: "record-diagnosis",
      projectPath: target,
      input: { ...DIAGNOSIS_INPUT, taskId: TEST_TASK_ID },
    });
    assert.equal(envelope.ok, false, JSON.stringify(envelope));
    assert.equal(envelope.error.code, "E_STORAGE_MIGRATION_REQUIRED");
    assert.deepEqual(logicalSnapshot(db, TEST_TASK_ID), before);
    assert.equal(validateLedgerEvents(listEvents(db, TEST_TASK_ID)).valid, true, "store ledger stays valid");
  } finally {
    db.close();
    await cleanupDir(target);
  }
});

test("B4: inconsistent indexed state rejects before canonical mutation", async () => {
  // A guard rejection must leave the database exactly as it was, proving the
  // guard ran inside the same transaction rather than after the write.
  const { target, db, before } = await buildStoreFixture();
  try {
    // Mark the task COMPLETE in the store: ownership is released by completion.
    db.prepare("UPDATE tasks SET phase = 'COMPLETE' WHERE task_id = ?").run(TEST_TASK_ID);

    const envelope = await executeForgeLoopCommand({
      command: "record-diagnosis",
      projectPath: target,
      input: { ...DIAGNOSIS_INPUT, taskId: TEST_TASK_ID },
    });
    assert.equal(envelope.ok, false, "a released-ownership task must be rejected");
    // The indexed phase disagrees with its validated state payload, so
    // canonical reads reject corruption before ownership or domain mutation.
    assert.equal(envelope.error.code, "E_STORAGE_PAYLOAD_MISMATCH");
    // No state revision and no event: the guard aborted before any write.
    assert.equal(logicalSnapshot(db, TEST_TASK_ID).eventCount, before.eventCount, "no event appended");
    assert.equal(logicalSnapshot(db, TEST_TASK_ID).revision, before.revision, "revision unchanged");
  } finally {
    db.close();
    await cleanupDir(target);
  }
});

test("B5: a recovery artifact without canonical recovery history fails closed", async () => {
  // Claim count alone does not gate mutation; a recovery record does. This
  // replaces an earlier case that asserted a store-specific "no claims" rule the
  // filesystem domain does not define.
  const { target, db, before } = await buildStoreFixture();
  try {
    const { putArtifact } = await import("../src/storage/index.js");
    putArtifact(db, { taskId: TEST_TASK_ID, kind: "recovery", payload: { status: "ACTIVE", recoveryId: "rec-1" } });

    const envelope = await executeForgeLoopCommand({
      command: "record-diagnosis",
      projectPath: target,
      input: { ...DIAGNOSIS_INPUT, taskId: TEST_TASK_ID },
    });
    assert.equal(envelope.ok, false, "a recovered task must be rejected");
    assert.equal(envelope.error.code, "E_TASK_CLAIM_OWNERSHIP_INCONSISTENT");
    assert.equal(logicalSnapshot(db, TEST_TASK_ID).eventCount, before.eventCount, "no event appended");
  } finally {
    db.close();
    await cleanupDir(target);
  }
});


const DIAGNOSIS_INPUT = Object.freeze({
  hypothesis: "Canonical dispatch comparison <= instead of <",
  failureClass: "VERIFICATION_FAILURE",
  evidenceRefs: ["check-auth-boundary"],
  settledBy: "pending-evidence",
  nextSafeAction: "Add the missing boundary case",
});

/** Build a native project and return an open store plus its snapshot. */
async function buildStoreFixture({ unrelated = 0 } = {}) {
  assert.equal(unrelated, 0, "canonical integration fixture has one task");
  const { target } = await buildCanonicalDiagnosisProject({ taskId: TEST_TASK_ID });
  const databasePath = path.join(target, ".forgeloop/state.sqlite");
  const db = openStorageDatabase(databasePath);
  return { target, databasePath, db, before: logicalSnapshot(db, TEST_TASK_ID) };
}

/** List every file under a directory, relative and sorted. */
function manifest(root) {
  const entries = [];
  const walk = (dir, prefix) => {
    let children;
    try {
      children = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const child of children) {
      const rel = prefix ? `${prefix}/${child.name}` : child.name;
      if (child.isDirectory()) walk(path.join(dir, child.name), rel);
      else entries.push(rel);
    }
  };
  walk(root, "");
  return entries.sort();
}

test("D1: a valid diagnosis through the canonical dispatcher mutates the store", async () => {
  const { target, db, before } = await buildStoreFixture();
  try {
    const envelope = await executeForgeLoopCommand({
      command: "record-diagnosis",
      projectPath: target,
      input: { ...DIAGNOSIS_INPUT, taskId: TEST_TASK_ID },
    });
    // The public envelope is the canonical one, not a bespoke result shape.
    assert.equal(envelope.ok, true);
    assert.equal(envelope.exitCode, 0);
    assert.equal(envelope.error, null);
    assert.equal(envelope.command, "record-diagnosis");
    assert.equal(envelope.metadata.integrationApiVersion, 1);
    assert.ok(envelope.result.event, "result carries the canonical event");
    assert.ok(envelope.result.state, "result carries the canonical state");
    assert.equal(envelope.result.idempotent, false);

    const after = logicalSnapshot(db, TEST_TASK_ID);
    assert.equal(after.revision, before.revision + 1, "state revision advanced once");
    assert.equal(after.eventCount, before.eventCount + 2, "diagnosis plus command commit appended");
    assert.equal(listEvents(db, TEST_TASK_ID).at(-2).hash, envelope.result.event.hash, "diagnosis precedes the command commit witness");
    assert.equal(checkStorageIntegrity(db).ok, true);
    assert.equal(validateLedgerEvents(listEvents(db, TEST_TASK_ID)).valid, true);
  } finally {
    db.close();
    await cleanupDir(target);
  }
});

test("D2: default context refuses unconverted legacy mutation and opens no store", async () => {
  const target = await buildDiagnosisProject({ unrelated: 0, legacy: true });
  try {
    const envelope = await executeForgeLoopCommand({
      command: "record-diagnosis",
      projectPath: target,
      input: { ...DIAGNOSIS_INPUT, taskId: TEST_TASK_ID },
    });
    assert.equal(envelope.ok, false, JSON.stringify(envelope));
    assert.equal(envelope.error.code, "E_STORAGE_MIGRATION_REQUIRED");
    // Existing legacy artifacts remain and no implicit migration occurs.
    assert.ok(manifest(path.join(target, ".forgeloop", "task-state")).length > 0);
    assert.equal(
      manifest(path.join(target, ".forgeloop")).includes("state.sqlite"),
      false,
      "default context must not create a SQLite store",
    );
  } finally {
    await cleanupDir(target);
  }
});

test("D3: invalid command input is rejected before any mutation", async () => {
  const { target, db, before } = await buildStoreFixture();
  try {
    const envelope = await executeForgeLoopCommand({
      command: "record-diagnosis",
      projectPath: target,
      // Missing required diagnosis fields: shared input validation must reject.
      input: { taskId: TEST_TASK_ID, hypothesis: "only a hypothesis" },
    });
    assert.equal(envelope.ok, false, "invalid input must not succeed");
    assert.equal(envelope.result, null);
    assert.ok(envelope.error.code, "an error code is reported");
    assert.deepEqual(logicalSnapshot(db, TEST_TASK_ID), before, "no persisted change");
  } finally {
    db.close();
    await cleanupDir(target);
  }
});

test("D4: missing structured case is rejected without mutation or filesystem fallback", async () => {
  const { target, db, before } = await buildStoreFixture();
  try {
    const envelope = await executeForgeLoopCommand({
      command: "record-diagnosis",
      projectPath: target,
      // Structured cases use the canonical parser; absent input must fail closed.
      input: { file: "case.json", taskId: TEST_TASK_ID },
    });
    assert.equal(envelope.ok, false);
    assert.equal(envelope.error.code, "E_DIAGNOSTIC_CASE_INVALID");
    assert.deepEqual(logicalSnapshot(db, TEST_TASK_ID), before, "no persisted change");
    // It must not have silently written through filesystem persistence.
    assert.equal(
      manifest(path.join(target, ".forgeloop", "task-state")).includes("case.json"),
      false,
      "no filesystem fallback artifact may be written",
    );
  } finally {
    db.close();
    await cleanupDir(target);
  }
});

test("D5: unavailable mandatory contract evidence blocks canonical correction", async () => {
  const { target, db } = await buildStoreFixture();
  try {
    const diagnosis = await executeForgeLoopCommand({ command: "record-diagnosis", projectPath: target, input: { ...DIAGNOSIS_INPUT, taskId: TEST_TASK_ID } });
    assert.equal(diagnosis.ok, true, JSON.stringify(diagnosis));
    db.prepare("DELETE FROM task_artifacts WHERE task_id = ? AND kind = 'contract'").run(TEST_TASK_ID);
    const before = logicalSnapshot(db, TEST_TASK_ID);
    const envelope = await executeForgeLoopCommand({
      command: "advance", projectPath: target,
      input: { to: "CORRECTING", taskId: TEST_TASK_ID },
    });
    assert.equal(envelope.ok, false, JSON.stringify(envelope));
    assert.equal(envelope.error.code, "E_PHASE_PREREQUISITE_MISSING", JSON.stringify(envelope));
    assert.deepEqual(logicalSnapshot(db, TEST_TASK_ID), before, "no persisted change");
  } finally {
    db.close();
    await cleanupDir(target);
  }
});

test("D6: a forged authority field in command input is not honoured as trust", async () => {
  const { target, db, before } = await buildStoreFixture();
  try {
    const envelope = await executeForgeLoopCommand({
      command: "record-diagnosis",
      projectPath: target,
      // Trust never comes from actor-controlled input.
      input: {
        ...DIAGNOSIS_INPUT,
        taskId: TEST_TASK_ID,
        authorityContext: { trust: "HOST_ATTESTED", actor: "forged-host" },
      },
    });
    // The forged field must not crash the runtime or be consumed as authority.
    assert.equal(envelope.ok, true, JSON.stringify(envelope.error));
    const after = logicalSnapshot(db, TEST_TASK_ID);
    assert.equal(after.revision, before.revision + 1, "the mutation is unaffected");
    // No host-attested authority was created by the forged field.
    assert.equal(envelope.result.authorityContext, undefined, "no authority context is echoed back");
  } finally {
    db.close();
    await cleanupDir(target);
  }
});

test("D7: the idempotent request keeps its revision and event effects", async () => {
  const { target, db } = await buildStoreFixture();
  try {
    const first = await executeForgeLoopCommand({
      command: "record-diagnosis",
      projectPath: target,
      input: { ...DIAGNOSIS_INPUT, taskId: TEST_TASK_ID },
    });
    assert.equal(first.result.idempotent, false);
    const afterFirst = logicalSnapshot(db, TEST_TASK_ID);

    const second = await executeForgeLoopCommand({
      command: "record-diagnosis",
      projectPath: target,
      input: { ...DIAGNOSIS_INPUT, taskId: TEST_TASK_ID },
    });
    assert.equal(second.ok, true);
    assert.equal(second.result.idempotent, true, "the repeat is idempotent");
    const afterSecond = logicalSnapshot(db, TEST_TASK_ID);
    // Filesystem semantics: revision advances, but no new event is appended.
    assert.equal(afterSecond.revision, afterFirst.revision + 1);
    assert.equal(afterSecond.eventCount, afterFirst.eventCount + 1, "only the command commit witness is added; diagnosis remains idempotent");
  } finally {
    db.close();
    await cleanupDir(target);
  }
});
