import { backupStorageDatabase } from "../../src/storage/backup.js";
import { activateStorageVersionMarker, readStorageVersionMarker } from "../../src/storage/storage-marker.js";
import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { openStorageDatabase } from "../../src/storage/connection.js";
import { iterateAttachmentReferences } from "../../src/storage/attachment-references.js";
import { publishAttachmentFile } from "../../src/storage/attachment-files.js";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { withStorageMaintenance } from "../../src/storage/maintenance.js";
import { readMaintenanceOwner } from "../../src/storage/maintenance-owner.js";
import { captureLegacySource } from "../../src/storage/migration-source.js";
import { canonicalFingerprint } from "../../src/core/artifacts.js";
import { prepareMigrationCandidate } from "../../src/storage/migration-candidate.js";
import { stageMigrationPublication } from "../../src/storage/migration-publication.js";
import { archiveMigrationSources } from "../../src/storage/migration-archive.js";
import { migrateProjectStorage } from "../../src/storage/migration.js";
import { executeForgeLoopCommand } from "../../src/core/command-runtime.js";

const [target, phase] = process.argv.slice(2);
if (phase === "PUBLISHED") {
  await migrateProjectStorage(target, { destination: "retained", writersQuiesced: true });
  const created = await executeForgeLoopCommand({ command: "task-create", projectPath: target, input: { taskId: "accepted-before-crash", claims: ["accepted-path"] } });
  if (!created.ok) throw new Error(JSON.stringify(created));
}
await withStorageMaintenance(target, async () => {
  const options = { writersQuiesced: true };
  if (["CAPTURING", "PARTIAL_SOURCE"].includes(phase)) {
    const captured = await captureLegacySource(target, "retained", options);
    captured.manifest.status = "CAPTURING";
    await writeFile(path.join(captured.path, "source-manifest.json"), JSON.stringify(captured.manifest));
    if (phase === "CAPTURING") await rm(captured.source, { recursive: true });
    else {
      const file = captured.manifest.files[0];
      const original = await readFile(path.join(captured.source, file.path));
      await writeFile(path.join(captured.path, "partial-source-expectation.json"), JSON.stringify({ path: file.path, bytes: [...original.subarray(0, 7)] }));
      await writeFile(path.join(captured.source, file.path), original.subarray(0, 7));
    }
  } else if (["CAPTURED", "PREPARING", "PARTIAL_CANDIDATE_MOVE"].includes(phase)) {
    const captured = await captureLegacySource(target, "retained", options);
    if (phase !== "CAPTURED") {
      const fingerprint = canonicalFingerprint({ files: captured.manifest.files, directories: captured.manifest.directories });
      const manifest = { schemaVersion: 2, status: "PREPARING", publicationReady: false, sourceInventoryFingerprint: fingerprint };
      await writeFile(path.join(captured.path, "candidate-manifest.json"), JSON.stringify(manifest));
      await writeFile(path.join(captured.path, "candidate.sqlite"), Buffer.from([0, 255, 128, 13, 10]));
      const partialAttachment = path.join(captured.path, "candidate-attachments/.forgeloop/attachments/objects/.publishing-interrupted/bytes");
      await mkdir(path.dirname(partialAttachment), { recursive: true });
      await writeFile(partialAttachment, Buffer.from([99, 0, 255, 128, 13, 10]));
      if (phase === "PARTIAL_CANDIDATE_MOVE") {
        const operationId = randomUUID();
        const intent = { schemaVersion: 1, kind: "CANDIDATE_RECOVERY", operationId, sourceInventoryFingerprint: fingerprint, files: ["candidate-manifest.json", "candidate.sqlite", "candidate-attachments"] };
        await writeFile(path.join(captured.path, "candidate-recovery.json"), JSON.stringify(intent));
        const attempt = path.join(captured.path, "candidate-history", operationId);
        await mkdir(attempt, { recursive: true });
        await rename(path.join(captured.path, "candidate-manifest.json"), path.join(attempt, "candidate-manifest.json"));
      }
    }
  } else if (phase !== "PUBLISHED") {
    const candidate = await prepareMigrationCandidate(target, { destination: "retained", ...options });
    if (["STAGING", "EMPTY_STAGE"].includes(phase)) {
      const directory = path.join(target, "retained/publication");
      await mkdir(directory);
      if (phase === "STAGING") {
        await writeFile(path.join(directory, "publication-journal.json"), JSON.stringify({ schemaVersion: 1, phase: "STAGING", publicationReady: false, operationId: randomUUID(), candidateSha256: candidate.manifest.candidateSha256, sourceInventoryFingerprint: candidate.manifest.sourceInventoryFingerprint }));
        await mkdir(path.join(directory, "bundle"));
        await writeFile(path.join(directory, "bundle/partial.sqlite"), Buffer.from([0, 255, 128, 13, 10]));
      }
    } else if (phase !== "PREPARED") {
      const staged = await stageMigrationPublication(target, "retained", options);
      if (phase !== "STAGED") await archiveMigrationSources(target, "retained", options);
      // Seed exact persisted interruption states in owned fixtures, then kill the owner.
      if (phase === "PARTIAL_ARCHIVING") {
        const archive=path.join(staged.path,"legacy-archive/.forgeloop");
        await rename(path.join(archive,"task-state"),path.join(target,".forgeloop/task-state"));
        await writeFile(path.join(staged.path,"publication-journal.json"),JSON.stringify({...JSON.parse(await readFile(path.join(staged.path,"publication-journal.json"),"utf8")),phase:"ARCHIVING",publicationReady:false}));
      }
      if (["DATABASE_PENDING_MARKER","ACTIVE_PENDING_JOURNAL"].includes(phase)) {
        const db=openStorageDatabase(path.join(staged.bundle,"state.sqlite"),{readOnly:true});
        try {await backupStorageDatabase(db,path.join(target,".forgeloop/state.sqlite"));} finally {db.close();}
        if (phase === "ACTIVE_PENDING_JOURNAL") {
          const marker=await readStorageVersionMarker(target);
          await activateStorageVersionMarker(target,marker);
        }
      }
      if (phase === "SIGNATURE_OBJECT") {
        const db = openStorageDatabase(path.join(staged.bundle, "state.sqlite"), { readOnly: true });
        try {
          const reference = iterateAttachmentReferences(db).next().value;
          if (!reference) throw new Error("Signature crash fixture requires a staged attachment");
          const temporaryRoot = path.join(staged.path, "activation-attachments");
          await mkdir(temporaryRoot);
          await publishAttachmentFile(target, createReadStream(path.join(staged.bundle, reference.path)), { db, temporaryRoot });
          await mkdir(path.join(temporaryRoot, ".publishing-interrupted"));
          await writeFile(path.join(temporaryRoot, ".publishing-interrupted/bytes"), Buffer.from([0, 255, 77]));
        } finally { db.close(); }
      }
    }
  }
  process.send({ ownerId: (await readMaintenanceOwner(target)).value.ownerId });
  await new Promise(() => { setInterval(() => {}, 1000); });
}, { retainOnError: true });
