import { createHash, randomUUID } from "node:crypto";

/** Bind signature discovery to the exact statement bytes, not mutable filenames. */
export function signatureReferencePrefix(statementText) {
  return `sigstore:${createHash("sha256").update(statementText, "utf8").digest("hex")}:`;
}

export function signatureReferenceId(statementText) {
  return `${signatureReferencePrefix(statementText)}${randomUUID()}`;
}

/** Historical logical paths remain addressable without changing ledger bytes. */
export function legacyAttachmentReferenceId(relativePath) {
  return `legacy-path:${createHash("sha256").update(relativePath, "utf8").digest("hex")}`;
}
