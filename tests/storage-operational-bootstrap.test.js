import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm, readdir, writeFile, readFile, symlink, cp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { withOperationalStore, withOperationalTransaction } from "../src/storage/unit-of-work.js";
import { openStorageDatabase, findTaskById, listEvents, listClaims } from "../src/storage/index.js";
import { executeForgeLoopCommand } from "../src/core/command-runtime.js";
import { validateLedgerEvents, readEvents as readProtocolEvents, iterateEvents as iterateProtocolEvents } from "../src/core/events.js";
import { discoverTasks } from "../src/core/task-discovery.js";
import { taskArtifactPath } from "../src/core/task-paths.js";
import { runDiscover } from "../src/commands/discover.js";
import { runContractCreate } from "../src/commands/contract-create.js";
import { runRoute } from "../src/commands/route.js";
import { runPreflight } from "../src/commands/preflight.js";
import { getPackageRoot } from "../src/core/templates.js";
import { createContract } from "../src/core/contract.js";
import { testSemanticProvider } from "../src/core/decision/test-provider.js";
import { recordSemanticDecision } from "../src/core/decision/service.js";
import { runActivate } from "../src/commands/activate.js";
import { runAdvance } from "../src/commands/advance.js";
import { runPrepareCompletion } from "../src/commands/prepare-completion.js";
import { readWorkState } from "../src/core/work-state.js";
import { runCheck } from "../src/commands/run-check.js";
import { runRecordDiagnosis } from "../src/commands/record-diagnosis.js";
import { runRecordCheck } from "../src/commands/record-check.js";
import { runComplete } from "../src/commands/complete.js";
import { createBarrier, spawnWorker } from "./helpers/storage-fixtures.js";
import { proposeAction, readAction, findActionByIdempotencyKey, detectOrphanActions } from "../src/core/actions.js";
import { projectActionLedger } from "../src/core/action-ledger-projection.js";
import { requestApproval, resolveApproval, listApprovals } from "../src/core/approvals.js";
import { acquireTaskLock, readLockInfo, forceUnlockTask, releaseStaleTaskLockIfUnchanged } from "../src/core/task-lock.js";
import { putArtifact, putExecution } from "../src/storage/repository.js";
import { readExecutionArtifact } from "../src/core/execution.js";
import { runTaskAbandon } from "../src/commands/task-abandon.js";
import { runTaskResume } from "../src/commands/task-resume.js";
import { listOperationalArtifactNames } from "../src/storage/operational-context.js";
import { readForgeLoopIntegrationResource } from "../src/core/integration-resources.js";
import { listCanonicalHandoffs, writeCanonicalHandoff } from "../src/core/handoff.js";
import { canonicalFingerprint } from "../src/core/artifacts.js";
import { buildTaskSnapshot } from "../src/core/task-snapshot.js";
import { clearWorkState } from "../src/core/work-state.js";
import { clearContinuity } from "../src/core/continuity.js";
import { withProjectStorage } from "../src/storage/project-boundary.js";
import { writeCodeManifest, codeManifestContentDigest } from "../src/core/code-manifest.js";
import { exportTaskBundle, readTaskBundle } from "../src/core/bundles.js";
import { resolveAttestationBundlePath } from "../src/core/attachment-paths.js";
import { taskAttestationBundlePath } from "../src/core/task-paths.js";
import { listStructuralQualityEvaluations } from "../src/core/structural-quality/artifacts.js";

