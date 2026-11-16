import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { canonicalFingerprint, readJsonArtifact } from "../artifacts.js";
import { readAttestationStatement } from "../attestation.js";
import { resolveAttestationBundlePath } from "../attachment-paths.js";
import { readCodeManifest } from "../code-manifest.js";
import { E_EVIDENCE_EXPORT_UNAVAILABLE } from "../error-codes.js";
import { assertSafePath, ensureWithin, writeFileAtomic } from "../filesystem.js";
import { withSigningStatementFile } from "../signing/statement-file.js";
import { taskArtifactPath, taskAttestationStatementPath } from "../task-paths.js";
import { getPackageRoot } from "../templates.js";
import { withProjectReadSnapshot } from "../../storage/project-read-snapshot.js";
import { withOperationalAttachmentFile } from "../../storage/operational-attachments.js";
import {
  DEFAULT_EVIDENCE_DIRECTORY,
  EVIDENCE_BUNDLE_KIND,
  EVIDENCE_BUNDLE_SCHEMA_VERSION,
  EVIDENCE_REDACTIONS,
  assertEvidenceTaskId,
  evidenceBundlePath,
  evidenceError,
  sealEvidenceBundle,
  serializeEvidenceBundle,
} from "./bundle-format.js";

async function packageVersion(packageRoot) {
  return JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8")).version;
}

async function readStatementText(target, taskId) {
  return withSigningStatementFile(target, taskAttestationStatementPath(taskId), (filename) => readFile(filename, "utf8"));
}

async function readSignatureText(target, taskId) {
  let bundlePath;
  try { bundlePath = resolveAttestationBundlePath(target, taskId); } catch { return null; }
  try {
    return await withOperationalAttachmentFile(target, bundlePath, taskId, (filename) => readFile(filename, "utf8"));
  } catch {
    return null;
  }
}

async function readOptional(target, relativePath, schemaName, packageRoot) {
  try { return (await readJsonArtifact(target, relativePath, schemaName, packageRoot)).value; } catch { return null; }
}

function checkSummary(receipt) {
  return (Array.isArray(receipt?.checks) ? receipt.checks : []).map((check) => ({
    id: check.id,
    requirement: typeof check.requirement === "string" ? check.requirement : null,
    status: check.status,
    exitCode: Number.isInteger(check.exitCode) ? check.exitCode : null,
  })).sort((left, right) => String(left.id).localeCompare(String(right.id)));
}

function informationalSummary(contract, receipt) {
  return {
    bound: false,
    note: "Informational projection of the contract and receipt; only the statement and manifest are cryptographically bound.",
    objective: typeof contract?.objective === "string" ? contract.objective : null,
    successCriteria: Array.isArray(contract?.successCriteria) ? contract.successCriteria.map(String) : [],
    checks: checkSummary(receipt),
  };
}

async function collectEvidence(target, taskId, packageRoot) {
  let manifest;
  let statement;
  try {
    manifest = await readCodeManifest({ target, packageRoot, taskId });
    statement = await readAttestationStatement({ target, packageRoot, taskId });
  } catch (error) {
    throw evidenceError(E_EVIDENCE_EXPORT_UNAVAILABLE, `Task ${taskId} has no exportable attestation (${error.code ?? "unknown"}); complete it with attestation mode required and run attestation-create first`);
  }
  if (statement.value.predicate?.verification?.completion !== "VALID") {
    throw evidenceError(E_EVIDENCE_EXPORT_UNAVAILABLE, `Task ${taskId} attestation does not record a VALID completion`);
  }
  const statementText = await readStatementText(target, taskId);
  if (canonicalFingerprint(JSON.parse(statementText)) !== canonicalFingerprint(statement.value)) {
    throw evidenceError(E_EVIDENCE_EXPORT_UNAVAILABLE, "Attestation statement bytes changed while exporting");
  }
  return {
    manifest: manifest.value,
    statementText,
    signatureText: await readSignatureText(target, taskId),
    contract: await readOptional(target, taskArtifactPath(taskId, "contract"), "current-contract", packageRoot),
    receipt: await readOptional(target, taskArtifactPath(taskId, "receipt"), "execution-receipt", packageRoot),
  };
}

function assertRedacted(text, target) {
  const absolute = path.resolve(target);
  if (text.includes(absolute) || text.includes(absolute.replaceAll("\\", "/"))) {
    throw evidenceError(E_EVIDENCE_EXPORT_UNAVAILABLE, "Evidence bundle would contain the absolute project path; refusing to export");
  }
}

export async function exportEvidenceBundle({ target, taskId, packageRoot = getPackageRoot(), directory = DEFAULT_EVIDENCE_DIRECTORY } = {}) {
  assertEvidenceTaskId(taskId);
  const evidence = await withProjectReadSnapshot(target, () => collectEvidence(target, taskId, packageRoot));
  const bundle = sealEvidenceBundle({
    schemaVersion: EVIDENCE_BUNDLE_SCHEMA_VERSION,
    kind: EVIDENCE_BUNDLE_KIND,
    taskId,
    forgeloopVersion: await packageVersion(packageRoot),
    statement: { text: evidence.statementText },
    manifest: evidence.manifest,
    manifestFingerprint: canonicalFingerprint(evidence.manifest),
    signature: evidence.signatureText === null ? null : { provider: "sigstore", bundleText: evidence.signatureText },
    summary: informationalSummary(evidence.contract, evidence.receipt),
    redactions: [...EVIDENCE_REDACTIONS],
  });
  const text = serializeEvidenceBundle(bundle);
  assertRedacted(text, target);
  const relativePath = evidenceBundlePath(directory, taskId);
  await mkdir(path.dirname(ensureWithin(target, relativePath)), { recursive: true });
  await assertSafePath(target, relativePath);
  await writeFileAtomic(ensureWithin(target, relativePath), text);
  return {
    schemaVersion: 1,
    taskId,
    path: relativePath,
    digest: bundle.digest,
    coveredPaths: bundle.manifest.entries.length,
    signed: bundle.signature !== null,
    redactions: bundle.redactions,
  };
}
