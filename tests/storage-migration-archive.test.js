import { removeTempTree } from "./helpers/rm-safe.js";
import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, readFile, rename } from "node:fs/promises";
import path from "node:path";
import { buildDiagnosisProject } from "./helpers/storage-fixtures.js";
import { prepareMigrationCandidate } from "../src/storage/migration-candidate.js";
import { stageMigrationPublication, verifyMigrationPublicationStage } from "../src/storage/migration-publication.js";
import { archiveMigrationSources } from "../src/storage/migration-archive.js";
import { withStorageMaintenance } from "../src/storage/maintenance.js";
import { executeForgeLoopCommand } from "../src/core/command-runtime.js";

test("owner-bound archival recognizes a rename before journal update and retains exclusion until activation", async () => {
  const target = await buildDiagnosisProject({ legacy: true });
  try {
    await prepareMigrationCandidate(target, { destination: "retained", writersQuiesced: true });
    const staged = await stageMigrationPublication(target, "retained", { writersQuiesced: true });
    await assert.rejects(archiveMigrationSources(target, "retained", { writersQuiesced: true }), { code: "E_STORAGE_MAINTENANCE_IN_PROGRESS" });
    const stop = new Error("Activation remains unfinished; retain exclusion");
    await assert.rejects(withStorageMaintenance(target, async () => {
      const archiveParent = path.join(staged.path, "legacy-archive/.forgeloop");
      await mkdir(archiveParent, { recursive: true });
      await rename(path.join(target, ".forgeloop/task-state"), path.join(archiveParent, "task-state"));
      const archived = await archiveMigrationSources(target, "retained", { writersQuiesced: true });
      assert.equal(archived.journal.phase, "ARCHIVED");
      assert.equal(archived.journal.publicationReady, false);
      assert.equal(archived.partition.roots.some(root => root.path !== ".forgeloop/attachments" && root.location === "ACTIVE"), false);
      assert.equal((await archiveMigrationSources(target, "retained", { writersQuiesced: true })).journal.phase, "ARCHIVED");
      await verifyMigrationPublicationStage(target, "retained", { sourcePartition: true });
      throw stop;
    }, { retainOnError: true }), error => error === stop);
    const excluded = await executeForgeLoopCommand({ command: "task-list", projectPath: target, input: {} });
    assert.equal(excluded.error.code, "E_STORAGE_MAINTENANCE_IN_PROGRESS");
    await assert.rejects(readFile(path.join(target, ".forgeloop/state.sqlite")), { code: "ENOENT" });
    assert.equal(JSON.parse(await readFile(path.join(staged.path, "publication-journal.json"), "utf8")).phase, "ARCHIVED");
    // Retained source remains independently valid after the active roots moved.
    await verifyMigrationPublicationStage(target, "retained", { sourcePartition: true });
  } finally { await removeTempTree(target); }
});