async function project(callback) {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-sqlite-bootstrap-"));
  await mkdir(path.join(target, "src"));
  const db = openStorageDatabase(path.join(target, "state.sqlite"));
  try { await callback({ target, db }); }
  finally { db.close(); await rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
}

test("SQLite code manifests preserve cycle immutability and prior-cycle history", async () => {
  await project(async ({ target, db }) => {
    const taskId = "manifest-history";
    await withOperationalStore({ db, target }, () => executeForgeLoopCommand({ command: "task-create", projectPath: target, input: { taskId, claims: ["src"] } }));
    const manifest = JSON.parse(await readFile(path.join(getPackageRoot(), "tests/fixtures/schemas/code-manifest/valid.json"), "utf8"));
    manifest.taskId = taskId;
    manifest.contentDigest = codeManifestContentDigest(manifest.entries);
    await withOperationalStore({ db, target }, async () => {
      await writeCodeManifest({ target, taskId, manifest });
      await assert.rejects(writeCodeManifest({ target, taskId, manifest }), { code: "E_ATTESTATION_MANIFEST_INVALID" });
      await writeCodeManifest({ target, taskId, manifest: { ...manifest, verificationCycle: 2 } });
    });
    const history = db.prepare("SELECT payload_json FROM task_artifacts WHERE kind = 'attestation' AND artifact_id = 'history/cycle-1/code-manifest'").get();
    assert.deepEqual(JSON.parse(history.payload_json), manifest);
    assert.equal((await readdir(target)).includes(".forgeloop"), false);
  });
});

test("public read-only storage neither creates nor upgrades a store and refuses symlinks", async () => {
  await project(async ({ target }) => {
    await withProjectStorage(target, () => assert.ok(true), { readOnly: true });
    assert.equal((await readdir(target)).includes(".forgeloop"), false);
    await mkdir(path.join(target, ".forgeloop"));
    const filename = path.join(target, ".forgeloop/state.sqlite");
    const db = openStorageDatabase(filename);
    db.prepare("UPDATE storage_meta SET schema_version = 3 WHERE id = 1").run();
    db.close();
    const before = await readFile(filename);
    await assert.rejects(withProjectStorage(target, () => assert.fail("incompatible read must not execute"), { readOnly: true }), { code: "E_STORAGE_MIGRATION_REQUIRED" });
    assert.deepEqual(await readFile(filename), before);
    for (const [command, input] of [["storage-backup", { destination: "old-schema-backup.sqlite" }], ["doctor", {}], ["doctor", { fix: false }]]) {
      const result = await executeForgeLoopCommand({ command, projectPath: target, input });
      assert.equal(result.ok, false, JSON.stringify(result));
      assert.equal(result.error.code, "E_STORAGE_MIGRATION_REQUIRED", command);
      assert.deepEqual(await readFile(filename), before, `${command} must preserve the source schema and bytes`);
    }
    await assert.rejects(readFile(path.join(target, "old-schema-backup.sqlite")), { code: "ENOENT" });
    const sidecar = `${filename}-wal`;
    await rm(sidecar, { force: true });
    await symlink(path.join(target, "outside-wal"), sidecar);
    await assert.rejects(withProjectStorage(target, () => assert.fail("symlinked WAL must not execute"), { readOnly: true }), /symlink/);
    await rm(sidecar);
    await rm(filename);
    await symlink(path.join(target, "state.sqlite"), filename);
    await assert.rejects(withProjectStorage(target, () => assert.fail("symlinked store must not execute"), { readOnly: true }));
  });
});

test("public command and resource boundaries select an existing canonical SQLite store", async () => {
  await project(async ({ target }) => {
    await mkdir(path.join(target, ".forgeloop"));
    const filename = path.join(target, ".forgeloop/state.sqlite");
    openStorageDatabase(filename).close();
    const created = await executeForgeLoopCommand({ command: "task-create", projectPath: target, input: { taskId: "public-sqlite", claims: ["src"] } });
    assert.equal(created.ok, true, JSON.stringify(created));
    const resource = await readForgeLoopIntegrationResource("project/tasks", { projectPath: target, packageRoot: getPackageRoot() });
    assert.equal(resource.data.count, 1);
    assert.equal(resource.data.tasks[0].taskId, "public-sqlite");
    const cli = await promisify(execFile)(process.execPath, [path.join(getPackageRoot(), "src/cli.js"), "task-list", "--path", target, "--json"]);
    assert.match(cli.stdout, /public-sqlite/);
    const backup = await executeForgeLoopCommand({ command: "storage-backup", projectPath: target, input: { destination: "api-backup.sqlite" } });
    assert.equal(backup.ok, true, JSON.stringify(backup));
    assert.equal(backup.result.attachmentsIncluded, false);
    const cliBackup = await promisify(execFile)(process.execPath, [path.join(getPackageRoot(), "src/cli.js"), "storage-backup", "--path", target, "--destination", "cli-backup.sqlite", "--json"]);
    assert.equal(JSON.parse(cliBackup.stdout).kind, "DATABASE_ONLY");
    const backupDb = openStorageDatabase(path.join(target, "cli-backup.sqlite"), { readOnly: true });
    try { assert.equal(findTaskById(backupDb, "public-sqlite").taskId, "public-sqlite"); }
    finally { backupDb.close(); }
    const overwrite = await executeForgeLoopCommand({ command: "storage-backup", projectPath: target, input: { destination: "api-backup.sqlite" } });
    assert.equal(overwrite.ok, false);
    const doctor = await executeForgeLoopCommand({ command: "doctor", projectPath: target, input: {} });
    assert.equal(doctor.result.storage.backend, "sqlite");
    assert.equal(doctor.result.storage.integrity.ok, true);
    const tampered = openStorageDatabase(filename);
    tampered.prepare("UPDATE events SET event_type = 'TAMPERED' WHERE seq = 1").run();
    tampered.close();
    const invalidDoctor = await executeForgeLoopCommand({ command: "doctor", projectPath: target, input: {} });
    assert.equal(invalidDoctor.result.storage.integrity.ok, false);
    assert.ok(invalidDoctor.result.findings.some(finding => finding.code === "E_STORAGE_INTEGRITY_INVALID" && finding.severity === "error"));
    assert.deepEqual((await readdir(path.join(target, ".forgeloop"))).filter(name => !name.startsWith("state.sqlite")), []);
    await mkdir(path.join(target, ".forgeloop/task-state"));
    const mixed = await executeForgeLoopCommand({ command: "task-create", projectPath: target, input: { taskId: "must-refuse", claims: [] } });
    assert.equal(mixed.error.code, "E_STORAGE_MIGRATION_REQUIRED");
    await assert.rejects(readForgeLoopIntegrationResource("project/tasks", { projectPath: target }), { code: "E_STORAGE_MIGRATION_REQUIRED" });
  });
});

test("SQLite handoff overwrite rejects and state clearing updates the canonical row", async () => {
  await project(async ({ target, db }) => {
    const taskId = "immutable-handoff";
    await withOperationalStore({ db, target }, () => executeForgeLoopCommand({ command: "task-create", projectPath: target, input: { taskId, claims: ["src"] } }));
    const handoff = JSON.parse(await readFile(path.join(getPackageRoot(), "tests/fixtures/schemas/handoff-envelope/valid.json"), "utf8"));
    handoff.taskId = taskId;
    delete handoff.artifactDigest;
    handoff.artifactDigest = canonicalFingerprint(handoff);
    putArtifact(db, { taskId, kind: "handoff", artifactId: handoff.handoffId, payload: handoff });
    await assert.rejects(withOperationalStore({ db, target }, () => writeCanonicalHandoff(target, handoff)), { code: "E_HANDOFF_INVALID" });
    assert.deepEqual(JSON.parse(db.prepare("SELECT payload_json FROM task_artifacts WHERE kind = 'handoff'").get().payload_json), handoff);
    db.prepare("UPDATE tasks SET phase = 'RECEIVED', revision = 1, state_json = ? WHERE task_id = ?").run(JSON.stringify({ taskId, phase: "RECEIVED", revision: 1 }), taskId);
    await withOperationalStore({ db, target }, async () => {
      assert.equal((await clearWorkState(target, { taskId })).removed, true);
      assert.equal((await clearWorkState(target, { taskId })).removed, false);
    });
    const task = db.prepare("SELECT phase, revision, state_json FROM tasks WHERE task_id = ?").get(taskId);
    assert.deepEqual({ ...task }, { phase: null, revision: null, state_json: null });
    putArtifact(db, { taskId, kind: "continuity", payload: { taskId } });
    await withOperationalStore({ db, target }, async () => {
      await assert.rejects(withOperationalTransaction({ target, taskId }, async () => {
        assert.equal((await clearContinuity(target, { taskId })).removed, true);
        throw new Error("injected clear failure");
      }), /injected clear failure/);
      assert.equal((await clearContinuity(target, { taskId })).removed, true);
      assert.equal((await clearContinuity(target, { taskId })).removed, false);
    });
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM task_artifacts WHERE kind = 'continuity'").get().count, 0);
    assert.equal((await readdir(target)).includes(".forgeloop"), false);
  });
});

test("unscoped execution lookup uses its index, validates records and rejects ambiguity", async () => {
  await project(async ({ target, db }) => {
    for (const taskId of ["execution-one", "execution-two"]) {
      await withOperationalStore({ db, target }, () => executeForgeLoopCommand({ command: "task-create", projectPath: target, input: { taskId, claims: [] } }));
    }
    const fixture = JSON.parse(await readFile(path.join(getPackageRoot(), "tests/fixtures/schemas/execution/valid.json"), "utf8"));
    const execution = { ...fixture, taskId: "execution-one", executionId: "exec-indexed" };
    putExecution(db, { taskId: execution.taskId, execution });
    const options = { target, executionRef: execution.executionId, packageRoot: getPackageRoot() };
    const result = await withOperationalStore({ db, target }, () => readExecutionArtifact(options));
    assert.deepEqual(result.value, execution);
    assert.match(db.prepare("EXPLAIN QUERY PLAN SELECT task_id FROM executions WHERE execution_id = ? ORDER BY task_id LIMIT 2").all(execution.executionId).map(row => row.detail).join(" "), /executions_reference_idx/);
    db.prepare("UPDATE executions SET check_id = 'tampered' WHERE task_id = ?").run(execution.taskId);
    await assert.rejects(withOperationalStore({ db, target }, () => readExecutionArtifact(options)), { code: "E_EXECUTION_REF_INVALID" });
    putExecution(db, { taskId: execution.taskId, execution });
    putExecution(db, { taskId: "execution-two", execution: { ...execution, taskId: "execution-two" } });
    await assert.rejects(withOperationalStore({ db, target }, () => readExecutionArtifact(options)), { code: "E_EXECUTION_REF_INVALID" });
    const scoped = await withOperationalStore({ db, target }, () => readExecutionArtifact({ ...options, taskId: execution.taskId }));
    assert.deepEqual(scoped.value, execution);
    assert.equal((await readdir(target)).includes(".forgeloop"), false);
  });
});

test("integration collections read canonical SQLite artifacts without legacy directories", async () => {
  await project(async ({ target, db }) => {
    const taskId = "collection-reader";
    await withOperationalStore({ db, target }, () => executeForgeLoopCommand({ command: "task-create", projectPath: target, input: { taskId, claims: ["src"] } }));
    for (const [kind, schema, idField] of [["evaluation", "trajectory-evaluation", "evaluationId"], ["decision", "semantic-decision", "decisionId"]]) {
      const payload = JSON.parse(await readFile(path.join(getPackageRoot(), "tests/fixtures/schemas", schema, "valid.json"), "utf8"));
      payload.taskId = taskId;
      putArtifact(db, { taskId, kind, artifactId: payload[idField], payload });
      const collection = kind === "evaluation" ? "evaluations" : "decisions";
      const result = await withOperationalStore({ db, target }, () => readForgeLoopIntegrationResource(`task/${collection}`, { projectPath: target, taskId, packageRoot: getPackageRoot() }));
      assert.deepEqual(result.data[collection], [payload]);
    }
    assert.equal((await readdir(target)).includes(".forgeloop"), false);
  });
});

test("collection preparation includes staged artifacts and rejects a concurrent insertion", async () => {
  await project(async ({ target, db }) => {
    const taskId = "collection-conflict";
    await withOperationalStore({ db, target }, () => executeForgeLoopCommand({ command: "task-create", projectPath: target, input: { taskId, claims: ["src"] } }));
    await assert.rejects(withOperationalStore({ db, target }, () => withOperationalTransaction({ target, taskId }, async transaction => {
      assert.deepEqual(listOperationalArtifactNames(target, taskId, "evaluations"), []);
      transaction.stageText(`${taskArtifactPath(taskId, "evaluations")}/eval-proposed.json`, JSON.stringify({ taskId, marker: "proposed" }));
      assert.deepEqual(listOperationalArtifactNames(target, taskId, "evaluations"), ["eval-proposed.json"]);
      putArtifact(db, { taskId, kind: "evaluation", artifactId: "eval-concurrent", payload: { taskId, marker: "concurrent" } });
    })), { code: "E_STATE_REVISION_CONFLICT" });
    assert.deepEqual(db.prepare("SELECT artifact_id FROM task_artifacts WHERE kind = 'evaluation'").all().map(row => row.artifact_id), ["eval-concurrent"]);
  });
});

test("nested quality collections and handoffs retain validation without filesystem fallback", async () => {
  await project(async ({ target, db }) => {
    const taskId = "nested-collections";
    await withOperationalStore({ db, target }, () => executeForgeLoopCommand({ command: "task-create", projectPath: target, input: { taskId, claims: ["src"] } }));
    putArtifact(db, { taskId, kind: "structuralQuality", artifactId: "baseline", payload: { taskId } });
    putArtifact(db, { taskId, kind: "structuralQuality", artifactId: "evaluations/cycle-1-attempt-1", payload: { taskId } });
    putArtifact(db, { taskId, kind: "handoff", artifactId: "handoff-invalid", payload: { taskId } });
    await withOperationalStore({ db, target }, async () => {
      assert.deepEqual(listOperationalArtifactNames(target, taskId, "structural-quality"), ["baseline.json"]);
      assert.deepEqual(listOperationalArtifactNames(target, taskId, "structural-quality/evaluations"), ["cycle-1-attempt-1.json"]);
      assert.throws(() => listOperationalArtifactNames(target, taskId, "structural-quality/../evaluations"), { code: "ARTIFACT_PATH_INVALID" });
      await assert.rejects(listStructuralQualityEvaluations(target, taskId), { code: "E_STRUCTURAL_QUALITY_EVIDENCE_STALE" });
      await assert.rejects(listCanonicalHandoffs(target, { taskId }), { code: "E_HANDOFF_INVALID" });
    });
    assert.equal((await readdir(target)).includes(".forgeloop"), false);
  });
});

test("canonical task-create commits descriptor, claims and ledger to SQLite without a legacy namespace", async () => {
  await project(async ({ target, db }) => {
    const result = await withOperationalStore({ db, target }, () => executeForgeLoopCommand({ command: "task-create", projectPath: target, input: { taskId: "bootstrap-one", claims: ["src"] } }));
    assert.equal(result.ok, true, JSON.stringify(result));
    const task = findTaskById(db, "bootstrap-one");
    assert.deepEqual(task.descriptor.writeClaims, ["src"]);
    assert.equal(task.state, null);
    const events = listEvents(db, "bootstrap-one");
    assert.deepEqual(events.map(event => event.event), ["TASK_RECEIVED", "TRANSACTION_COMMITTED"]);
    assert.equal(validateLedgerEvents(events).valid, true);
    assert.deepEqual(listClaims(db, "bootstrap-one").map(row => row.claim_norm), ["src"]);
    assert.equal((await readdir(target)).includes(".forgeloop"), false);
    const tasks = await withOperationalStore({ db, target }, () => discoverTasks(target));
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].claimState, "ACTIVE");
    assert.equal(tasks[0].ownershipValid, true);
  });
});

