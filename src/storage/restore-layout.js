import { lstat, opendir } from "node:fs/promises";
import { assertSafePath } from "../core/filesystem.js";
import { LEGACY_SOURCE_ROOTS } from "./migration-source.js";
import { iterateAttachmentReferences } from "./attachment-references.js";
import { verifyAttachmentFile } from "./attachment-files.js";

const invalid = message => Object.assign(new Error(message), { code: "E_STORAGE_RESTORE_INVALID" });
export async function restorePathExists(target, relative) {
  try { await lstat(await assertSafePath(target, relative)); return true; }
  catch (error) { if (error.code === "ENOENT") return false; throw error; }
}

/** Publication may contain only immutable objects bound to the retained snapshot. */
export async function assertRestorePublicationLayout(target, db) {
  for (const root of LEGACY_SOURCE_ROOTS) {
    if (root !== ".forgeloop/attachments" && await restorePathExists(target, root)) throw invalid(`Restore publication refuses legacy operational state: ${root}`);
  }
  if (!await restorePathExists(target, ".forgeloop/attachments")) return;
  for await (const entry of await opendir(await assertSafePath(target, ".forgeloop/attachments"))) {
    if (entry.name !== "objects" || !entry.isDirectory()) throw invalid("Restore attachment namespace has unexpected membership");
  }
  if (!await restorePathExists(target, ".forgeloop/attachments/objects")) return;
  const expected = new Map();
  for (const reference of iterateAttachmentReferences(db)) expected.set(reference.sha256, reference);
  for await (const entry of await opendir(await assertSafePath(target, ".forgeloop/attachments/objects"))) {
    const reference = expected.get(entry.name);
    if (!reference || !entry.isFile()) throw invalid("Restore publication contains an unbound object");
    await verifyAttachmentFile(target, reference);
  }
}
