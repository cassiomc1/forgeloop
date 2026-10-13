import { withTaskTransaction } from "./transaction.js";
import { withProjectReadSnapshot } from "../storage/project-read-snapshot.js";
import { canonicalFingerprint, readJsonArtifact, writeJsonArtifact } from "./artifacts.js";
import { assertSchema, readSchema } from "./schema-validation.js";
import { assertSecretFree } from "./receipt.js";
import { getPackageRoot } from "./templates.js";
import { readCodeManifest, validateCodeManifestBindings } from "./code-manifest.js";
import {
  taskAttestationStatementPath,
  taskAttestationStatementHistoryPath,
} from "./task-paths.js";
import { appendProtocolEvent } from "./events.js";
import { ensureWithin, fileExists } from "./filesystem.js";
import { operationalArtifactExists } from "../storage/operational-context.js";
import { resolveAttestationBundlePath } from "./attachment-paths.js";
import { E_ATTESTATION_CONFIGURATION_INVALID } from "./error-codes.js";

const STATEMENT_TYPE = "https://in-toto.io/Statement/v1";
const PREDICATE_TYPE = "https://forgeloop.dev/attestation/v1";

function attestationError(code, message, artifacts = []) {
  const error = new Error(message);
  error.name = "AttestationError";
  error.code = code;
  error.artifacts = artifacts;
  return error;
}

export async function validateAttestationPredicate(predicate, packageRoot = getPackageRoot()) {
  try {
    assertSchema(predicate, await readSchema("code-attestation", packageRoot), "ForgeLoop attestation predicate");
    assertSecretFree(predicate);
    return predicate;
  } catch (error) {
    throw attestationError("E_ATTESTATION_STATEMENT_INVALID", error.message);
  }
}

export async function validateAttestationStatement(statement, packageRoot = getPackageRoot()) {
  try {
    assertSchema(statement, await readSchema("in-toto-statement", packageRoot), "in-toto statement");
    if (statement._type !== STATEMENT_TYPE || statement.predicateType !== PREDICATE_TYPE) {
      throw attestationError("E_ATTESTATION_STATEMENT_INVALID", "Statement type or predicate type is not the ForgeLoop v1 contract");
    }
    await validateAttestationPredicate(statement.predicate, packageRoot);
    const subject = statement.subject[0];
    if (subject.name !== `forgeloop-task:${statement.predicate.task.taskId}`) {
      throw attestationError("E_ATTESTATION_SUBJECT_MISMATCH", "Statement subject does not match the attested task");
    }
    if (subject.digest.sha256 !== statement.predicate.content.contentDigest) {
      throw attestationError("E_ATTESTATION_SUBJECT_MISMATCH", "Statement subject digest does not match the predicate content digest");
    }
    assertSecretFree(statement);
    return statement;
  } catch (error) {
    if (error.code?.startsWith("E_ATTESTATION_")) throw error;
    throw attestationError("E_ATTESTATION_STATEMENT_INVALID", error.message);
  }
}

export async function buildAttestationStatement({
  target,
  packageRoot = getPackageRoot(),
  taskId,
  completionResult = null,
  auditResult = null,
  revisionProvider = null,
} = {}) {
  const manifestArtifact = await readCodeManifest({ target, packageRoot, taskId });
  const binding = await validateCodeManifestBindings({
    target,
    packageRoot,
    taskId,
    manifest: manifestArtifact.value,
    revisionProvider: revisionProvider ?? manifestArtifact.value.capture.revisionProvider,
  });
  let completion = completionResult;
  if (!completion) {
    const { evaluateCompletion } = await import("./completion.js");
    completion = await evaluateCompletion({ target, packageRoot, taskId });
  }
  if (completion.status !== "VALID") throw attestationError("E_ATTESTATION_STATEMENT_INVALID", "A VALID completion result is required before creating an attestation statement");
  let audit = auditResult;
  if (!audit) {
    const { evaluateAudit } = await import("./audit.js");
    audit = await evaluateAudit({ target, packageRoot, taskId });
  }
  if (audit.status !== "VALID") throw attestationError("E_ATTESTATION_STATEMENT_INVALID", "A VALID audit result is required before creating an attestation statement");
  const manifest = binding.manifest;
  const evidence = manifest.bindings;
  const coveredPaths = [...new Set(manifest.entries.flatMap((entry) => [entry.path, entry.sourcePath].filter(Boolean)))].sort();
  const predicate = await validateAttestationPredicate({
    schemaVersion: 1,
    protocol: { name: "ForgeLoop", protocolVersion: 1 },
    task: { taskId, verificationCycle: manifest.verificationCycle },
    content: {
      manifestFingerprint: manifestArtifact.fingerprint,
      contentDigest: manifest.contentDigest,
      coveredPaths,
    },
    evidence: {
      contractFingerprint: evidence.contractFingerprint,
      routeFingerprint: evidence.routeFingerprint,
      stateFingerprint: evidence.stateFingerprint,
      receiptFingerprint: evidence.receiptFingerprint,
      ledgerSeq: evidence.ledgerSeq,
      ledgerHash: evidence.ledgerHash,
    },
    verification: { completion: "VALID", audit: "VALID" },
  }, packageRoot);
  const statement = await validateAttestationStatement({
    schemaVersion: 1,
    _type: STATEMENT_TYPE,
    subject: [{ name: `forgeloop-task:${taskId}`, digest: { sha256: manifest.contentDigest } }],
    predicateType: PREDICATE_TYPE,
    predicate,
  }, packageRoot);
  return {
    statement,
    fingerprint: canonicalFingerprint(statement),
    manifest: manifestArtifact,
    completion,
    audit,
  };
}