test("canonical task-create preserves duplicate and overlapping-claim errors on SQLite", async () => {
  await project(async ({ target, db }) => {
    const execute = input => withOperationalStore({ db, target }, () => executeForgeLoopCommand({ command: "task-create", projectPath: target, input }));
    assert.equal((await execute({ taskId: "owner", claims: ["src"] })).ok, true);
    const duplicate = await execute({ taskId: "owner", claims: [] });
    assert.equal(duplicate.error.code, "E_TASK_ALREADY_EXISTS");
    const conflict = await execute({ taskId: "conflict", claims: ["src/nested"] });
    assert.equal(conflict.error.code, "E_TASK_SCOPE_CONFLICT");
    assert.equal(findTaskById(db, "conflict"), null);
    assert.equal(listEvents(db, "owner").length, 2);
  });
});

test("prepared operational mutation rejects a concurrent task change without overwriting it", async () => {
  await project(async ({ target, db }) => {
    await withOperationalStore({ db, target }, () => executeForgeLoopCommand({ command: "task-create", projectPath: target, input: { taskId: "observed", claims: [] } }));
    const other = openStorageDatabase(path.join(target, "state.sqlite"));
    try {
      await assert.rejects(withOperationalStore({ db, target }, store => withOperationalTransaction({ target, taskId: "observed", operation: "test-read-conflict" }, async tx => {
        const relativePath = taskArtifactPath("observed", "descriptor");
        const descriptor = JSON.parse(store.readText(relativePath));
        await tx.stageText(relativePath, JSON.stringify(descriptor));
        other.prepare("UPDATE tasks SET updated_at = ? WHERE task_id = ?").run("concurrent-marker", "observed");
      })), { code: "E_STATE_REVISION_CONFLICT" });
      assert.equal(findTaskById(db, "observed").updatedAt, "concurrent-marker");
      assert.equal(listEvents(db, "observed").length, 2);
    } finally { other.close(); }
  });
});

