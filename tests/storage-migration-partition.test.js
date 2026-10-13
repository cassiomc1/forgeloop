import { removeTempTree } from "./helpers/rm-safe.js";
import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, readFile, rm, rename, writeFile, cp } from "node:fs/promises";
import path from "node:path";
import { buildDiagnosisProject, TEST_TASK_ID } from "./helpers/storage-fixtures.js";
import { taskStorageKey } from "../src/core/task-identity.js";
import { captureLegacySource } from "../src/storage/migration-source.js";
import { inspectMigrationSourcePartition } from "../src/storage/migration-source-partition.js";
import { publishAttachmentFile } from "../src/storage/attachment-files.js";
import { Readable } from "node:stream";

test("source partition inspection derives interrupted archival location and refuses duplicated or changed roots", async () => {
  const target = await buildDiagnosisProject({ legacy: true });
  try {
    await captureLegacySource(target, "retained", { writersQuiesced: true });
    const initial = await inspectMigrationSourcePartition(target, "retained");
    assert.equal(initial.roots.find(root => root.path === ".forgeloop/task-state").location, "ACTIVE");
    const archive = path.join(target, "retained/publication/legacy-archive");
    await mkdir(path.join(archive, ".forgeloop"), { recursive: true });
    const active = path.join(target, ".forgeloop/task-state");
    const archived = path.join(archive, ".forgeloop/task-state");
    await rename(active, archived);
    // No journal update: actual intact bytes prove that the rename happened.
    const interrupted = await inspectMigrationSourcePartition(target, "retained");
    assert.equal(interrupted.roots.find(root => root.path === ".forgeloop/task-state").location, "ARCHIVED");
    assert.equal(interrupted.sourceInventoryFingerprint, initial.sourceInventoryFingerprint);
    await writeFile(path.join(archive, "unmapped-root-file"), "unexpected");
    await assert.rejects(inspectMigrationSourcePartition(target, "retained"), { code: "E_STORAGE_MIGRATION_ARCHIVE_INVALID" });
    await rm(path.join(archive, "unmapped-root-file"));
    const descriptor = path.join(archived, taskStorageKey(TEST_TASK_ID), "task.json");
    const descriptorBytes = await readFile(descriptor);
    await writeFile(descriptor, Buffer.concat([descriptorBytes, Buffer.from(" ")]));
    await assert.rejects(inspectMigrationSourcePartition(target, "retained"), { code: "E_STORAGE_MIGRATION_ARCHIVE_INVALID" });
    await writeFile(descriptor, descriptorBytes);
    await cp(archived, active, { recursive: true });
    await assert.rejects(inspectMigrationSourcePartition(target, "retained"), error => error.code === "E_STORAGE_MIGRATION_ARCHIVE_INVALID" && error.message.includes("both"));
    await rm(active, { recursive: true });
    await mkdir(path.join(archived, "unexpected-empty-directory"));
    await assert.rejects(inspectMigrationSourcePartition(target, "retained"), { code: "E_STORAGE_MIGRATION_ARCHIVE_INVALID" });
    await rm(path.join(archived, "unexpected-empty-directory"), { recursive: true });
    await writeFile(path.join(archived, "extra.json"), "{}");
    await assert.rejects(inspectMigrationSourcePartition(target, "retained"), { code: "E_STORAGE_MIGRATION_ARCHIVE_INVALID" });
    await rm(path.join(archived, "extra.json"));
    await rm(archived, { recursive: true });
    await assert.rejects(inspectMigrationSourcePartition(target, "retained"), { code: "E_STORAGE_MIGRATION_ARCHIVE_INVALID" });
  } finally { await removeTempTree(target); }
});

test("empty captured roots remain distinguishable from missing and duplicated roots", async () => {
  const target = await buildDiagnosisProject({ legacy: true });
  try {
    await mkdir(path.join(target, ".forgeloop/attachments"));
    await captureLegacySource(target, "retained", { writersQuiesced: true });
    const active = path.join(target, ".forgeloop/attachments");
    const archive = path.join(target, "retained/publication/legacy-archive/.forgeloop");
    await mkdir(archive, { recursive: true });
    await rename(active, path.join(archive, "attachments"));
    const partition = await inspectMigrationSourcePartition(target, "retained");
    assert.equal(partition.roots.find(root => root.path === ".forgeloop/attachments").location, "ARCHIVED");
    await mkdir(active);
    await assert.rejects(inspectMigrationSourcePartition(target, "retained"), { code: "E_STORAGE_MIGRATION_ARCHIVE_INVALID" });
  } finally { await removeTempTree(target); }
});

test("published attachment growth preserves captured bytes and refuses unmanaged additions", async () => {
  const target = await buildDiagnosisProject({ legacy: true });
  try {
    await mkdir(path.join(target, ".forgeloop/attachments"));
    const capturedFile = path.join(target, ".forgeloop/attachments/original.bin");
    await writeFile(capturedFile, "original bytes");
    await captureLegacySource(target, "retained", { writersQuiesced: true });
    const original = await inspectMigrationSourcePartition(target, "retained");
    await publishAttachmentFile(target, Readable.from(["new bytes"]));
    await assert.rejects(inspectMigrationSourcePartition(target, "retained"), { code: "E_STORAGE_MIGRATION_ARCHIVE_INVALID" });
    const growth = await inspectMigrationSourcePartition(target, "retained", { allowAttachmentGrowth: true });
    assert.equal(growth.sourceInventoryFingerprint, original.sourceInventoryFingerprint);
    await writeFile(capturedFile, "substituted");
    await assert.rejects(inspectMigrationSourcePartition(target, "retained", { allowAttachmentGrowth: true }), { code: "E_STORAGE_MIGRATION_ARCHIVE_INVALID" });
    await writeFile(capturedFile, "original bytes");
    const unmanaged = path.join(target, ".forgeloop/attachments/unmanaged.bin");
    await writeFile(unmanaged, "unmanaged");
    await assert.rejects(inspectMigrationSourcePartition(target, "retained", { allowAttachmentGrowth: true }), { code: "E_STORAGE_MIGRATION_ARCHIVE_INVALID" });
  } finally { await removeTempTree(target); }
});
