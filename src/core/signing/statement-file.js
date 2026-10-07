import { needsExistingProjectScope, withExistingProjectScope } from "../../storage/existing-project-scope.js";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { assertSafePath, ensureWithin, writeFileAtomic } from "../filesystem.js";
import { getOperationalStore, readOperationalText } from "../../storage/operational-context.js";

/** Present selected canonical bytes to external signers without a legacy mirror. */
export async function withSigningStatementFile(target, statementPath, callback) {
  if (await needsExistingProjectScope(target)) {
    return withExistingProjectScope(target, () => withSigningStatementFile(target, statementPath, callback), { readOnly: true });
  }
  await assertSafePath(target, statementPath);
  const source = readOperationalText(target, statementPath);
  if (!source.selected) return callback(ensureWithin(target, statementPath));
  const invalid = message => Object.assign(new Error(message), { code: "E_ATTESTATION_STATEMENT_INVALID" });
  if (source.text === null) throw invalid("Selected attestation statement is missing");
  if (getOperationalStore(target).db.isTransaction) throw invalid("External signing cannot run inside a SQLite write transaction");
  const directory = await mkdtemp(path.join(os.tmpdir(), "forgeloop-signing-statement-"));
  try {
    const filename = path.join(directory, "statement.json");
    await writeFileAtomic(filename, source.text);
    const result = await callback(filename);
    if (readOperationalText(target, statementPath).text !== source.text) throw invalid("Attestation statement changed during external signing");
    return result;
  } finally { await rm(directory, { recursive: true, force: true }); }
}