test("changed preparation reads reject before mixed-version domain checks while stable failures remain domain errors", async () => {
  await project(async ({ target, db }) => {
    await withOperationalStore({ db, target }, () => executeForgeLoopCommand({ command: "task-create", projectPath: target, input: { taskId: "interleaved", claims: [] } }));
    const relativePath = taskArtifactPath("interleaved", "descriptor");
    const domainError = Object.assign(new Error("stable invalid evidence"), { code: "E_EVIDENCE_COVERAGE_INVALID" });
    await assert.rejects(withOperationalStore({ db, target }, store => withOperationalTransaction({ target, taskId: "interleaved", operation: "stable-domain-control" }, async () => {
      assert.equal(store.readText(relativePath), store.readText(relativePath));
      throw domainError;
    })), error => error === domainError);
    const other = openStorageDatabase(path.join(target, "state.sqlite"));
    let mixedVersionCheckReached = false;
    try {
      await assert.rejects(withOperationalStore({ db, target }, store => withOperationalTransaction({ target, taskId: "interleaved", operation: "interleaved-read-control" }, async () => {
        store.readText(relativePath);
        other.prepare("UPDATE tasks SET updated_at = ? WHERE task_id = ?").run("concurrent-version", "interleaved");
        store.readText(relativePath);
        mixedVersionCheckReached = true;
        throw domainError;
      })), { code: "E_STATE_REVISION_CONFLICT" });
      assert.equal(mixedVersionCheckReached, false);
      assert.equal(findTaskById(db, "interleaved").updatedAt, "concurrent-version");
      assert.equal(listEvents(db, "interleaved").length, 2);
    } finally { other.close(); }
  });
});

