import assert from "node:assert/strict";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { createHash } from "node:crypto";
import { buildDiagnosisProject, TEST_TASK_ID } from "./helpers/storage-fixtures.js";
import { taskStorageKey } from "../src/core/task-identity.js";
import { prepareMigrationCandidate, resumeMigrationCandidate, verifyMigrationCandidate } from "../src/storage/migration-candidate.js";
import { canonicalFingerprint } from "../src/core/artifacts.js";
import { withStorageMaintenance } from "../src/storage/maintenance.js";
import { captureLegacySource, inventoryLegacySource } from "../src/storage/migration-source.js";
import { executeForgeLoopCommand } from "../src/core/command-runtime.js";
import { openStorageDatabase } from "../src/storage/connection.js";
import { createCheck } from "../src/core/checks.js";
import { eventHash } from "../src/core/events.js";

test("candidate preparation validates a real lifecycle and preserves source/export/round-trip parity", async () => {
  const target = await buildDiagnosisProject({ legacy: true, unrelated: 2 });
  try {
    const before = await inventoryLegacySource(target);
    const prepared = await prepareMigrationCandidate(target, { destination: "retained", writersQuiesced: true });
    assert.equal(prepared.manifest.status, "PREPARED");
    assert.equal(prepared.manifest.publicationReady, false);
    assert.equal(prepared.manifest.logical.tables.tasks.count, 3);
    assert.ok(prepared.manifest.parity.filesCompared > 0);
    assert.equal(prepared.manifest.validation.taskCount, 3);
    assert.equal(prepared.manifest.taskInventory.records, 3);
    const inventory = (await readFile(path.join(prepared.path, "task-inventory.ndjson"), "utf8")).trim().split("\n").map(line => JSON.parse(line));
    assert.ok(inventory.every(task => task.head.hash && task.events > 0 && task.taskKey && task.stateFingerprint));
    assert.deepEqual(await inventoryLegacySource(target), before);
    await assert.rejects(readFile(path.join(target, ".forgeloop/state.sqlite")), { code: "ENOENT" });
    const verified = await verifyMigrationCandidate(target, "retained");
    assert.equal(verified.manifest.candidateSha256, prepared.manifest.candidateSha256);
    const inventoryPath = path.join(prepared.path, "task-inventory.ndjson");
    const manifestPath = path.join(prepared.path, "candidate-manifest.json");
    const inventoryBytes = await readFile(inventoryPath);
    const manifestBytes = await readFile(manifestPath);
    const substituted = Buffer.from(`${JSON.stringify({ ...inventory[0], taskId: "substituted-task" })}\n`);
    await writeFile(inventoryPath, substituted);
    const rebound = JSON.parse(manifestBytes);
    rebound.taskInventory.sha256 = createHash("sha256").update(substituted).digest("hex");
    rebound.taskInventory.records = 1;
    await writeFile(manifestPath, JSON.stringify(rebound));
    await assert.rejects(verifyMigrationCandidate(target, "retained"), error => error.code === "E_STORAGE_MIGRATION_PARITY_INVALID" && error.message.includes("canonical tasks"));
    await writeFile(inventoryPath, inventoryBytes);
    await writeFile(manifestPath, manifestBytes);
    const sourceContract = path.join(target, ".forgeloop/task-state", taskStorageKey(TEST_TASK_ID), "contract.json");
    const original = await readFile(sourceContract);
    await writeFile(sourceContract, Buffer.concat([original, Buffer.from(" ")]));
    await assert.rejects(verifyMigrationCandidate(target, "retained"), error => error.code === "E_STORAGE_MIGRATION_PARITY_INVALID" && error.message.includes("legacy source changed"));
    await writeFile(sourceContract, original);
    const wal = `${prepared.candidatePath}-wal`;
    await writeFile(wal, Buffer.from([1, 2, 3]));
    await assert.rejects(verifyMigrationCandidate(target, "retained"), error => error.code === "E_STORAGE_MIGRATION_PARITY_INVALID" && error.message.includes("unshipped WAL"));
    await rm(wal);
    await verifyMigrationCandidate(target, "retained");
    const status = await executeForgeLoopCommand({ command: "storage-migration-status", projectPath: target, input: {} });
    assert.equal(status.result.layout, "FILESYSTEM");
    assert.equal(status.result.maintenance.status, "NONE");
    // A physically valid page-level database can still violate canonical parity.
    const changed = openStorageDatabase(prepared.candidatePath);
    changed.prepare("UPDATE tasks SET revision = revision + 1").run();
    changed.close();
    await assert.rejects(verifyMigrationCandidate(target, "retained"), { code: "E_STORAGE_MIGRATION_PARITY_INVALID" });
  } finally { await rm(target, { recursive: true, force: true }); }
});

