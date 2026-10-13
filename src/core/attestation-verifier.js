import { withProjectReadSnapshot } from "../storage/project-read-snapshot.js";
import { createHash } from "node:crypto";

import { canonicalFingerprint } from "./artifacts.js";
import { getPackageRoot } from "./templates.js";
import { readCodeManifest, validateCodeManifestBindings } from "./code-manifest.js";
import { readAttestationStatement, validateAttestationStatement } from "./attestation.js";
import { assertRevisionProvider, resolveRevisionProvider } from "./revision/provider.js";
import { REVISION_PROVIDERS } from "./revision/registry.js";
import { assertSigningProvider, resolveSigningProvider } from "./signing/provider.js";
import { SIGNING_PROVIDERS } from "./signing/registry.js";
import { taskAttestationStatementPath } from "./task-paths.js";
import { resolveAttestationBundlePath } from "./attachment-paths.js";
import { ensureWithin, fileExists } from "./filesystem.js";
import { E_ATTESTATION_CONFIGURATION_INVALID } from "./error-codes.js";

function verifierError(code, message, artifacts = []) {
  const error = new Error(message);
  error.name = "AttestationVerificationError";
  error.code = code;
  error.artifacts = artifacts;
  return error;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function assertAttestationStatementBindings(statement, manifest, taskId, manifestFingerprint = canonicalFingerprint(manifest)) {
  const predicate = statement.predicate;
  if (predicate.task.taskId !== taskId || predicate.task.verificationCycle !== manifest.verificationCycle) {
    throw verifierError("E_ATTESTATION_SCOPE_MISMATCH", "Attestation statement task or verification cycle does not match the manifest");
  }
  if (predicate.content.manifestFingerprint !== manifestFingerprint) {
    throw verifierError("E_ATTESTATION_SUBJECT_MISMATCH", "Statement does not bind the current code manifest");
  }
  if (predicate.content.contentDigest !== manifest.contentDigest) {
    throw verifierError("E_ATTESTATION_SUBJECT_MISMATCH", "Statement subject does not bind the manifest content digest");
  }
  const expectedPaths = [...new Set(manifest.entries.flatMap((entry) => [entry.path, entry.sourcePath].filter(Boolean)))].sort();
  const actualPaths = [...new Set(predicate.content.coveredPaths)].sort();
  if (JSON.stringify(expectedPaths) !== JSON.stringify(actualPaths)) {
    throw verifierError("E_ATTESTATION_SCOPE_MISMATCH", "Statement covered paths do not match the manifest");
  }
  const bindingPairs = [
    ["contractFingerprint", "E_ATTESTATION_CONTRACT_MISMATCH"],
    ["routeFingerprint", "E_ATTESTATION_ROUTE_MISMATCH"],
    ["stateFingerprint", "E_ATTESTATION_STATE_MISMATCH"],
    ["receiptFingerprint", "E_ATTESTATION_RECEIPT_MISMATCH"],
    ["ledgerSeq", "E_ATTESTATION_LEDGER_MISMATCH"],
    ["ledgerHash", "E_ATTESTATION_LEDGER_MISMATCH"],
  ];
  for (const [key, code] of bindingPairs) {
    if (predicate.evidence[key] !== manifest.bindings[key]) {
      throw verifierError(code, `Statement evidence does not match the manifest binding: ${key}`);
    }
  }
}

async function verifyEntryContent(provider, { target, revision }, entry) {
  if (entry.kind === "DELETED" || entry.operation === "DELETED") {
    try {
      await provider.readContent({ target, revision, path: entry.path });
      throw verifierError("E_ATTESTATION_CONTENT_MISMATCH", `Deleted path exists at revision ${revision}: ${entry.path}`);
    } catch (error) {
      if (error.code === "E_ATTESTATION_CONTENT_MISMATCH") throw error;
      if (error.notFound === true) return { valid: true };
      throw verifierError("E_ATTESTATION_CONTENT_MISMATCH", `Unable to prove that deleted path is absent at revision ${revision}: ${entry.path}`, [entry.path]);
    }
  }
  if (entry.kind === "GITLINK") {
    let identity;
    try {
      identity = await provider.getContentIdentity({ target, revision, path: entry.path });
    } catch (error) {
      if (error.notFound === true) throw verifierError("E_ATTESTATION_CONTENT_MISMATCH", `Gitlink is absent at revision ${revision}: ${entry.path}`, [entry.path]);
      throw error;
    }
    if (identity !== entry.providerContentId) {
      throw verifierError("E_ATTESTATION_CONTENT_MISMATCH", `Gitlink identity differs from the attested snapshot: ${entry.path}`, [entry.path]);
    }
    return { valid: true, actualIdentity: identity };
  }
  let bytes;
  try {
    bytes = await provider.readContent({ target, revision, path: entry.path });
  } catch (error) {
    if (error.code?.startsWith("E_REVISION_") && error.notFound !== true) throw error;
    throw verifierError("E_ATTESTATION_CONTENT_MISMATCH", `Attested path cannot be read at revision ${revision}: ${entry.path}`, [entry.path]);
  }
  const actualDigest = sha256(bytes);
  if (actualDigest !== entry.sha256) {
    throw verifierError("E_ATTESTATION_CONTENT_MISMATCH", `Current source content differs from the attested snapshot: ${entry.path}`, [entry.path]);
  }
  if (entry.providerContentId) {
    let actualIdentity;
    try {
      actualIdentity = await provider.getContentIdentity({ target, revision, path: entry.path });
    } catch (error) {
      if (error.code?.startsWith("E_REVISION_") && error.notFound !== true) throw error;
      throw verifierError("E_ATTESTATION_CONTENT_MISMATCH", `Attested provider identity cannot be read at revision ${revision}: ${entry.path}`, [entry.path]);
    }
    if (actualIdentity !== entry.providerContentId) {
      throw verifierError("E_ATTESTATION_CONTENT_MISMATCH", `Provider content identity differs from the attested snapshot: ${entry.path}`, [entry.path]);
    }
  }
  return { valid: true, actualDigest };
}

export async function verifyCodeManifestContent({ target, manifest, revisionProvider, revision = null } = {}) {
  const provider = typeof revisionProvider === "string"
    ? await resolveRevisionProvider({ target, providerName: revisionProvider, registry: REVISION_PROVIDERS })
    : revisionProvider;
  assertRevisionProvider(provider);
  const targetRevision = revision ?? (manifest.capture.mode === "WORKTREE" ? "WORKTREE" : manifest.capture.observedRevision);
  const results = [];
  for (const entry of manifest.entries) {
    results.push({ path: entry.path, ...(await verifyEntryContent(provider, { target, revision: targetRevision }, entry)) });
  }
  return { valid: true, revision: targetRevision, results, provider };
}

export async function verifyAttestation({
  target,
  packageRoot = getPackageRoot(),
  taskId,
  revision = null,
  bundlePath = null,
  identity = null,
  issuer = null,
  revisionProvider = null,
  signingProvider = null,
  trustedRoot = null,
  requireSignature = false,
} = {}) {
  const options = { target, packageRoot, taskId, revision, bundlePath, identity, issuer, revisionProvider, signingProvider, trustedRoot, requireSignature };
  return withProjectReadSnapshot(target, () => verifySelectedAttestation(options));
}

async function verifySelectedAttestation({
  target,
  packageRoot = getPackageRoot(),
  taskId,
  revision = null,
  bundlePath = null,
  identity = null,
  issuer = null,
  revisionProvider = null,
  signingProvider = null,
  trustedRoot = null,
  requireSignature = false,
} = {}) {
  let effectiveRequireSignature = requireSignature === true;
  let effectiveSigningProvider = signingProvider;
  let effectiveBundlePath = bundlePath;
  let configuredPolicy = {};
  let configurationError = null;
  try {
    const { readConfig } = await import("./config.js");
    const config = await readConfig(target, packageRoot);
    const signing = config.attestation?.signing ?? {};
    effectiveRequireSignature ||= signing.required === true;
    effectiveSigningProvider ??= signing.provider;
    configuredPolicy = signing.policy ?? {};
  } catch (error) {
    if (error.code !== "ARTIFACT_MISSING") configurationError = error;
  }
  const result = {
    schemaVersion: 1,
    status: "INVALID",
    level: "PROCESSED",
    taskId,
    revisionProvider: typeof revisionProvider === "string" ? revisionProvider : "git",
    revision: revision ?? null,
    content: { status: "NOT_CHECKED", checkedPaths: 0 },
    receipt: "NOT_CHECKED",
    statement: "NOT_CHECKED",
    ledger: "NOT_CHECKED",
    signature: { required: effectiveRequireSignature, status: effectiveRequireSignature ? "UNAVAILABLE" : "NOT_CHECKED" },
    errors: [],
  };
  if (configurationError) {
    result.errors.push({ code: E_ATTESTATION_CONFIGURATION_INVALID, message: configurationError.message });
    return result;
  }
  try {
    if (effectiveBundlePath || effectiveRequireSignature) effectiveBundlePath = resolveAttestationBundlePath(target, taskId, effectiveBundlePath);
    const statementArtifact = await readAttestationStatement({ target, packageRoot, taskId });
    const manifestArtifact = await readCodeManifest({ target, packageRoot, taskId });
    await validateAttestationStatement(statementArtifact.value, packageRoot);
    result.statement = "VALID";
    result.ledger = "VALID";
    result.receipt = "VALID";
    assertAttestationStatementBindings(
      statementArtifact.value,
      manifestArtifact.value,
      taskId,
      manifestArtifact.fingerprint,
    );
    const provider = typeof revisionProvider === "string"
      ? await resolveRevisionProvider({ target, providerName: revisionProvider, registry: REVISION_PROVIDERS })
      : revisionProvider ?? await resolveRevisionProvider({ target, providerName: manifestArtifact.value.capture.revisionProvider, registry: REVISION_PROVIDERS });
    result.revisionProvider = provider.name ?? result.revisionProvider;
    await validateCodeManifestBindings({ target, packageRoot, taskId, manifest: manifestArtifact.value, revisionProvider: provider });
    const content = await verifyCodeManifestContent({ target, manifest: manifestArtifact.value, revisionProvider: provider, revision });
    result.revision = content.revision;
    result.content = { status: "VALID", checkedPaths: content.results.length };
    const signingPolicy = {
      ...configuredPolicy,
      identity,
      issuer,
      ...(trustedRoot ? { trustedRoot } : {}),
    };
    if (effectiveRequireSignature && !(await fileExists(ensureWithin(target, effectiveBundlePath)))) {
      throw verifierError("E_ATTESTATION_UNSIGNED", `Required attestation signature bundle is missing: ${effectiveBundlePath}`);
    }
    const signer = typeof effectiveSigningProvider === "object"
      ? assertSigningProvider(effectiveSigningProvider)
      : await resolveSigningProvider({
        providerName: effectiveSigningProvider ?? (effectiveBundlePath ? "sigstore" : "none"),
        registry: SIGNING_PROVIDERS,
      });
    const signature = await signer.verify({
      target,
      statementPath: taskAttestationStatementPath(taskId),
      bundlePath: effectiveBundlePath,
      policy: signingPolicy,
    });
    result.signature = {
      required: effectiveRequireSignature,
      status: signature.status,
      provider: signer.name,
      ...(identity ? { identity } : {}),
      ...(issuer ? { issuer } : {}),
    };
    if (effectiveRequireSignature && signature.status !== "VALID") {
      throw verifierError(signature.code ?? "E_ATTESTATION_SIGNATURE_INVALID", signature.message ?? "Required signature is not valid");
    }
    result.status = "VALID";
    result.level = signature.status === "VALID" ? "ATTESTED" : "VERIFIED";
    return result;
  } catch (error) {
    result.errors.push({ code: error.code ?? "E_ATTESTATION_STATEMENT_INVALID", message: error.message, ...(error.artifacts ? { artifacts: error.artifacts } : {}) });
    return result;
  }
}
