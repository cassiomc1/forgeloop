import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { openStorageDatabase } from "../src/storage/index.js";
import { withOperationalStore } from "../src/storage/unit-of-work.js";
import { withOperationalAttachmentFile } from "../src/storage/operational-attachments.js";

test("object address aliases never reach an attachment consumer without a task binding", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-attachment-aliases-"));
  let db;
  try {
    await mkdir(path.join(target, ".forgeloop"));
    db = openStorageDatabase(path.join(target, ".forgeloop/state.sqlite"));
    const hash = "0".repeat(64);
    const canonical = `.forgeloop/attachments/objects/${hash}`;
    const addresses = [canonical, canonical.toUpperCase(), canonical.replaceAll("/", "\\"),
      `./${canonical}`, `unused/../${canonical}`, path.join(target, canonical),
      `.forgeloop./attachments/objects/${hash}`, `.forgeloop/attachments/objects./${hash}`,
      `.forgeloop/attachments/objects:alias/${hash}`, `${canonical}/../../portable.json`];
    await withOperationalStore({ db, target }, async () => {
      for (const address of addresses) {
        let called = false;
        await assert.rejects(withOperationalAttachmentFile(target, address, "missing-task", () => {
          called = true;
        }), { code: "E_STORAGE_ATTACHMENT_INVALID" }, address);
        assert.equal(called, false, address);
      }
      assert.equal(await withOperationalAttachmentFile(target, "portable-signature.json", "missing-task", filename => filename),
        path.join(target, "portable-signature.json"));
    });
  } finally {
    db?.close();
    await rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
