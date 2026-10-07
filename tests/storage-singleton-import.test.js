import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createContract, contractFingerprint } from "../src/core/contract.js";
import { createWorkState } from "../src/core/work-state.js";
import { readSingletonImportSource, importSingletonSource } from "../src/storage/singleton-import.js";
import { openStorageDatabase, findTaskById } from "../src/storage/index.js";
import { inventoryLegacySource } from "../src/storage/migration-source.js";
import { importProjectState } from "../src/storage/importer.js";
import { prepareMigrationCandidate, verifyMigrationCandidate } from "../src/storage/migration-candidate.js";
import { migrateProjectStorage } from "../src/storage/migration.js";
import { readStorageVersionMarker } from "../src/storage/storage-marker.js";
import { eventHash } from "../src/core/events.js";
import { listEvents, findArtifact, findExecutionById } from "../src/storage/repository.js";

test("singleton candidate preserves state, ordered ledger hashes and gate identity and refuses corruption", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "singleton-ledger-"));
  try {
    const taskId = "singleton-ledger";
    const contract = createContract({ taskId, objective: "Preserve legacy evidence", deliverables: ["src/index.js"], constraints: ["none"], risks: [], verification: ["tests"], successCriteria: ["pass"], stopConditions: ["error"], unresolvedDecisions: [], sourceRefs: [] });
    const state = createWorkState({ taskId, contractFingerprint: contractFingerprint(contract), repositoryFingerprint: { branch: null, head: null }, phase: "PLANNED", completedSteps: [], pendingSteps: [], checks: [], failures: [], blockers: [] });
    const events = [];
    for (const event of ["TASK_RECEIVED", "CONTRACT_VALIDATED"]) {
      const value = { seq: events.length + 1, schemaVersion: 1, protocolVersion: 1, taskId, event, at: "2026-09-11T00:00:00.000Z", previousHash: events.at(-1)?.hash ?? null };
      value.hash = eventHash(value);
      events.push(value);
    }
    const gate = { schemaVersion: 1, protocolVersion: 1, taskId, gate: "security", status: "unverified", requiredBy: [], artifacts: [], decisions: [], unknowns: [], approvedAssumptions: [], evidence: [] };
    const execution = { schemaVersion: 1, protocolVersion: 1, executionId: "exec-retained", taskId, checkId: "retained-check", requirement: "tests", verificationCycle: 1, kind: "COMMAND_EXECUTION", argv: ["node", "--version"], cwd: target, resolution: { resolutionMode: "local", mayInstall: false, installer: null, tool: null }, startedAt: "2026-09-11T00:00:00.000Z", finishedAt: "2026-09-11T00:00:01.000Z", status: "passed", exitCode: 0 };
    await mkdir(path.join(target, ".forgeloop/gates"), { recursive: true });
    await mkdir(path.join(target, ".forgeloop/executions"));
    await writeFile(path.join(target, ".forgeloop/executions/exec-retained.json"), JSON.stringify(execution) + "\n");
    for (const [filename, value] of [["current-contract.json", contract], ["work-state.json", state], ["gates/security.json", gate]]) await writeFile(path.join(target, ".forgeloop", filename), JSON.stringify(value) + "\n");
    const ledger = events.map(value => JSON.stringify(value) + "\n").join("");
    await writeFile(path.join(target, ".forgeloop/events.ndjson"), ledger);
    const before = await inventoryLegacySource(target);
    const imported = await importProjectState(target, path.join(target, "candidate.sqlite"), { convertSingleton: true });
    try {
      assert.deepEqual(findTaskById(imported.db, taskId).state, state);
      assert.deepEqual(listEvents(imported.db, taskId), events);
      assert.deepEqual(findArtifact(imported.db, taskId, "gate", "security"), gate);
      assert.deepEqual(findExecutionById(imported.db, taskId, execution.executionId), execution);
    } finally { imported.db.close(); }
    await prepareMigrationCandidate(target, { destination: "retained", writersQuiesced: true });
    await verifyMigrationCandidate(target, "retained");
    assert.deepEqual(await inventoryLegacySource(target), before);
    const corrupted = events.map(value => ({ ...value }));
    corrupted[1].previousHash = "f".repeat(64);
    await writeFile(path.join(target, ".forgeloop/events.ndjson"), corrupted.map(value => JSON.stringify(value) + "\n").join(""));
    const invalidSource = await inventoryLegacySource(target);
    await assert.rejects(importProjectState(target, path.join(target, "refused.sqlite"), { convertSingleton: true }), { code: "E_TASK_MIGRATION_INVALID" });
    await assert.rejects(stat(path.join(target, "refused.sqlite")), { code: "ENOENT" });
    assert.deepEqual(await inventoryLegacySource(target), invalidSource);
    await writeFile(path.join(target, ".forgeloop/events.ndjson"), ledger);
    await writeFile(path.join(target, ".forgeloop/executions/exec-retained.json"), JSON.stringify({ ...execution, executionId: "foreign-execution" }));
    const mismatchedExecution = await inventoryLegacySource(target);
    await assert.rejects(importProjectState(target, path.join(target, "identity-refused.sqlite"), { convertSingleton: true }), { code: "E_STORAGE_PAYLOAD_MISMATCH" });
    await assert.rejects(stat(path.join(target, "identity-refused.sqlite")), { code: "ENOENT" });
    assert.deepEqual(await inventoryLegacySource(target), mismatchedExecution);
  } finally { await rm(target, { recursive: true, force: true }); }
});

