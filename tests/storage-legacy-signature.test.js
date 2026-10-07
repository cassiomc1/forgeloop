import { removeTempTree } from "./helpers/rm-safe.js";
import assert from "node:assert/strict";
import test from "node:test";
import { fork } from "node:child_process";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildDiagnosisProject, TEST_TASK_ID } from "./helpers/storage-fixtures.js";
import { importProjectState } from "../src/storage/importer.js";
import { openStorageDatabase } from "../src/storage/connection.js";
import { exportDatabase } from "../src/storage/exporter.js";
import { prepareLegacySignatureAttachment, prepareRecordedLegacySignatures } from "../src/storage/legacy-signature.js";
import { inventoryLegacySourceLayout } from "../src/storage/migration-source.js";
import { prepareMigrationCandidate, verifyMigrationCandidate } from "../src/storage/migration-candidate.js";
import { stageMigrationPublication, verifyMigrationPublicationStage } from "../src/storage/migration-publication.js";
import { archiveMigrationSources } from "../src/storage/migration-archive.js";
import { activateArchivedMigration } from "../src/storage/migration-activate.js";
import { withStorageMaintenance } from "../src/storage/maintenance.js";
import { publishAttachmentFile } from "../src/storage/attachment-files.js";
import { Readable } from "node:stream";
import { migrateProjectStorage, resumeProjectStorageMigration } from "../src/storage/migration.js";
import { insertVerifiedAttachmentReference } from "../src/storage/attachment-references.js";
import { runInTransaction } from "../src/storage/transaction.js";
import { putArtifact } from "../src/storage/repository.js";
import { withOperationalStore } from "../src/storage/unit-of-work.js";
import { withOperationalAttachmentFile } from "../src/storage/operational-attachments.js";
import { resolveAttestationBundlePath } from "../src/core/attachment-paths.js";
import { taskAttestationBundlePath, taskAttestationStatementPath, taskAttestationStatementHistoryPath } from "../src/core/task-paths.js";
import { taskStorageKey } from "../src/core/task-identity.js";