for (const limit of [null, 1, "domain-array"]) {
  test(`streamed event observation rejects concurrent canonical payload change for ${limit ?? "full"} read`, async () => {
    await project(async ({ target, db }) => {
      await withOperationalStore({ db, target }, () => executeForgeLoopCommand({ command: "task-create", projectPath: target, input: { taskId: "event-observed", claims: [] } }));
      const other = openStorageDatabase(path.join(target, "state.sqlite"));
      let callbacks = 0;
      try {
        await assert.rejects(withOperationalStore({ db, target }, store => withOperationalTransaction({ target, taskId: "event-observed", operation: "test-event-conflict" }, async tx => {
          callbacks += 1;
          const events = limit === "domain-array"
            ? await readProtocolEvents(target, getPackageRoot(), { taskId: "event-observed" })
            : store.readEvents(taskArtifactPath("event-observed", "events"), limit);
          assert.equal(events.length, limit === 1 ? 1 : 2);
          const relative = taskArtifactPath("event-observed", "descriptor");
          await tx.stageText(relative, store.readText(relative));
          const event = { ...events.at(-1), details: { concurrent: true } };
          other.prepare("UPDATE events SET event_json = ? WHERE task_id = ? AND seq = ?").run(JSON.stringify(event), event.taskId, event.seq);
        })), { code: "E_STATE_REVISION_CONFLICT" });
        assert.equal(callbacks, 1);
        assert.equal(listEvents(db, "event-observed").length, 2);
        assert.equal(listEvents(db, "event-observed").at(-1).details.concurrent, true);
      } finally { other.close(); }
    });
  });
}

test("partial event iteration cannot authorize an operational mutation", async () => {
  await project(async ({ target, db }) => {
    await withOperationalStore({ db, target }, () => executeForgeLoopCommand({ command: "task-create", projectPath: target, input: { taskId: "partial-events", claims: [] } }));
    await assert.rejects(withOperationalStore({ db, target }, store => withOperationalTransaction({ target, taskId: "partial-events", operation: "partial-events" }, async tx => {
      for (const event of store.iterateEvents(taskArtifactPath("partial-events", "events"))) { assert.equal(event.seq, 1); break; }
      const relative = taskArtifactPath("partial-events", "descriptor");
      await tx.stageText(relative, store.readText(relative));
    })), { code: "E_STORAGE_OBSERVATION_INCOMPLETE" });
    assert.equal(listEvents(db, "partial-events").length, 2);
  });
});

test("domain event iterator preserves canonical ordering and schema validation", async () => {
  await project(async ({ target, db }) => {
    await withOperationalStore({ db, target }, () => executeForgeLoopCommand({ command: "task-create", projectPath: target, input: { taskId: "domain-events", claims: [] } }));
    await withOperationalStore({ db, target }, async () => {
      const events = [];
      for await (const event of iterateProtocolEvents(target, getPackageRoot(), { taskId: "domain-events" })) events.push(event);
      assert.deepEqual(events, listEvents(db, "domain-events"));
      assert.deepEqual(await readProtocolEvents(target, getPackageRoot(), { taskId: "domain-events" }), events);
      const snapshot = await buildTaskSnapshot({ target, packageRoot: getPackageRoot(), taskId: "domain-events" });
      assert.equal(snapshot.consistent, true);
      assert.equal(snapshot.integrity.valid, true);
      assert.deepEqual(snapshot.events, events);
      assert.equal(snapshot.anchors.sequence, events.at(-1).seq);
      assert.equal(snapshot.anchors.hash, events.at(-1).hash);
    });
    const event = { ...listEvents(db, "domain-events")[0], schemaVersion: 999 };
    db.prepare("UPDATE events SET event_json = ? WHERE task_id = ? AND seq = ?").run(JSON.stringify(event), event.taskId, event.seq);
    await assert.rejects(withOperationalStore({ db, target }, async () => {
      for await (const value of iterateProtocolEvents(target, getPackageRoot(), { taskId: "domain-events" })) assert.fail(`Unexpected invalid event ${value.seq}`);
    }), { name: "SchemaValidationError" });
    await assert.rejects(withOperationalStore({ db, target }, () => readProtocolEvents(target, getPackageRoot(), { taskId: "domain-events" })), { name: "SchemaValidationError" });
    await assert.rejects(withOperationalStore({ db, target }, () => buildTaskSnapshot({ target, packageRoot: getPackageRoot(), taskId: "domain-events" })), { name: "SchemaValidationError" });
  });
});

test("event iterator cannot continue after its operational scope closes", async () => {
  await project(async ({ target, db }) => {
    await withOperationalStore({ db, target }, () => executeForgeLoopCommand({ command: "task-create", projectPath: target, input: { taskId: "expired-events", claims: [] } }));
    let iterator;
    let domainIterator;
    await withOperationalStore({ db, target }, store => {
      iterator = store.iterateEvents(taskArtifactPath("expired-events", "events"));
      domainIterator = iterateProtocolEvents(target, getPackageRoot(), { taskId: "expired-events" });
      assert.equal(iterator.next().value.seq, 1);
    });
    assert.throws(() => iterator.next(), { code: "E_STORAGE_TRANSACTION_INVALID" });
    await assert.rejects(domainIterator.next(), { code: "E_STORAGE_TRANSACTION_INVALID" });
  });
});

test("a retained preparation handle cannot write through a later transaction", async () => {
  await project(async ({ target, db }) => {
    const taskId = "sqlite-expired-preparation";
    await withOperationalStore({ db, target }, async () => {
      await executeForgeLoopCommand({ command: "task-create", projectPath: target, input: { taskId, claims: [] } });
      let closed;
      await withOperationalTransaction({ target, taskId, operation: "first" }, transaction => { closed = transaction; });
      await withOperationalTransaction({ target, taskId, operation: "second" }, () => {
        assert.throws(() => closed.stageText(taskArtifactPath(taskId, "descriptor"), "{}"), { code: "E_STORAGE_TRANSACTION_EXPIRED" });
      });
    });
    assert.equal(findTaskById(db, taskId).descriptor.taskId, taskId);
    assert.equal(listEvents(db, taskId).length, 2);
  });
});

