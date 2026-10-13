import { createHash } from "node:crypto";
import { constants, createWriteStream } from "node:fs";
import { link, lstat, mkdir, mkdtemp, open, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { digestFile, syncDirectory } from "./file-durability.js";
import { assertSafePath } from "../core/filesystem.js";
import { assertWritableContext } from "./transaction.js";

function invalid(message) { return Object.assign(new Error(message), { code: "E_STORAGE_ATTACHMENT_INVALID" }); }


/** Verify referenced immutable bytes without loading the attachment into memory. */
async function attachmentFilename(target, reference) {
  if (!reference || !Number.isSafeInteger(reference.size) || reference.size < 0
    || !/^[a-f0-9]{64}$/.test(reference.sha256 ?? "")
    || reference.path !== `.forgeloop/attachments/objects/${reference.sha256}`) throw invalid("Invalid attachment reference");
  const filename = await assertSafePath(target, reference.path);
  if (!(await lstat(filename)).isFile()) throw invalid("Attachment reference must name a regular file");
  return filename;
}

export async function verifyAttachmentFile(target, reference) {
  const filename = await attachmentFilename(target, reference);
  const actual = await digestFile(filename, { includeSize: true });
  if (actual.size !== reference.size || actual.sha256 !== reference.sha256) throw invalid("Attachment bytes disagree with their reference");
  return reference;
}

/** Give consumers private verified bytes, closing the source check/use window. */
export async function withVerifiedAttachmentFile(target, reference, callback) {
  const source = await attachmentFilename(target, reference);
  const directory = await mkdtemp(path.join(os.tmpdir(), "forgeloop-attachment-read-"));
  try {
    const filename = path.join(directory, "bytes");
    const handle = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      if (!(await handle.stat()).isFile()) throw invalid("Attachment must remain a regular file");
      const hash = createHash("sha256");
      let size = 0;
      const check = new Transform({ transform(bytes, _encoding, done) {
        size += bytes.length;
        if (size > reference.size) { done(invalid("Attachment exceeds its reference size")); return; }
        hash.update(bytes);
        done(null, bytes);
      } });
      await pipeline(handle.createReadStream({ autoClose: false }), check, createWriteStream(filename, { flags: "wx", mode: 0o600 }));
      if (size !== reference.size || hash.digest("hex") !== reference.sha256) throw invalid("Attachment bytes disagree with their reference");
    } finally { await handle.close(); }
    return await callback(filename);
  } finally { await rm(directory, { recursive: true, force: true }); }
}

/** Publish immutable bytes before a caller commits their database reference. */
export async function publishAttachmentFile(target, readable, { db, temporaryRoot } = {}) {
  if (db?.isTransaction) throw invalid("Attachment publication must precede the database write transaction");
  if (db) assertWritableContext(db);
  const root = await assertSafePath(target, ".forgeloop/attachments/objects");
  await mkdir(root, { recursive: true });
  await assertSafePath(target, ".forgeloop/attachments/objects");
  const temporaryParent = temporaryRoot ? await assertSafePath(temporaryRoot, ".") : root;
  const temporary = await mkdtemp(path.join(temporaryParent, ".publishing-"));
  const filename = path.join(temporary, "bytes");
  try {
    await pipeline(readable, createWriteStream(filename, { flags: "wx", mode: 0o600 }));
    const binding = await digestFile(filename, { includeSize: true });
    const file = await open(filename, "r+");
    try { await file.sync(); } finally { await file.close(); }
    const reference = { path: `.forgeloop/attachments/objects/${binding.sha256}`, ...binding };
    const destination = await assertSafePath(target, reference.path);
    try { await link(filename, destination); }
    catch (error) { if (error.code !== "EEXIST") throw error; }
    await verifyAttachmentFile(target, reference);
    await syncDirectory(root);
    await syncDirectory(path.dirname(root));
    await syncDirectory(path.dirname(path.dirname(root)));
    await syncDirectory(target);
    return reference;
  } finally { await rm(temporary, { recursive: true, force: true }); }
}
