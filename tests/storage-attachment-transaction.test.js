import assert from "node:assert/strict";
import test from "node:test";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { buildDiagnosisProject, TEST_TASK_ID } from "./helpers/storage-fixtures.js";
import { taskStorageKey } from "../src/core/task-identity.js";
import { withProjectStorage } from "../src/storage/project-boundary.js";
import { withOperationalTransaction } from "../src/storage/unit-of-work.js";
import { iterateAttachmentReferences } from "../src/storage/attachment-references.js";

test("prepared attachment bindings commit with artifacts/events and conflict rolls everything back", async () => {
  const target = await buildDiagnosisProject();
  try {
    await withProjectStorage(target, async store => {
      const logical = `.forgeloop/task-state/${taskStorageKey(TEST_TASK_ID)}/contract.json`;
      const original = store.readText(logical);
      const updated = `${original} `;
      const beforeEvents = store.db.prepare("SELECT COUNT(*) AS count FROM events").get().count;
      const options = { target, taskId: TEST_TASK_ID, operation: "attachment-test", recordCommitEvent: true };
      let reference;
      await withOperationalTransaction(options, async transaction => {
        reference = await transaction.stageAttachment({ referenceId: "signature-test", readable: Readable.from(["first signature bytes"]) });
        assert.equal(store.db.isTransaction, false);
        assert.equal([...iterateAttachmentReferences(store.db)].length, 0);
        transaction.stageText(logical, updated);
      });
      assert.deepEqual([...iterateAttachmentReferences(store.db)], [reference]);
      assert.equal(store.readText(logical), updated);
      assert.equal(store.db.prepare("SELECT COUNT(*) AS count FROM events").get().count, beforeEvents + 1);
      let rejectedReference;
      await assert.rejects(withOperationalTransaction(options, async transaction => {
        rejectedReference = await transaction.stageAttachment({ referenceId: "signature-test", readable: Readable.from(["different signature bytes"]) });
        transaction.stageText(logical, original);
      }), { code: "E_STORAGE_ATTACHMENT_INVALID" });
      assert.deepEqual([...iterateAttachmentReferences(store.db)], [reference]);
      assert.equal(store.readText(logical), updated);
      assert.equal(store.db.prepare("SELECT COUNT(*) AS count FROM events").get().count, beforeEvents + 1);
      assert.equal(await readFile(path.join(target, rejectedReference.path), "utf8"), "different signature bytes");
      assert.equal(store.db.isTransaction, false);
    });
  } finally { await rm(target, { recursive: true, force: true }); }
});

test("attachment staging refuses an expired preparation without binding late published bytes", async () => {
  const target = await buildDiagnosisProject();
  try {
    let release;
    const blocked = new Promise(resolve => { release = resolve; });
    let late;
    await withProjectStorage(target, async () => {
      await withOperationalTransaction({ target, taskId: TEST_TASK_ID, operation: "late-attachment" }, async transaction => {
        const readable = Readable.from((async function* () { await blocked; yield "late bytes"; })());
        late = transaction.stageAttachment({ referenceId: "late-signature", readable }).catch(error => error);
      });
    });
    release();
    assert.equal((await late).code, "E_STORAGE_TRANSACTION_EXPIRED");
    await withProjectStorage(target, store => assert.equal([...iterateAttachmentReferences(store.db)].length, 0));
  } finally { await rm(target, { recursive: true, force: true }); }
});
