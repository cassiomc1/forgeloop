import { createHash } from "node:crypto";
import { canonicalFingerprint } from "../artifacts.js";
import { E_EVIDENCE_BUNDLE_INVALID } from "../error-codes.js";

// Portable evidence bundle: what a completed task can prove to a verifier that
// has only the repository checkout. Signed content is the exact attestation
// statement text; everything else is either bound to it (the code manifest) or
// informational (the summary).

export const EVIDENCE_BUNDLE_SCHEMA_VERSION = 1;
export const EVIDENCE_BUNDLE_KIND = "forgeloop-evidence-bundle";
export const DEFAULT_EVIDENCE_DIRECTORY = ".forgeloop-evidence";

export const EVIDENCE_REDACTIONS = Object.freeze([
  "absolute-paths",
  "command-argv",
  "command-output",
  "environment",
  "ledger-events",
]);

// Task IDs may contain dots (release-2.2.0); a leading letter or digit and the
// absence of separators keep the bundle file name inside the evidence directory.
const TASK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/u;

export function evidenceError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, ...details });
}

export function assertEvidenceTaskId(taskId) {
  if (typeof taskId !== "string" || !TASK_ID_PATTERN.test(taskId)) {
    throw evidenceError(E_EVIDENCE_BUNDLE_INVALID, `Invalid evidence task ID: ${taskId} (bundles need letters, digits, ".", "_" or "-", starting with a letter or digit)`);
  }
  return taskId;
}

export function evidenceBundlePath(directory, taskId) {
  return `${directory.replace(/\/+$/u, "")}/${assertEvidenceTaskId(taskId)}.json`;
}

export function evidenceBundleDigest(bundle) {
  const { digest: _digest, ...body } = bundle;
  return createHash("sha256").update(JSON.stringify(body)).digest("hex");
}

export function sealEvidenceBundle(body) {
  return { ...body, digest: evidenceBundleDigest(body) };
}

export function serializeEvidenceBundle(bundle) {
  return `${JSON.stringify(bundle, null, 2)}\n`;
}

function requireField(condition, message) {
  if (!condition) throw evidenceError(E_EVIDENCE_BUNDLE_INVALID, message);
}

export function parseEvidenceBundle(text, expectedTaskId = null) {
  let bundle;
  try { bundle = JSON.parse(text); } catch { throw evidenceError(E_EVIDENCE_BUNDLE_INVALID, "Evidence bundle is not valid JSON"); }
  requireField(bundle && typeof bundle === "object" && !Array.isArray(bundle), "Evidence bundle must be an object");
  requireField(bundle.schemaVersion === EVIDENCE_BUNDLE_SCHEMA_VERSION, `Unsupported evidence bundle schemaVersion: ${bundle.schemaVersion}`);
  requireField(bundle.kind === EVIDENCE_BUNDLE_KIND, "Evidence bundle kind is not forgeloop-evidence-bundle");
  assertEvidenceTaskId(bundle.taskId);
  requireField(expectedTaskId === null || bundle.taskId === expectedTaskId, `Evidence bundle taskId ${bundle.taskId} does not match its file name`);
  requireField(typeof bundle.statement?.text === "string", "Evidence bundle is missing the statement text");
  requireField(bundle.manifest && typeof bundle.manifest === "object", "Evidence bundle is missing the code manifest");
  requireField(bundle.manifestFingerprint === canonicalFingerprint(bundle.manifest), "Evidence bundle manifest fingerprint does not match its manifest");
  requireField(bundle.signature === null || (typeof bundle.signature?.bundleText === "string" && typeof bundle.signature?.provider === "string"), "Evidence bundle signature is malformed");
  requireField(typeof bundle.digest === "string" && bundle.digest === evidenceBundleDigest(bundle), "Evidence bundle digest does not match its content");
  let statement;
  try { statement = JSON.parse(bundle.statement.text); } catch { throw evidenceError(E_EVIDENCE_BUNDLE_INVALID, "Evidence bundle statement text is not valid JSON"); }
  return { bundle, statement };
}