test("singleton conversion imports directly into an unpublished SQLite transaction and preserves source", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "singleton-import-"));
  let db;
  try {
    await mkdir(path.join(target, ".forgeloop"));
    const contract = createContract({ taskId: "singleton-direct", objective: "Convert", deliverables: ["src/index.js"], constraints: ["none"], risks: ["low"], verification: ["tests"], successCriteria: ["pass"], stopConditions: ["error"], unresolvedDecisions: [], sourceRefs: ["src"] });
    const text = JSON.stringify(contract, null, 2) + "\n";
    await writeFile(path.join(target, ".forgeloop/current-contract.json"), text);
    const before = await inventoryLegacySource(target);
    const source = await readSingletonImportSource(target);
    db = openStorageDatabase(path.join(target, "candidate.sqlite"));
    assert.throws(() => importSingletonSource(db, source), { code: "E_STORAGE_TRANSACTION_INVALID" });
    db.exec("BEGIN IMMEDIATE");
    const result = importSingletonSource(db, source);
    assert.equal(result.taskId, contract.taskId);
    assert.equal(findTaskById(db, contract.taskId).descriptor.taskId, contract.taskId);
    const artifact = db.prepare("SELECT payload_json, source_json FROM task_artifacts WHERE task_id = ? AND kind = 'contract'").get(contract.taskId);
    assert.deepEqual(JSON.parse(artifact.payload_json), contract);
    assert.equal(artifact.source_json, text);
    assert.throws(() => importSingletonSource(db, source), { code: "E_STORAGE_IMPORT_IDENTITY_COLLISION" });
    db.exec("ROLLBACK");
    assert.equal(findTaskById(db, contract.taskId), null);
    assert.deepEqual(await inventoryLegacySource(target), before);
    const imported = await importProjectState(target, path.join(target, "explicit.sqlite"), { convertSingleton: true });
    try { assert.equal(imported.report.totals.tasks, 1); }
    finally { imported.db.close(); }
    const candidate = await prepareMigrationCandidate(target, { destination: "retained", writersQuiesced: true });
    assert.ok(candidate);
    const verified = await verifyMigrationCandidate(target, "retained");
    assert.ok(verified);
    assert.deepEqual(await inventoryLegacySource(target), before);
    const foreignState = createWorkState({ taskId: "foreign-singleton", contractFingerprint: "0".repeat(64), repositoryFingerprint: { branch: null, head: null }, phase: "PLANNED", completedSteps: [], pendingSteps: [], checks: [], failures: [], blockers: [] });
    await writeFile(path.join(target, ".forgeloop/work-state.json"), JSON.stringify(foreignState));
    const mismatched = await inventoryLegacySource(target);
    await assert.rejects(readSingletonImportSource(target), { code: "E_TASK_MIGRATION_IDENTITY_MISMATCH" });
    assert.deepEqual(await inventoryLegacySource(target), mismatched);
    assert.equal(findTaskById(db, contract.taskId), null);
    await rm(path.join(target, ".forgeloop/work-state.json"));
    const published = await migrateProjectStorage(target, { destination: "cutover", writersQuiesced: true });
    assert.ok(published);
    assert.equal((await readStorageVersionMarker(target)).phase, "ACTIVE");
    const active = openStorageDatabase(path.join(target, ".forgeloop/state.sqlite"));
    try { assert.equal(findTaskById(active, contract.taskId).descriptor.taskId, contract.taskId); }
    finally { active.close(); }
    assert.deepEqual(await inventoryLegacySource(target), []);
  } finally { db?.close(); await rm(target, { recursive: true, force: true }); }
});
