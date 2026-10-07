import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, readdir, rm, writeFile, symlink } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { Readable } from "node:stream";
import { runInTransaction } from "../src/storage/transaction.js";
import { publishAttachmentFile, verifyAttachmentFile } from "../src/storage/attachment-files.js";
import { checkStorageIntegrity, openStorageDatabase } from "../src/storage/connection.js";
import { backupStorageDatabase } from "../src/storage/backup.js";
import { registerAttachment, iterateAttachmentReferences } from "../src/storage/attachment-references.js";
import { buildDiagnosisProject, TEST_TASK_ID } from "./helpers/storage-fixtures.js";
import { importProjectState } from "../src/storage/importer.js";
import { exportDatabase } from "../src/storage/exporter.js";

test("immutable attachment publication verifies bytes and refuses corrupted deduplication", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-attachments-"));
  try {
    const bytes = Buffer.from([0, 255, 128, 13, 10]);
    const reference = await publishAttachmentFile(target, Readable.from([bytes]));
    assert.equal(reference.size, bytes.length);
    assert.deepEqual(await readFile(path.join(target, reference.path)), bytes);
    assert.deepEqual(await publishAttachmentFile(target, Readable.from([bytes])), reference);
    await writeFile(path.join(target, reference.path), "corrupted");
    await assert.rejects(publishAttachmentFile(target, Readable.from([bytes])), { code: "E_STORAGE_ATTACHMENT_INVALID" });
    assert.equal(await readFile(path.join(target, reference.path), "utf8"), "corrupted");
    await rm(path.join(target, reference.path));
    await symlink(path.join(target, "outside"), path.join(target, reference.path));
    await assert.rejects(verifyAttachmentFile(target, reference), /symlink/iu);
    await assert.rejects(verifyAttachmentFile(target, { ...reference, path: "../outside" }), { code: "E_STORAGE_ATTACHMENT_INVALID" });
  } finally { await rm(target, { recursive: true, force: true }); }
});

test("attachment publication refuses an active SQLite write transaction", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-attachments-"));
  const db = openStorageDatabase(path.join(target, "state.sqlite"));
  try {
    db.exec("BEGIN IMMEDIATE");
    await assert.rejects(publishAttachmentFile(target, Readable.from(["bytes"]), { db }), { code: "E_STORAGE_ATTACHMENT_INVALID" });
    db.exec("ROLLBACK");
    await assert.rejects(readFile(path.join(target, ".forgeloop/attachments/objects")), { code: "ENOENT" });
  } finally { db.close(); await rm(target, { recursive: true, force: true }); }
});

test("a failed attachment stream publishes no reference and preserves earlier objects", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-attachments-"));
  try {
    const earlier = await publishAttachmentFile(target, Readable.from(["retained bytes"]));
    async function* interrupted() { yield "partial"; throw new Error("source interrupted"); }
    await assert.rejects(publishAttachmentFile(target, Readable.from(interrupted())), /source interrupted/u);
    assert.deepEqual(await readdir(path.join(target, ".forgeloop/attachments/objects")), [earlier.sha256]);
    assert.equal(await readFile(path.join(target, earlier.path), "utf8"), "retained bytes");
  } finally { await rm(target, { recursive: true, force: true }); }
});

test("registered attachment identities are immutable and portable with verified bytes", async () => {
  const target = await buildDiagnosisProject({ legacy: true });
  const { db } = await importProjectState(target, path.join(target, "state.sqlite"));
  let restored;
  try {
    const input = { taskId: TEST_TASK_ID, referenceId: "evidence-log", readable: Readable.from(["external evidence"]) };
    const reference = await registerAttachment(db, target, input);
    assert.deepEqual([...iterateAttachmentReferences(db)], [reference]);
    await assert.rejects(registerAttachment(db, target, { ...input, readable: Readable.from(["changed"]) }), { code: "E_STORAGE_ATTACHMENT_INVALID" });
    assert.deepEqual([...iterateAttachmentReferences(db)], [reference]);
    await assert.rejects(exportDatabase(db, path.join(target, "missing-root-export")), { code: "E_STORAGE_ATTACHMENT_INVALID" });
    const exported = path.join(target, "portable");
    await exportDatabase(db, exported, { attachmentRoot: target });
    restored = (await importProjectState(exported, path.join(target, "restored.sqlite"))).db;
    assert.deepEqual([...iterateAttachmentReferences(restored)], [reference]);
    assert.equal(await readFile(path.join(exported, reference.path), "utf8"), "external evidence");
    await writeFile(path.join(exported, reference.path), "tampered");
    await assert.rejects(importProjectState(exported, path.join(target, "rejected.sqlite")), error => error.code === "E_STORAGE_IMPORT_ABORTED" && error.report.errors.some(issue => issue.code === "E_STORAGE_ATTACHMENT_INVALID"));
  } finally { restored?.close(); db.close(); await rm(target, { recursive: true, force: true }); }
});

test("storage integrity refuses malformed references even when native SQLite checks pass", async () => {
  const target = await buildDiagnosisProject({ legacy: true });
  const { db } = await importProjectState(target, path.join(target, "state.sqlite"));
  try {
    await registerAttachment(db, target, { taskId: TEST_TASK_ID, referenceId: "bound", readable: Readable.from(["bytes"]) });
    assert.equal(checkStorageIntegrity(db).ok, true);
    db.prepare("UPDATE attachment_references SET path = '../escaped', sha256 = ?").run("z".repeat(64));
    const result = checkStorageIntegrity(db);
    assert.deepEqual(result.integrity, ["ok"]);
    assert.deepEqual(result.foreignKeys, []);
    assert.equal(result.ok, false);
    assert.equal(result.attachmentErrors[0].code, "E_STORAGE_ATTACHMENT_INVALID");
    const destination = path.join(target, "refused.sqlite");
    await assert.rejects(backupStorageDatabase(db, destination), { code: "E_STORAGE_BACKUP_INVALID" });
    await assert.rejects(readFile(destination), { code: "ENOENT" });
  } finally { db.close(); await rm(target, { recursive: true, force: true }); }
});


test("expired native callbacks reject attachment publication before consuming bytes", async () => {
  for (const operation of ["publish", "register"]) {
    const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-expired-attachment-"));
    const db = openStorageDatabase(path.join(target, "state.sqlite"));
    try {
      let consumed = false, scheduled;
      const readable = Readable.from((async function* () { consumed = true; yield "late attachment"; })());
      assert.throws(() => runInTransaction(db, () => {
        scheduled = Promise.resolve().then(() => operation === "publish"
          ? publishAttachmentFile(target, readable, { db })
          : registerAttachment(db, target, { taskId: "unknown", referenceId: "late", readable }));
        return scheduled;
      }), { code: "E_STORAGE_ASYNC_TRANSACTION" });
      assert.equal(await scheduled.then(() => "published", error => error.code), "E_STORAGE_TRANSACTION_EXPIRED");
      assert.equal(consumed, false);
      await assert.rejects(readdir(path.join(target, ".forgeloop/attachments/objects")), { code: "ENOENT" });
      assert.equal([...iterateAttachmentReferences(db)].length, 0);
    } finally { db.close(); await rm(target, { recursive: true, force: true }); }
  }
});