test("candidate preparation rejects schema-invalid optional records and retains diagnostics and exclusion", async () => {
  const target = await buildDiagnosisProject({ legacy: true });
  try {
    const filename = path.join(target, ".forgeloop/task-state", taskStorageKey(TEST_TASK_ID), "usage.json");
    await writeFile(filename, JSON.stringify({ schemaVersion: 999, taskId: TEST_TASK_ID }));
    const sourceBytes = await readFile(filename);
    await assert.rejects(prepareMigrationCandidate(target, { destination: "retained", writersQuiesced: true }), /usage/u);
    const manifest = JSON.parse(await readFile(path.join(target, "retained/candidate-manifest.json"), "utf8"));
    assert.equal(manifest.status, "FAILED");
    assert.equal(manifest.publicationReady, false);
    assert.deepEqual(await readFile(filename), sourceBytes);
    const status = await executeForgeLoopCommand({ command: "storage-migration-status", projectPath: target, input: {} });
    assert.equal(status.result.maintenance.status, "RETAINED");
    await assert.rejects(verifyMigrationCandidate(target, "retained"), { code: "E_STORAGE_MIGRATION_PARITY_INVALID" });
  } finally { await rm(target, { recursive: true, force: true }); }
});

test("candidate preparation refuses unmapped source artifacts and does not claim attachment references verified", async () => {
  const target = await buildDiagnosisProject({ legacy: true });
  const unmapped = await buildDiagnosisProject({ legacy: true });
  try {
    await mkdir(path.join(target, ".forgeloop/attachments"));
    await writeFile(path.join(target, ".forgeloop/attachments/raw.bin"), Buffer.from([0, 255, 128]));
    const prepared = await prepareMigrationCandidate(target, { destination: "retained", writersQuiesced: true });
    assert.equal(prepared.manifest.parity.externalAttachments.length, 1);
    assert.equal(prepared.manifest.parity.attachmentReferenceValidation, "NOT_VERIFIED");
    assert.equal(prepared.manifest.publicationReady, false);
    await writeFile(path.join(unmapped, ".forgeloop/task-state", taskStorageKey(TEST_TASK_ID), "unknown-operational.json"), "{}");
    await assert.rejects(prepareMigrationCandidate(unmapped, { destination: "retained", writersQuiesced: true }), { code: "E_STORAGE_MIGRATION_UNMAPPED_SOURCE" });
  } finally {
    await rm(target, { recursive: true, force: true });
    await rm(unmapped, { recursive: true, force: true });
  }
});

test("candidate validation refuses owned command evidence whose execution reference is missing", async () => {
  const target = await buildDiagnosisProject({ legacy: true });
  try {
    const filename = path.join(target, ".forgeloop/task-state", taskStorageKey(TEST_TASK_ID), "work-state.json");
    const state = JSON.parse(await readFile(filename, "utf8"));
    state.checks = [createCheck({ id: "missing-owned-execution", kind: "command", requirement: "tests", source: "node test.js", status: "failed", evidenceKind: "OBSERVED", provenance: "FORGELOOP_EXECUTED", executionRef: "missing-execution" })];
    await writeFile(filename, JSON.stringify(state));
    await assert.rejects(prepareMigrationCandidate(target, { destination: "retained", writersQuiesced: true }), { code: "E_EXECUTION_REF_INVALID" });
    assert.equal(JSON.parse(await readFile(path.join(target, "retained/candidate-manifest.json"), "utf8")).status, "FAILED");
  } finally { await rm(target, { recursive: true, force: true }); }
});

test("source parity refuses invalid UTF-8 even when decoded event hashes validate", async () => {
  const target = await buildDiagnosisProject({ legacy: true });
  try {
    const filename = path.join(target, ".forgeloop/task-state", taskStorageKey(TEST_TASK_ID), "events.ndjson");
    const original = await readFile(filename);
    const head = JSON.parse(original.toString("utf8").trim().split("\n").at(-1));
    const event = { schemaVersion: 1, protocolVersion: 1, taskId: TEST_TASK_ID, seq: head.seq + 1, event: "TASK_RECEIVED", at: head.at, previousHash: head.hash, details: { message: "\uFFFD" } };
    event.hash = eventHash(event);
    const line = Buffer.from(`${JSON.stringify(event)}\n`);
    const marker = line.indexOf(Buffer.from("\uFFFD"));
    assert.ok(marker > 0);
    const invalidBytes = Buffer.concat([original, line.subarray(0, marker), Buffer.from([255]), line.subarray(marker + 3)]);
    await writeFile(filename, invalidBytes);
    await assert.rejects(prepareMigrationCandidate(target, { destination: "retained", writersQuiesced: true }), /UTF|encoding/iu);
    assert.deepEqual(await readFile(filename), invalidBytes);
  } finally { await rm(target, { recursive: true, force: true }); }
});

