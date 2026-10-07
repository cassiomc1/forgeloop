import { isOperationalArtifactPath, needsExistingProjectScope, withExistingProjectScope } from "../../storage/existing-project-scope.js";
import { constants } from "node:fs";
import { mkdtemp, open, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { assertSafePath, ensureWithin } from "../filesystem.js";
import { getOperationalStore, readOperationalText } from "../../storage/operational-context.js";
import { signatureReferenceId } from "./bundle-reference.js";

/** External signing finishes before immutable bytes enter the prepared commit. */
export async function withSigningBundleFile(target, destinationPath, statementPath, callback) {
  if (await needsExistingProjectScope(target)) {
    return withExistingProjectScope(target, () => withSigningBundleFile(target, destinationPath, statementPath, callback));
  }
  const store = getOperationalStore(target);
  if (!store) {
    if (isOperationalArtifactPath(destinationPath)) throw Object.assign(new Error("Operational signature bundles require canonical SQLite preparation"), { code: "E_STORAGE_OPERATION_UNSUPPORTED" });
    await assertSafePath(target, destinationPath);
    await callback(ensureWithin(target, destinationPath));
    return { path: destinationPath };
  }
  const transaction = store.transaction;
  if (!transaction || store.db.isTransaction) {
    throw Object.assign(new Error("SQLite signing requires an active preparation outside the native writer"), { code: "E_ATTESTATION_SIGNATURE_INVALID" });
  }
  const source = readOperationalText(target, statementPath);
  if (!source.selected || source.text === null) {
    throw Object.assign(new Error("SQLite signing requires a canonical statement"), { code: "E_ATTESTATION_STATEMENT_INVALID" });
  }
  const directory = await mkdtemp(path.join(os.tmpdir(), "forgeloop-signing-bundle-"));
  try {
    const filename = path.join(directory, "bundle.json");
    await callback(filename);
    if (readOperationalText(target, statementPath).text !== source.text) {
      throw Object.assign(new Error("Canonical statement changed during signing"), { code: "E_ATTESTATION_STATEMENT_INVALID" });
    }
    let handle;
    try {
      await assertSafePath(directory, "bundle.json");
      handle = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch {
      throw Object.assign(new Error("Signer did not produce a safe signature bundle"), { code: "E_ATTESTATION_SIGNATURE_INVALID" });
    }
    try {
      if (!(await handle.stat()).isFile()) throw new Error("Signer output must be a regular file");
      const attachment = await transaction.stageAttachment({
        referenceId: signatureReferenceId(source.text),
        readable: handle.createReadStream({ autoClose: false }),
      });
      return { path: attachment.path, attachment };
    } finally { await handle.close(); }
  } finally { await rm(directory, { recursive: true, force: true }); }
}
