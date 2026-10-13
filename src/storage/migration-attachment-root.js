import { createReadStream } from "node:fs";
import { mkdir, readdir } from "node:fs/promises";
import { assertSafePath } from "../core/filesystem.js";
import { canonicalFingerprint } from "../core/artifacts.js";
import { validateAttachmentReference } from "./attachment-binding.js";
import { publishAttachmentFile, verifyAttachmentFile } from "./attachment-files.js";
import { prepareRecordedLegacySignatures } from "./legacy-signature.js";
import { readStorageMetadataJson } from "./metadata-json.js";

function invalid(message) { return Object.assign(new Error(message), { code: "E_STORAGE_ATTACHMENT_INVALID" }); }

/** Build one private root for captured portable objects and legacy signatures. */
export async function prepareMigrationAttachmentRoot(captured, root, { packageRoot } = {}) {
  if (!captured.manifest.files.some(file => file.path.endsWith("/statement.sigstore.json"))) {
    return { root: captured.source, preparedAttachments: null, summary: null, mappings: [], references: [] };
  }
  await mkdir(root);
  const discovered = await prepareRecordedLegacySignatures(captured.source, root, captured.manifest.files, { packageRoot });
  const index = await readStorageMetadataJson(captured.source, "export-index.json", { optional: true });
  const portable = index?.attachments ?? [];
  if (!Array.isArray(portable)) throw invalid("Invalid captured attachment catalog");
  const references = new Map();
  for (const value of portable) {
    const reference = validateAttachmentReference(value);
    const key = JSON.stringify([reference.taskId, reference.referenceId]);
    if (references.has(key)) throw invalid("Duplicate captured attachment identity");
    await verifyAttachmentFile(captured.source, reference);
    const copied = await publishAttachmentFile(root, createReadStream(await assertSafePath(captured.source, reference.path)));
    if (copied.size !== reference.size || copied.sha256 !== reference.sha256) throw invalid("Captured attachment changed during preparation");
    references.set(key, reference);
  }
  const newReferences = [];
  for (const reference of discovered.references) {
    const key = JSON.stringify([reference.taskId, reference.referenceId]);
    const prior = references.get(key);
    if (prior) {
      if (prior.path !== reference.path || prior.size !== reference.size || prior.sha256 !== reference.sha256) throw invalid("Captured alias conflicts with signature bytes");
    } else { references.set(key, reference); newReferences.push(reference); }
  }
  const all = [...references.values()].sort((left, right) => JSON.stringify([left.taskId, left.referenceId]).localeCompare(JSON.stringify([right.taskId, right.referenceId])));
  const summary = { root: "candidate-attachments", signatures: discovered.mappings.length, references: all.length, fingerprint: canonicalFingerprint({ references: all, mappings: discovered.mappings }) };
  return { root, preparedAttachments: { root, references: newReferences }, summary, mappings: discovered.mappings, references: all };
}

/** A prepared root contains only the independently reproduced canonical objects. */
export async function verifyMigrationAttachmentRoot(root, references) {
  const expected = new Map();
  for (const reference of references) {
    validateAttachmentReference(reference);
    const previous = expected.get(reference.sha256);
    if (previous && previous.size !== reference.size) throw invalid("Candidate object has inconsistent size bindings");
    expected.set(reference.sha256, reference);
  }
  for (const [relative, names] of [[".", [".forgeloop"]], [".forgeloop", ["attachments"]], [".forgeloop/attachments", ["objects"]]]) {
    const entries = await readdir(await assertSafePath(root, relative));
    if (canonicalFingerprint(entries.sort()) !== canonicalFingerprint(names)) throw invalid("Candidate attachment root has unexpected membership");
  }
  const entries = await readdir(await assertSafePath(root, ".forgeloop/attachments/objects"));
  if (entries.length !== expected.size || entries.some(name => !expected.has(name))) throw invalid("Candidate attachment object membership changed");
  for (const reference of expected.values()) await verifyAttachmentFile(root, reference);
}
