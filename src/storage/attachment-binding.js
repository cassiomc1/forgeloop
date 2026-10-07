/** Pure canonical binding validation, independent of files and SQLite. */
export function validateAttachmentReference(reference) {
  if (!reference || typeof reference.taskId !== "string" || !reference.taskId
    || typeof reference.referenceId !== "string" || !reference.referenceId || reference.referenceId.length > 256
    || !Number.isSafeInteger(reference.size) || reference.size < 0
    || !/^[a-f0-9]{64}$/.test(reference.sha256 ?? "")
    || reference.path !== `.forgeloop/attachments/objects/${reference.sha256}`) {
    throw Object.assign(new Error("Invalid canonical attachment reference"), { code: "E_STORAGE_ATTACHMENT_INVALID" });
  }
  return reference;
}
