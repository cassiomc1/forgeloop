import { publishAttachmentFile, verifyAttachmentFile } from "./attachment-files.js";
import { assertWritableContext, runInTransaction } from "./transaction.js";
import { validateAttachmentReference } from "./attachment-binding.js";
export { validateAttachmentReference } from "./attachment-binding.js";

function invalid(message) { return Object.assign(new Error(message), { code: "E_STORAGE_ATTACHMENT_INVALID" }); }

/** Synchronous insertion is used only after the referenced bytes were verified. */
export function insertVerifiedAttachmentReference(db, reference) {
  assertWritableContext(db);
  validateAttachmentReference(reference);
  const prior = db.prepare("SELECT path, size, sha256 FROM attachment_references WHERE task_id = ? AND reference_id = ?").get(reference.taskId, reference.referenceId);
  if (prior) {
    if (prior.path !== reference.path || prior.size !== reference.size || prior.sha256 !== reference.sha256) throw invalid("An immutable attachment identity already names different bytes");
    return reference;
  }
  db.prepare("INSERT INTO attachment_references(task_id, reference_id, path, size, sha256) VALUES (?, ?, ?, ?, ?)")
    .run(reference.taskId, reference.referenceId, reference.path, reference.size, reference.sha256);
  return reference;
}

/** Publish first, then commit the immutable binding in a short writer transaction. */
export async function registerAttachment(db, target, { taskId, referenceId, readable }) {
  if (db.isTransaction) throw invalid("Attachment registration cannot span an active write transaction");
  assertWritableContext(db);
  const binding = await publishAttachmentFile(target, readable, { db });
  const reference = validateAttachmentReference({ taskId, referenceId, ...binding });
  await verifyAttachmentFile(target, reference);
  return runInTransaction(db, () => insertVerifiedAttachmentReference(db, reference));
}

export function* iterateAttachmentReferences(db) {
  for (const row of db.prepare("SELECT * FROM attachment_references ORDER BY task_id, reference_id").iterate()) {
    yield validateAttachmentReference({ taskId: row.task_id, referenceId: row.reference_id, path: row.path, size: row.size, sha256: row.sha256 });
  }
}
