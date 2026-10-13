import { needsExistingProjectScope, withExistingProjectScope } from "./existing-project-scope.js";
import { getOperationalStore } from "./operational-context.js";
import { validateAttachmentReference } from "./attachment-binding.js";
import { withVerifiedAttachmentFile } from "./attachment-files.js";
import { ensureWithin } from "../core/filesystem.js";
import path from "node:path";

function isObjectAddress(target, relativePath) {
  const portable = relativePath.replaceAll("\\", "/");
  const normalizeNames = value => value.replaceAll("\\", "/").split("/")
    .map(segment => segment.replace(/[. ]+$/, "").split(":")[0].toLowerCase()).join("/");
  const prefix = ".forgeloop/attachments/objects/";
  // Keep lexical object traversal protected, and detect absolute/dot aliases.
  // Classification never rewrites the immutable SQL path binding.
  return normalizeNames(portable).startsWith(prefix)
    || normalizeNames(path.relative(target, path.resolve(target, portable))).startsWith(prefix);
}

/** Explicit non-object paths retain legacy handling until their migration. */
export async function withOperationalAttachmentFile(target, relativePath, taskId, callback) {
  if (await needsExistingProjectScope(target)) {
    return withExistingProjectScope(target, () => withOperationalAttachmentFile(target, relativePath, taskId, callback), { readOnly: true });
  }
  const store = getOperationalStore(target);
  if (!store || !isObjectAddress(target, relativePath)) return callback(ensureWithin(target, relativePath));
  const invalid = message => Object.assign(new Error(message), { code: "E_STORAGE_ATTACHMENT_INVALID" });
  if (store.db.isTransaction) throw invalid("External attachment consumption cannot run inside the native writer");
  const row = store.observe(`attachment-path:${JSON.stringify([taskId, relativePath])}`, () => store.db.prepare(
    "SELECT * FROM attachment_references WHERE task_id = ? AND path = ? ORDER BY reference_id LIMIT 1",
  ).get(taskId, relativePath) ?? null);
  let reference = row ? validateAttachmentReference({ taskId: row.task_id, referenceId: row.reference_id, path: row.path, size: row.size, sha256: row.sha256 }) : null;
  if (!reference) {
    for (const value of store.attachments.values()) {
      if (value.taskId === taskId && value.path === relativePath) { reference = value; break; }
    }
  }
  if (!reference) throw invalid("Attachment path has no binding for this task");
  let consumerStarted = false;
  try {
    return await withVerifiedAttachmentFile(target, validateAttachmentReference(reference), filename => {
      consumerStarted = true;
      return callback(filename);
    });
  }
  catch (error) {
    if (!consumerStarted && ["ENOENT", "ENOTDIR", "ELOOP"].includes(error.code)) throw invalid("Referenced attachment bytes are missing or unsafe");
    throw error;
  }
}
