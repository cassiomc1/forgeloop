import assert from "node:assert/strict";
import test from "node:test";
import { readFile, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { buildDiagnosisProject, TEST_TASK_ID } from "./helpers/storage-fixtures.js";
import { importProjectState } from "../src/storage/importer.js";
import { registerAttachment } from "../src/storage/attachment-references.js";
import { withOperationalStore } from "../src/storage/unit-of-work.js";
import { withOperationalAttachmentFile } from "../src/storage/operational-attachments.js";

test("attachment consumers receive private verified bytes and clean up after success/failure", async () => {
  const target = await buildDiagnosisProject({ legacy: true });
  const { db } = await importProjectState(target, path.join(target, "state.sqlite"));
  try {
    const reference = await registerAttachment(db, target, { taskId: TEST_TASK_ID, referenceId: "consumer", readable: Readable.from(["original bytes"]) });
    await withOperationalStore({ db, target }, async () => {
      let temporary;
      const result = await withOperationalAttachmentFile(target, reference.path, TEST_TASK_ID, async filename => {
        temporary = filename;
        assert.notEqual(filename, path.join(target, reference.path));
        await writeFile(path.join(target, reference.path), "replaced bytes");
        return readFile(filename, "utf8");
      });
      assert.equal(result, "original bytes");
      await assert.rejects(readFile(temporary), { code: "ENOENT" });
      await writeFile(path.join(target, reference.path), "original bytes");
      await assert.rejects(withOperationalAttachmentFile(target, reference.path, TEST_TASK_ID, filename => {
        temporary = filename;
        throw Object.assign(new Error("consumer executable is missing"), { code: "ENOENT" });
      }), { code: "ENOENT" });
      await assert.rejects(readFile(temporary), { code: "ENOENT" });
      await assert.rejects(withOperationalAttachmentFile(target, reference.path, TEST_TASK_ID, filename => {
        temporary = filename;
        throw new Error("consumer failed");
      }), /consumer failed/u);
      await assert.rejects(readFile(temporary), { code: "ENOENT" });
    });
  } finally { db.close(); await rm(target, { recursive: true, force: true }); }
});

test("attachment consumers refuse corrupt, oversized, missing, linked and unbound objects before use", async () => {
  const target = await buildDiagnosisProject({ legacy: true });
  const { db } = await importProjectState(target, path.join(target, "state.sqlite"));
  try {
    const reference = await registerAttachment(db, target, { taskId: TEST_TASK_ID, referenceId: "consumer", readable: Readable.from(["original bytes"]) });
    await withOperationalStore({ db, target }, async () => {
      let calls = 0;
      const consume = () => { calls += 1; };
      await assert.rejects(withOperationalAttachmentFile(target, reference.path, "another-task", consume), { code: "E_STORAGE_ATTACHMENT_INVALID" });
      db.exec("BEGIN IMMEDIATE");
      try {
        await assert.rejects(withOperationalAttachmentFile(target, reference.path, TEST_TASK_ID, consume), { code: "E_STORAGE_ATTACHMENT_INVALID" });
      } finally { db.exec("ROLLBACK"); }
      for (const bytes of ["corrupt! bytes", "original bytes plus", "short"]) {
        await writeFile(path.join(target, reference.path), bytes);
        await assert.rejects(withOperationalAttachmentFile(target, reference.path, TEST_TASK_ID, consume), { code: "E_STORAGE_ATTACHMENT_INVALID" });
      }
      await rm(path.join(target, reference.path));
      await assert.rejects(withOperationalAttachmentFile(target, reference.path, TEST_TASK_ID, consume), { code: "E_STORAGE_ATTACHMENT_INVALID" });
      await writeFile(path.join(target, "untrusted"), "original bytes");
      await symlink(path.join(target, "untrusted"), path.join(target, reference.path));
      await assert.rejects(withOperationalAttachmentFile(target, reference.path, TEST_TASK_ID, consume));
      assert.equal(calls, 0);
    });
  } finally { db.close(); await rm(target, { recursive: true, force: true }); }
});
