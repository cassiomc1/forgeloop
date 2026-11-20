import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { validateAttestationStatement } from "../attestation.js";
import { assertAttestationStatementBindings, verifyCodeManifestContent } from "../attestation-verifier.js";
import { validateCodeManifest } from "../code-manifest.js";
import { E_ATTESTATION_CONTENT_MISMATCH, E_ATTESTATION_COVERAGE_GAP, E_ATTESTATION_UNSIGNED, E_DELEGATION_EVIDENCE_MISSING, E_DELEGATION_SCOPE_VIOLATION, E_DELEGATION_VERIFICATION_UNMET, E_EVIDENCE_ASSURANCE_INSUFFICIENT, E_EVIDENCE_BUNDLE_INVALID } from "../error-codes.js";
import { resolveRevisionProvider } from "../revision/provider.js";
import { REVISION_PROVIDERS } from "../revision/registry.js";
import { createSigstoreSigningProvider } from "../signing/sigstore.js";
import { getPackageRoot } from "../templates.js";
import { DEFAULT_EVIDENCE_DIRECTORY, parseEvidenceBundle } from "./bundle-format.js";

export const EVIDENCE_LEVELS = Object.freeze({ ATTESTED: "ATTESTED", INTEGRITY_ONLY: "INTEGRITY_ONLY", NONE: "NONE" });
// Execution assurance (docs/PROTOCOL_SPEC.md Section 7.2): who ran the checks.
export const EXECUTION_ASSURANCE = Object.freeze(["UNKNOWN", "REPORTED", "EXECUTED", "HOST_ATTESTED"]);
// A workload identity issuer: a signature under this issuer policy was made by
// a CI job, outside the actor's control.
export const HOST_WORKLOAD_ISSUERS = Object.freeze(["https://token.actions.githubusercontent.com"]);
const assuranceRank = (value) => EXECUTION_ASSURANCE.indexOf(value);

export function predicateExecutionAssurance(predicate) {
  const checks = predicate?.verification?.checks;
  if (!(predicate?.schemaVersion >= 2) || !Array.isArray(checks) || checks.length === 0) return "UNKNOWN";
  return checks.every((check) => check.provenance === "FORGELOOP_EXECUTED") ? "EXECUTED" : "REPORTED";
}

export const UNSIGNED_WARNING = "Unsigned evidence bundles prove internal consistency with the committed code, not that ForgeLoop produced them; require signatures to use this check as a trust gate.";