export async function readAttestationStatement({ target, packageRoot = getPackageRoot(), taskId } = {}) {
  const relativePath = taskAttestationStatementPath(taskId);
  try {
    const artifact = await readJsonArtifact(target, relativePath, "in-toto-statement", packageRoot);
    await validateAttestationStatement(artifact.value, packageRoot);
    return artifact;
  } catch (error) {
    if (error.code === "ARTIFACT_MISSING") throw attestationError("E_ATTESTATION_STATEMENT_MISSING", `Attestation statement is missing: ${relativePath}`, [relativePath]);
    if (error.code?.startsWith("E_ATTESTATION_")) throw error;
    throw attestationError("E_ATTESTATION_STATEMENT_INVALID", error.message, [relativePath]);
  }
}

export async function writeAttestationStatement({ target, packageRoot = getPackageRoot(), taskId, statement } = {}) {
  await validateAttestationStatement(statement, packageRoot);
  return withTaskTransaction({ target, taskId, packageRoot, operation: "attestation-create" }, () =>
    writeValidatedAttestationStatement({ target, packageRoot, taskId, statement }));
}

async function writeValidatedAttestationStatement({ target, packageRoot, taskId, statement }) {
  const relativePath = taskAttestationStatementPath(taskId);
  if (operationalArtifactExists(target, relativePath) ?? await fileExists(ensureWithin(target, relativePath))) {
    let previous;
    try {
      previous = await readAttestationStatement({ target, packageRoot, taskId });
    } catch (error) {
      throw attestationError("E_ATTESTATION_STATEMENT_INVALID", `Existing attestation statement cannot be versioned safely: ${error.message}`, [relativePath]);
    }
    const previousCycle = previous.value.predicate.task.verificationCycle;
    const nextCycle = statement.predicate.task.verificationCycle;
    if (nextCycle <= previousCycle) {
      throw attestationError("E_ATTESTATION_STATEMENT_INVALID", "Attestation statement is immutable within a verification cycle", [relativePath]);
    }
    const historyPath = taskAttestationStatementHistoryPath(taskId, previousCycle);
    if (!(operationalArtifactExists(target, historyPath) ?? await fileExists(ensureWithin(target, historyPath)))) {
      await writeJsonArtifact(target, historyPath, previous.value, "in-toto-statement", packageRoot, { taskId, operation: "attestation-statement-history" });
    }
  }
  const artifact = await writeJsonArtifact(target, relativePath, statement, "in-toto-statement", packageRoot, { taskId, operation: "attestation-create" });
  await appendProtocolEvent(target, {
    taskId,
    event: "ATTESTATION_STATEMENT_CREATED",
    fingerprint: artifact.fingerprint,
    details: { statementFingerprint: artifact.fingerprint, manifestFingerprint: statement.predicate.content.manifestFingerprint },
  }, packageRoot, { taskId });
  return { path: relativePath, fingerprint: artifact.fingerprint, statement };
}

export async function resolveAttestationStatus(options = {}) {
  return withProjectReadSnapshot(options.target, () => resolveSelectedAttestationStatus(options));
}

