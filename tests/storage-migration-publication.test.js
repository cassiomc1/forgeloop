import { removeTempTree } from "./helpers/rm-safe.js";
import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildDiagnosisProject } from "./helpers/storage-fixtures.js";
import { prepareMigrationCandidate } from "../src/storage/migration-candidate.js";
import { resumeMigrationPublicationStage, stageMigrationPublication, verifyMigrationPublicationStage } from "../src/storage/migration-publication.js";
import { openStorageDatabase } from "../src/storage/connection.js";
import { withStorageMaintenance } from "../src/storage/maintenance.js";
import { writePendingStorageVersionMarker } from "../src/storage/storage-marker.js";
import { inventoryLegacySource } from "../src/storage/migration-source.js";

test("publication staging retains a closed independent database and verifies canonical parity", async () => {
  const target = await buildDiagnosisProject({ legacy: true });
  try {
    const before = await inventoryLegacySource(target);
    const candidate = await prepareMigrationCandidate(target, { destination: "retained", writersQuiesced: true });
    const candidateBytes = await readFile(candidate.candidatePath);
    await assert.rejects(stageMigrationPublication(target, "retained"), { code: "E_STORAGE_MIGRATION_QUIESCENCE_REQUIRED" });
    const staged = await stageMigrationPublication(target, "retained", { writersQuiesced: true });
    assert.equal(staged.journal.phase, "STAGED");
    assert.equal(staged.journal.publicationReady, false);
    const databasePath = path.join(staged.bundle, "state.sqlite");
    assert.notEqual((await stat(databasePath)).ino, (await stat(candidate.candidatePath)).ino);
    assert.deepEqual(await readFile(candidate.candidatePath), candidateBytes);
    assert.deepEqual(await inventoryLegacySource(target), before);
    await assert.rejects(readFile(path.join(target, ".forgeloop/state.sqlite")), { code: "ENOENT" });
    await verifyMigrationPublicationStage(target, "retained");
    const journalPath = path.join(staged.path, "publication-journal.json");
    const journal = JSON.parse(await readFile(journalPath, "utf8"));
    for (const phase of ["STAGING", "ARCHIVED"]) {
      await writeFile(journalPath, JSON.stringify({ ...journal, phase }));
      await assert.rejects(verifyMigrationPublicationStage(target, "retained", { sourcePartition: true }), { code: "E_STORAGE_MIGRATION_PUBLICATION_INVALID" });
    }
    await writeFile(journalPath, JSON.stringify(journal));
    // Even rebound physical digests cannot authorize substituted canonical rows.
    const changed = openStorageDatabase(databasePath);
    changed.prepare("UPDATE tasks SET revision = revision + 1").run();
    changed.close();
    const manifestPath = path.join(staged.bundle, "backup-manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const digest = createHash("sha256").update(await readFile(databasePath)).digest("hex");
    await writeFile(manifestPath, JSON.stringify({ ...manifest, databaseSha256: digest }));
    await writeFile(journalPath, JSON.stringify({ ...journal, databaseSha256: digest }));
    await assert.rejects(verifyMigrationPublicationStage(target, "retained"), error => error.code === "E_STORAGE_MIGRATION_PUBLICATION_INVALID" && error.message.includes("canonical rows"));
  } finally { await removeTempTree(target); }
});

test("publication staging refuses unresolved attachment coverage before creating publication files", async () => {
  const target = await buildDiagnosisProject({ legacy: true });
  try {
    await mkdir(path.join(target, ".forgeloop/attachments"));
    await writeFile(path.join(target, ".forgeloop/attachments/unmapped.bin"), "retained bytes");
    await prepareMigrationCandidate(target, { destination: "retained", writersQuiesced: true });
    await assert.rejects(stageMigrationPublication(target, "retained", { writersQuiesced: true }), error => error.code === "E_STORAGE_MIGRATION_PUBLICATION_INVALID" && error.message.includes("Attachment reference coverage"));
    await assert.rejects(stat(path.join(target, "retained/publication")), { code: "ENOENT" });
    assert.equal(await readFile(path.join(target, ".forgeloop/attachments/unmapped.bin"), "utf8"), "retained bytes");
  } finally { await removeTempTree(target); }
});

test("interrupted stage rebuild refuses changed bindings and any active or pending publication", async () => {
  const target = await buildDiagnosisProject({ legacy: true });
  try {
    const candidate = await prepareMigrationCandidate(target, { destination: "retained", writersQuiesced: true });
    const staged = await stageMigrationPublication(target, "retained", { writersQuiesced: true });
    const journalPath = path.join(staged.path, "publication-journal.json");
    const failed = { ...staged.journal, phase: "FAILED", publicationReady: false };
    const bytes = await readFile(path.join(staged.bundle, "state.sqlite"));
    const resume = () => withStorageMaintenance(target, () => resumeMigrationPublicationStage(target, "retained", { writersQuiesced: true }));
    await writeFile(journalPath, JSON.stringify({ ...failed, candidateSha256: "0".repeat(64) }));
    await assert.rejects(resume(), error => error.code === "E_STORAGE_MIGRATION_PUBLICATION_INVALID" && error.message.includes("retained candidate"));
    await writeFile(journalPath, JSON.stringify(failed));
    const active = path.join(target, ".forgeloop/state.sqlite");
    await writeFile(active, "existing database bytes");
    await assert.rejects(resume(), error => error.code === "E_STORAGE_MIGRATION_PUBLICATION_INVALID" && error.message.includes("cannot be rebuilt"));
    assert.equal(await readFile(active, "utf8"), "existing database bytes");
    await rm(active);
    await withStorageMaintenance(target, () => writePendingStorageVersionMarker(target, { operationId: staged.journal.operationId, sourceInventoryFingerprint: candidate.manifest.sourceInventoryFingerprint, databaseSchemaVersion: candidate.manifest.metadata.schema_version }));
    await assert.rejects(resume(), error => error.code === "E_STORAGE_MIGRATION_PUBLICATION_INVALID" && error.message.includes("cannot be rebuilt"));
    assert.deepEqual(await readFile(path.join(staged.bundle, "state.sqlite")), bytes);
    await assert.rejects(stat(path.join(target, "retained/publication-history")), { code: "ENOENT" });
  } finally { await removeTempTree(target); }
});