function inventory(relativePath, bytes) {
  return { path: relativePath, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
}

async function fixture(callback) {
  const target = await buildDiagnosisProject({ legacy: true });
  const output = await mkdtemp(path.join(os.tmpdir(), "forgeloop-legacy-signature-"));
  const { db } = await importProjectState(target, path.join(target, "state.sqlite"));
  try {
    const predicate = JSON.parse(await readFile(new URL("./fixtures/schemas/code-attestation/valid.json", import.meta.url)));
    predicate.task.taskId = TEST_TASK_ID;
    const value = { schemaVersion: 1, _type: "https://in-toto.io/Statement/v1", subject: [{ name: `forgeloop-task:${TEST_TASK_ID}`, digest: { sha256: predicate.content.contentDigest } }], predicateType: "https://forgeloop.dev/attestation/v1", predicate };
    const statementBytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
    const signatureBytes = Buffer.from([0, 255, 1, 13, 10, 128, 99]);
    const statement = inventory(taskAttestationStatementPath(TEST_TASK_ID), statementBytes);
    const signature = inventory(taskAttestationBundlePath(TEST_TASK_ID), signatureBytes);
    await mkdir(path.dirname(path.join(target, statement.path)), { recursive: true });
    await writeFile(path.join(target, statement.path), statementBytes);
    await writeFile(path.join(target, signature.path), signatureBytes);
    putArtifact(db, { taskId: TEST_TASK_ID, kind: "attestation", artifactId: "statement", payload: value, sourceText: statementBytes.toString("utf8") });
    await callback({ target, output, db, statement, signature, statementBytes, signatureBytes });
  } finally { db.close(); await removeTempTree(target); await removeTempTree(output); }
}

test("legacy signature preparation preserves source/ledger bytes and supplies immutable logical aliases", async () => {
  await fixture(async ({ target, output, db, statement, signature, statementBytes, signatureBytes }) => {
    const ledger = path.join(target, `.forgeloop/task-state/${taskStorageKey(TEST_TASK_ID)}/events.ndjson`);
    const before = await readFile(ledger);
    const prepared = await prepareLegacySignatureAttachment(target, output, { taskId: TEST_TASK_ID, statement, signature });
    assert.equal(prepared.references.length, 2);
    assert.deepEqual(await readFile(path.join(output, prepared.binding.path)), signatureBytes);
    assert.deepEqual(await readFile(path.join(target, statement.path)), statementBytes);
    assert.deepEqual(await readFile(path.join(target, signature.path)), signatureBytes);
    assert.deepEqual(await readFile(ledger), before);
    runInTransaction(db, () => { for (const reference of prepared.references) insertVerifiedAttachmentReference(db, reference); });
    await withOperationalStore({ db, target: output }, async () => {
      assert.equal(resolveAttestationBundlePath(output, TEST_TASK_ID), prepared.binding.path);
      const historical = resolveAttestationBundlePath(output, TEST_TASK_ID, signature.path);
      assert.equal(historical, prepared.binding.path);
      assert.deepEqual(await withOperationalAttachmentFile(output, historical, TEST_TASK_ID, filename => readFile(filename)), signatureBytes);
      assert.equal(resolveAttestationBundlePath(output, "another-task", signature.path), signature.path);
    });
  });
});

test("legacy signature preparation refuses inventory drift, missing bindings, source overlap and linked sources", async () => {
  await fixture(async ({ target, output, statement, signature, signatureBytes, statementBytes }) => {
    const options = { taskId: TEST_TASK_ID, statement, signature };
    await assert.rejects(prepareLegacySignatureAttachment(target, output, { ...options, signature: undefined }), { code: "E_STORAGE_ATTACHMENT_INVALID" });
    await assert.rejects(prepareLegacySignatureAttachment(target, output, { ...options, statement: { ...statement, size: 64 * 1024 * 1024 + 1 } }), { code: "E_STORAGE_ATTACHMENT_INVALID" });
    await assert.rejects(prepareLegacySignatureAttachment(target, output, { ...options, statement: { ...statement, sha256: "0".repeat(64) } }), { code: "E_STORAGE_ATTACHMENT_INVALID" });
    await assert.rejects(prepareLegacySignatureAttachment(target, output, { ...options, signature: { ...signature, sha256: "0".repeat(64) } }), { code: "E_STORAGE_ATTACHMENT_INVALID" });
    const wrongTask = JSON.parse(statementBytes);
    wrongTask.predicate.task.taskId = "another-task";
    wrongTask.subject[0].name = "forgeloop-task:another-task";
    const wrongBytes = Buffer.from(JSON.stringify(wrongTask));
    await writeFile(path.join(target, statement.path), wrongBytes);
    await assert.rejects(prepareLegacySignatureAttachment(target, output, { ...options, statement: inventory(statement.path, wrongBytes) }), { code: "E_STORAGE_ATTACHMENT_INVALID" });
    await writeFile(path.join(target, statement.path), statementBytes);
    await assert.rejects(prepareLegacySignatureAttachment(target, target, options), { code: "E_STORAGE_ATTACHMENT_INVALID" });
    const alias = path.join(output, "source-alias");
    await symlink(target, alias);
    await assert.rejects(prepareLegacySignatureAttachment(target, alias, options), { code: "E_STORAGE_ATTACHMENT_INVALID" });
    await writeFile(path.join(target, signature.path), Buffer.from([1, 2]));
    await assert.rejects(prepareLegacySignatureAttachment(target, output, options), { code: "E_STORAGE_ATTACHMENT_INVALID" });
    await rm(path.join(target, signature.path));
    const outside = path.join(output, "outside-signature");
    await writeFile(outside, signatureBytes);
    await symlink(outside, path.join(target, signature.path));
    await assert.rejects(prepareLegacySignatureAttachment(target, output, options));
  });
});

test("legacy signature import commits external bindings atomically and refuses unmapped or changed source", async () => {
  await fixture(async ({ target, output, statement, signature, signatureBytes }) => {
    const unmapped = path.join(output, "unmapped.sqlite");
    const rejectsImport = error => error.code === "E_STORAGE_IMPORT_ABORTED" && error.report.errors.some(value => value.code === "E_STORAGE_IMPORT_SIGNATURE_UNMAPPED");
    await assert.rejects(importProjectState(target, unmapped), rejectsImport);
    const assertEmpty = filename => {
      const candidate = openStorageDatabase(filename, { readOnly: true });
      try {
        for (const table of ["tasks", "events", "task_artifacts", "attachment_references"]) {
          assert.equal(candidate.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, 0);
        }
      } finally { candidate.close(); }
    };
    assertEmpty(unmapped);
    const prepared = await prepareLegacySignatureAttachment(target, output, { taskId: TEST_TASK_ID, statement, signature });
    const preparedAttachments = { root: output, references: prepared.references };
    const ledger = await readFile(path.join(target, `.forgeloop/task-state/${taskStorageKey(TEST_TASK_ID)}/events.ndjson`), "utf8");
    const imported = await importProjectState(target, path.join(output, "prepared.sqlite"), { preparedAttachments });
    try {
      assert.equal(imported.report.errors.length, 0);
      assert.equal(imported.db.prepare("SELECT COUNT(*) AS count FROM attachment_references").get().count, 2);
      assert.equal(imported.db.prepare("SELECT COUNT(*) AS count FROM task_artifacts WHERE kind = 'attestation' AND artifact_id = 'statement.sigstore'").get().count, 0);
      assert.deepEqual(imported.db.prepare("SELECT event_json FROM events ORDER BY seq").all().map(row => JSON.parse(row.event_json)), ledger.trim().split("\n").map(JSON.parse));
      await withOperationalStore({ db: imported.db, target: output }, async () => {
        const resolved = resolveAttestationBundlePath(output, TEST_TASK_ID, signature.path);
        assert.deepEqual(await withOperationalAttachmentFile(output, resolved, TEST_TASK_ID, filename => readFile(filename)), signatureBytes);
      });
      const portable = path.join(output, "portable");
      await exportDatabase(imported.db, portable, { attachmentRoot: output });
      assert.deepEqual(await readFile(path.join(portable, signature.path)), signatureBytes);
      const roundTrip = await importProjectState(portable, path.join(output, "round-trip.sqlite"));
      try {
        assert.deepEqual(roundTrip.db.prepare("SELECT * FROM attachment_references ORDER BY task_id, reference_id").all(), imported.db.prepare("SELECT * FROM attachment_references ORDER BY task_id, reference_id").all());
        await withOperationalStore({ db: roundTrip.db, target: portable }, async () => {
          const resolved = resolveAttestationBundlePath(portable, TEST_TASK_ID, signature.path);
          assert.deepEqual(await withOperationalAttachmentFile(portable, resolved, TEST_TASK_ID, filename => readFile(filename)), signatureBytes);
        });
      } finally { roundTrip.db.close(); }
      const mirrorDrift = Buffer.from(signatureBytes);
      mirrorDrift[0] = 77;
      await writeFile(path.join(portable, signature.path), mirrorDrift);
      const rejectedMirror = path.join(output, "rejected-mirror.sqlite");
      await assert.rejects(importProjectState(portable, rejectedMirror), rejectsImport);
      assertEmpty(rejectedMirror);
      const replacement = JSON.parse(await readFile(path.join(target, statement.path), "utf8"));
      replacement.predicate.task.verificationCycle = 2;
      putArtifact(imported.db, { taskId: TEST_TASK_ID, kind: "attestation", artifactId: "statement", payload: replacement });
      const changedPortable = path.join(output, "replacement-statement");
      await exportDatabase(imported.db, changedPortable, { attachmentRoot: output });
      await assert.rejects(readFile(path.join(changedPortable, signature.path)), { code: "ENOENT" });
      const changedRoundTrip = await importProjectState(changedPortable, path.join(output, "replacement-round-trip.sqlite"));
      try { assert.equal(changedRoundTrip.db.prepare("SELECT COUNT(*) AS count FROM attachment_references").get().count, 2); }
      finally { changedRoundTrip.db.close(); }
    } finally { imported.db.close(); }
    const incomplete = path.join(output, "incomplete.sqlite");
    await assert.rejects(importProjectState(target, incomplete, { preparedAttachments: { root: output, references: prepared.references.slice(0, 1) } }), rejectsImport);
    assertEmpty(incomplete);
    const changed = Buffer.from(signatureBytes);
    changed[0] = 77;
    await writeFile(path.join(target, signature.path), changed);
    const drifted = path.join(output, "drifted.sqlite");
    await assert.rejects(importProjectState(target, drifted, { preparedAttachments }), rejectsImport);
    assertEmpty(drifted);
    assert.deepEqual(await readFile(path.join(output, prepared.binding.path)), signatureBytes);
  });
});

test("recorded signature discovery binds current and historical cycles without scanning unrecorded files", async () => {
  await fixture(async ({ target, output, statement, signature, statementBytes, signatureBytes }) => {
    const historyPath = taskAttestationStatementHistoryPath(TEST_TASK_ID, 1);
    const historyBundle = historyPath.replace(/\.json$/u, ".sigstore.json");
    await mkdir(path.dirname(path.join(target, historyPath)), { recursive: true });
    await writeFile(path.join(target, historyPath), statementBytes);
    const historicalBytes = Buffer.from(signatureBytes);
    historicalBytes[0] = 123;
    await writeFile(path.join(target, historyBundle), historicalBytes);
    const current = JSON.parse(statementBytes);
    current.predicate.task.verificationCycle = 2;
    const currentBytes = Buffer.from(`${JSON.stringify(current, null, 2)}\n`);
    await writeFile(path.join(target, statement.path), currentBytes);
    const captured = await inventoryLegacySourceLayout(target);
    const prepared = await prepareRecordedLegacySignatures(target, output, captured.files);
    assert.equal(prepared.mappings.length, 2);
    assert.equal(prepared.references.length, 4);
    const imported = await importProjectState(target, path.join(output, "history.sqlite"), { preparedAttachments: prepared });
    try {
      await withOperationalStore({ db: imported.db, target: output }, async () => {
        const currentPath = resolveAttestationBundlePath(output, TEST_TASK_ID);
        const previousPath = resolveAttestationBundlePath(output, TEST_TASK_ID, historyBundle);
        assert.notEqual(currentPath, previousPath);
        assert.deepEqual(await withOperationalAttachmentFile(output, currentPath, TEST_TASK_ID, filename => readFile(filename)), signatureBytes);
        assert.deepEqual(await withOperationalAttachmentFile(output, previousPath, TEST_TASK_ID, filename => readFile(filename)), historicalBytes);
      });
      const portable = path.join(output, "historical-portable");
      await exportDatabase(imported.db, portable, { attachmentRoot: output });
      assert.deepEqual(await readFile(path.join(portable, signature.path)), signatureBytes);
      assert.deepEqual(await readFile(path.join(portable, historyBundle)), historicalBytes);
      const roundTrip = await importProjectState(portable, path.join(output, "historical-round-trip.sqlite"));
      try { assert.equal(roundTrip.db.prepare("SELECT COUNT(*) AS count FROM attachment_references").get().count, 4); }
      finally { roundTrip.db.close(); }
    } finally { imported.db.close(); }
    const descriptorPath = `.forgeloop/task-state/${taskStorageKey(TEST_TASK_ID)}/task.json`;
    await assert.rejects(prepareRecordedLegacySignatures(target, output, captured.files.filter(file => file.path !== descriptorPath)), { code: "E_STORAGE_ATTACHMENT_INVALID" });
    const descriptor = captured.files.find(file => file.path === descriptorPath);
    await assert.rejects(prepareRecordedLegacySignatures(target, output, [...captured.files, descriptor]), { code: "E_STORAGE_ATTACHMENT_INVALID" });
    await assert.rejects(prepareRecordedLegacySignatures(target, output, captured.files.map(file => file.path === descriptorPath ? { ...file, sha256: "0".repeat(64) } : file)), { code: "E_STORAGE_ATTACHMENT_INVALID" });
    const wrongHistory = taskAttestationStatementHistoryPath(TEST_TASK_ID, 2);
    const wrongBundle = wrongHistory.replace(/\.json$/u, ".sigstore.json");
    await mkdir(path.dirname(path.join(target, wrongHistory)), { recursive: true });
    await writeFile(path.join(target, wrongHistory), statementBytes);
    await writeFile(path.join(target, wrongBundle), historicalBytes);
    await assert.rejects(prepareLegacySignatureAttachment(target, output, { taskId: TEST_TASK_ID, verificationCycle: 2, statement: inventory(wrongHistory, statementBytes), signature: inventory(wrongBundle, historicalBytes) }), { code: "E_STORAGE_ATTACHMENT_INVALID" });
    const repeated = await prepareRecordedLegacySignatures(target, output, captured.files);
    assert.equal(repeated.mappings.length, 2);
    assert.equal(repeated.mappings.some(mapping => mapping.sourcePath === wrongBundle), false);
    assert.deepEqual(await readFile(path.join(target, statement.path)), currentBytes);
    assert.deepEqual(await readFile(path.join(target, signature.path)), signatureBytes);
    assert.deepEqual(await readFile(path.join(target, historyPath)), statementBytes);
    assert.deepEqual(await readFile(path.join(target, historyBundle)), historicalBytes);
  });
});

test("public candidate preparation reproduces signature roots and stages their verified binary objects", async () => {
  await fixture(async ({ target, signature, signatureBytes }) => {
    const candidate = await prepareMigrationCandidate(target, { destination: "retained", writersQuiesced: true });
    assert.equal(candidate.manifest.status, "PREPARED");
    assert.equal(candidate.manifest.attachmentPreparation.root, "candidate-attachments");
    assert.equal(candidate.manifest.attachmentPreparation.signatures, 1);
    assert.equal(candidate.manifest.attachmentPreparation.references, 2);
    assert.equal(candidate.manifest.parity.attachmentReferenceValidation, "VERIFIED");
    const verified = await verifyMigrationCandidate(target, "retained");
    assert.equal(verified.attachmentRoot, path.join(target, "retained/candidate-attachments"));
    const object = `.forgeloop/attachments/objects/${signature.sha256}`;
    assert.deepEqual(await readFile(path.join(verified.attachmentRoot, object)), signatureBytes);
    const stage = await stageMigrationPublication(target, "retained", { writersQuiesced: true });
    assert.deepEqual(await readFile(path.join(stage.bundle, object)), signatureBytes);
    assert.deepEqual(await readFile(path.join(target, signature.path)), signatureBytes);
    await assert.rejects(readFile(path.join(target, object)), { code: "ENOENT" });
    const unexpected = path.join(verified.attachmentRoot, ".forgeloop/attachments/objects/unrecorded-object");
    await writeFile(unexpected, "unrecorded private bytes");
    await assert.rejects(verifyMigrationCandidate(target, "retained"), { code: "E_STORAGE_ATTACHMENT_INVALID" });
    await rm(unexpected);
    await writeFile(path.join(verified.attachmentRoot, object), Buffer.alloc(signatureBytes.length));
    await assert.rejects(verifyMigrationCandidate(target, "retained"), { code: "E_STORAGE_ATTACHMENT_INVALID" });
    assert.deepEqual(await readFile(path.join(stage.bundle, object)), signatureBytes);
  });
});

test("public signature migration activates independent objects and preserves archived logical bytes", async () => {
  await fixture(async ({ target, signature, signatureBytes }) => {
    const result = await migrateProjectStorage(target, { destination: "retained", writersQuiesced: true });
    assert.equal(result.phase, "PUBLISHED");
    assert.equal(result.currentStateVerified, true);
    assert.equal(result.attachments, 2);
    const object = `.forgeloop/attachments/objects/${signature.sha256}`;
    assert.deepEqual(await readFile(path.join(target, object)), signatureBytes);
    assert.deepEqual(await readFile(path.join(target, "retained/publication/legacy-archive", signature.path)), signatureBytes);
    const active = openStorageDatabase(path.join(target, ".forgeloop/state.sqlite"), { readOnly: true });
    try {
      await withOperationalStore({ db: active, target }, async () => {
        const resolved = resolveAttestationBundlePath(target, TEST_TASK_ID, signature.path);
        assert.deepEqual(await withOperationalAttachmentFile(target, resolved, TEST_TASK_ID, filename => readFile(filename)), signatureBytes);
      });
    } finally { active.close(); }
    await writeFile(path.join(target, object), Buffer.alloc(signatureBytes.length));
    assert.deepEqual(await readFile(path.join(target, "retained/publication/bundle", object)), signatureBytes);
    assert.deepEqual(await readFile(path.join(target, "retained/candidate-attachments", object)), signatureBytes);
  });
});

test("pending signature publication accepts known objects, refuses unrelated growth and retains private partial bytes", async () => {
  await fixture(async ({ target, signature, signatureBytes }) => {
    await withStorageMaintenance(target, async () => {
      const options = { writersQuiesced: true };
      await prepareMigrationCandidate(target, { destination: "retained", ...options });
      const stage = await stageMigrationPublication(target, "retained", options);
      await archiveMigrationSources(target, "retained", options);
      const temporaryRoot = path.join(stage.path, "activation-attachments");
      await mkdir(temporaryRoot);
      const partial = path.join(temporaryRoot, ".publishing-interrupted/bytes");
      await mkdir(path.dirname(partial));
      await writeFile(partial, Buffer.from([0, 255, 77]));
      await publishAttachmentFile(target, Readable.from([signatureBytes]), { temporaryRoot });
      assert.equal((await verifyMigrationPublicationStage(target, "retained", { sourcePartition: true, allowPublished: true })).journal.phase, "ARCHIVED");
      const unknown = await publishAttachmentFile(target, Readable.from(["unrelated pending object"]), { temporaryRoot });
      await assert.rejects(verifyMigrationPublicationStage(target, "retained", { sourcePartition: true, allowPublished: true }), error => error.code === "E_STORAGE_MIGRATION_ARCHIVE_INVALID" && error.message.includes("captured signature"));
      assert.equal(await readFile(path.join(target, unknown.path), "utf8"), "unrelated pending object");
      await rm(path.join(target, unknown.path)); // Remove only this fixture's deliberately introduced object.
      const activated = await activateArchivedMigration(target, "retained", options);
      assert.equal(activated.journal.phase, "PUBLISHED");
      assert.deepEqual(await readFile(partial), Buffer.from([0, 255, 77]));
      assert.deepEqual(await readFile(path.join(target, `.forgeloop/attachments/objects/${signature.sha256}`)), signatureBytes);
    });
  });
});

test("SIGKILL after signature-object publication resumes without replacing bytes or losing partial evidence", { timeout: 60000 }, async () => {
  await fixture(async ({ target, signature, signatureBytes }) => {
    const worker = fork(new URL("./helpers/storage-migration-crash-worker.mjs", import.meta.url), [target, "SIGNATURE_OBJECT"], { silent: true });
    let errors = "";
    worker.stderr.on("data", data => { errors += data; });
    try {
      const [ready] = await Promise.race([once(worker, "message"), once(worker, "exit").then(() => { throw new Error(errors); })]);
      const object = path.join(target, `.forgeloop/attachments/objects/${signature.sha256}`);
      const before = await stat(object);
      assert.deepEqual(await readFile(object), signatureBytes);
      await assert.rejects(readFile(path.join(target, ".forgeloop/state.sqlite")), { code: "ENOENT" });
      const exited = once(worker, "exit");
      worker.kill("SIGKILL");
      await exited;
      const result = await resumeProjectStorageMigration(target, { destination: "retained", expectedOwnerId: ready.ownerId, writersQuiesced: true });
      assert.equal(result.phase, "PUBLISHED");
      assert.equal(result.currentStateVerified, true);
      assert.equal(result.attachments, 2);
      assert.deepEqual(await readFile(object), signatureBytes);
      const after = await stat(object);
      assert.equal(after.dev, before.dev);
      assert.equal(after.ino, before.ino);
      assert.deepEqual(await readFile(path.join(target, "retained/publication/activation-attachments/.publishing-interrupted/bytes")), Buffer.from([0, 255, 77]));
      assert.deepEqual(await readFile(path.join(target, "retained/publication/legacy-archive", signature.path)), signatureBytes);
    } finally { if (worker.exitCode === null && worker.signalCode === null) worker.kill("SIGKILL"); }
  });
});
