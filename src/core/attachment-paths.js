import { getOperationalStore, readOperationalText } from "../storage/operational-context.js";
import { validateAttachmentReference } from "../storage/attachment-binding.js";
import { taskStorageKey } from "./task-identity.js";
import { taskAttestationBundlePath, taskAttestationStatementPath } from "./task-paths.js";
import { legacyAttachmentReferenceId, signatureReferencePrefix } from "./signing/bundle-reference.js";

function resolveCanonicalSignature(target, taskId, store) {
  const source = readOperationalText(target, taskAttestationStatementPath(taskId));
  if (source.text === null) return null;
  const prefix = signatureReferencePrefix(source.text);
  // At most two distinct objects are enough to detect ambiguity. Repeated
  // bindings to identical bytes do not make selection ambiguous.
  const rows = store.observe(`signature:${taskId}:${prefix}`, () => store.db.prepare(
    "SELECT MIN(reference_id) AS reference_id, path, size, sha256 FROM attachment_references WHERE task_id = ? AND reference_id >= ? AND reference_id < ? GROUP BY path, size, sha256 ORDER BY path LIMIT 2",
  ).all(taskId, prefix, `${prefix}~`));
  const paths = new Set(rows.map(row => validateAttachmentReference({ taskId, referenceId: row.reference_id, path: row.path, size: row.size, sha256: row.sha256 }).path));
  for (const reference of store.attachments.values()) {
    if (reference.taskId === taskId && reference.referenceId.startsWith(prefix)) paths.add(validateAttachmentReference(reference).path);
  }
  if (paths.size > 1) {
    throw Object.assign(new Error("Multiple signature bundles bind this statement; supply an explicit bundle path"), { code: "E_ATTESTATION_SIGNATURE_INVALID" });
  }
  return paths.values().next().value ?? null;
}

/** Preserve legacy logical references while locating external SQLite assets. */
export function resolveAttestationBundlePath(target, taskId, suppliedPath = null) {
  const legacy = taskAttestationBundlePath(taskId);
  const store = getOperationalStore(target);
  if (store && suppliedPath) {
    const referenceId = legacyAttachmentReferenceId(suppliedPath);
    const row = store.observe(`attachment-alias:${JSON.stringify([taskId, referenceId])}`, () => store.db.prepare(
      "SELECT * FROM attachment_references WHERE task_id = ? AND reference_id = ?",
    ).get(taskId, referenceId) ?? null);
    const staged = store.attachments.get(JSON.stringify([taskId, referenceId]));
    const reference = staged ?? (row ? { taskId: row.task_id, referenceId: row.reference_id, path: row.path, size: row.size, sha256: row.sha256 } : null);
    if (reference) return validateAttachmentReference(reference).path;
  }
  if (store && (!suppliedPath || suppliedPath === legacy)) {
    const canonical = resolveCanonicalSignature(target, taskId, store);
    if (canonical) return canonical;
    return `.forgeloop/attachments/${taskStorageKey(taskId)}/attestations/statement.sigstore.json`;
  }
  return suppliedPath ?? legacy;
}