const normalize = (value) => String(value).replaceAll("\\", "/").replace(/^\.\//u, "");
const entryPaths = (entry) => [entry.path, entry.sourcePath].filter(Boolean).map(normalize);

function isExcluded(value, directory, exclusions) {
  if (value === ".forgeloop" || value.startsWith(".forgeloop/")) return true;
  if (value === directory || value.startsWith(`${directory}/`)) return true;
  return exclusions.some((pattern) => {
    const normalized = normalize(pattern);
    if (normalized.endsWith("/**")) return value === normalized.slice(0, -3) || value.startsWith(normalized.slice(0, -2));
    return value === normalized;
  });
}

async function resolveProvider(target, revisionProvider) {
  return typeof revisionProvider === "string"
    ? resolveRevisionProvider({ target, providerName: revisionProvider, registry: REVISION_PROVIDERS })
    : revisionProvider;
}

function changedBundlePaths(changedEntries, directory) {
  return [...new Set(changedEntries
    .filter((entry) => entry.kind !== "DELETED" && entry.operation !== "DELETED")
    .map((entry) => normalize(entry.path))
    .filter((value) => value.startsWith(`${directory}/`) && value.endsWith(".json")))].sort();
}

async function verifySignature({ statementText, signature, signer, policy }) {
  if (!signature) return { status: "UNSIGNED" };
  const directory = await mkdtemp(path.join(os.tmpdir(), "forgeloop-evidence-signature-"));
  try {
    await writeFile(path.join(directory, "statement.json"), statementText);
    await writeFile(path.join(directory, "statement.sigstore.json"), signature.bundleText);
    const result = await signer.verify({ target: directory, statementPath: "statement.json", bundlePath: "statement.sigstore.json", policy });
    return { status: result.status, ...(result.code ? { code: result.code } : {}), ...(result.message ? { message: result.message } : {}) };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function verifyEntries({ target, manifest, provider, headRevision }) {
  const entries = [];
  for (const entry of manifest.entries) {
    try {
      await verifyCodeManifestContent({ target, manifest: { ...manifest, entries: [entry] }, revisionProvider: provider, revision: headRevision });
      entries.push({ paths: entryPaths(entry), digest: entry.sha256 ?? entry.providerContentId ?? entry.kind, matches: true });
    } catch (error) {
      if (error.code !== E_ATTESTATION_CONTENT_MISMATCH) throw error;
      entries.push({ paths: entryPaths(entry), digest: entry.sha256 ?? entry.providerContentId ?? entry.kind, matches: false });
    }
  }
  return entries;
}

async function loadBundle(context, bundlePath) {
  const { target, provider, headRevision, packageRoot, signer, policy } = context;
  const expectedTaskId = path.posix.basename(bundlePath, ".json");
  const record = { path: bundlePath, taskId: expectedTaskId, integrity: "INVALID", signature: { status: "NOT_CHECKED" }, assurance: "UNKNOWN", entries: [] };
  try {
    const bytes = await provider.readContent({ target, revision: headRevision, path: bundlePath });
    const { bundle, statement } = parseEvidenceBundle(Buffer.from(bytes).toString("utf8"), expectedTaskId);
    await validateAttestationStatement(statement, packageRoot);
    const manifest = await validateCodeManifest(bundle.manifest, packageRoot);
    assertAttestationStatementBindings(statement, manifest, bundle.taskId, bundle.manifestFingerprint);
    record.entries = await verifyEntries({ target, manifest, provider, headRevision });
    record.integrity = "VALID";
    record.signature = await verifySignature({ statementText: bundle.statement.text, signature: bundle.signature, signer, policy });
    record.assurance = predicateExecutionAssurance(statement.predicate);
    record.coveredPaths = statement.predicate.content.coveredPaths.map(normalize);
    record.checks = Array.isArray(statement.predicate.verification?.checks) ? statement.predicate.verification.checks : null;
    if (record.assurance === "EXECUTED" && record.signature.status === "VALID" && HOST_WORKLOAD_ISSUERS.includes(policy.issuer)) {
      record.assurance = "HOST_ATTESTED";
    }
  } catch (error) {
    if (error.code?.startsWith("E_REVISION_")) throw error;
    record.error = { code: error.code?.startsWith("E_") ? error.code : E_EVIDENCE_BUNDLE_INVALID, message: error.message };
  }
  return record;
}

function coverageFor(changedPaths, bundles) {
  const covering = new Map();
  for (const bundle of bundles.filter((item) => item.integrity === "VALID")) {
    for (const entry of bundle.entries.filter((item) => item.matches)) {
      for (const value of entry.paths) covering.set(value, [...(covering.get(value) ?? []), bundle.taskId]);
    }
  }
  const errors = [];
  const superseded = [];
  for (const bundle of bundles.filter((item) => item.integrity === "VALID")) {
    for (const entry of bundle.entries.filter((item) => !item.matches)) {
      for (const value of entry.paths) {
        if (covering.has(value)) superseded.push({ path: value, taskId: bundle.taskId, supersededBy: [...new Set(covering.get(value))].sort() });
        else errors.push({ code: E_ATTESTATION_CONTENT_MISMATCH, taskId: bundle.taskId, path: value, message: `Evidence for ${value} does not match the head revision and no other bundle covers it` });
      }
    }
  }
  const uncoveredPaths = changedPaths.filter((value) => !covering.has(value));
  return { covering, errors, superseded, uncoveredPaths };
}

function signerPolicyFrom(signerPolicy) {
  return Object.fromEntries(["identity", "issuer", "trustedRoot"].filter((key) => signerPolicy[key]).map((key) => [key, signerPolicy[key]]));
}

function signatureErrors(bundles) {
  return bundles.filter((bundle) => bundle.signature.status !== "VALID").map((bundle) => ({
    code: bundle.signature.code ?? E_ATTESTATION_UNSIGNED,
    taskId: bundle.taskId,
    message: bundle.signature.message ?? `Evidence for task ${bundle.taskId} has no valid signature`,
  }));
}

function overallLevel(status, usedBundles) {
  if (status !== "VALID") return EVIDENCE_LEVELS.NONE;
  return usedBundles.length > 0 && usedBundles.every((bundle) => bundle.signature.status === "VALID") ? EVIDENCE_LEVELS.ATTESTED : EVIDENCE_LEVELS.INTEGRITY_ONLY;
}

const withinPath = (value, root) => value === root || value.startsWith(`${root}/`);

// docs/PROTOCOL_SPEC.md Section 8: accept a delegate's work only on evidence.
// The brief is already validated (validateTaskBrief).
export function delegationErrors(brief, bundles) {
  const bundle = bundles.find((item) => item.taskId === brief.taskId && item.integrity === "VALID");
  if (!bundle) {
    return [{ code: E_DELEGATION_EVIDENCE_MISSING, taskId: brief.taskId, message: `No intact evidence bundle for delegated task ${brief.taskId} in the range` }];
  }
  const errors = [];
  const outside = bundle.coveredPaths.filter((value) => !brief.allowedPaths.some((root) => withinPath(value, root)));
  const readOnly = bundle.coveredPaths.filter((value) => brief.readOnlyPaths.some((root) => withinPath(value, root)));
  if (outside.length > 0 || readOnly.length > 0) {
    errors.push({ code: E_DELEGATION_SCOPE_VIOLATION, taskId: brief.taskId, paths: [...new Set([...outside, ...readOnly])].sort(), message: `Delegated task ${brief.taskId} changed paths outside its brief: ${[...new Set([...outside, ...readOnly])].sort().join(", ")}` });
  }
  const passed = (bundle.checks ?? []).filter((check) => check.status === "passed");
  const unmet = brief.verification.filter((item) => !passed.some((check) => check.requirement === item || check.id === item));
  if (unmet.length > 0) {
    errors.push({
      code: E_DELEGATION_VERIFICATION_UNMET,
      taskId: brief.taskId,
      requirements: unmet,
      message: bundle.checks === null
        ? `Delegated task ${brief.taskId} has a version-1 predicate, which binds no checks; its brief verification cannot be proven`
        : `Delegated task ${brief.taskId} has no passing bound check for: ${unmet.join("; ")}`,
    });
  }
  return errors;
}

export async function verifyEvidenceRange({
  target,
  packageRoot = getPackageRoot(),
  revisionProvider = "git",
  baseRevision,
  headRevision,
  directory = DEFAULT_EVIDENCE_DIRECTORY,
  requireCompleteCoverage = true,
  requireSignature = false,
  signerPolicy = {},
  signingProvider = null,
  exclusions = [],
  minAssurance = null,
  brief = null,
} = {}) {
  if (minAssurance !== null && !EXECUTION_ASSURANCE.includes(minAssurance)) {
    throw Object.assign(new Error(`Unknown execution assurance: ${minAssurance} (expected ${EXECUTION_ASSURANCE.join(", ")})`), { code: "E_CLI_INVOCATION_INVALID" });
  }
  const evidenceDirectory = normalize(directory).replace(/\/+$/u, "");
  const provider = await resolveProvider(target, revisionProvider);
  const changedEntries = await provider.getChangedEntries({ target, baseRevision, headRevision });
  const changedPaths = [...new Set(changedEntries.flatMap(entryPaths))].filter((value) => !isExcluded(value, evidenceDirectory, exclusions)).sort();
  const policy = signerPolicyFrom(signerPolicy);
  const context = { target, provider, headRevision, packageRoot, signer: signingProvider ?? createSigstoreSigningProvider(), policy };
  const bundles = [];
  for (const bundlePath of changedBundlePaths(changedEntries, evidenceDirectory)) bundles.push(await loadBundle(context, bundlePath));
  const coverage = coverageFor(changedPaths, bundles);
  const errors = [
    ...bundles.filter((bundle) => bundle.error).map((bundle) => ({ ...bundle.error, taskId: bundle.taskId, path: bundle.path })),
    ...coverage.errors,
  ];
  if (requireCompleteCoverage && coverage.uncoveredPaths.length > 0) {
    errors.push({ code: E_ATTESTATION_COVERAGE_GAP, message: `Changed paths are not covered by evidence: ${coverage.uncoveredPaths.join(", ")}`, paths: coverage.uncoveredPaths });
  }
  const usedBundles = bundles.filter((bundle) => bundle.integrity === "VALID");
  if (requireSignature) errors.push(...signatureErrors(usedBundles));
  const assurance = usedBundles.length === 0 ? "UNKNOWN"
    : usedBundles.map((bundle) => bundle.assurance).reduce((low, value) => (assuranceRank(value) < assuranceRank(low) ? value : low));
  if (minAssurance !== null && assuranceRank(assurance) < assuranceRank(minAssurance)) {
    errors.push({ code: E_EVIDENCE_ASSURANCE_INSUFFICIENT, message: `Execution assurance ${assurance} is below the required ${minAssurance}`, assurance, required: minAssurance });
  }
  const delegation = brief ? delegationErrors(brief, bundles) : null;
  if (delegation) errors.push(...delegation);
  const status = errors.length === 0 ? "VALID" : "INVALID";
  const level = overallLevel(status, usedBundles);
  return {
    schemaVersion: 1,
    kind: "forgeloop-evidence-verification",
    status,
    level,
    assurance,
    ...(minAssurance !== null ? { minAssurance } : {}),
    ...(brief ? { delegation: { taskId: brief.taskId, status: delegation.length === 0 ? "ACCEPTED" : "REJECTED" } } : {}),
    revisionProvider: provider.name ?? "unknown",
    baseRevision: baseRevision ?? null,
    headRevision: headRevision ?? null,
    evidenceDirectory,
    changedPaths: changedPaths.length,
    coveredPaths: changedPaths.length - coverage.uncoveredPaths.length,
    uncoveredPaths: coverage.uncoveredPaths,
    superseded: coverage.superseded,
    bundles: bundles.map(({ entries, coveredPaths: _coveredPaths, checks: _checks, ...bundle }) => ({ ...bundle, entries: entries.length, matchingEntries: entries.filter((entry) => entry.matches).length })),
    signature: { required: requireSignature, ...policy },
    warnings: level === EVIDENCE_LEVELS.INTEGRITY_ONLY ? [UNSIGNED_WARNING] : [],
    errors,
  };
}