test("an empty orphan namespace survives capture and aborts candidate import", async () => {
  const target = await buildDiagnosisProject({ legacy: true });
  try {
    await mkdir(path.join(target, ".forgeloop/task-state", "0".repeat(64)));
    await assert.rejects(prepareMigrationCandidate(target, { destination: "retained", writersQuiesced: true }), error =>
      error.code === "E_STORAGE_IMPORT_ABORTED" && error.report.errors.some(issue => issue.code === "E_TASK_DESCRIPTOR_INVALID"));
    const failed = JSON.parse(await readFile(path.join(target, "retained/candidate-manifest.json"), "utf8"));
    assert.equal(failed.status, "FAILED");
    assert.ok(failed.error.report.errors.some(issue => issue.code === "E_TASK_DESCRIPTOR_INVALID"));
  } finally { await rm(target, { recursive: true, force: true }); }
});

test("candidate import refuses empty unknown namespaces and stray task-root files", async () => {
  for (const directory of [true, false]) {
    const target = await buildDiagnosisProject({ legacy: true });
    try {
      const entry = path.join(target, ".forgeloop/task-state", directory ? "unknown-namespace" : "stray.json");
      if (directory) await mkdir(entry);
      else await writeFile(entry, "{}");
      await assert.rejects(prepareMigrationCandidate(target, { destination: "retained", writersQuiesced: true }), error =>
        error.code === "E_STORAGE_IMPORT_ABORTED" && error.report.errors.some(issue => issue.code === "E_STORAGE_IMPORT_NAMESPACE_INVALID"));
      const manifest = JSON.parse(await readFile(path.join(target, "retained/candidate-manifest.json"), "utf8"));
      assert.equal(manifest.status, "FAILED");
      assert.ok(manifest.error.report.errors.some(issue => issue.code === "E_STORAGE_IMPORT_NAMESPACE_INVALID"));
      const rejected = openStorageDatabase(path.join(target, "retained/candidate.sqlite"), { readOnly: true });
      try {
        assert.equal(rejected.prepare("SELECT COUNT(*) AS count FROM tasks").get().count, 0);
        assert.equal(rejected.prepare("SELECT COUNT(*) AS count FROM events").get().count, 0);
      } finally { rejected.close(); }
      if (!directory) assert.equal(await readFile(entry, "utf8"), "{}");
    } finally { await rm(target, { recursive: true, force: true }); }
  }
});

test("candidate recovery refuses unbound files, changed fingerprints and staging without replacing evidence", async () => {
  const target = await buildDiagnosisProject({ legacy: true });
  try {
    const captured = await captureLegacySource(target, "retained", { writersQuiesced: true });
    const filename = path.join(captured.path, "candidate.sqlite");
    const raw = Buffer.from([0, 255, 128, 13, 10]);
    const resume = () => withStorageMaintenance(target, () => resumeMigrationCandidate(target, "retained", { writersQuiesced: true }));
    const attachment = path.join(captured.path, "candidate-attachments/.forgeloop/attachments/objects/.publishing-unbound/bytes");
    await mkdir(path.dirname(attachment), { recursive: true });
    await writeFile(attachment, raw);
    await assert.rejects(resume(), error => error.message.includes("without a preparation identity"));
    assert.deepEqual(await readFile(attachment), raw);
    await writeFile(filename, raw);
    await assert.rejects(resume(), error => error.message.includes("without a preparation identity"));
    const manifestPath = path.join(captured.path, "candidate-manifest.json");
    const manifest = { schemaVersion: 2, status: "PREPARING", publicationReady: false, sourceInventoryFingerprint: "0".repeat(64) };
    await writeFile(manifestPath, JSON.stringify(manifest));
    await assert.rejects(resume(), error => error.message.includes("source bindings"));
    manifest.sourceInventoryFingerprint = canonicalFingerprint({ files: captured.manifest.files, directories: captured.manifest.directories });
    await writeFile(manifestPath, JSON.stringify(manifest));
    await mkdir(path.join(captured.path, "publication"));
    await assert.rejects(resume(), error => error.message.includes("forbidden after staging"));
    assert.deepEqual(await readFile(filename), raw);
    assert.deepEqual(await readFile(attachment), raw);
    await assert.rejects(stat(path.join(captured.path, "candidate-history")), { code: "ENOENT" });
  } finally { await rm(target, { recursive: true, force: true }); }
});