async function resolveSelectedAttestationStatus({ target, packageRoot = getPackageRoot(), taskId, revisionProvider = null, bundlePath = null, requireSignature = false, signingProvider = null, signerPolicy = {} } = {}) {
  const result = {
    taskId,
    status: "MISSING",
    level: "PROCESSED",
    content: "NOT_CHECKED",
    receipt: "NOT_CHECKED",
    ledger: "NOT_CHECKED",
    signature: requireSignature ? "REQUIRED" : "NOT_CHECKED",
    signer: null,
    files: 0,
    subject: null,
    errors: [],
  };
  let effectiveRequireSignature = requireSignature === true;
  let effectiveSigningProvider = signingProvider;
  let effectiveSignerPolicy = { ...signerPolicy };
  let effectiveBundlePath = bundlePath;
  try {
    const { readConfig } = await import("./config.js");
    const config = await readConfig(target, packageRoot);
    const configuredSigning = config.attestation?.signing ?? {};
    effectiveRequireSignature ||= configuredSigning.required === true;
    effectiveSigningProvider ??= configuredSigning.provider;
    effectiveSignerPolicy = {
      ...(configuredSigning.policy ?? {}),
      ...signerPolicy,
    };
    result.signature = effectiveRequireSignature ? "REQUIRED" : "NOT_CHECKED";
    if ((config.attestation?.mode ?? "off") === "off" && !bundlePath && !effectiveRequireSignature) {
      result.status = "DISABLED";
      result.level = "PROCESSED";
      result.signature = "NOT_CHECKED";
      return result;
    }
  } catch (error) {
    if (error.code !== "ARTIFACT_MISSING") {
      result.status = "INVALID";
      result.errors.push({ code: E_ATTESTATION_CONFIGURATION_INVALID, message: error.message });
      return result;
    }
  }
  result.signature = effectiveRequireSignature ? "REQUIRED" : "NOT_CHECKED";
  try {
    if (effectiveBundlePath || effectiveRequireSignature) effectiveBundlePath = resolveAttestationBundlePath(target, taskId, effectiveBundlePath);
    const statement = await readAttestationStatement({ target, packageRoot, taskId });
    const manifest = await readCodeManifest({ target, packageRoot, taskId });
    const provider = revisionProvider ?? manifest.value.capture.revisionProvider;
    await validateCodeManifestBindings({ target, packageRoot, taskId, manifest: manifest.value, revisionProvider: provider });
    const { assertAttestationStatementBindings, verifyCodeManifestContent } = await import("./attestation-verifier.js");
    assertAttestationStatementBindings(statement.value, manifest.value, taskId, manifest.fingerprint);
    await verifyCodeManifestContent({
      target,
      manifest: manifest.value,
      revisionProvider: provider,
      revision: manifest.value.capture.mode === "WORKTREE" ? "WORKTREE" : manifest.value.capture.observedRevision,
    });
    result.status = "VALID";
    result.level = "VERIFIED";
    result.content = "VALID";
    result.receipt = "VALID";
    result.ledger = "VALID";
    result.files = statement.value.predicate.content.coveredPaths.length;
    result.subject = `sha256:${statement.value.subject[0].digest.sha256}`;
    if (effectiveRequireSignature && !(await fileExists(ensureWithin(target, effectiveBundlePath)))) {
      result.signature = "UNSIGNED";
      result.status = "INVALID";
      result.errors.push({ code: "E_ATTESTATION_UNSIGNED", message: `Required attestation signature bundle is missing: ${effectiveBundlePath}` });
      return result;
    }
    if (effectiveBundlePath) {
      const { assertSigningProvider, resolveSigningProvider } = await import("./signing/provider.js");
      const { SIGNING_PROVIDERS } = await import("./signing/registry.js");
      const signer = typeof effectiveSigningProvider === "object"
        ? assertSigningProvider(effectiveSigningProvider)
        : await resolveSigningProvider({ providerName: effectiveSigningProvider ?? effectiveSignerPolicy.provider ?? (effectiveBundlePath ? "sigstore" : "none"), registry: SIGNING_PROVIDERS });
      const verified = await signer.verify({ target, statementPath: taskAttestationStatementPath(taskId), bundlePath: effectiveBundlePath, policy: effectiveSignerPolicy });
      result.signature = verified.status;
      result.signer = verified.signer ?? null;
      if (verified.status === "VALID") result.level = "ATTESTED";
      else if (effectiveRequireSignature) {
        result.status = "INVALID";
        result.errors.push({ code: verified.code ?? (verified.status === "UNSIGNED" ? "E_ATTESTATION_UNSIGNED" : "E_ATTESTATION_SIGNATURE_INVALID"), message: verified.message ?? "Signature verification failed" });
      }
    }
  } catch (error) {
    if (["E_ATTESTATION_STATEMENT_MISSING", "E_ATTESTATION_MANIFEST_MISSING"].includes(error.code)) {
      result.status = "MISSING";
      result.level = "PROCESSED";
    } else {
      result.status = "INVALID";
    }
    result.errors.push({ code: error.code ?? "E_ATTESTATION_STATEMENT_INVALID", message: error.message });
  }
  return result;
}