test("canonical SQLite lifecycle completes after a real correction cycle without legacy task or session files", async () => {
  await project(async ({ target, db }) => {
    const taskId = "sqlite-preflight";
    const packageRoot = getPackageRoot();
    const context = { target, taskId, packageRoot };
    await withOperationalStore({ db, target }, async () => {
      const created = await executeForgeLoopCommand({ command: "task-create", projectPath: target, input: { taskId, claims: ["src"] } });
      assert.equal(created.ok, true, JSON.stringify(created));
      await runDiscover(context);
      const contract = createContract({ taskId, objective: "Validate canonical SQLite task bootstrap", deliverables: ["src"], verification: ["The fixture check passes"], successCriteria: ["Protocol integrity is preserved"] });
      await writeFile(path.join(target, "fixture-contract.json"), JSON.stringify(contract));
      await runContractCreate({ ...context, contractFile: "fixture-contract.json", semanticProvider: testSemanticProvider });
      await runRoute({ ...context, workType: "code", surfaces: ["config"], executableChange: true, semanticProvider: testSemanticProvider });
      const preflight = await runPreflight(context);
      assert.equal(preflight.status, "READY", JSON.stringify(preflight));
      const activation = await runActivate({ target, packageRoot });
      assert.equal(db.prepare("SELECT active_session_id FROM storage_meta WHERE id = 1").get().active_session_id, activation.sessionId);
      for (const to of ["PLANNED", "EXECUTING", "VERIFYING"]) await runAdvance({ ...context, to });
      await runPrepareCompletion(context);
      assert.equal((await readWorkState(target, { taskId, packageRoot })).phase, "VERIFYING");
      const check = await runCheck({ ...context, id: "sqlite-real-check", requirement: "The fixture check passes", argv: [process.execPath, "-e", "process.exit(1)"] });
      assert.equal(check.check.status, "failed");
      await runAdvance({ ...context, to: "DIAGNOSING" });
      await runRecordDiagnosis({ ...context, hypothesis: "Fixture check deliberately exits with failure", failureClass: "VERIFICATION_FAILURE", evidenceRefs: ["sqlite-real-check"], settledBy: "A passing fixture check", nextSafeAction: "Correct the fixture command" });
      await runAdvance({ ...context, to: "CORRECTING" });
      assert.equal((await readWorkState(target, { taskId, packageRoot })).phase, "CORRECTING");
      await runTaskAbandon({ ...context, acknowledgeAbandonment: true });
      assert.equal(listClaims(db, taskId).every(claim => claim.reservation_state === "RELEASED"), true);
      const resumed = await runTaskResume(context);
      assert.equal(resumed.resumed, true);
      assert.equal(listClaims(db, taskId).every(claim => claim.reservation_state === "ACTIVE"), true);
      await runAdvance({ ...context, to: "VERIFYING" });
      const corrected = await runCheck({ ...context, id: "sqlite-corrected-check", requirement: "The fixture check passes", argv: [process.execPath, "-e", "process.exit(0)"] });
      assert.equal(corrected.check.status, "passed");
      const protocol = validateLedgerEvents(listEvents(db, taskId));
      assert.equal(protocol.valid, true);
      await runRecordCheck({ ...context, id: "sqlite-protocol-integrity", requirement: "Protocol integrity is preserved", kind: "manual-review", status: "passed", evidenceKind: "OBSERVED", result: "Shared canonical ledger validator returned valid after the correction cycle", provenance: "MANUAL_OBSERVATION" });
      const schemaTests = await runCheck({ ...context, id: "sqlite-schema-tests", requirement: "tests", argv: [process.execPath, "--test", path.join(packageRoot, "tests/schema-golden.test.js")] });
      assert.equal(schemaTests.check.status, "passed", JSON.stringify(schemaTests.execution));
      await runAdvance({ ...context, to: "REVIEWING" });
      const complete = await runComplete(context);
      assert.equal(complete.status, "VALID", JSON.stringify(complete));
      assert.equal((await readWorkState(target, { taskId, packageRoot })).phase, "COMPLETE");
      const attachmentPath = resolveAttestationBundlePath(target, taskId);
      assert.match(attachmentPath, /^\.forgeloop\/attachments\//);
      assert.equal(resolveAttestationBundlePath(target, taskId, taskAttestationBundlePath(taskId)), attachmentPath);
      assert.equal(resolveAttestationBundlePath(target, taskId, "custom/signature.json"), "custom/signature.json");
      await mkdir(path.dirname(path.join(target, attachmentPath)), { recursive: true });
      await writeFile(path.join(target, attachmentPath), JSON.stringify({ fixture: "external signature bytes" }));
      const bundle = await exportTaskBundle(target, taskId, packageRoot);
      assert.ok(bundle.artifacts.includes("events.ndjson"));
      assert.ok(bundle.artifacts.includes("attestations/statement.sigstore.json"));
      const exportedEvents = (await readFile(path.join(target, path.dirname(bundle.path), "events.ndjson"), "utf8")).trim().split("\n").map(JSON.parse);
      assert.deepEqual(exportedEvents, listEvents(db, taskId));
      assert.equal(listClaims(db, taskId).every(claim => claim.reservation_state === "RELEASED"), true);
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM task_artifacts WHERE kind = 'operationLease'").get().count, 0);
      assert.equal(validateLedgerEvents(listEvents(db, taskId)).valid, true);
    });
    await assert.rejects(readdir(path.join(target, ".forgeloop/task-state")), { code: "ENOENT" });
    await assert.rejects(readdir(path.join(target, ".forgeloop/sessions")), { code: "ENOENT" });
    const portableRoot = path.join(target, "portable-only");
    await mkdir(path.join(portableRoot, ".forgeloop"), { recursive: true });
    await cp(path.join(target, ".forgeloop/tasks"), path.join(portableRoot, ".forgeloop/tasks"), { recursive: true });
    const portable = await readTaskBundle(portableRoot, "sqlite-preflight", getPackageRoot());
    assert.equal(portable.artifacts.state.phase, "COMPLETE");
    assert.equal(portable.manifest.taskId, "sqlite-preflight");
    assert.equal(portable.manifest.schemaVersion, 2);
    await writeFile(path.join(portableRoot, ".forgeloop/tasks/sqlite-preflight/events.ndjson"), "tampered ledger\n");
    await assert.rejects(readTaskBundle(portableRoot, "sqlite-preflight", getPackageRoot()), { code: "E_BUNDLE_DIGEST_INVALID" });
  });
});

test("durable operation reservation excludes another runtime without holding a database writer", async () => {
  await project(async ({ target, db }) => {
    const taskId = "sqlite-reserved";
    await withOperationalStore({ db, target }, () => executeForgeLoopCommand({ command: "task-create", projectPath: target, input: { taskId, claims: [] } }));
    let announce, release;
    const ready = new Promise(resolve => { announce = resolve; });
    const finish = new Promise(resolve => { release = resolve; });
    const holder = withOperationalStore({ db, target }, async () => {
      const lease = await acquireTaskLock(target, taskId, "external-fixture");
      assert.equal(db.isTransaction, false);
      announce();
      try { await finish; } finally { await lease.release(); }
    });
    await ready;
    const other = openStorageDatabase(path.join(target, "state.sqlite"));
    try {
      await assert.rejects(withOperationalStore({ db: other, target }, () => withOperationalTransaction({ target, taskId, operation: "competing-mutation" }, () => assert.fail("reserved mutation must not execute"))), { code: "E_TASK_LOCKED" });
      // Another task can reserve the writer while the first operation waits.
      const unrelated = await withOperationalStore({ db: other, target }, () => executeForgeLoopCommand({ command: "task-create", projectPath: target, input: { taskId: "sqlite-unrelated", claims: [] } }));
      assert.equal(unrelated.ok, true, JSON.stringify(unrelated));
    } finally { other.close(); release(); await holder; }
    await withOperationalStore({ db, target }, async () => assert.equal(await readLockInfo(target, taskId), null));
    assert.equal((await readdir(target)).includes(".forgeloop"), false);
  });
});

test("stale SQLite reservation release compares identity and fails closed for malformed leases", async () => {
  await project(async ({ target, db }) => {
    const taskId = "sqlite-stale";
    await withOperationalStore({ db, target }, () => executeForgeLoopCommand({ command: "task-create", projectPath: target, input: { taskId, claims: [] } }));
    const stale = { lockId: "stale-lock", taskId, operation: "fixture", pid: process.pid, hostname: os.hostname(), processStartToken: "fixture-token", ownerInstanceId: "fixture-owner", acquiredAt: "2020-01-01T00:00:00.000Z", heartbeatAt: "2020-01-01T00:00:00.000Z", leaseMs: 300000 };
    putArtifact(db, { taskId, kind: "operationLease", payload: stale });
    await withOperationalStore({ db, target }, async () => {
      assert.equal((await releaseStaleTaskLockIfUnchanged(target, taskId, { ...stale, lockId: "other" })).reason, "LOCK_CHANGED");
      assert.equal((await releaseStaleTaskLockIfUnchanged(target, taskId, stale)).released, true);
    });
    putArtifact(db, { taskId, kind: "operationLease", payload: { taskId } });
    await withOperationalStore({ db, target }, async () => {
      const result = await forceUnlockTask(target, taskId, { staleOnly: true });
      assert.equal(result.unlocked, false);
      assert.equal(result.classification.status, "UNKNOWN");
      assert.equal((await forceUnlockTask(target, taskId)).unlocked, true);
    });
  });
});

for (const [label, claims, accepted] of [
  ["overlapping ancestor claims", [["src"], ["src/nested"]], 1],
  ["non-overlapping claims", [["src/a"], ["src/b"]], 2],
]) {
  test(`independent SQLite bootstrap workers preserve ${label}`, async () => {
    await project(async ({ target, db }) => {
      const barrier = createBarrier("bootstrap-reservation");
      const config = { mode: "bootstrap", target, databasePath: path.join(target, "state.sqlite"), barrierDir: barrier.dir };
      const workers = claims.map((scope, index) => spawnWorker({ ...config, workerId: String(index), taskId: `bootstrap-${index}`, claims: scope }));
      try {
        for (const [index, worker] of workers.entries()) await barrier.waitFor(`ready-${index}`, undefined, worker);
        barrier.signal("proceed");
        const outcomes = await Promise.all(workers.map(worker => worker.result()));
        assert.equal(outcomes.filter(outcome => outcome.result.ok).length, accepted, JSON.stringify(outcomes));
        for (const outcome of outcomes) {
          if (outcome.result.ok) {
            assert.equal(listEvents(db, outcome.result.taskId).length, 2);
            assert.equal(validateLedgerEvents(listEvents(db, outcome.result.taskId)).valid, true);
          } else {
            assert.equal(outcome.result.code, "E_TASK_SCOPE_CONFLICT", JSON.stringify(outcome));
            assert.equal(findTaskById(db, outcome.result.taskId), null);
          }
        }
      } finally {
        for (const worker of workers) await worker.kill();
        barrier.cleanup();
      }
    });
  });
}

test("streamed semantic decision discovery supersedes the latest unsuperseded native record", async () => {
  await project(async ({ target, db }) => {
    const taskId = "streamed-decisions";
    const packageRoot = getPackageRoot();
    await withOperationalStore({ db, target }, async () => {
      await executeForgeLoopCommand({ command: "task-create", projectPath: target, input: { taskId, claims: [] } });
      for (const [index, decisionId] of ["context-one", "context-two", "context-three"].entries()) {
        const result = await recordSemanticDecision({ target, packageRoot, taskId, decisionId,
          request: { decisionKind: "CONTEXT_PLAN", questionSetId: "context-v1", state: { objective: "streamed supersession" } }, provider: testSemanticProvider });
        if (index === 0) assert.equal(result.supersededEvent, null);
        else assert.equal(result.supersededEvent.details.decisionId, index === 1 ? "context-one" : "context-two");
      }
      assert.equal(listEvents(db, taskId).filter(event => event.event === "SEMANTIC_DECISION_SUPERSEDED").length, 2);
    });
  });
});

test("canonical action idempotency and single-decision approvals use the SQLite record store", async () => {
  await project(async ({ target, db }) => {
    const taskId = "sqlite-actions";
    const packageRoot = getPackageRoot();
    const context = { packageRoot, taskId };
    await withOperationalStore({ db, target }, async () => {
      await executeForgeLoopCommand({ command: "task-create", projectPath: target, input: { taskId, claims: [] } });
      const input = { actionId: "action-publish", effectClass: "EXTERNAL_PUBLICATION", capability: "repository.push", operation: "push branch", target: "origin/topic", idempotencyKey: "publish-once", requiredForCompletion: true, requirement: "publication", provenance: "HOST_REPORTED" };
      const proposed = await proposeAction(target, { ...context, input });
      assert.equal(proposed.action.state, "PROPOSED");
      const projected = await projectActionLedger({ target, ...context, actionId: input.actionId, artifact: proposed.action });
      assert.equal(projected.state, "PROPOSED");
      assert.equal(projected.actionFingerprint, proposed.action.actionFingerprint);
      assert.deepEqual(await detectOrphanActions(target, context), []);
      assert.equal((await proposeAction(target, { ...context, input })).idempotent, true);
      await assert.rejects(proposeAction(target, { ...context, input: { ...input, actionId: "action-other", target: "origin/other" } }), { code: "E_ACTION_IDEMPOTENCY_CONFLICT" });
      assert.equal((await findActionByIdempotencyKey(target, { ...context, idempotencyKey: input.idempotencyKey })).actionId, input.actionId);
      const plan = db.prepare("EXPLAIN QUERY PLAN SELECT * FROM actions WHERE task_id = ? AND idempotency_key = ?").all(taskId, input.idempotencyKey);
      assert.ok(plan.some(row => row.detail.includes("actions_idempotency_idx")), JSON.stringify(plan));
      const binding = { approvalId: "approval-publish", actionId: input.actionId, actionFingerprint: proposed.action.actionFingerprint, contractFingerprint: "a".repeat(64), taskRevision: 0, capability: input.capability };
      await requestApproval(target, { ...context, input: binding });
      const resolved = await resolveApproval(target, { ...context, approvalId: binding.approvalId, decision: "APPROVED", authorityKind: "CALLER_ACKNOWLEDGED" });
      assert.equal(resolved.status, "APPROVED");
      await assert.rejects(resolveApproval(target, { ...context, approvalId: binding.approvalId, decision: "REJECTED", authorityKind: "CALLER_ACKNOWLEDGED" }), { code: "E_APPROVAL_ALREADY_RESOLVED" });
      assert.equal((await listApprovals(target, context)).length, 1);
      const before = listEvents(db, taskId).length;
      db.prepare("UPDATE actions SET revision = 99 WHERE task_id = ?").run(taskId);
      await assert.rejects(readAction(target, { ...context, actionId: input.actionId }), { code: "E_STORAGE_PAYLOAD_MISMATCH" });
      assert.equal(listEvents(db, taskId).length, before);
      assert.equal(validateLedgerEvents(listEvents(db, taskId)).valid, true);
    });
    assert.equal((await readdir(target)).includes(".forgeloop"), false);
  });
});

for (const [operation, event] of [
  ["propose", "ACTION_PROPOSED"],
  ["request", "APPROVAL_REQUESTED"],
  ["resolve", "APPROVAL_RESOLVED"],
]) {
  test(`SQLite ${operation} rolls back its record and ledger when event publication fails`, async () => {
    await project(async ({ target, db }) => {
      const taskId = "atomic-action-approval";
      const context = { taskId, packageRoot: getPackageRoot() };
      await withOperationalStore({ db, target }, async () => {
        await executeForgeLoopCommand({ command: "task-create", projectPath: target, input: { taskId, claims: [] } });
        const input = { actionId: "action-publish", effectClass: "EXTERNAL_PUBLICATION", capability: "repository.push", operation: "push branch", target: "origin/topic", idempotencyKey: "atomic-publish", requiredForCompletion: true, requirement: "publication", provenance: "HOST_REPORTED" };
        const binding = operation === "propose" ? null : {
          approvalId: "approval-publish", actionId: input.actionId,
          actionFingerprint: (await proposeAction(target, { ...context, input })).action.actionFingerprint,
          contractFingerprint: "a".repeat(64), taskRevision: 0, capability: input.capability,
        };
        if (operation === "resolve") await requestApproval(target, { ...context, input: binding });
        const snapshot = () => ["tasks", "claims", "events", "actions", "approvals", "task_artifacts"]
          .map(table => db.prepare(`SELECT * FROM ${table} ORDER BY 1, 2`).all());
        const before = snapshot();
        db.exec(`CREATE TRIGGER action_approval_fault AFTER INSERT ON events WHEN NEW.event_type = '${event}' BEGIN SELECT RAISE(ABORT, 'SQLITE_ACTION_APPROVAL_FAULT'); END`);
        const invoke = () => operation === "propose" ? proposeAction(target, { ...context, input })
          : operation === "request" ? requestApproval(target, { ...context, input: binding })
            : resolveApproval(target, { ...context, approvalId: binding.approvalId, decision: "APPROVED", authorityKind: "CALLER_ACKNOWLEDGED" });
        await assert.rejects(invoke(), /SQLITE_ACTION_APPROVAL_FAULT/);
        assert.deepEqual(snapshot(), before);
        assert.equal(db.isTransaction, false);
        db.exec("DROP TRIGGER action_approval_fault");
        await invoke();
        assert.equal(listEvents(db, taskId).filter(item => item.event === event).length, 1);
        assert.equal(validateLedgerEvents(listEvents(db, taskId)).valid, true);
      });
      assert.equal((await readdir(target)).includes(".forgeloop"), false);
    });
  });
}
